import { beforeEach, vi } from "vitest";

// Silence the engine's progress logging during tests. Spies are restored after
// each test (restoreMocks in vitest.config), so a test that wants to assert on
// output can still read `vi.mocked(console.log).mock.calls`.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
