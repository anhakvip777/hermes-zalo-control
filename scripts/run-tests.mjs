#!/usr/bin/env node

/**
 * Root test orchestrator.
 *
 * Backend tests must run through the package runner because it creates and
 * verifies the isolated Prisma test database before invoking Vitest. The root
 * runner then executes shared and frontend tests without ever selecting the
 * backend files directly.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const VITEST_CLI = require.resolve("vitest/vitest.mjs");
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: "file:./test.db",
};

const steps = [
  {
    cmd: process.execPath,
    args: ["packages/backend/scripts/run-tests.mjs"],
    label: "backend (isolated test DB)",
  },
  {
    cmd: process.execPath,
    args: [
      VITEST_CLI,
      "run",
      "--config",
      "./packages/shared/vitest.config.ts",
    ],
    label: "shared",
  },
  {
    cmd: process.execPath,
    args: [
      VITEST_CLI,
      "run",
      "--config",
      "./vitest.config.ts",
      "packages/frontend/src",
    ],
    label: "frontend",
  },
];

for (const { cmd, args, label } of steps) {
  console.log("");
  console.log("[root-tests] === " + label + " ===");
  const result = spawnSync(cmd, args, {
    cwd: PROJECT_ROOT,
    env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error("[root-tests] " + label + " failed to start: " + result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("[root-tests] " + label + " failed with exit code " + (result.status ?? 1));
    process.exit(result.status ?? 1);
  }
}

console.log("");
console.log("[root-tests] All test groups passed.");
