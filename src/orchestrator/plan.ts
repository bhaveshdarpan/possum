import { readdir, readFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import matter from "gray-matter";
import type { IndexFile } from "../index/schema.js";

export const PROVIDER = "google-drive";

export type OnDelete = "trash" | "archive" | "ignore";

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
  // Source moved/renamed: reuse the existing Drive file (id + URL stay stable),
  // update content, move to the new folder, and re-key the ledger.
  | {
      kind: "rename";
      fromPath: string;
      sourcePath: string;
      fileId: string;
      segments: string[];
      name: string;
      body: string;
      hash: string;
    }
  // Source no longer on disk: trash/archive the mirror and drop the entry.
  | { kind: "delete"; sourcePath: string; fileId: string; onDelete: OnDelete }
  | { kind: "skip"; sourcePath: string; reason: string };

// A doc discovered on disk and routed to this target, before we know whether it
// is a fresh create or the destination of a rename.
type Candidate = {
  sourcePath: string;
  segments: string[];
  name: string;
  body: string;
  hash: string;
};

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

// Resolve a document's target list from front-matter, falling back to the
// manifest default when `publish` is absent. An explicit `publish: []` (or a
// malformed value) routes to no target.
function resolvePublishTargets(
  fmPublish: unknown,
  defaultPublish: string[],
): string[] {
  if (fmPublish === undefined) return defaultPublish;
  if (Array.isArray(fmPublish)) {
    return fmPublish.filter((x): x is string => typeof x === "string");
  }
  return [];
}

export async function planSync(opts: {
  docsRoot: string;
  repoRoot: string;
  index: IndexFile;
  targetName: string;
  defaultPublish: string[];
  onDelete: OnDelete;
  // Git-detected renames (old → new repo-relative POSIX path).
  renames: Map<string, string>;
  // Allow content-hash rename matching when Git history can't be consulted
  // (no lastSyncedSha yet, or Git unavailable).
  hashFallback: boolean;
}): Promise<DocAction[]> {
  const actions: DocAction[] = [];
  // Every .md on disk (routed or not) — used to tell "deleted" from "just not
  // routed to this target".
  const seenPaths = new Set<string>();
  // Fresh docs (no ledger entry yet); some may turn out to be rename targets.
  const creates: Candidate[] = [];

  for await (const fullPath of walkMarkdown(opts.docsRoot)) {
    const raw = await readFile(fullPath, "utf8");
    const hash = hashContent(raw);
    const sourcePath = path
      .relative(opts.repoRoot, fullPath)
      .split(path.sep)
      .join("/");
    seenPaths.add(sourcePath);

    const parsed = matter(raw);

    // Per-doc routing (P0-5): only publish docs whose target list includes
    // this target. Docs routed elsewhere produce no action here.
    const targets = resolvePublishTargets(
      parsed.data["publish"],
      opts.defaultPublish,
    );
    if (!targets.includes(opts.targetName)) continue;

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

    const provider = opts.index.entries[sourcePath]?.providers[PROVIDER];
    if (!provider) {
      creates.push({ sourcePath, segments, name, body, hash });
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

  // Reconcile (P0-8): ledger entries whose source path is gone from disk are
  // candidates for delete — unless we can re-link them to a rename target.
  const createByPath = new Map(creates.map((c) => [c.sourcePath, c]));
  const consumed = new Set<string>();

  const findRenameTarget = (oldPath: string): Candidate | undefined => {
    // 1. Authoritative: Git rename to a path we're about to create.
    const viaGit = opts.renames.get(oldPath);
    if (viaGit) {
      const c = createByPath.get(viaGit);
      if (c && !consumed.has(c.sourcePath)) return c;
    }
    // 2. Fallback (no Git history): a fresh doc with identical last-synced
    //    content. Ambiguous for identical files; only used when enabled.
    if (opts.hashFallback) {
      const oldHash =
        opts.index.entries[oldPath]?.providers[PROVIDER]?.lastSyncedHash;
      if (oldHash) {
        for (const c of creates) {
          if (!consumed.has(c.sourcePath) && c.hash === oldHash) return c;
        }
      }
    }
    return undefined;
  };

  for (const [ledgerPath, entry] of Object.entries(opts.index.entries)) {
    const provider = entry.providers[PROVIDER];
    if (!provider || seenPaths.has(ledgerPath)) continue;

    const target = findRenameTarget(ledgerPath);
    if (target) {
      consumed.add(target.sourcePath);
      actions.push({
        kind: "rename",
        fromPath: ledgerPath,
        sourcePath: target.sourcePath,
        fileId: provider.fileId,
        segments: target.segments,
        name: target.name,
        body: target.body,
        hash: target.hash,
      });
    } else if (opts.onDelete === "ignore") {
      actions.push({
        kind: "skip",
        sourcePath: ledgerPath,
        reason: "deleted (onDelete: ignore)",
      });
    } else {
      actions.push({
        kind: "delete",
        sourcePath: ledgerPath,
        fileId: provider.fileId,
        onDelete: opts.onDelete,
      });
    }
  }

  // Remaining fresh docs (not claimed by a rename) are creates.
  for (const c of creates) {
    if (consumed.has(c.sourcePath)) continue;
    actions.push({ kind: "create", ...c });
  }

  actions.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  return actions;
}
