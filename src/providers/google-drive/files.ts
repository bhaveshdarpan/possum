import { Readable } from "node:stream";
import type { DriveContext } from "./auth.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

function bufferToStream(buf: Buffer): Readable {
  return Readable.from(buf);
}

export async function createDoc(
  ctx: DriveContext,
  folderId: string,
  name: string,
  docx: Buffer,
): Promise<{ fileId: string; url: string }> {
  const res = await ctx.drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType: GOOGLE_DOC_MIME,
    },
    media: { mimeType: DOCX_MIME, body: bufferToStream(docx) },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  const fileId = res.data.id;
  const url = res.data.webViewLink;
  if (!fileId || !url) {
    throw new Error(`Drive create returned incomplete data for "${name}"`);
  }
  return { fileId, url };
}

export async function updateDoc(
  ctx: DriveContext,
  fileId: string,
  name: string,
  docx: Buffer,
): Promise<void> {
  await ctx.drive.files.update({
    fileId,
    requestBody: { name },
    media: { mimeType: DOCX_MIME, body: bufferToStream(docx) },
    supportsAllDrives: true,
  });
}
