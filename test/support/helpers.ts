import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { planSync } from "../../src/app/plan.js";
import { runActions } from "../../src/app/run.js";
import type { Ledger, Publication } from "../../src/domain/ledger.js";
import type {
  OnDelete,
  PublishAction,
  PublishPlan,
} from "../../src/domain/publish-plan.js";
import type { Publisher } from "../../src/ports/publisher.js";

export const PROVIDER = "google-drive";
export const TARGET = "google-docs";

// Same digest the planner uses — seed ledger entries so "unchanged" is detected.
export function hash(raw: string): string {
  return "sha256:" + createHash("sha256").update(raw).digest("hex");
}

// A throwaway repo with a docs/ tree. Returns the repo root and a cleanup fn.
export function tmpRepo(files: Record<string, string>): {
  root: string;
  docsRoot: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(path.join(tmpdir(), "possum-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, "docs", rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return {
    root,
    docsRoot: path.join(root, "docs"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// Build a Ledger from a compact { path: {fileId, hash} } map.
export function seedLedger(
  entries: Record<string, { fileId: string; hash: string; url?: string }>,
  lastSyncedSha?: string,
): Ledger {
  const led: Ledger = { version: 2, entries: {} };
  if (lastSyncedSha) led.lastSyncedSha = lastSyncedSha;
  for (const [p, e] of Object.entries(entries)) {
    const pub: Publication = {
      fileId: e.fileId,
      url: e.url ?? `https://docs.google.com/document/d/${e.fileId}/edit`,
      lastSyncedHash: e.hash,
    };
    led.entries[p] = { providers: { [PROVIDER]: pub } };
  }
  return led;
}

// planSync with sensible defaults; override any field per scenario.
export function plan(
  root: string,
  index: Ledger,
  over: Partial<{
    targetName: string;
    defaultPublish: string[];
    onDelete: OnDelete;
    renames: Map<string, string>;
    hashFallback: boolean;
  }> = {},
): Promise<PublishPlan> {
  return planSync({
    docsRoot: path.join(root, "docs"),
    repoRoot: root,
    index,
    targetName: over.targetName ?? TARGET,
    providerId: PROVIDER,
    defaultPublish: over.defaultPublish ?? [TARGET],
    onDelete: over.onDelete ?? "trash",
    renames: over.renames ?? new Map(),
    hashFallback: over.hashFallback ?? false,
  });
}

// Execute a plan against a publisher, capturing every ledger write (deep-cloned
// so later mutations don't alter earlier snapshots).
export async function runWithFake(
  publisher: Publisher,
  ledger: Ledger,
  actions: PublishAction[],
): Promise<{ next: Ledger; failed: number; writes: Ledger[] }> {
  const writes: Ledger[] = [];
  const { next, failed } = await runActions(publisher, ledger, actions, async (l) => {
    writes.push(structuredClone(l));
  });
  return { next, failed, writes };
}
