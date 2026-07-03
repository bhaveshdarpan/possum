import path from "node:path";
import { loadConfig } from "../config.js";
import { loadManifest } from "../config/manifest.js";
import { currentHead, detectRenames } from "../adapters/git.js";
import { FileLedgerStore } from "../adapters/file-ledger-store.js";
import { runPipeline, type RunReport } from "../app/pipeline.js";
import {
  createGoogleDrivePublisher,
  GOOGLE_DRIVE_PROVIDER_ID,
} from "../publishers/google-drive/publisher.js";

// Composition root: build the concrete adapters (ledger store, Google publisher)
// and Git-derived inputs, then hand them to the pure app orchestrator. Returns
// the RunReport; the CLI renders it and maps failures to an exit code.
export async function main(
  opts: { dryRun?: boolean; manifestPath?: string; repoRoot?: string } = {},
): Promise<RunReport> {
  const dryRun = opts.dryRun ?? false;
  // Planning is read-only (local files + ledger + Git), so a dry-run needs no
  // service-account key — only real publishing does.
  if (!dryRun) loadConfig(); // fail fast if GOOGLE_APPLICATION_CREDENTIALS is missing
  const repoRoot = opts.repoRoot ?? process.cwd();
  const manifest = loadManifest(
    opts.manifestPath ?? path.join(repoRoot, "docpipe.yaml"),
  );

  const ledgerStore = new FileLedgerStore(path.join(repoRoot, manifest.ledger));
  const ledger = await ledgerStore.load();

  // V1 wires one publisher type; a single google-docs target keeps the ledger
  // key ("google-drive") unambiguous. Multi-target dispatch is a later step.
  const googleTargets = manifest.targets.filter((t) => t.type === "google-docs");
  if (googleTargets.length > 1) {
    throw new Error(
      "V1 supports a single google-docs target; multi-target dispatch is not wired yet.",
    );
  }

  const head = currentHead(repoRoot);
  return runPipeline({
    docsRoot: path.join(repoRoot, manifest.source.docsDir),
    repoRoot,
    targets: googleTargets.map((t) => ({
      name: t.name,
      providerId: GOOGLE_DRIVE_PROVIDER_ID,
      createPublisher: () =>
        createGoogleDrivePublisher({
          driveFolderId: t.driveFolderId,
          orgDomain: t.orgDomain,
        }),
    })),
    defaultPublish: manifest.defaults.publish,
    onDelete: manifest.defaults.onDelete,
    renames: detectRenames(
      repoRoot,
      ledger.lastSyncedSha,
      manifest.source.docsDir,
    ),
    hashFallback: !ledger.lastSyncedSha || head === null,
    head,
    ledger,
    ledgerStore,
    dryRun,
  });
}
