import type { Ledger } from "../domain/ledger.js";
import type { LedgerStore } from "../ports/ledger-store.js";
import { readIndex, writeIndex } from "../index/io.js";

// V1 LedgerStore: a committed JSON file (`_index.json`). Wraps the existing
// read/write helpers behind the port so the app depends only on `LedgerStore`
// (ADR-0003). Swap for an external store here as concurrency grows.
export class FileLedgerStore implements LedgerStore {
  constructor(private readonly path: string) {}

  load(): Promise<Ledger> {
    return readIndex(this.path);
  }

  save(ledger: Ledger): Promise<void> {
    return writeIndex(this.path, ledger);
  }
}
