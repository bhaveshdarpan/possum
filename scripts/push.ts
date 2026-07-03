import { main } from "../src/cli/main.js";

try {
  process.loadEnvFile();
} catch {
  // no .env file in cwd; rely on the real environment
}

const dryRun = process.argv.includes("--dry-run");

main({ dryRun }).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
