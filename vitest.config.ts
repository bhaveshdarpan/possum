import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/support/setup.ts"],
    restoreMocks: true,
    // The source is NodeNext and imports with explicit `.js` specifiers that
    // point at `.ts` files. Map those back to source so Vitest can resolve them.
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: "$1.ts" }],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      // Gate the pure core — Config, Transform, Orchestration, and the Git
      // adapter — where full coverage is achievable offline (testing-strategy
      // ≥90%). The Drive publisher's auth factory needs real Google credentials,
      // so it's covered by the contract test, not this threshold.
      include: ["src/app/**", "src/config/**", "src/adapters/git.ts"],
      thresholds: { statements: 90, functions: 90, lines: 90, branches: 80 },
    },
  },
});
