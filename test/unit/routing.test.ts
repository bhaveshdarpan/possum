import { describe, it, expect, afterEach } from "vitest";
import { emptyLedger } from "../../src/domain/ledger.js";
import { tmpRepo, plan } from "../support/helpers.js";

// Feature: routing.feature — per-doc `publish:`; exclusion (P0-5)

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
const paths = (actions: { kind: string; sourcePath: string }[]) =>
  actions.map((a) => `${a.kind}:${a.sourcePath.replace(/^docs\//, "")}`);

describe("per-doc routing (P0-5)", () => {
  it("publishes a doc with no front-matter via defaults.publish", async () => {
    const { root } = repo({ "a.md": "# body" });
    const actions = await plan(root, emptyLedger());
    expect(paths(actions)).toEqual(["create:a.md"]);
  });

  it("publishes a doc that explicitly lists the target", async () => {
    const { root } = repo({ "a.md": "---\npublish: [google-docs]\n---\n# body" });
    const actions = await plan(root, emptyLedger());
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("create");
  });

  it("excludes a doc with publish: []", async () => {
    const { root } = repo({ "a.md": "---\npublish: []\n---\n# body" });
    expect(await plan(root, emptyLedger())).toEqual([]);
  });

  it("excludes a doc routed only to another target", async () => {
    const { root } = repo({ "a.md": "---\npublish: [notion]\n---\n# body" });
    expect(await plan(root, emptyLedger())).toEqual([]);
  });

  it("excludes a doc with a malformed publish value", async () => {
    const { root } = repo({ "a.md": "---\npublish: true\n---\n# body" });
    expect(await plan(root, emptyLedger())).toEqual([]);
  });

  it("routes each doc independently within one tree", async () => {
    const { root } = repo({
      "keep.md": "# in",
      "drop.md": "---\npublish: []\n---\n# out",
    });
    expect(paths(await plan(root, emptyLedger()))).toEqual(["create:keep.md"]);
  });
});
