import path from "node:path";
import { loadConfig } from "./config.js";
import { loadManifest } from "./config/manifest.js";
import { currentHead, detectRenames } from "./git.js";
import { readIndex, writeIndex } from "./index/io.js";
import type { IndexFile } from "./index/schema.js";
import { planSync } from "./orchestrator/plan.js";
import { runActions } from "./orchestrator/run.js";
import { createGoogleDrivePublisher } from "./publishers/google-drive/publisher.js";

export async function main(): Promise<void> {
  loadConfig(); // fail fast if GOOGLE_APPLICATION_CREDENTIALS is missing
  const repoRoot = process.cwd();
  const manifest = loadManifest(path.join(repoRoot, "docpipe.yaml"));

  const docsRoot = path.join(repoRoot, manifest.source.docsDir);
  const indexPath = path.join(repoRoot, "_index.json");
  const writeLedger = (idx: IndexFile): Promise<void> =>
    writeIndex(indexPath, idx);

  // V1 has one publisher type. Multi-target dispatch (a distinct ledger key per
  // target) lands with the ADR-0006 ports refactor; until then the ledger key
  // is the fixed "google-drive" provider, so a single target keeps it stable.
  const googleTargets = manifest.targets.filter((t) => t.type === "google-docs");
  if (googleTargets.length > 1) {
    throw new Error(
      "Phase 1 supports a single google-docs target; multi-target dispatch lands with the ADR-0006 refactor.",
    );
  }

  let index = await readIndex(indexPath);
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
    await writeIndex(indexPath, index);
    console.log(`[${target.name}] index updated: ${path.relative(repoRoot, indexPath)}`);
  }

  // Advance the rename-detection baseline only on a clean run, so a partial
  // failure re-detects the same renames next time instead of missing them.
  if (totalFailed === 0 && head && index.lastSyncedSha !== head) {
    index.lastSyncedSha = head;
    await writeIndex(indexPath, index);
    console.log(`ledger baseline advanced to ${head.slice(0, 7)}`);
  }

  if (totalFailed > 0) {
    throw new Error(
      `${totalFailed} document(s) failed to publish. See the log above.`,
    );
  }
}
