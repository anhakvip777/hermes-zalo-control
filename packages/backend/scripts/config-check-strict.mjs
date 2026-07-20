#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(backendRoot, "..", "..");
const checker = resolve(backendRoot, "src", "config-check-cli.ts");

// Resolve the workspace-local tsx installation without relying on a shell
// assignment (`STRICT_CONFIG_CHECK=true ...`), which is not portable to
// PowerShell.  Calling tsx's CLI module through node also avoids spawning a
// `.cmd` shim with shell=true on Windows.
const tsxCliCandidates = [
  resolve(backendRoot, "node_modules", "tsx", "dist", "cli.mjs"),
  resolve(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
];
const tsxCli = tsxCliCandidates.find((candidate) => existsSync(candidate));

if (!tsxCli) {
  console.error("[config-check] Unable to locate the workspace-local tsx CLI");
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, [tsxCli, checker, "--strict"], {
    cwd: backendRoot,
    env: { ...process.env, STRICT_CONFIG_CHECK: "true" },
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(`[config-check] Unable to start checker: ${result.error.message}`);
    process.exitCode = 1;
  } else {
    // Preserve the child's exit status exactly. A null status means the child
    // was terminated before it could return a code; report a generic failure.
    process.exitCode = typeof result.status === "number" ? result.status : 1;
  }
}
