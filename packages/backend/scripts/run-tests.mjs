#!/usr/bin/env node
/**
 * Test Runner — TDB1 Test Database Isolation
 *
 * Runs the backend test suite in an isolated test database.
 * Sets NODE_ENV=test and DATABASE_URL=file:./test.db for ALL child processes,
 * ensuring prisma db push, assert-test-db, and vitest all use the test DB.
 *
 * Usage:
 *   node scripts/run-tests.mjs
 *   # Or via npm: npm test -w packages/backend
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const PRISMA_CLI = require.resolve("prisma/build/index.js");
const VITEST_CLI = require.resolve("vitest/vitest.mjs");
const TEST_FS_ROOT = mkdtempSync(join(tmpdir(), `hermes-backend-tests-${process.pid}-`));
const TEST_DATABASE_NAME = `test-${process.pid}-${Date.now()}.db`;
const TEST_DATABASE_PATH = resolve(PROJECT_ROOT, "prisma", TEST_DATABASE_NAME);
writeFileSync(TEST_DATABASE_PATH, "");

// Override environment for the entire test run
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: `file:./${TEST_DATABASE_NAME}`,
  SYSTEM_BACKUP_ROOT: resolve(TEST_FS_ROOT, "backups", "system"),
  DB_BACKUP_DIR: resolve(TEST_FS_ROOT, "backups", "db"),
  ZALO_SESSION_DIR: resolve(TEST_FS_ROOT, "zalo-session"),
};

const testFilters = process.argv.slice(2);

const steps = [
  { cmd: process.execPath, args: ["scripts/assert-test-db.mjs"], label: "assert-test-db" },
  { cmd: process.execPath, args: [PRISMA_CLI, "db", "push", "--skip-generate"], label: "prisma db push" },
  { cmd: process.execPath, args: ["scripts/assert-test-db.mjs"], label: "assert-test-db (post-push)" },
  { cmd: process.execPath, args: [VITEST_CLI, "run", ...testFilters], label: "vitest" },
];

let exitCode = 0;
try {
  for (const { cmd, args, label } of steps) {
    console.log(`\n[run-tests] === ${label} ===`);
    const result = spawnSync(cmd, args, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      env,
      shell: false,
    });

    if (result.error) {
      console.error(`\n[run-tests] FAIL: ${label} failed to start: ${result.error.message}`);
      exitCode = 1;
      break;
    }
    if (result.status !== 0) {
      console.error(`\n[run-tests] FAIL: ${label} exited with code ${result.status}`);
      exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  rmSync(TEST_FS_ROOT, { recursive: true, force: true });
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(TEST_DATABASE_PATH + suffix, { force: true });
  }
}

if (exitCode !== 0) process.exit(exitCode);
console.log("\n[run-tests] All steps passed.");
