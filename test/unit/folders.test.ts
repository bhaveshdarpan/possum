import { describe, it, expect } from "vitest";
import { ensureFolderPath } from "../../src/publishers/google-drive/folders.js";
import type { DriveContext } from "../../src/publishers/google-drive/auth.js";

// Unit: Drive folder-query escaping and the per-run folder cache.

function fakeCtx(opts: {
  listQueries: string[];
  existing?: Record<string, string>; // folder name → id already present
}): DriveContext {
  let created = 0;
  const drive = {
    files: {
      list: async (req: { q: string }) => {
        opts.listQueries.push(req.q);
        for (const [name, id] of Object.entries(opts.existing ?? {})) {
          if (req.q.includes(`name='${name.replace(/'/g, "\\'")}'`)) {
            return { data: { files: [{ id, name }] } };
          }
        }
        return { data: { files: [] } };
      },
      create: async () => ({ data: { id: `new-${++created}` } }),
    },
  };
  return {
    drive: drive as unknown as DriveContext["drive"],
    rootFolderId: "root",
    orgDomain: "e.com",
    folderCache: new Map(),
  };
}

describe("ensureFolderPath", () => {
  it("escapes single quotes in the Drive query", async () => {
    const listQueries: string[] = [];
    const ctx = fakeCtx({ listQueries });
    await ensureFolderPath(ctx, ["O'Brien"]);
    expect(listQueries[0]).toContain("name='O\\'Brien'");
  });

  it("returns the root folder id for an empty path", async () => {
    const listQueries: string[] = [];
    const ctx = fakeCtx({ listQueries });
    expect(await ensureFolderPath(ctx, [])).toBe("root");
    expect(listQueries).toHaveLength(0);
  });

  it("reuses an existing folder instead of creating one", async () => {
    const listQueries: string[] = [];
    const ctx = fakeCtx({ listQueries, existing: { Reports: "fld-reports" } });
    expect(await ensureFolderPath(ctx, ["Reports"])).toBe("fld-reports");
  });

  it("caches folder ids across calls in the same run", async () => {
    const listQueries: string[] = [];
    const ctx = fakeCtx({ listQueries });
    await ensureFolderPath(ctx, ["a", "b"]);
    await ensureFolderPath(ctx, ["a", "b"]); // fully cached — no new lookups
    // First call performs 2 lookups (a, then b); second call hits the cache.
    expect(listQueries).toHaveLength(2);
  });
});
