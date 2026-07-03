import { describe, it, expect, afterEach } from "vitest";
import { FakePublisher } from "../support/fakes.js";
import { tmpRepo, plan, seedLedger, hash, runWithFake, PROVIDER } from "../support/helpers.js";

// Feature: reconcile.feature — delete → trash + drop entry; rename → reuse file,
// move, re-key (P0-8)

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

describe("reconcile — deletes (P0-8)", () => {
  it("trashes a deleted source's mirror and drops the ledger entry", async () => {
    const { root } = repo({ "kept.md": "# kept" });
    const ledger = seedLedger({
      "docs/kept.md": { fileId: "id-kept", hash: hash("# kept") },
      "docs/gone.md": { fileId: "id-gone", hash: hash("# gone") },
    });

    const actions = await plan(root, ledger);
    const del = actions.find((a) => a.kind === "delete");
    expect(del).toMatchObject({ kind: "delete", sourcePath: "docs/gone.md", onDelete: "trash" });

    const pub = new FakePublisher();
    const { next } = await runWithFake(pub, ledger, actions);
    const delCall = pub.ops("delete")[0] as { ref: { id: string }; mode: string };
    expect(delCall.ref.id).toBe("id-gone");
    expect(delCall.mode).toBe("trash");
    expect(next.entries["docs/gone.md"]).toBeUndefined();
    expect(next.entries["docs/kept.md"]).toBeDefined();
  });

  it("archives instead of trashing when onDelete is archive", async () => {
    const { root } = repo({});
    const ledger = seedLedger({ "docs/gone.md": { fileId: "id-gone", hash: hash("x") } });
    const actions = await plan(root, ledger, { onDelete: "archive" });

    const pub = new FakePublisher();
    await runWithFake(pub, ledger, actions);
    expect((pub.ops("delete")[0] as { mode: string }).mode).toBe("archive");
  });

  it("leaves the mirror alone when onDelete is ignore", async () => {
    const { root } = repo({});
    const ledger = seedLedger({ "docs/gone.md": { fileId: "id-gone", hash: hash("x") } });
    const actions = await plan(root, ledger, { onDelete: "ignore" });
    expect(actions).toEqual([
      { kind: "skip", sourcePath: "docs/gone.md", reason: "deleted (onDelete: ignore)" },
    ]);

    const pub = new FakePublisher();
    const { next } = await runWithFake(pub, ledger, actions);
    expect(pub.ops("delete")).toHaveLength(0);
    expect(next.entries["docs/gone.md"]).toBeDefined(); // untouched
  });
});

describe("reconcile — renames (P0-8)", () => {
  it("reuses the same mirror on a Git-detected move (id + URL stable, ledger re-keyed)", async () => {
    const url = "https://docs.google.com/document/d/id-x/edit";
    const { root } = repo({ "sub/new.md": "# moved body" });
    const ledger = seedLedger({ "docs/old.md": { fileId: "id-x", hash: hash("# old"), url } });
    const renames = new Map([["docs/old.md", "docs/sub/new.md"]]);

    const actions = await plan(root, ledger, { renames });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "rename",
      fromPath: "docs/old.md",
      sourcePath: "docs/sub/new.md",
      fileId: "id-x",
      segments: ["sub"],
    });

    const pub = new FakePublisher();
    const { next } = await runWithFake(pub, ledger, actions);

    // Reused the Doc: update + move, never create/delete.
    expect(pub.ops("create")).toHaveLength(0);
    expect(pub.ops("delete")).toHaveLength(0);
    expect((pub.ops("update")[0] as { ref: { id: string } }).ref.id).toBe("id-x");
    expect((pub.ops("move")[0] as { segments: string[] }).segments).toEqual(["sub"]);

    // Ledger re-keyed old → new; id and URL preserved.
    expect(next.entries["docs/old.md"]).toBeUndefined();
    const pub2 = next.entries["docs/sub/new.md"]!.providers[PROVIDER]!;
    expect(pub2.fileId).toBe("id-x");
    expect(pub2.url).toBe(url);
  });

  it("falls back to content-hash matching when Git history is unavailable", async () => {
    const raw = "# identical";
    const { root } = repo({ "renamed.md": raw });
    const ledger = seedLedger({ "docs/orig.md": { fileId: "id-x", hash: hash(raw) } });

    const actions = await plan(root, ledger, { renames: new Map(), hashFallback: true });
    expect(actions[0]).toMatchObject({
      kind: "rename",
      fromPath: "docs/orig.md",
      sourcePath: "docs/renamed.md",
      fileId: "id-x",
    });
  });

  it("does NOT invent a rename via hash when the fallback is disabled", async () => {
    const raw = "# identical";
    const { root } = repo({ "renamed.md": raw });
    const ledger = seedLedger(
      { "docs/orig.md": { fileId: "id-x", hash: hash(raw) } },
      "somesha",
    );
    const actions = await plan(root, ledger, { renames: new Map(), hashFallback: false });
    expect(actions.map((a) => a.kind).sort()).toEqual(["create", "delete"]);
  });
});
