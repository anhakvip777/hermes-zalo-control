import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    globals: true,
    environment: "node",
    include: ["packages/shared/src/**/*.test.ts", "packages/frontend/src/**/*.test.ts", "packages/frontend/src/**/*.test.tsx"],
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
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "file:./test.db",
    },
  },
});
