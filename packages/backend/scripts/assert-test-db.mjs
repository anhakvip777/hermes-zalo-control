#!/usr/bin/env node
/**
 * Assert Test Database Isolation
 *
 * Refuses to run unless DATABASE_URL points to a test-only database.
 * Prevents accidental wipe of runtime (dev.db) data during tests.
 *
 * Usage:
 *   node scripts/assert-test-db.mjs              # validate + exit 0/1
 *   node scripts/assert-test-db.mjs --verbose    # print DB path info
 *
 * Exit codes:
 *   0 — safe test DB
 *   1 — unsafe (dev.db or unknown)
 *
 * Part of TDB1 — Test Database Isolation (D2 incident fix).
 */

import { existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const PRISMA_DIR = resolve(PROJECT_ROOT, "prisma");

function red(s) { return `\x1b[31m${s}\x1b[0m`; }
function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }

function getResolvedDbPath() {
  const url = process.env.DATABASE_URL || "";
  if (!url) return { url, resolved: null, error: "DATABASE_URL is not set" };

  // Support file:./test.db and file:/absolute/path/test.db
  const match = url.match(/^file:(.+)$/);
  if (!match) {
    return { url, resolved: null, error: `DATABASE_URL is not a file: URL: ${url}` };
  }

  const relative = match[1];
  // Prisma resolves relative paths from the prisma/ directory
  const resolved = resolve(PRISMA_DIR, relative);
  return { url, resolved, relative, error: null };
}

function main() {
  const verbose = process.argv.includes("--verbose");
  const { url, resolved, error } = getResolvedDbPath();

  if (verbose) {
    console.log(`[assert-test-db] DATABASE_URL: ${url}`);
    console.log(`[assert-test-db] Resolved path: ${resolved || "(unresolvable)"}`);
    console.log(`[assert-test-db] NODE_ENV: ${process.env.NODE_ENV || "(not set)"}`);
  }

  if (error) {
    console.error(red(`[assert-test-db] FAIL: ${error}`));
    process.exit(1);
  }

  // Guard 1: NODE_ENV must be "test"
  if (process.env.NODE_ENV !== "test") {
    console.error(red(`[assert-test-db] FAIL: NODE_ENV=${process.env.NODE_ENV || "(not set)"}, expected "test"`));
    console.error(`[assert-test-db] Tests must run with NODE_ENV=test to protect runtime data.`);
    process.exit(1);
  }

  // Guard 2: DATABASE_URL must not be /dev.db
  if (resolved.endsWith("/dev.db") || resolved.endsWith("\\dev.db") || url.includes("dev.db")) {
    console.error(red(`[assert-test-db] FAIL: DATABASE_URL points to dev.db (runtime DB)`));
    console.error(`[assert-test-db] Resolved: ${resolved}`);
    console.error(`[assert-test-db] Tests must NEVER touch the runtime database.`);
    process.exit(1);
  }

  // Guard 3: DATABASE_URL must reference test.db, an owned test-*.db, or :memory:
  const testDatabaseName = resolved ? basename(resolved) : "";
  if (!/^test(?:-[A-Za-z0-9_-]+)?\.db$/i.test(testDatabaseName) && !url.includes(":memory:")) {
    console.error(red(`[assert-test-db] FAIL: DATABASE_URL does not reference a test DB`));
    console.error(`[assert-test-db] URL: ${url}`);
    console.error(`[assert-test-db] Expected file:./test.db, file:./test-<run>.db, or file::memory:`);
    process.exit(1);
  }

  // Check if test.db exists (informational, not fatal)
  if (verbose) {
    if (existsSync(resolved)) {
      console.log(green(`[assert-test-db] Test DB exists: ${resolved}`));
    } else {
      console.log(yellow(`[assert-test-db] Test DB not yet created: ${resolved}`));
      console.log(`[assert-test-db] It will be created by 'prisma db push' in the test script.`);
    }
  }

  console.log(green(`[assert-test-db] PASS — safe test DB: ${url}`));
  console.log(green(`[assert-test-db] Resolved: ${resolved}`));
  process.exit(0);
}

main();
