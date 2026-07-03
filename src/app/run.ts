import type { Ledger } from "../domain/ledger.js";
import type { PublishAction } from "../domain/publish-plan.js";
import type { Publisher, DestinationRef } from "../ports/publisher.js";

// Remove a publication (keyed by the publisher's providerId) from a ledger path,
// dropping the entry entirely once no providers remain. Builds fresh objects (no
// mutation of shared nested state).
function dropProvider(
  index: Ledger,
  sourcePath: string,
  providerId: string,
): void {
  const entry = index.entries[sourcePath];
  if (!entry) return;
  const { [providerId]: _removed, ...rest } = entry.providers;
  if (Object.keys(rest).length === 0) {
    delete index.entries[sourcePath];
  } else {
    index.entries[sourcePath] = { providers: rest };
  }
}

export type RunResult = { next: Ledger; failed: number };

// Persist the ledger after each successful action. Passed in so the caller owns
// where the ledger lives (file path today; a store later).
export type WriteLedger = (ledger: Ledger) => Promise<void>;

// Executes a PublishPlan against a Publisher. The port hides all Drive/render
// specifics; this layer owns ledger bookkeeping and the reliability guarantees:
//
//  - Partial-failure isolation (P0-6): each action has its own try/catch, the
//    ledger is persisted immediately after each success, and one failure never
//    blocks the rest. The caller exits non-zero when `failed > 0`.
//  - No orphaned mirror (P0-6): on create, the ledger is persisted BEFORE
//    `afterRecord` (the commenter grant), so a grant failure can't leave a
//    created-but-unrecorded Doc that a re-run would duplicate.
export async function runActions(
  publisher: Publisher,
  index: Ledger,
  actions: PublishAction[],
  writeLedger: WriteLedger,
): Promise<RunResult> {
  const key = publisher.providerId;
  const next: Ledger = {
    version: index.version,
    ...(index.lastSyncedSha ? { lastSyncedSha: index.lastSyncedSha } : {}),
    entries: { ...index.entries },
  };
  let failed = 0;
  for (const action of actions) {
    try {
      switch (action.kind) {
        case "skip":
          console.log(`skip   ${action.sourcePath}  (${action.reason})`);
          break;
        case "create": {
          console.log(`create ${action.sourcePath}`);
          const ref = await publisher.create({
            name: action.name,
            body: action.body,
            segments: action.segments,
          });
          const existing = next.entries[action.sourcePath];
          next.entries[action.sourcePath] = {
            providers: {
              ...(existing?.providers ?? {}),
              [key]: { fileId: ref.id, url: ref.url, lastSyncedHash: action.hash },
            },
          };
          // Record BEFORE afterRecord so a grant failure can't orphan the Doc.
          await writeLedger(next);
          await publisher.afterRecord?.(ref);
          console.log(`       → ${ref.url}`);
          break;
        }
        case "update": {
          console.log(`update ${action.sourcePath}`);
          const existing = next.entries[action.sourcePath];
          const prev = existing?.providers[key];
          if (!prev) {
            throw new Error(
              `Internal: update action without provider entry for ${action.sourcePath}`,
            );
          }
          await publisher.update(
            { id: action.fileId, url: prev.url },
            { name: action.name, body: action.body },
          );
          next.entries[action.sourcePath] = {
            providers: {
              ...existing!.providers,
              [key]: { ...prev, lastSyncedHash: action.hash },
            },
          };
          await writeLedger(next);
          break;
        }
        case "rename": {
          console.log(`rename ${action.fromPath} → ${action.sourcePath}`);
          const prev = next.entries[action.fromPath]?.providers[key];
          if (!prev) {
            throw new Error(
              `Internal: rename without source provider entry for ${action.fromPath}`,
            );
          }
          // Reuse the same mirror: update content, then move to the new folder.
          // id and URL stay stable, so external links keep working.
          const ref: DestinationRef = { id: action.fileId, url: prev.url };
          await publisher.update(ref, {
            name: action.name,
            body: action.body,
          });
          await publisher.move(ref, action.segments);
          // Re-key the ledger from old path to new.
          const toExisting = next.entries[action.sourcePath];
          next.entries[action.sourcePath] = {
            providers: {
              ...(toExisting?.providers ?? {}),
              [key]: { ...prev, lastSyncedHash: action.hash },
            },
          };
          dropProvider(next, action.fromPath, key);
          await writeLedger(next);
          break;
        }
        case "delete": {
          console.log(
            `delete ${action.sourcePath}  (onDelete: ${action.onDelete})`,
          );
          const prev = next.entries[action.sourcePath]?.providers[key];
          const ref: DestinationRef = {
            id: action.fileId,
            url: prev?.url ?? "",
          };
          await publisher.delete(ref, action.onDelete);
          dropProvider(next, action.sourcePath, key);
          await writeLedger(next);
          break;
        }
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`FAILED ${action.sourcePath}: ${msg}`);
    }
  }
  return { next, failed };
}
