import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { emptyIndex, indexSchema, type IndexFile } from "./schema.js";

export async function readIndex(path: string): Promise<IndexFile> {
  if (!existsSync(path)) return emptyIndex();
  const raw = await readFile(path, "utf8");
  const trimmed = raw.trim();
  if (trimmed === "") return emptyIndex();
  const parsed: unknown = JSON.parse(trimmed);
  return indexSchema.parse(parsed);
}

export async function writeIndex(path: string, index: IndexFile): Promise<void> {
  const sorted: IndexFile = {
    version: index.version,
    entries: Object.fromEntries(
      Object.keys(index.entries)
        .sort()
        .map((k) => [k, index.entries[k]!]),
    ),
  };
  await writeFile(path, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}
