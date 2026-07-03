import path from "node:path";
import { loadConfig } from "../config.js";
import { loadManifest } from "../config/manifest.js";
import { currentHead, detectRenames } from "../adapters/git.js";
import type { Ledger } from "../domain/ledger.js";
import { FileLedgerStore } from "../adapters/file-ledger-store.js";
import { planSync } from "../app/plan.js";
import { runActions } from "../app/run.js";
import {
  createGoogleDrivePublisher,
  GOOGLE_DRIVE_PROVIDER_ID,
} from "../publishers/google-drive/publisher.js";

export async function main(): Promise<void> {
  loadConfig(); // fail fast if GOOGLE_APPLICATION_CREDENTIALS is missing
  const repoRoot = process.cwd();
  const manifest = loadManifest(path.join(repoRoot, "docpipe.yaml"));

  const docsRoot = path.join(repoRoot, manifest.source.docsDir);
  const ledgerStore = new FileLedgerStore(path.join(repoRoot, "_index.json"));
  const writeLedger = (ledger: Ledger): Promise<void> =>
    ledgerStore.save(ledger);

  // V1 wires one publisher type. Each google-docs target keys its publications
  // under the same providerId ("google-drive"), so a single target keeps the
  // ledger unambiguous; multi-target dispatch is a later step.
  const googleTargets = manifest.targets.filter((t) => t.type === "google-docs");
  if (googleTargets.length > 1) {
    throw new Error(
      "V1 supports a single google-docs target; multi-target dispatch is not wired yet.",
    );
  }

  let index = await ledgerStore.load();
  let totalFailed = 0;

  // Rename detection (P0-8): diff the last-synced commit against HEAD. When no
  // SHA is recorded yet (or Git is unavailable), fall back to content-hash
  // matching in the planner.
  const head = currentHead(repoRoot);
  const renames = detectRenames(
    repoRoot,
    index.lastSyncedSha,
    manifest.source.docsDir,
  );
  const hashFallback = !index.lastSyncedSha || head === null;

  for (const target of googleTargets) {
    const actions = await planSync({
      docsRoot,
      repoRoot,
      index,
      targetName: target.name,
      providerId: GOOGLE_DRIVE_PROVIDER_ID,
      defaultPublish: manifest.defaults.publish,
      onDelete: manifest.defaults.onDelete,
      renames,
      hashFallback,
    });

    const counts: Record<string, number> = {};
    for (const a of actions) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
    console.log(
      `[${target.name}] planned: ${actions.length} file(s) — ${JSON.stringify(counts)}`,
    );

    const hasWork = actions.some((a) => a.kind !== "skip");
    if (!hasWork) {
      console.log(`[${target.name}] nothing to sync.`);
      continue;
    }

    const publisher = await createGoogleDrivePublisher({
      driveFolderId: target.driveFolderId,
      orgDomain: target.orgDomain,
    });
    const { next, failed } = await runActions(
      publisher,
      index,
      actions,
      writeLedger,
    );
    index = next;
    totalFailed += failed;
    await ledgerStore.save(index);
    console.log(`[${target.name}] ledger updated`);
  }

  // Advance the rename-detection baseline only on a clean run, so a partial
  // failure re-detects the same renames next time instead of missing them.
  if (totalFailed === 0 && head && index.lastSyncedSha !== head) {
    index.lastSyncedSha = head;
    await ledgerStore.save(index);
    console.log(`ledger baseline advanced to ${head.slice(0, 7)}`);
  }

  if (totalFailed > 0) {
    throw new Error(
      `${totalFailed} document(s) failed to publish. See the log above.`,
    );
  }
}
