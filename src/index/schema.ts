import { z } from "zod";

const providerEntrySchema = z.object({
  fileId: z.string().min(1),
  url: z.string().url(),
  lastSyncedHash: z.string().min(1),
});

const entrySchema = z.object({
  providers: z.record(z.string(), providerEntrySchema),
});

export const indexSchema = z.object({
  version: z.literal(2),
  // Commit synced last run — enables Git rename detection (P0-8). Optional so
  // pre-existing ledgers (written before this field) still parse.
  lastSyncedSha: z.string().min(1).optional(),
  entries: z.record(z.string(), entrySchema),
});

export type IndexFile = z.infer<typeof indexSchema>;
export type IndexEntry = z.infer<typeof entrySchema>;
export type ProviderEntry = z.infer<typeof providerEntrySchema>;

export function emptyIndex(): IndexFile {
  return { version: 2, entries: {} };
}
