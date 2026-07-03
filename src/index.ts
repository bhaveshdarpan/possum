// Public API for programmatic use. The CLI (bin: docpipe) is the primary entry;
// this barrel lets other tooling embed the engine or compose a custom run.
//
// - `main` is the Google-Drive composition root (reads docpipe.yaml, wires the
//   Drive publisher) — the same thing the CLI runs.
// - `runPipeline` is the pure orchestrator: inject your own Publisher(s) and
//   LedgerStore to publish to a different surface without the CLI.
export { main } from "./cli/main.js";
export {
  runPipeline,
  type PipelineDeps,
  type PipelineTarget,
  type RunReport,
  type TargetOutcome,
} from "./app/pipeline.js";
export { loadManifest, type Manifest, type Target } from "./config/manifest.js";
export type { Ledger, Publication } from "./domain/ledger.js";
export type { LedgerStore } from "./ports/ledger-store.js";
export type {
  Publisher,
  DestinationRef,
  RenderedDoc,
  PublishTargetDoc,
} from "./ports/publisher.js";
export type { PublishAction, PublishPlan } from "./domain/publish-plan.js";
