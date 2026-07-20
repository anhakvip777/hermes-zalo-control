import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
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
      NODE_ENV: process.env.NODE_ENV ?? "test",
      DATABASE_URL: process.env.DATABASE_URL ?? "file:./test.db",
      SYSTEM_BACKUP_ROOT: process.env.SYSTEM_BACKUP_ROOT ?? "",
      DB_BACKUP_DIR: process.env.DB_BACKUP_DIR ?? "",
      ZALO_SESSION_DIR: process.env.ZALO_SESSION_DIR ?? "",
    },
    setupFiles: ["./src/test-env.ts"],
  },
});
