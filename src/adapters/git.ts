import { execFileSync } from "node:child_process";

// Small Git helper for rename detection (P0-8). Kept dependency-free and
// failure-tolerant: if Git is unavailable or the repo has no history, callers
// fall back to content-hash matching.

export function currentHead(repoRoot: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// Renames of tracked files under `pathspec` between `sinceSha` and HEAD, as a
// map of old → new repo-relative POSIX paths. Empty when `sinceSha` is missing,
// Git is unavailable, or nothing was renamed.
export function detectRenames(
  repoRoot: string,
  sinceSha: string | undefined,
  pathspec: string,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!sinceSha) return map;
  let out: string;
  try {
    out = execFileSync(
      "git",
      [
        "diff",
        "--find-renames",
        "--name-status",
        sinceSha,
        "HEAD",
        "--",
        pathspec,
      ],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return map;
  }
  for (const line of out.split("\n")) {
    if (line === "") continue;
    const parts = line.split("\t");
    // Rename status is "R<score>" followed by old and new paths.
    if (parts[0]?.startsWith("R") && parts.length >= 3) {
      map.set(parts[1]!, parts[2]!);
    }
  }
  return map;
}
