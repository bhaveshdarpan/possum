import { describe, it, expect, afterEach } from "vitest";
import { runPipeline, type PipelineTarget } from "../../src/app/pipeline.js";
import { emptyLedger } from "../../src/domain/ledger.js";
import { FakePublisher, InMemoryLedgerStore, type Call } from "../support/fakes.js";
import { tmpRepo, seedLedger, hash, PROVIDER, TARGET } from "../support/helpers.js";

// Orchestrator behaviour, testable with fakes now that it lives in app/ instead
// of the CLI composition root (P0-6 aggregation + P0-8 baseline, end to end).

let cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.forEach((c) => c());
  cleanups = [];
});
function repo(files: Record<string, string>) {
  const r = tmpRepo(files);
  cleanups.push(r.cleanup);
  return r;
}

function target(
  pub: FakePublisher | (() => Promise<never>),
): PipelineTarget {
  return {
    name: TARGET,
    providerId: PROVIDER,
    createPublisher:
      typeof pub === "function" ? pub : () => Promise.resolve(pub),
  };
}

describe("runPipeline orchestration", () => {
  it("dry-run: plans without building a publisher or writing the ledger", async () => {
    const { root } = repo({ "a.md": "# a" });
    const store = new InMemoryLedgerStore(emptyLedger());
    const built = () => Promise.reject(new Error("publisher must not be built on dry-run"));

    const report = await runPipeline({
      docsRoot: `${root}/docs`,
      repoRoot: root,
      targets: [target(built)],
      defaultPublish: [TARGET],
      onDelete: "trash",
      renames: new Map(),
      hashFallback: false,
      head: "abc1234",
      ledger: emptyLedger(),
      ledgerStore: store,
      dryRun: true,
    });

    expect(report.dryRun).toBe(true);
    expect(report.targets[0]!.executed).toBe(false);
    expect(report.targets[0]!.counts).toEqual({ create: 1 });
    expect(store.saves).toHaveLength(0); // nothing written
    expect(report.baselineAdvancedTo).toBeUndefined();
  });

  it("real run: publishes, persists, and advances the rename baseline", async () => {
    const { root } = repo({ "a.md": "# a" });
    const store = new InMemoryLedgerStore(emptyLedger());
    const pub = new FakePublisher();

    const report = await runPipeline({
      docsRoot: `${root}/docs`,
      repoRoot: root,
      targets: [target(pub)],
      defaultPublish: [TARGET],
      onDelete: "trash",
      renames: new Map(),
      hashFallback: false,
      head: "abc1234",
      ledger: emptyLedger(),
      ledgerStore: store,
      dryRun: false,
    });

    expect(report.failed).toBe(0);
    expect(report.targets[0]!.executed).toBe(true);
    expect(pub.ops("create")).toHaveLength(1);
    expect(store.latest.entries["docs/a.md"]!.providers[PROVIDER]!.fileId).toBe("id-a");
    expect(report.baselineAdvancedTo).toBe("abc1234");
    expect(store.latest.lastSyncedSha).toBe("abc1234");
  });

  it("partial failure: aggregates failures and does NOT advance the baseline", async () => {
    const { root } = repo({ "a.md": "# a", "b.md": "# b" });
    const store = new InMemoryLedgerStore(emptyLedger());
    const pub = new FakePublisher({
      failOn: (c: Call) => c.op === "create" && c.doc.name === "b",
    });

    const report = await runPipeline({
      docsRoot: `${root}/docs`,
      repoRoot: root,
      targets: [target(pub)],
      defaultPublish: [TARGET],
      onDelete: "trash",
      renames: new Map(),
      hashFallback: false,
      head: "abc1234",
      ledger: emptyLedger(),
      ledgerStore: store,
      dryRun: false,
    });

    expect(report.failed).toBe(1);
    expect(report.baselineAdvancedTo).toBeUndefined(); // not clean → no advance
    expect(store.latest.lastSyncedSha).toBeUndefined();
    expect(store.latest.entries["docs/a.md"]).toBeDefined();
    expect(store.latest.entries["docs/b.md"]).toBeUndefined();
  });

  it("no work: skips execution but still advances the baseline on a clean run", async () => {
    const raw = "# a";
    const { root } = repo({ "a.md": raw });
    const ledger = seedLedger({ "docs/a.md": { fileId: "id-a", hash: hash(raw) } });
    const store = new InMemoryLedgerStore(ledger);
    const built = () => Promise.reject(new Error("publisher must not be built when there is no work"));

    const report = await runPipeline({
      docsRoot: `${root}/docs`,
      repoRoot: root,
      targets: [target(built)],
      defaultPublish: [TARGET],
      onDelete: "trash",
      renames: new Map(),
      hashFallback: false,
      head: "abc1234",
      ledger,
      ledgerStore: store,
      dryRun: false,
    });

    expect(report.targets[0]!.executed).toBe(false);
    expect(report.targets[0]!.counts).toEqual({ skip: 1 });
    expect(report.baselineAdvancedTo).toBe("abc1234");
  });
});
