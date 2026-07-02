import { markdownToDocx } from "../converters/markdown-to-docx.js";
import type { DriveContext } from "../providers/google-drive/auth.js";
import { ensureFolderPath } from "../providers/google-drive/folders.js";
import {
  createDoc,
  updateDoc,
  trashDoc,
  moveDoc,
} from "../providers/google-drive/files.js";
import { grantDomainCommenter } from "../providers/google-drive/permissions.js";
import type { IndexFile } from "../index/schema.js";
import { PROVIDER, type DocAction } from "./plan.js";

// Folder that `onDelete: archive` moves mirrors into, under the Drive root.
const ARCHIVE_FOLDER = "_Archived";

// Remove this provider's publication from a ledger path, dropping the entry
// entirely once no providers remain. Builds fresh objects (no mutation of
// shared nested state).
function dropProvider(index: IndexFile, sourcePath: string): void {
  const entry = index.entries[sourcePath];
  if (!entry) return;
  const { [PROVIDER]: _removed, ...rest } = entry.providers;
  if (Object.keys(rest).length === 0) {
    delete index.entries[sourcePath];
  } else {
    index.entries[sourcePath] = { providers: rest };
  }
}

export type RunResult = { next: IndexFile; failed: number };

// Persist the ledger after each successful action. Passed in so the caller
// owns where the ledger lives (file path today; a store later).
export type WriteLedger = (index: IndexFile) => Promise<void>;

// Partial-failure isolation (P0-6): each action is wrapped in its own
// try/catch, the ledger is persisted immediately after a successful
// create/update — crucially BEFORE the permission grant, so a Doc is never
// orphaned (recorded-less) if the grant throws — and one failure never blocks
// the rest. The caller exits non-zero when `failed > 0`.
export async function runActions(
  ctx: DriveContext,
  index: IndexFile,
  actions: DocAction[],
  writeLedger: WriteLedger,
): Promise<RunResult> {
  const next: IndexFile = {
    version: index.version,
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
          const docx = await markdownToDocx(action.body);
          const folderId = await ensureFolderPath(ctx, action.segments);
          const { fileId, url } = await createDoc(
            ctx,
            folderId,
            action.name,
            docx,
          );
          const existing = next.entries[action.sourcePath];
          next.entries[action.sourcePath] = {
            providers: {
              ...(existing?.providers ?? {}),
              [PROVIDER]: { fileId, url, lastSyncedHash: action.hash },
            },
          };
          // Record BEFORE the grant so a grant failure can't orphan the Doc.
          await writeLedger(next);
          await grantDomainCommenter(ctx, fileId);
          console.log(`       → ${url}`);
          break;
        }
        case "update": {
          console.log(`update ${action.sourcePath}`);
          const docx = await markdownToDocx(action.body);
          await updateDoc(ctx, action.fileId, action.name, docx);
          const existing = next.entries[action.sourcePath];
          if (!existing) {
            throw new Error(
              `Internal: update action without index entry for ${action.sourcePath}`,
            );
          }
          const prev = existing.providers[PROVIDER];
          if (!prev) {
            throw new Error(
              `Internal: update action without provider entry for ${action.sourcePath}`,
            );
          }
          next.entries[action.sourcePath] = {
            providers: {
              ...existing.providers,
              [PROVIDER]: { ...prev, lastSyncedHash: action.hash },
            },
          };
          await writeLedger(next);
          break;
        }
        case "rename": {
          console.log(`rename ${action.fromPath} → ${action.sourcePath}`);
          const fromEntry = next.entries[action.fromPath];
          const prev = fromEntry?.providers[PROVIDER];
          if (!prev) {
            throw new Error(
              `Internal: rename without source provider entry for ${action.fromPath}`,
            );
          }
          // Reuse the same Drive file: update content, then move it to the new
          // folder. id and URL stay stable, so external links keep working.
          const docx = await markdownToDocx(action.body);
          await updateDoc(ctx, action.fileId, action.name, docx);
          const folderId = await ensureFolderPath(ctx, action.segments);
          await moveDoc(ctx, action.fileId, folderId);
          // Re-key the ledger from old path to new.
          const toExisting = next.entries[action.sourcePath];
          next.entries[action.sourcePath] = {
            providers: {
              ...(toExisting?.providers ?? {}),
              [PROVIDER]: { ...prev, lastSyncedHash: action.hash },
            },
          };
          dropProvider(next, action.fromPath);
          await writeLedger(next);
          break;
        }
        case "delete": {
          console.log(
            `delete ${action.sourcePath}  (onDelete: ${action.onDelete})`,
          );
          if (action.onDelete === "archive") {
            const archiveId = await ensureFolderPath(ctx, [ARCHIVE_FOLDER]);
            await moveDoc(ctx, action.fileId, archiveId);
          } else {
            await trashDoc(ctx, action.fileId);
          }
          dropProvider(next, action.sourcePath);
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
