import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { emptyLedger, type Ledger } from "../domain/ledger.js";
import { parseLedger } from "./ledger-schema.js";

export async function readLedger(path: string): Promise<Ledger> {
  if (!existsSync(path)) return emptyLedger();
  const raw = await readFile(path, "utf8");
  const trimmed = raw.trim();
  if (trimmed === "") return emptyLedger();
  const parsed: unknown = JSON.parse(trimmed);
  return parseLedger(parsed);
}

export async function writeLedger(path: string, ledger: Ledger): Promise<void> {
  const sorted: Ledger = {
    version: ledger.version,
    ...(ledger.lastSyncedSha ? { lastSyncedSha: ledger.lastSyncedSha } : {}),
    entries: Object.fromEntries(
      Object.keys(ledger.entries)
        .sort()
        .map((k) => [k, ledger.entries[k]!]),
    ),
  };
  await mkdir(dirname(path), { recursive: true }); // support nested custom ledger paths
  await writeFile(path, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}
