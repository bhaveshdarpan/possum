import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadManifest } from "../../src/config/manifest.js";

// Feature: manifest.feature — validate; fail fast

const dirs: string[] = [];
function writeManifest(yaml: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "docpipe-manifest-"));
  dirs.push(dir);
  const file = path.join(dir, "docpipe.yaml");
  writeFileSync(file, yaml);
  return file;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const VALID = `
version: 1
source: { type: git, docsDir: docs }
targets:
  - { name: google-docs, type: google-docs, driveFolderId: "fld", orgDomain: "e.com" }
defaults: { publish: [google-docs] }
`;

describe("loadManifest (P0-2)", () => {
  it("loads a valid manifest and applies defaults", () => {
    const m = loadManifest(writeManifest(VALID));
    expect(m.version).toBe(1);
    expect(m.source).toEqual({ type: "git", docsDir: "docs" });
    expect(m.targets[0]).toMatchObject({
      name: "google-docs",
      type: "google-docs",
      driveFolderId: "fld",
      orgDomain: "e.com",
      mode: "mirror", // defaulted
    });
    expect(m.defaults.onDelete).toBe("trash"); // defaulted
    expect(m.defaults.onUnchanged).toBe("skip"); // defaulted
  });

  it("applies source + defaults when omitted entirely", () => {
    const m = loadManifest(
      writeManifest(
        `version: 1\ntargets:\n  - { name: g, type: google-docs, driveFolderId: "f", orgDomain: "e.com" }\n`,
      ),
    );
    expect(m.source.docsDir).toBe("docs");
    expect(m.defaults.publish).toEqual([]);
  });

  it("fails fast when a required field is missing", () => {
    const bad = `version: 1\ntargets:\n  - { name: g, type: google-docs, orgDomain: "e.com" }\n`;
    expect(() => loadManifest(writeManifest(bad))).toThrow(
      /driveFolderId/,
    );
  });

  it("rejects duplicate target names", () => {
    const bad = `
version: 1
targets:
  - { name: dup, type: google-docs, driveFolderId: "a", orgDomain: "e.com" }
  - { name: dup, type: google-docs, driveFolderId: "b", orgDomain: "e.com" }
`;
    expect(() => loadManifest(writeManifest(bad))).toThrow(/duplicate target name/);
  });

  it("rejects defaults.publish referencing an unknown target", () => {
    const bad = `
version: 1
targets:
  - { name: google-docs, type: google-docs, driveFolderId: "a", orgDomain: "e.com" }
defaults: { publish: [notion] }
`;
    expect(() => loadManifest(writeManifest(bad))).toThrow(/unknown target "notion"/);
  });

  it("rejects an unknown onDelete value", () => {
    const bad = VALID.replace(
      "defaults: { publish: [google-docs] }",
      "defaults: { publish: [google-docs], onDelete: nuke }",
    );
    expect(() => loadManifest(writeManifest(bad))).toThrow(/onDelete/);
  });

  it("throws a helpful error when the file is absent", () => {
    expect(() => loadManifest("/no/such/docpipe.yaml")).toThrow(/not found/);
  });
});
