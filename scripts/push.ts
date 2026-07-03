import { main } from "../src/cli/main.js";

try {
  process.loadEnvFile();
} catch {
  // no .env file in cwd; rely on the real environment
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
