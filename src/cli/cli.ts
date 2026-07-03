#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { main } from "./main.js";
import type { RunReport } from "../app/pipeline.js";
import type { PublishAction } from "../domain/publish-plan.js";

const COUNT_ORDER = ["create", "update", "rename", "delete", "skip"];

// One-line description of a planned action, for the dry-run plan listing.
function describeAction(a: PublishAction): string | null {
  switch (a.kind) {
    case "create":
      return `  create  ${a.sourcePath}`;
    case "update":
      return `  update  ${a.sourcePath}`;
    case "rename":
      return `  rename  ${a.fromPath} → ${a.sourcePath}`;
    case "delete":
      return `  delete  ${a.sourcePath}  (${a.onDelete})`;
    case "skip":
      return null; // omitted from the listing; still counted
  }
}

// Render the orchestrator's RunReport to stdout. This is the only place the CLI
// turns structured results into human/CI output.
function renderReport(report: RunReport): void {
  for (const t of report.targets) {
    const summary = COUNT_ORDER.filter((k) => t.counts[k])
      .map((k) => `${t.counts[k]} ${k}`)
      .join(", ");
    if (report.dryRun) {
      console.log(`[${t.target}] dry-run plan — ${summary || "no changes"}`);
      for (const a of t.plan) {
        const line = describeAction(a);
        if (line) console.log(line);
      }
    } else if (!t.executed) {
      console.log(`[${t.target}] nothing to sync.`);
    } else {
      const failed = t.failed > 0 ? `, ${t.failed} failed` : "";
      console.log(`[${t.target}] done — ${summary || "no changes"}${failed}`);
    }
  }
  if (report.baselineAdvancedTo) {
    console.log(`ledger baseline advanced to ${report.baselineAdvancedTo.slice(0, 7)}`);
  }
}

const USAGE = `docpipe — publish Markdown docs from Git to configured targets

Usage:
  docpipe push [options]     Publish docs to their targets (updates the ledger)
  docpipe plan [options]     Show what push would do; write nothing (alias: push --dry-run)

Options:
  --manifest <path>          Path to docpipe.yaml (default: ./docpipe.yaml)
  --dry-run                  Plan only; make no changes (implied by 'plan')
  -v, --version              Print version and exit
  -h, --help                 Show this help

Planning ('plan' / --dry-run) is read-only and needs no credentials.
'push' requires GOOGLE_APPLICATION_CREDENTIALS (a service-account key).`;

function version(): string {
  // Works in dev (src/cli → repo root) and when published (dist/cli → pkg root).
  const pkg = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
  return (JSON.parse(readFileSync(pkg, "utf8")) as { version: string }).version;
}

type Args = {
  command?: string;
  manifestPath?: string;
  dryRun: boolean;
  help: boolean;
  version: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, help: false, version: false };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "-h" || a === "--help") args.help = true;
    else if (a === "-v" || a === "--version") args.version = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--manifest" || a === "-m") {
      const next = rest[++i];
      if (next === undefined) throw new Error("--manifest requires a path");
      args.manifestPath = next;
    } else if (a.startsWith("--manifest=")) {
      args.manifestPath = a.slice("--manifest=".length);
    } else if (!a.startsWith("-") && args.command === undefined) {
      args.command = a;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

async function run(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }

  if (args.version) {
    console.log(version());
    return 0;
  }
  if (args.help || args.command === undefined) {
    console.log(USAGE);
    return args.command === undefined && !args.help ? 1 : 0;
  }
  if (args.command !== "push" && args.command !== "plan") {
    console.error(`Unknown command: ${args.command}\n\n${USAGE}`);
    return 2;
  }

  // Load a local .env if present (dev convenience); CI injects env directly.
  try {
    process.loadEnvFile();
  } catch {
    // no .env in cwd — rely on the real environment
  }

  const dryRun = args.command === "plan" || args.dryRun;
  try {
    const report = await main({
      dryRun,
      ...(args.manifestPath ? { manifestPath: args.manifestPath } : {}),
    });
    renderReport(report);
    return report.failed > 0 ? 1 : 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

run().then((code) => {
  process.exitCode = code;
});
