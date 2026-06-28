import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT = "/home/anhakvip777/hermes-zalo-control/packages/backend/scripts/db-guard.mjs";
const NODE = "/home/anhakvip777/.nvm/versions/node/v22.23.0/bin/node";
const BACKEND_DIR = "/home/anhakvip777/hermes-zalo-control/packages/backend";
const ROOT_DIR = "/home/anhakvip777/hermes-zalo-control";
const BACKUP_DIR = join(BACKEND_DIR, "backups", "db");

function runGuard(args: string[], env?: Record<string, string>): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(NODE, [SCRIPT, ...args], {
    cwd: BACKEND_DIR,
    env: { ...process.env, ...env },
    timeout: 15_000,
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

describe("DB Guard — status", () => {
  it("status detects database existence and reports health", () => {
    const r = runGuard(["--status"]);
    // DB exists — should report database path and existence
    // Strip ANSI escape codes for assertions
    const clean = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    expect(clean).toContain("Database:");
    expect(clean).toContain("Exists: YES");
    expect(r.exitCode).toBe(0);
  });

  it("status reports FAIL for non-existent DB", () => {
    const r = runGuard(["--status"], { DATABASE_URL: "file:./nonexistent.db" });
    expect(r.stdout).toContain("Database file not found");
  });
});

describe("DB Guard — backup", () => {
  it("backup creates a file", () => {
    const before = readdirSync(BACKUP_DIR).filter((f) =>
      f.startsWith("dev.db.backup-")
    ).length;

    const r = runGuard(["--backup"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Backup created");

    const after = readdirSync(BACKUP_DIR).filter((f) =>
      f.startsWith("dev.db.backup-")
    ).length;
    expect(after).toBeGreaterThan(before);
  });

  it("backup retention keeps latest N (DB_BACKUP_KEEP=2)", () => {
    // Create extra backups
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(BACKUP_DIR, `dev.db.backup-extra-${i}.sqlite`), "test");
    }

    const r = runGuard(["--backup"], { DB_BACKUP_KEEP: "2" });
    expect(r.exitCode).toBe(0);

    const files = readdirSync(BACKUP_DIR).filter((f) =>
      f.startsWith("dev.db.backup-")
    ).length;
    expect(files).toBeLessThanOrEqual(2);

    // Cleanup extras
    for (let i = 0; i < 5; i++) {
      const p = join(BACKUP_DIR, `dev.db.backup-extra-${i}.sqlite`);
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it("backup fails if DB doesn't exist", () => {
    const r = runGuard(["--backup"], { DATABASE_URL: "file:./nonexistent.db" });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("Cannot backup");
  });
});

describe("DB Guard — reset protection", () => {
  it("blocks reset without ALLOW_DB_RESET", () => {
    const r = runGuard(["--before-reset"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("BLOCKED");
    expect(r.stdout).toContain("ALLOW_DB_RESET");
  });

  it("allows reset with ALLOW_DB_RESET=true (backup created)", () => {
    const r = runGuard(["--before-reset"], { ALLOW_DB_RESET: "true" });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("safe to proceed");
  });
});

describe("DB Guard — before-db-push", () => {
  it("creates backup and allows push", () => {
    const r = runGuard(["--before-db-push"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Backup created");
    expect(r.stdout).toContain("Safe to proceed");
  });
});

describe("DB Guard — script integration", () => {
  it("npm run db:guard works", () => {
    const r = spawnSync("npm", ["run", "db:guard"], {
      cwd: ROOT_DIR,
      timeout: 30_000,
    });
    const output = r.stdout?.toString() ?? "";
    expect(output).toContain("Database:");
    expect(output).toContain("Exists:");
  });
});
