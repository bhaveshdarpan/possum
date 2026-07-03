// The Sync Ledger — durable record of Publications that makes publishing
// idempotent (ADR-0006). The domain owns these types; the zod schema in
// adapters/ledger-schema.ts validates the persisted JSON against them. Same
// wire shape as the PoC's `_index.json` — no data migration.

// One Document's mirror on one provider: destination ref + last published hash.
export type Publication = {
  fileId: string;
  url: string;
  lastSyncedHash: string;
};

// A ledger row keyed by source path; publications keyed by providerId.
export type LedgerEntry = {
  providers: Record<string, Publication>;
};

export type Ledger = {
  version: 2;
  // Commit synced last run — enables Git rename detection (P0-8).
  lastSyncedSha?: string;
  entries: Record<string, LedgerEntry>;
};

export function emptyLedger(): Ledger {
  return { version: 2, entries: {} };
}
