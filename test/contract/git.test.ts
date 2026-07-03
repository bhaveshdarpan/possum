import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { currentHead, detectRenames } from "../../src/adapters/git.js";

// Integration: Git rename detection (P0-8) against a real repo.

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function initRepo(): string {
  dir = mkdtempSync(path.join(tmpdir(), "possum-git-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@t.co");
  git(dir, "config", "user.name", "t");
  mkdirSync(path.join(dir, "docs"));
  return dir;
}

describe("git rename detection (P0-8)", () => {
  it("reports a moved file as old → new since the last-synced commit", async () => {
    const d = initRepo();
    // A realistically-sized doc so Git's similarity check clears its threshold.
    const body =
      "# Payments\n\nDescribes the payments subsystem: ledgers, reconciliation,\nand idempotency guarantees across runs.\n";
    writeFileSync(path.join(d, "docs", "pay.md"), body);
    git(d, "add", "-A");
    git(d, "commit", "-qm", "first");
    const sha = currentHead(d)!;

    mkdirSync(path.join(d, "docs", "finance"));
    git(d, "mv", "docs/pay.md", "docs/finance/pay.md");
    writeFileSync(path.join(d, "docs", "finance", "pay.md"), body + "One more line.\n");
    git(d, "add", "-A");
    git(d, "commit", "-qm", "move");

    const renames = detectRenames(d, sha, "docs");
    expect([...renames.entries()]).toEqual([["docs/pay.md", "docs/finance/pay.md"]]);
  });

  it("returns an empty map when no baseline SHA is given", () => {
    const d = initRepo();
    expect(detectRenames(d, undefined, "docs").size).toBe(0);
  });

  it("returns null head outside a Git repo (tolerant fallback)", () => {
    const d = mkdtempSync(path.join(tmpdir(), "possum-nogit-"));
    try {
      expect(currentHead(d)).toBeNull();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
