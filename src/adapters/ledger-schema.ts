import { z } from "zod";
import type { Ledger } from "../domain/ledger.js";

const publicationSchema = z.object({
  fileId: z.string().min(1),
  url: z.string().url(),
  lastSyncedHash: z.string().min(1),
});

const entrySchema = z.object({
  providers: z.record(z.string(), publicationSchema),
});

export const ledgerSchema = z.object({
  version: z.literal(2),
  // Optional so pre-existing ledgers (written before this field) still parse.
  lastSyncedSha: z.string().min(1).optional(),
  entries: z.record(z.string(), entrySchema),
});

// Parse untrusted JSON into a domain Ledger (throws on invalid). The cast
// reconciles zod's inferred optional (`string | undefined`) with the domain's
// `lastSyncedSha?: string` under exactOptionalPropertyTypes; the runtime shape
// is guaranteed by the schema.
export function parseLedger(raw: unknown): Ledger {
  return ledgerSchema.parse(raw) as Ledger;
}
