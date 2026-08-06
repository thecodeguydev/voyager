import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./vitest.global-setup.ts",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // All test files share one Testcontainers database; keep them sequential so
    // truncate-between-tests stays correct instead of racing across files.
    fileParallelism: false,
  },
});
