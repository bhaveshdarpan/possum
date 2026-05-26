import path from "node:path";
import { loadConfig } from "./config.js";
import { readIndex, writeIndex } from "./index/io.js";
import { planSync } from "./orchestrator/plan.js";
import { runActions } from "./orchestrator/run.js";
import { createDriveContext } from "./providers/google-drive/auth.js";

export async function main(): Promise<void> {
  const config = loadConfig();
  const repoRoot = process.cwd();
  const docsRoot = path.join(repoRoot, "docs");
  const indexPath = path.join(repoRoot, "_index.json");

  const index = await readIndex(indexPath);
  const actions = await planSync({ docsRoot, repoRoot, index });

  const counts: Record<string, number> = {};
  for (const a of actions) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  console.log(
    `planned: ${actions.length} file(s) — ${JSON.stringify(counts)}`,
  );

  const hasWork = actions.some((a) => a.kind !== "skip");
  if (!hasWork) {
    console.log("nothing to sync.");
    return;
  }

  const ctx = await createDriveContext({
    rootFolderId: config.DRIVE_ROOT_FOLDER_ID,
    orgDomain: config.ORG_DOMAIN,
  });
  const next = await runActions(ctx, index, actions);
  await writeIndex(indexPath, next);
  console.log(`index updated: ${path.relative(repoRoot, indexPath)}`);
}
