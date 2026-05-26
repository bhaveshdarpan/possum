import { main } from "../src/main.js";

try {
  process.loadEnvFile();
} catch {
  // no .env file in cwd; rely on the real environment
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
