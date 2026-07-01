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
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// Override environment for the entire test run
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: "file:./test.db",
};

const steps = [
  { cmd: "npx", args: ["prisma", "db", "push", "--skip-generate"], label: "prisma db push" },
  { cmd: "node", args: ["scripts/assert-test-db.mjs"], label: "assert-test-db" },
  { cmd: "npx", args: ["vitest", "run"], label: "vitest" },
];

for (const { cmd, args, label } of steps) {
  console.log(`\n[run-tests] === ${label} ===`);
  const result = spawnSync(cmd, args, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env,
    shell: true,
  });

  if (result.status !== 0) {
    console.error(`\n[run-tests] FAIL: ${label} exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\n[run-tests] All steps passed.");
