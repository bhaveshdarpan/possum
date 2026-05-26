import { readdir, readFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import matter from "gray-matter";
import type { IndexFile } from "../index/schema.js";

export const PROVIDER = "google-drive";

export type DocAction =
  | {
      kind: "create";
      sourcePath: string;
      segments: string[];
      name: string;
      body: string;
      hash: string;
    }
  | {
      kind: "update";
      sourcePath: string;
      fileId: string;
      name: string;
      body: string;
      hash: string;
    }
  | { kind: "skip"; sourcePath: string; reason: string };

async function* walkMarkdown(root: string): AsyncIterable<string> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      yield* walkMarkdown(full);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      yield full;
    }
  }
}

function hashContent(raw: string): string {
  return "sha256:" + createHash("sha256").update(raw).digest("hex");
}

function rewriteMermaidBlocks(markdown: string): string {
  return markdown.replace(
    /```mermaid\n([\s\S]*?)\n```/g,
    (_, code: string) => {
      const encoded = Buffer.from(code.trim(), "utf8").toString("base64url");
      return `![diagram](https://mermaid.ink/img/${encoded})`;
    },
  );
}

export async function planSync(opts: {
  docsRoot: string;
  repoRoot: string;
  index: IndexFile;
}): Promise<DocAction[]> {
  const actions: DocAction[] = [];
  for await (const fullPath of walkMarkdown(opts.docsRoot)) {
    const raw = await readFile(fullPath, "utf8");
    const hash = hashContent(raw);
    const sourcePath = path
      .relative(opts.repoRoot, fullPath)
      .split(path.sep)
      .join("/");

    const parsed = matter(raw);
    const fmTitle =
      typeof parsed.data["title"] === "string"
        ? parsed.data["title"].trim()
        : "";
    const stem = path.basename(fullPath, ".md");
    const name = fmTitle !== "" ? fmTitle : stem;
    const body = rewriteMermaidBlocks(parsed.content);

    const relUnderDocs = path
      .relative(opts.docsRoot, fullPath)
      .split(path.sep);
    const segments = relUnderDocs.slice(0, -1);

    const entry = opts.index.entries[sourcePath];
    const provider = entry?.providers[PROVIDER];
    if (!provider) {
      actions.push({ kind: "create", sourcePath, segments, name, body, hash });
    } else if (provider.lastSyncedHash === hash) {
      actions.push({ kind: "skip", sourcePath, reason: "unchanged" });
    } else {
      actions.push({
        kind: "update",
        sourcePath,
        fileId: provider.fileId,
        name,
        body,
        hash,
      });
    }
  }
  actions.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  return actions;
}
