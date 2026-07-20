import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BACKEND_ROOT = resolve(import.meta.dirname, "../..");

function readBackendFile(relativePath: string): string {
  return readFileSync(resolve(BACKEND_ROOT, relativePath), "utf8");
}

describe("backend test runner filesystem safety", () => {
  it("checks the test database before prisma db push", () => {
    const source = readBackendFile("scripts/run-tests.mjs");
    const assertIndex = source.indexOf('args: ["scripts/assert-test-db.mjs"]');
    const pushIndex = source.indexOf('args: [PRISMA_CLI, "db", "push"');

    expect(assertIndex).toBeGreaterThanOrEqual(0);
    expect(pushIndex).toBeGreaterThanOrEqual(0);
    expect(assertIndex).toBeLessThan(pushIndex);
  });

  it("injects isolated backup and session roots", () => {
    const source = readBackendFile("scripts/run-tests.mjs");

    expect(source).toContain("mkdtempSync");
    expect(source).toContain("SYSTEM_BACKUP_ROOT");
    expect(source).toContain("DB_BACKUP_DIR");
    expect(source).toContain("ZALO_SESSION_DIR");
  });

  it("spawns local Prisma and Vitest CLIs without a command shell", () => {
    const source = readBackendFile("scripts/run-tests.mjs");

    expect(source).toContain('require.resolve("prisma/build/index.js")');
    expect(source).toContain('require.resolve("vitest/vitest.mjs")');
    expect(source).toContain("shell: false");
    expect(source).not.toContain("shell: true");
  });

  it("runs all root test groups without npm shell commands", () => {
    const source = readBackendFile("../../scripts/run-tests.mjs");

    expect(source).toContain('require.resolve("vitest/vitest.mjs")');
    expect(source).toContain('"packages/backend/scripts/run-tests.mjs"');
    expect(source).toContain("shell: false");
    expect(source).not.toContain("npmCommand");
    expect(source).not.toContain('shell: process.platform === "win32"');
  });

  it("places the Prisma test database under an owned unique run directory", () => {
    const source = readBackendFile("scripts/run-tests.mjs");

    expect(source).toContain('const TEST_DATABASE_NAME = `test-${process.pid}-${Date.now()}.db`');
    expect(source).toContain('DATABASE_URL: `file:./${TEST_DATABASE_NAME}`');
    expect(source).toContain('writeFileSync(TEST_DATABASE_PATH, "")');
    expect(source).toContain("rmSync(TEST_DATABASE_PATH");
  });

  it("accepts an owned unique test database name in the pre-mutation guard", () => {
    const result = spawnSync(process.execPath, ["scripts/assert-test-db.mjs"], {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: "file:./test-runner-123.db",
      },
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
  });

  it("backup scripts honor explicit filesystem overrides", () => {
    const backupSource = readBackendFile("scripts/backup-restore.mjs");
    const guardSource = readBackendFile("scripts/db-guard.mjs");

    expect(backupSource).toContain("process.env.SYSTEM_BACKUP_ROOT");
    expect(backupSource).toContain("process.env.ZALO_SESSION_DIR");
    expect(guardSource).toContain("process.env.DB_BACKUP_DIR");
    expect(guardSource).toContain("process.env.ZALO_SESSION_DIR");
  });

  it("loads .env before resolving configured backup and session paths", () => {
    const backupSource = readBackendFile("scripts/backup-restore.mjs");
    const guardSource = readBackendFile("scripts/db-guard.mjs");

    expect(backupSource.indexOf("loadEnv();")).toBeLessThan(backupSource.indexOf("const BACKUP_ROOT"));
    expect(guardSource.indexOf("loadEnv();")).toBeLessThan(guardSource.indexOf("const BACKUP_DIR"));
  });
});
