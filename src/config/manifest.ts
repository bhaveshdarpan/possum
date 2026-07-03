import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// A named, typed destination. V1 has one publisher type: google-docs.
// Non-secret config (driveFolderId, orgDomain) lives here in the committed
// manifest; the service-account key stays in env (ADR-0003).
const targetSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["google-docs"]),
  driveFolderId: z.string().min(1),
  orgDomain: z.string().min(1),
  mode: z.enum(["mirror"]).default("mirror"),
});

const manifestSchema = z
  .object({
    version: z.literal(1),
    source: z
      .object({
        type: z.enum(["git"]).default("git"),
        docsDir: z.string().min(1).default("docs"),
      })
      .default({ type: "git", docsDir: "docs" }),
    targets: z.array(targetSchema).min(1),
    // Where the machine-managed Sync Ledger lives, relative to the repo root.
    // Like a lockfile: committed, but never hand-edited. Adopters can relocate
    // it (e.g. "state/ledger.json"); nested paths are created automatically.
    ledger: z.string().min(1).default("ledger.json"),
    defaults: z
      .object({
        onUnchanged: z.enum(["skip"]).default("skip"),
        onDelete: z.enum(["trash", "archive", "ignore"]).default("trash"),
        publish: z.array(z.string()).default([]),
      })
      .default({ onUnchanged: "skip", onDelete: "trash", publish: [] }),
  })
  .superRefine((m, ctx) => {
    // Invariant: every Target name is unique (domain-model PipelineConfig).
    const names = m.targets.map((t) => t.name);
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const n of names) {
      if (seen.has(n)) dupes.add(n);
      seen.add(n);
    }
    if (dupes.size > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate target name(s): ${[...dupes].join(", ")}`,
        path: ["targets"],
      });
    }
    // Invariant: defaults.publish only references declared targets.
    m.defaults.publish.forEach((p, i) => {
      if (!seen.has(p)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `references unknown target "${p}"`,
          path: ["defaults", "publish", i],
        });
      }
    });
  });

export type Manifest = z.infer<typeof manifestSchema>;
export type Target = z.infer<typeof targetSchema>;

export function loadManifest(path: string): Manifest {
  if (!existsSync(path)) {
    throw new Error(
      `Manifest not found at ${path}. Create a possum.yaml (see README).`,
    );
  }
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${path} as YAML: ${msg}`);
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid manifest (${path}):\n${issues}`);
  }
  return parsed.data;
}
