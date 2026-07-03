import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "../../src/cli/main.js";

// Feature: dry_run.feature — plan without writing (P1-2)

const MANIFEST = `
version: 1
source: { type: git, docsDir: docs }
targets:
  - { name: google-docs, type: google-docs, driveFolderId: "fld", orgDomain: "e.com" }
defaults: { publish: [google-docs] }
`;
const LEDGER = '{\n  "version": 2,\n  "entries": {}\n}\n';

let dir: string | undefined;
let prevCwd: string | undefined;
afterEach(() => {
  if (prevCwd) process.chdir(prevCwd);
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = prevCwd = undefined;
});

const LEDGER_PATH = "ledger.json"; // manifest default, at repo root

function setupRepo(): string {
  dir = mkdtempSync(path.join(tmpdir(), "docpipe-dryrun-"));
  writeFileSync(path.join(dir, "docpipe.yaml"), MANIFEST);
  writeFileSync(path.join(dir, LEDGER_PATH), LEDGER);
  mkdirSync(path.join(dir, "docs"));
  writeFileSync(path.join(dir, "docs", "new.md"), "# a new doc");
  prevCwd = process.cwd();
  process.chdir(dir);
  return dir;
}

describe("dry-run (P1-2)", () => {
  it("plans a create, needs no credentials, and writes nothing", async () => {
    const d = setupRepo();
    const before = readFileSync(path.join(d, LEDGER_PATH), "utf8");
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS; // must not be required

    const report = await main({ dryRun: true });

    // Structured plan: one create for the new doc, target not executed.
    expect(report.dryRun).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.targets).toHaveLength(1);
    const t = report.targets[0]!;
    expect(t.executed).toBe(false);
    expect(t.counts).toEqual({ create: 1 });
    expect(t.plan[0]).toMatchObject({ kind: "create", sourcePath: "docs/new.md" });
    expect(report.baselineAdvancedTo).toBeUndefined();

    // Ledger untouched on disk.
    expect(readFileSync(path.join(d, LEDGER_PATH), "utf8")).toBe(before);
  });
});
