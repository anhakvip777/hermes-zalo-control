import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
    // SQLite = one writer at a time. Single thread, sequential files.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // TDB1: Force test environment variables in the worker process.
    // This is a defense-in-depth layer; the package.json test script
    // also sets these in the shell environment for prisma db push.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "file:./test.db",
    },
  },
});
