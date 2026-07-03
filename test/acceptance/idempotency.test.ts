import { describe, it, expect, afterEach } from "vitest";
import { emptyLedger } from "../../src/domain/ledger.js";
import { FakePublisher } from "../support/fakes.js";
import { tmpRepo, plan, seedLedger, hash, runWithFake, PROVIDER } from "../support/helpers.js";

// Feature: idempotency.feature — skip unchanged; never duplicate a Mirror (P0-4)

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

describe("idempotent publishing (P0-4)", () => {
  it("skips an unchanged document and writes nothing to the target", async () => {
    const raw = "---\ntitle: T\n---\n# stable";
    const { root } = repo({ "a.md": raw });
    const ledger = seedLedger({ "docs/a.md": { fileId: "id-a", hash: hash(raw) } });

    const actions = await plan(root, ledger);
    expect(actions).toEqual([{ kind: "skip", sourcePath: "docs/a.md", reason: "unchanged" }]);

    const pub = new FakePublisher();
    const { failed } = await runWithFake(pub, ledger, actions);
    expect(failed).toBe(0);
    expect(pub.calls).toEqual([]); // no create/update — 0 writes
  });

  it("updates a changed document in place, reusing the same fileId", async () => {
    const { root } = repo({ "a.md": "# new content" });
    // Ledger holds a stale hash + an existing destination.
    const ledger = seedLedger({ "docs/a.md": { fileId: "id-a", hash: hash("# old content") } });

    const actions = await plan(root, ledger);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "update", sourcePath: "docs/a.md", fileId: "id-a" });

    const pub = new FakePublisher();
    const { next } = await runWithFake(pub, ledger, actions);

    expect(pub.ops("create")).toHaveLength(0); // never creates a new Doc
    const updates = pub.ops("update");
    expect(updates).toHaveLength(1);
    expect((updates[0] as { ref: { id: string } }).ref.id).toBe("id-a");
    // Same destination, new hash recorded.
    expect(next.entries["docs/a.md"]!.providers[PROVIDER]!.fileId).toBe("id-a");
    expect(next.entries["docs/a.md"]!.providers[PROVIDER]!.lastSyncedHash).toBe(hash("# new content"));
  });

  it("re-running with no changes produces an empty (skip-only) plan", async () => {
    const raw = "# body";
    const { root } = repo({ "a.md": raw });
    const first = await plan(root, emptyLedger());
    const pub = new FakePublisher();
    const { next } = await runWithFake(pub, emptyLedger(), first);

    const second = await plan(root, next);
    expect(second.every((a) => a.kind === "skip")).toBe(true);
  });
});
