import { describe, it, expect, afterEach } from "vitest";
import { emptyLedger } from "../../src/domain/ledger.js";
import { tmpRepo, plan, seedLedger, hash } from "../support/helpers.js";

// Feature: discovery.feature — load Markdown + front-matter; hash (P0-1)

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

describe("discovery + naming (P0-1)", () => {
  it("names a doc from front-matter title, else the filename stem", async () => {
    const { root } = repo({
      "titled.md": "---\ntitle: Nice Title\n---\n# heading",
      "untitled.md": "# just body",
    });
    const actions = await plan(root, emptyLedger());
    const byPath = Object.fromEntries(
      actions.map((a) => [a.sourcePath.replace(/^docs\//, ""), a]),
    );
    expect((byPath["titled.md"] as { name: string }).name).toBe("Nice Title");
    expect((byPath["untitled.md"] as { name: string }).name).toBe("untitled");
  });

  it("mirrors nested folders as segments", async () => {
    const { root } = repo({ "a/b/deep.md": "# deep" });
    const [action] = await plan(root, emptyLedger());
    expect((action as { segments: string[] }).segments).toEqual(["a", "b"]);
  });

  it("ignores non-markdown and dotfiles", async () => {
    const { root } = repo({
      "keep.md": "# yes",
      "note.txt": "no",
      ".hidden.md": "no",
    });
    const actions = await plan(root, emptyLedger());
    expect(actions).toHaveLength(1);
    expect(actions[0]!.sourcePath).toMatch(/keep\.md$/);
  });

  it("rewrites mermaid blocks to a mermaid.ink image in the body", async () => {
    const { root } = repo({
      "d.md": "# t\n\n```mermaid\ngraph TD\nA-->B\n```\n",
    });
    const [action] = await plan(root, emptyLedger());
    const body = (action as { body: string }).body;
    expect(body).toContain("![diagram](https://mermaid.ink/img/");
    expect(body).not.toContain("```mermaid");
  });

  it("hashes content so identical bytes are reported unchanged", async () => {
    const raw = "---\ntitle: T\n---\n# stable";
    const { root } = repo({ "s.md": raw });
    const ledger = seedLedger({ "docs/s.md": { fileId: "id-s", hash: hash(raw) } });
    const actions = await plan(root, ledger);
    expect(actions).toEqual([{ kind: "skip", sourcePath: "docs/s.md", reason: "unchanged" }]);
  });
});
