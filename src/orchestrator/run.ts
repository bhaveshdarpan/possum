import { markdownToDocx } from "../converters/markdown-to-docx.js";
import type { DriveContext } from "../providers/google-drive/auth.js";
import { ensureFolderPath } from "../providers/google-drive/folders.js";
import { createDoc, updateDoc } from "../providers/google-drive/files.js";
import { grantDomainCommenter } from "../providers/google-drive/permissions.js";
import type { IndexFile } from "../index/schema.js";
import { PROVIDER, type DocAction } from "./plan.js";

export async function runActions(
  ctx: DriveContext,
  index: IndexFile,
  actions: DocAction[],
): Promise<IndexFile> {
  const next: IndexFile = {
    version: index.version,
    entries: { ...index.entries },
  };
  for (const action of actions) {
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
        await grantDomainCommenter(ctx, fileId);
        const existing = next.entries[action.sourcePath];
        next.entries[action.sourcePath] = {
          providers: {
            ...(existing?.providers ?? {}),
            [PROVIDER]: { fileId, url, lastSyncedHash: action.hash },
          },
        };
        console.log(`       → ${url}`);
        break;
      }
      case "update": {
        console.log(`update ${action.sourcePath}`);
        const docx = await markdownToDocx(action.body);
        await updateDoc(ctx, action.fileId, docx);
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
        break;
      }
    }
  }
  return next;
}
