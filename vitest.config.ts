import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "packages/*/src/**/*.test.tsx"],
    exclude: ["node_modules", "dist", ".next"],
    // SQLite = single writer. All tests must run sequentially.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    testTimeout: 15_000,
  },
});
