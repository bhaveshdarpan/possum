import { planSync } from "./plan.js";
import { runActions, type ActionResult } from "./run.js";
import type { Ledger } from "../domain/ledger.js";
import type { OnDelete, PublishPlan } from "../domain/publish-plan.js";
import type { Publisher } from "../ports/publisher.js";
import type { LedgerStore } from "../ports/ledger-store.js";

// A target the pipeline publishes to. `createPublisher` is lazy — only invoked
// when the target actually has work, so a dry-run (or a no-op run) never builds
// an authenticated client.
export type PipelineTarget = {
  name: string; // manifest target name — used for routing
  providerId: string; // ledger key for this target's publications
  createPublisher: () => Promise<Publisher>;
};

export type PipelineDeps = {
  docsRoot: string;
  repoRoot: string;
  targets: PipelineTarget[];
  defaultPublish: string[];
  onDelete: OnDelete;
  renames: Map<string, string>;
  hashFallback: boolean;
  head: string | null;
  ledger: Ledger;
  ledgerStore: LedgerStore;
  dryRun: boolean;
};

export type TargetOutcome = {
  target: string;
  plan: PublishPlan;
  counts: Record<string, number>;
  failed: number;
  executed: boolean; // false for a dry-run or when there was no work
  results: ActionResult[]; // per-action outcomes (empty unless executed)
};

export type RunReport = {
  dryRun: boolean;
  targets: TargetOutcome[];
  failed: number;
  baselineAdvancedTo?: string;
};

// The application orchestrator: for each target, decide a PublishPlan and — unless
// this is a dry-run — execute it, persisting the ledger. Depends only on domain +
// ports (no Google / Git / fs specifics), so it is unit-testable with fakes. It
// returns a structured RunReport; rendering and exit codes are the caller's job.
export async function runPipeline(deps: PipelineDeps): Promise<RunReport> {
  let ledger = deps.ledger;
  let totalFailed = 0;
  const targets: TargetOutcome[] = [];

  for (const target of deps.targets) {
    const plan = await planSync({
      docsRoot: deps.docsRoot,
      repoRoot: deps.repoRoot,
      index: ledger,
      targetName: target.name,
      providerId: target.providerId,
      defaultPublish: deps.defaultPublish,
      onDelete: deps.onDelete,
      renames: deps.renames,
      hashFallback: deps.hashFallback,
    });

    const counts: Record<string, number> = {};
    for (const a of plan) counts[a.kind] = (counts[a.kind] ?? 0) + 1;

    const hasWork = plan.some((a) => a.kind !== "skip");
    if (deps.dryRun || !hasWork) {
      targets.push({
        target: target.name,
        plan,
        counts,
        failed: 0,
        executed: false,
        results: [],
      });
      continue;
    }

    const publisher = await target.createPublisher();
    const { next, failed, results } = await runActions(publisher, ledger, plan, (l) =>
      deps.ledgerStore.save(l),
    );
    ledger = next;
    totalFailed += failed;
    await deps.ledgerStore.save(ledger);
    targets.push({ target: target.name, plan, counts, failed, executed: true, results });
  }

  const report: RunReport = { dryRun: deps.dryRun, targets, failed: totalFailed };

  // Advance the rename-detection baseline only on a clean, real run, so a
  // partial failure re-detects the same renames next time instead of missing them.
  if (
    !deps.dryRun &&
    totalFailed === 0 &&
    deps.head &&
    ledger.lastSyncedSha !== deps.head
  ) {
    ledger.lastSyncedSha = deps.head;
    await deps.ledgerStore.save(ledger);
    report.baselineAdvancedTo = deps.head;
  }

  return report;
}
