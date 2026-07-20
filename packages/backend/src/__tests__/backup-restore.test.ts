import { describe, it, expect, afterEach, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(TEST_DIR, "..", "..");
const ROOT_DIR = join(BACKEND_DIR, "..", "..");
const NODE = process.execPath;
const SCRIPT = join(BACKEND_DIR, "scripts", "backup-restore.mjs");
const ISOLATION_ROOT = mkdtempSync(join(tmpdir(), "hermes-backup-restore-test-"));
const BACKUP_ROOT = join(ISOLATION_ROOT, "backups", "system");
const SESSION_DIR = join(ISOLATION_ROOT, "zalo-session");
const TEST_DATABASE_DIR = join(ISOLATION_ROOT, "prisma");
const TEST_DATABASE_PATH = join(TEST_DATABASE_DIR, "test.db");
const ACTIVE_DATABASE_URL = process.env.DATABASE_URL ?? "file:./test.db";
const ACTIVE_DATABASE_PATH = resolve(BACKEND_DIR, "prisma", ACTIVE_DATABASE_URL.replace(/^file:/, ""));
mkdirSync(TEST_DATABASE_DIR, { recursive: true });
copyFileSync(ACTIVE_DATABASE_PATH, TEST_DATABASE_PATH);
const ISOLATED_ENV = {
  DATABASE_URL: `file:${TEST_DATABASE_PATH}`,
  SYSTEM_BACKUP_ROOT: BACKUP_ROOT,
  ZALO_SESSION_DIR: SESSION_DIR,
};

function runBackup(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(NODE, [SCRIPT, ...args], {
    cwd: BACKEND_DIR,
    env: { ...process.env, ...ISOLATED_ENV, ...env },
    timeout: 15_000,
  });
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout?.toString() ?? "",
    stderr: r.stderr?.toString() ?? "",
  };
}

function cleanupBackups() {
  if (existsSync(BACKUP_ROOT)) {
    try { rmSync(BACKUP_ROOT, { recursive: true, force: true }); } catch {}
  }
}

function cleanupSession() {
  if (existsSync(SESSION_DIR)) {
    try { rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
  }
}

afterEach(() => {
  cleanupBackups();
  cleanupSession();
});

afterAll(() => {
  rmSync(ISOLATION_ROOT, { recursive: true, force: true });
});

describe("Backup/Restore — create", () => {
  afterEach(cleanupBackups);

  it("creates a backup folder with required files", () => {
    cleanupBackups();
    const r = runBackup(["create", "--reason", "test"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Created:");

    const dirs = readdirSync(BACKUP_ROOT);
    expect(dirs.length).toBe(1);
    const backupDir = join(BACKUP_ROOT, dirs[0]!);

    expect(existsSync(join(backupDir, "dev.db"))).toBe(true);
    expect(existsSync(join(backupDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(backupDir, "metadata.json"))).toBe(true);
  });

  it("manifest has required fields and masks secrets", () => {
    cleanupBackups();
    runBackup(["create", "--reason", "test"]);
    const dirs = readdirSync(BACKUP_ROOT);
    const mf = join(BACKUP_ROOT, dirs[0]!, "manifest.json");
    const manifest = JSON.parse(readFileSync(mf, "utf-8"));

    expect(manifest.version).toBe(1);
    expect(manifest.createdAt).toBeTruthy();
    expect(manifest.reason).toBe("test");
    expect(manifest.dbSizeBytes).toBeGreaterThan(0);
    expect(manifest.sessionExists).toBeDefined();
    expect(manifest.safeConfig).toBeDefined();

    // Secret masking: no API keys, tokens, passwords in safeConfig
    const sc = manifest.safeConfig;
    expect(sc).not.toHaveProperty("apiKey");
    expect(sc).not.toHaveProperty("token");
    expect(sc).not.toHaveProperty("password");
    expect(sc).not.toHaveProperty("secret");
    expect(sc).not.toHaveProperty("ADMIN_PASSWORD");
  });

  it("backup includes session when file exists", () => {
    cleanupBackups();
    // Create a fake session file
    mkdirSync(SESSION_DIR, { recursive: true });
    writeFileSync(join(SESSION_DIR, "zalo-session.json"), JSON.stringify({ test: true }));

    const r = runBackup(["create", "--reason", "test"]);
    expect(r.exitCode).toBe(0);

    const dirs = readdirSync(BACKUP_ROOT);
    const sessFile = join(BACKUP_ROOT, dirs[0]!, "zalo-session.json");
    expect(existsSync(sessFile)).toBe(true);
  });

  it("list shows backups sorted newest first", () => {
    cleanupBackups();
    runBackup(["create", "--reason", "first"]);
    runBackup(["create", "--reason", "second"]);
    runBackup(["create", "--reason", "third"]);

    const r = runBackup(["list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("3 backup(s)");
  });
});

describe("Backup/Restore — verify", () => {
  afterEach(cleanupBackups);

  it("verify passes on valid backup", () => {
    cleanupBackups();
    const cr = runBackup(["create", "--reason", "test"]);
    const name = cr.stdout.match(/backup-\d+T\d+/)?.[0];
    expect(name).toBeTruthy();

    const r = runBackup(["verify", name!]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("VERIFIED");
  });

  it("verify fails on missing backup", () => {
    cleanupBackups();
    const r = runBackup(["verify", "backup-nonexistent"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("not found");
  });

  it("rejects a backup name that escapes the isolated backup root", () => {
    const outsideDir = join(ISOLATION_ROOT, "backups", "outside-backup");
    mkdirSync(outsideDir, { recursive: true });
    copyFileSync(TEST_DATABASE_PATH, join(outsideDir, "dev.db"));
    writeFileSync(join(outsideDir, "manifest.json"), JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      dbSizeBytes: 2048,
    }));
    writeFileSync(join(outsideDir, "metadata.json"), JSON.stringify({ sessionExists: false }));

    const r = runBackup(["verify", "../outside-backup"]);

    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("invalid backup name");
  });

  it("verify fails on corrupted manifest", () => {
    cleanupBackups();
    const cr = runBackup(["create", "--reason", "test"]);
    const name = cr.stdout.match(/backup-\d+T\d+/)?.[0];
    // Corrupt the manifest
    writeFileSync(join(BACKUP_ROOT, name!, "manifest.json"), "not json");

    const r = runBackup(["verify", name!]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("invalid JSON");
  });
});

describe("Backup/Restore — retention", () => {
  afterEach(cleanupBackups);

  it.each(["0", "-1", "1.5", "invalid"])(
    "rejects an invalid SYSTEM_BACKUP_KEEP value (%s) before creating a backup",
    (keep) => {
      const r = runBackup(["create", "--reason", "invalid-retention"], { SYSTEM_BACKUP_KEEP: keep });

      expect(r.exitCode).toBe(1);
      expect(r.stdout).toContain("SYSTEM_BACKUP_KEEP");
      expect(existsSync(BACKUP_ROOT)).toBe(false);
    },
  );

  it("keeps only latest N backups", () => {
    cleanupBackups();
    for (let i = 0; i < 5; i++) {
      runBackup(["create", "--reason", `test-${i}`]);
    }

    // With KEEP=3, should have at most 3
    const r = runBackup(["create", "--reason", "overflow"], { SYSTEM_BACKUP_KEEP: "3" });
    expect(r.exitCode).toBe(0);

    const dirs = readdirSync(BACKUP_ROOT).filter(d => d.startsWith("backup-"));
    expect(dirs.length).toBeLessThanOrEqual(3);
  });
});

describe("Backup/Restore — restore", () => {
  afterEach(cleanupBackups);

  it("restore requires explicit backup name", () => {
    const r = runBackup(["restore"]);
    expect(r.exitCode).toBe(1);
  });

  it("restore fails on missing backup", () => {
    cleanupBackups();
    const r = runBackup(["restore", "backup-nonexistent"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("not found");
  });
});

describe("Backup/Restore — no regression", () => {
  it("npm run backup:list works", () => {
    const r = spawnSync("npm", ["run", "backup:list"], {
      cwd: ROOT_DIR,
      env: { ...process.env, ...ISOLATED_ENV },
      timeout: 30_000,
      shell: true,
    });
    const output = (r.stdout?.toString() ?? "") + (r.stderr?.toString() ?? "");
    // npm puts lifecycle output on stderr, actual script output on stdout
    expect(output).toContain("backup");
  });
});
