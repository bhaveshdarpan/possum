import type {
  Publisher,
  DestinationRef,
  PublishTargetDoc,
} from "../../ports/publisher.js";
import type { OnDelete } from "../../domain/publish-plan.js";
import { markdownToDocx } from "../../converters/markdown-to-docx.js";
import {
  createDriveContext,
  type DriveContext,
} from "../../providers/google-drive/auth.js";
import { ensureFolderPath } from "../../providers/google-drive/folders.js";
import {
  createDoc,
  updateDoc,
  moveDoc,
  trashDoc,
} from "../../providers/google-drive/files.js";
import { grantDomainCommenter } from "../../providers/google-drive/permissions.js";

// Folder that `onDelete: archive` moves mirrors into, under the Drive root.
const ARCHIVE_FOLDER = "_Archived";

// Publishes Documents to Google Docs. Owns rendering (markdown → docx), folder
// mirroring, and the commenter grant, so the app sees only the Publisher port.
// Exported for tests (construct with a fake DriveContext); production code uses
// the async factory below, which builds the authenticated context.
export class GoogleDrivePublisher implements Publisher {
  readonly type = "google-docs"; 
  readonly providerId = "google-drive"; // stable ledger key (wire-compatible)
  readonly capabilities = { folders: true, comments: true };

  constructor(private readonly ctx: DriveContext) {}

  async create(doc: PublishTargetDoc): Promise<DestinationRef> {
    const docx = await markdownToDocx(doc.body);
    const folderId = await ensureFolderPath(this.ctx, doc.segments);
    const { fileId, url } = await createDoc(this.ctx, folderId, doc.name, docx);
    return { id: fileId, url };
  }

  async update(ref: DestinationRef, doc: PublishTargetDoc): Promise<void> {
    const docx = await markdownToDocx(doc.body);
    await updateDoc(this.ctx, ref.id, doc.name, docx);
  }

  async move(ref: DestinationRef, segments: string[]): Promise<void> {
    const folderId = await ensureFolderPath(this.ctx, segments);
    await moveDoc(this.ctx, ref.id, folderId);
  }

  async delete(ref: DestinationRef, mode: OnDelete): Promise<void> {
    // The domain converts `ignore` to a skip, so this is only defensive.
    if (mode === "ignore") return;
    if (mode === "archive") {
      const archiveId = await ensureFolderPath(this.ctx, [ARCHIVE_FOLDER]);
      await moveDoc(this.ctx, ref.id, archiveId);
    } else {
      await trashDoc(this.ctx, ref.id);
    }
  }

  async afterRecord(ref: DestinationRef): Promise<void> {
    await grantDomainCommenter(this.ctx, ref.id);
  }
}

export async function createGoogleDrivePublisher(opts: {
  driveFolderId: string;
  orgDomain: string;
}): Promise<Publisher> {
  const ctx = await createDriveContext({
    rootFolderId: opts.driveFolderId,
    orgDomain: opts.orgDomain,
  });
  return new GoogleDrivePublisher(ctx);
}
