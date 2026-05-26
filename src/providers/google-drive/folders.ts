import type { DriveContext } from "./auth.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function escapeDriveQuery(name: string): string {
  return name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findFolder(
  ctx: DriveContext,
  parentId: string,
  name: string,
): Promise<string | null> {
  const q = [
    `name='${escapeDriveQuery(name)}'`,
    `mimeType='${FOLDER_MIME}'`,
    `'${parentId}' in parents`,
    "trashed=false",
  ].join(" and ");
  const res = await ctx.drive.files.list({
    q,
    fields: "files(id, name)",
    pageSize: 2,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const files = res.data.files ?? [];
  return files[0]?.id ?? null;
}

async function createFolder(
  ctx: DriveContext,
  parentId: string,
  name: string,
): Promise<string> {
  const res = await ctx.drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id",
    supportsAllDrives: true,
  });
  const id = res.data.id;
  if (!id) throw new Error(`Drive did not return an id for folder "${name}"`);
  return id;
}

export async function ensureFolderPath(
  ctx: DriveContext,
  segments: string[],
): Promise<string> {
  let parentId = ctx.rootFolderId;
  const trail: string[] = [];
  for (const seg of segments) {
    trail.push(seg);
    const cacheKey = trail.join("/");
    const cached = ctx.folderCache.get(cacheKey);
    if (cached) {
      parentId = cached;
      continue;
    }
    const existing = await findFolder(ctx, parentId, seg);
    const id = existing ?? (await createFolder(ctx, parentId, seg));
    ctx.folderCache.set(cacheKey, id);
    parentId = id;
  }
  return parentId;
}
