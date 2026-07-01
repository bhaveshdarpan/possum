import path from "node:path";
import { loadConfig } from "./config.js";
import { loadManifest } from "./config/manifest.js";
import { readIndex, writeIndex } from "./index/io.js";
import type { IndexFile } from "./index/schema.js";
import { planSync } from "./orchestrator/plan.js";
import { runActions } from "./orchestrator/run.js";
import { createDriveContext } from "./providers/google-drive/auth.js";

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

  for (const target of googleTargets) {
    const actions = await planSync({
      docsRoot,
      repoRoot,
      index,
      targetName: target.name,
      defaultPublish: manifest.defaults.publish,
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

    const ctx = await createDriveContext({
      rootFolderId: target.driveFolderId,
      orgDomain: target.orgDomain,
    });
    const { next, failed } = await runActions(ctx, index, actions, writeLedger);
    index = next;
    totalFailed += failed;
    await writeIndex(indexPath, index);
    console.log(`[${target.name}] index updated: ${path.relative(repoRoot, indexPath)}`);
  }

  if (totalFailed > 0) {
    throw new Error(
      `${totalFailed} document(s) failed to publish. See the log above.`,
    );
  }
}
