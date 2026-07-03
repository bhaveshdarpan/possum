import { describe, it, expect, afterEach } from "vitest";
import { emptyLedger } from "../../src/domain/ledger.js";
import { FakePublisher, type Call } from "../support/fakes.js";
import { tmpRepo, plan, runWithFake, PROVIDER } from "../support/helpers.js";

// Feature: run_report.feature — per-doc report; isolate partial failures; no dup
// on re-run (P0-6)

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

describe("run reporting & partial-failure isolation (P0-6)", () => {
  it("one failing document does not block the others or cause a duplicate", async () => {
    const { root } = repo({ "a.md": "# a", "b.md": "# b", "c.md": "# c" });
    const actions = await plan(root, emptyLedger());
    expect(actions.map((a) => a.kind)).toEqual(["create", "create", "create"]);

    // Second document (name "b") fails to publish.
    const pub = new FakePublisher({
      failOn: (c: Call) => c.op === "create" && c.doc.name === "b",
    });
    const { next, failed, writes } = await runWithFake(pub, emptyLedger(), actions);

    expect(failed).toBe(1); // run exits non-zero
    // First and third recorded; the failing one is not.
    expect(Object.keys(next.entries).sort()).toEqual(["docs/a.md", "docs/c.md"]);
    expect(next.entries["docs/b.md"]).toBeUndefined();
    // Ledger persisted per success (one write each for a and c).
    expect(writes).toHaveLength(2);

    // Re-run: a and c skip (already recorded), only b is retried — no duplicate.
    const second = await plan(root, next);
    const byPath = Object.fromEntries(second.map((s) => [s.sourcePath, s.kind]));
    expect(byPath["docs/a.md"]).toBe("skip");
    expect(byPath["docs/c.md"]).toBe("skip");
    expect(byPath["docs/b.md"]).toBe("create");
  });

  it("isolates an internal inconsistency (update/rename without a ledger entry) as a per-doc failure", async () => {
    const pub = new FakePublisher();
    // An update action whose ledger entry is missing → defensive throw, caught.
    const bad1 = await runWithFake(pub, emptyLedger(), [
      { kind: "update", sourcePath: "docs/x.md", fileId: "id-x", name: "X", body: "# x", hash: "sha256:x" },
    ]);
    expect(bad1.failed).toBe(1);
    expect(bad1.next.entries["docs/x.md"]).toBeUndefined();

    // A rename action whose source ledger entry is missing → same.
    const bad2 = await runWithFake(pub, emptyLedger(), [
      {
        kind: "rename",
        fromPath: "docs/old.md",
        sourcePath: "docs/new.md",
        fileId: "id-x",
        segments: [],
        name: "X",
        body: "# x",
        hash: "sha256:x",
      },
    ]);
    expect(bad2.failed).toBe(1);
    expect(bad2.next.entries["docs/new.md"]).toBeUndefined();
    // Neither internal error reached the publisher.
    expect(pub.calls).toEqual([]);
  });

  it("records the mirror BEFORE afterRecord, so a grant failure can't orphan it", async () => {
    const { root } = repo({ "a.md": "# a" });
    const actions = await plan(root, emptyLedger());

    // create succeeds; the post-record grant throws.
    const pub = new FakePublisher({ failOn: (c: Call) => c.op === "afterRecord" });
    const { next, failed } = await runWithFake(pub, emptyLedger(), actions);

    expect(failed).toBe(1);
    // The Doc is still recorded — a re-run would skip it, not duplicate it.
    expect(next.entries["docs/a.md"]!.providers[PROVIDER]!.fileId).toBe("id-a");
  });
});
