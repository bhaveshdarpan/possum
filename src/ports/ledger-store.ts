import type { Ledger } from "../domain/ledger.js";

// Durable store of Publications — the memory that makes publishing idempotent.
// V1 adapter is a committed JSON file (`_index.json`); swap behind this port for
// an external store as concurrency grows.
export interface LedgerStore {
  load(): Promise<Ledger>;
  save(ledger: Ledger): Promise<void>;
}
