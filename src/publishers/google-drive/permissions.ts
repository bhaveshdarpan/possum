import type { DriveContext } from "./auth.js";

export async function grantDomainCommenter(
  ctx: DriveContext,
  fileId: string,
): Promise<void> {
  await ctx.drive.permissions.create({
    fileId,
    requestBody: {
      type: "domain",
      role: "commenter",
      domain: ctx.orgDomain,
    },
    sendNotificationEmail: false,
    supportsAllDrives: true,
  });
}
