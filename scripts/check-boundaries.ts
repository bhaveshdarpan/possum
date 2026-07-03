// Enforces the hexagonal dependency rule (ADR-0002 / ADR-0006): the core —
// `domain/`, `ports/`, `app/` — must not import from `publishers/` or
// `adapters/`. Providers depend on the core, never the reverse; `cli/` is the
// only composition root and may import anything. Zero-dependency: scans import
// specifiers and resolves relative ones against the source tree.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "../src");
const CORE = ["domain", "ports", "app"];
const FORBIDDEN = ["publishers", "adapters"];
const IMPORT_RE = /(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

type Violation = { file: string; spec: string; target: string };
const violations: Violation[] = [];

for (const layer of CORE) {
  const dir = path.join(SRC, layer);
  for (const file of walk(dir)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1]!;
      if (!spec.startsWith(".")) continue; // external package
      const resolved = path.resolve(path.dirname(file), spec);
      const top = path.relative(SRC, resolved).split(path.sep)[0]!;
      if (FORBIDDEN.includes(top)) {
        violations.push({ file: path.relative(SRC, file), spec, target: top });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    `Boundary check failed — the core (${CORE.join(", ")}) must not import from ${FORBIDDEN.join(" / ")}:`,
  );
  for (const v of violations) {
    console.error(`  src/${v.file}  →  "${v.spec}"  (${v.target}/)`);
  }
  process.exit(1);
}

console.log(
  `Boundary check passed — core (${CORE.join(", ")}) imports nothing from ${FORBIDDEN.join(" / ")}.`,
);
