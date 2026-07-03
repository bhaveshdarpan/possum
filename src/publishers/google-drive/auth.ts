import { google, type drive_v3 } from "googleapis";
import { GoogleAuth } from "google-auth-library";

export type DriveContext = {
  drive: drive_v3.Drive;
  rootFolderId: string;
  orgDomain: string;
  folderCache: Map<string, string>;
};

export async function createDriveContext(opts: {
  rootFolderId: string;
  orgDomain: string;
}): Promise<DriveContext> {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });
  return {
    drive,
    rootFolderId: opts.rootFolderId,
    orgDomain: opts.orgDomain,
    folderCache: new Map(),
  };
}
