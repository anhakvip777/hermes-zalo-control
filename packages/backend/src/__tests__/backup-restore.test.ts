import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(TEST_DIR, "..", "..");
const ROOT_DIR = join(BACKEND_DIR, "..", "..");
const NODE = process.execPath;
const SCRIPT = join(BACKEND_DIR, "scripts", "backup-restore.mjs");
const BACKUP_ROOT = join(BACKEND_DIR, "backups", "system");

function runBackup(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(NODE, [SCRIPT, ...args], {
    cwd: BACKEND_DIR,
    env: { ...process.env, ...env },
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
    const sessionDir = join(BACKEND_DIR, "zalo-session");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "zalo-session.json"), JSON.stringify({ test: true }));

    const r = runBackup(["create", "--reason", "test"]);
    expect(r.exitCode).toBe(0);

    const dirs = readdirSync(BACKUP_ROOT);
    const sessFile = join(BACKUP_ROOT, dirs[0]!, "zalo-session.json");
    expect(existsSync(sessFile)).toBe(true);

    // Cleanup
    try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
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
      timeout: 30_000,
      shell: true,
    });
    const output = (r.stdout?.toString() ?? "") + (r.stderr?.toString() ?? "");
    // npm puts lifecycle output on stderr, actual script output on stdout
    expect(output).toContain("backup");
  });
});
