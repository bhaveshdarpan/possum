import { describe, it, expect } from "vitest";
import {
  GoogleDrivePublisher,
  GOOGLE_DRIVE_PROVIDER_ID,
} from "../../src/publishers/google-drive/publisher.js";
import type { DriveContext } from "../../src/publishers/google-drive/auth.js";

// Feature: publish_google_docs.feature — create, then update in place (P0-3).
// Contract test: the real publisher against a fake Drive client. Pins the edges
// the acceptance tests stub out (create returns an id; update targets same id).

type DriveCall = { method: string; args: any };

function fakeDrive(calls: DriveCall[]) {
  return {
    files: {
      create: async (args: any) => {
        calls.push({ method: "files.create", args });
        // A Doc create (has media) returns id + link; a folder create returns id.
        if (args.media) {
          return { data: { id: "doc-1", webViewLink: "https://docs.google.com/document/d/doc-1/edit" } };
        }
        return { data: { id: "folder-1" } };
      },
      update: async (args: any) => {
        calls.push({ method: "files.update", args });
        return { data: {} };
      },
      get: async (args: any) => {
        calls.push({ method: "files.get", args });
        return { data: { parents: ["root"] } };
      },
      list: async (args: any) => {
        calls.push({ method: "files.list", args });
        return { data: { files: [] } };
      },
    },
    permissions: {
      create: async (args: any) => {
        calls.push({ method: "permissions.create", args });
        return { data: {} };
      },
    },
  };
}

function publisher(calls: DriveCall[]): GoogleDrivePublisher {
  const ctx: DriveContext = {
    drive: fakeDrive(calls) as unknown as DriveContext["drive"],
    rootFolderId: "root",
    orgDomain: "example.com",
    folderCache: new Map(),
  };
  return new GoogleDrivePublisher(ctx);
}

describe("GoogleDrivePublisher contract (P0-3)", () => {
  it("declares its type and stable ledger providerId", () => {
    expect(publisher([]).type).toBe("google-docs");
    expect(publisher([]).providerId).toBe(GOOGLE_DRIVE_PROVIDER_ID);
    expect(GOOGLE_DRIVE_PROVIDER_ID).toBe("google-drive");
  });

  it("create returns a destination ref from the Drive response", async () => {
    const calls: DriveCall[] = [];
    const ref = await publisher(calls).create({ name: "Doc", body: "# hi", segments: [] });
    expect(ref).toEqual({ id: "doc-1", url: "https://docs.google.com/document/d/doc-1/edit" });
    const create = calls.find((c) => c.method === "files.create")!;
    expect(create.args.requestBody.mimeType).toBe("application/vnd.google-apps.document");
  });

  it("update targets the same fileId and creates no new Doc", async () => {
    const calls: DriveCall[] = [];
    const pub = publisher(calls);
    const ref = await pub.create({ name: "Doc", body: "# v1", segments: [] });
    calls.length = 0; // isolate the update
    await pub.update(ref, { name: "Doc", body: "# v2" });

    const updates = calls.filter((c) => c.method === "files.update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.args.fileId).toBe("doc-1");
    expect(calls.some((c) => c.method === "files.create")).toBe(false);
  });

  it("move reparents the file (add new parent, remove old)", async () => {
    const calls: DriveCall[] = [];
    await publisher(calls).move({ id: "doc-1", url: "u" }, ["Reports"]);
    const update = calls.find((c) => c.method === "files.update")!;
    expect(update.args.fileId).toBe("doc-1");
    expect(update.args.addParents).toBe("folder-1"); // ensureFolderPath created it
    expect(update.args.removeParents).toBe("root");
  });

  it("delete(trash) trashes the file; afterRecord grants domain commenter", async () => {
    const calls: DriveCall[] = [];
    const pub = publisher(calls);
    await pub.delete({ id: "doc-1", url: "u" }, "trash");
    expect(calls.find((c) => c.method === "files.update")!.args.requestBody.trashed).toBe(true);

    calls.length = 0;
    await pub.afterRecord({ id: "doc-1", url: "u" });
    const grant = calls.find((c) => c.method === "permissions.create")!;
    expect(grant.args.requestBody).toMatchObject({
      type: "domain",
      role: "commenter",
      domain: "example.com",
    });
  });
});
