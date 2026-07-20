import { afterAll, beforeEach, describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(TEST_DIR, "..", "..");
const ROOT_DIR = join(BACKEND_DIR, "..", "..");
const SCRIPT = join(BACKEND_DIR, "scripts", "db-guard.mjs");
const NODE = process.execPath;
const ISOLATION_ROOT = mkdtempSync(join(tmpdir(), "hermes-db-guard-test-"));
const BACKUP_DIR = join(ISOLATION_ROOT, "backups", "db");
const SESSION_DIR = join(ISOLATION_ROOT, "zalo-session");
const TEST_DATABASE_DIR = join(ISOLATION_ROOT, "prisma");
const TEST_DATABASE_PATH = join(TEST_DATABASE_DIR, "test.db");
const MISSING_DATABASE_URL = `file:${join(TEST_DATABASE_DIR, "nonexistent.db")}`;
const ACTIVE_DATABASE_URL = process.env.DATABASE_URL ?? "file:./test.db";
const ACTIVE_DATABASE_PATH = resolve(BACKEND_DIR, "prisma", ACTIVE_DATABASE_URL.replace(/^file:/, ""));
mkdirSync(TEST_DATABASE_DIR, { recursive: true });
copyFileSync(ACTIVE_DATABASE_PATH, TEST_DATABASE_PATH);
const ISOLATED_ENV = {
  DATABASE_URL: `file:${TEST_DATABASE_PATH}`,
  DB_BACKUP_DIR: BACKUP_DIR,
  ZALO_SESSION_DIR: SESSION_DIR,
};

beforeEach(() => {
  rmSync(BACKUP_DIR, { recursive: true, force: true });
  mkdirSync(BACKUP_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(ISOLATION_ROOT, { recursive: true, force: true });
});

function runGuard(args: string[], env?: Record<string, string>): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(NODE, [SCRIPT, ...args], {
    cwd: BACKEND_DIR,
    env: { ...process.env, ...ISOLATED_ENV, ...env },
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
    const r = runGuard(["--status"], { DATABASE_URL: MISSING_DATABASE_URL });
    expect(r.stdout).toContain("Database file not found");
  });
});

describe("DB Guard — backup", () => {
  it.each(["0", "-1", "1.5", "invalid"])(
    "rejects an invalid DB_BACKUP_KEEP value (%s) before creating a backup",
    (keep) => {
      const r = runGuard(["--backup"], { DB_BACKUP_KEEP: keep });

      expect(r.exitCode).toBe(1);
      expect(r.stdout).toContain("DB_BACKUP_KEEP");
      expect(readdirSync(BACKUP_DIR)).toHaveLength(0);
    },
  );

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
    const r = runGuard(["--backup"], { DATABASE_URL: MISSING_DATABASE_URL });
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
      env: { ...process.env, ...ISOLATED_ENV },
      timeout: 30_000,
      shell: true,
    });
    const output = r.stdout?.toString() ?? "";
    expect(output).toContain("Database:");
    expect(output).toContain("Exists:");
  });
});
