#!/usr/bin/env node
/**
 * Backup/Restore Automation — safe backup + restore for DB, Zalo session, and config metadata.
 *
 * Commands:
 *   create [--reason <reason>]   Create a timestamped backup
 *   list                         List all backups (newest first)
 *   verify <name>                Verify a backup's integrity
 *   restore <name>               Restore from a backup (auto-backs-up current state first)
 *
 * Env vars:
 *   SYSTEM_BACKUP_KEEP=10        Number of backups to retain
 *   DATABASE_URL=file:./dev.db    DB path
 */

import {
  existsSync, statSync, mkdirSync, copyFileSync, readdirSync,
  unlinkSync, rmdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const PRISMA_DIR = resolve(PROJECT_ROOT, "prisma");
const SESSION_DIR = resolve(PROJECT_ROOT, "zalo-session");
const BACKUP_ROOT = resolve(PROJECT_ROOT, "backups", "system");

const DB_PATH = (() => {
  const url = process.env.DATABASE_URL || "file:./dev.db";
  const m = url.match(/^file:(.+)$/);
  return m ? resolve(PRISMA_DIR, m[1]) : resolve(PRISMA_DIR, "dev.db");
})();

const SESSION_FILE = resolve(SESSION_DIR, "zalo-session.json");

// --- Helpers ---

function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function red(s) { return `\x1b[31m${s}\x1b[0m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }
function fmtBytes(b) { return b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(1)}MB`; }

function loadEnv() {
  const p = resolve(PROJECT_ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

function safeConfig() {
  return {
    enabled: process.env.ZALO_AUTO_REPLY_ENABLED,
    dryRun: process.env.ZALO_AUTO_REPLY_DRY_RUN,
    allowedThreadsCount: (process.env.ZALO_AUTO_REPLY_ALLOWED_THREADS || "").split(",").filter(Boolean).length,
    visionEnabled: process.env.ZALO_VISION_ENABLED,
    voiceEnabled: process.env.ZALO_VOICE_ENABLED,
    cooldownSeconds: process.env.ZALO_AUTO_REPLY_COOLDOWN_SECONDS,
    nodeEnv: process.env.NODE_ENV,
  };
}

function buildManifest(reason, dbSize, sessionExists, gitCommit) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    reason,
    dbSizeBytes: dbSize,
    dbPath: DB_PATH,
    sessionExists,
    gitCommit,
    cwd: process.cwd(),
    hostname: (() => { try { return execSync("hostname", { encoding: "utf-8" }).trim(); } catch { return "unknown"; } })(),
    safeConfig: safeConfig(),
  };
}

function getGitCommit() {
  try { return execSync("git rev-parse --short HEAD", { encoding: "utf-8", cwd: PROJECT_ROOT }).trim(); }
  catch { return "unknown"; }
}

// --- Create backup ---
function createBackup(reason = "manual") {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\./g, "").slice(0, 17);
  const name = `backup-${ts}`;
  const dir = join(BACKUP_ROOT, name);

  mkdirSync(dir, { recursive: true });

  if (!existsSync(DB_PATH)) {
    console.log(red("[backup] ERROR: database file not found"));
    return { ok: false };
  }

  const dbSize = statSync(DB_PATH).size;
  copyFileSync(DB_PATH, join(dir, "dev.db"));
  console.log(`[backup] DB: ${fmtBytes(dbSize)} → ${name}/dev.db`);

  let sessionExists = false;
  if (existsSync(SESSION_FILE)) {
    copyFileSync(SESSION_FILE, join(dir, "zalo-session.json"));
    console.log(`[backup] Session: included`);
    sessionExists = true;
  } else {
    console.log(yellow("[backup] Session: not found, skipped"));
  }

  // Metadata
  const metadata = {
    dbSizeBytes: dbSize,
    sessionExists,
    dbPath: DB_PATH,
    sessionPath: sessionExists ? SESSION_FILE : null,
  };
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

  // Manifest
  const manifest = buildManifest(reason, dbSize, sessionExists, getGitCommit());
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  // Retention
  const keep = parseInt(process.env.SYSTEM_BACKUP_KEEP || "10", 10);
  const dirs = listBackups();
  for (let i = keep; i < dirs.length; i++) {
    const old = join(BACKUP_ROOT, dirs[i]);
    try {
      for (const f of readdirSync(old)) unlinkSync(join(old, f));
      rmdirSync(old);
      console.log(`[backup] Retention: removed ${dirs[i]}`);
    } catch { /* ignore */ }
  }

  console.log(green(`[backup] Created: ${name}`));
  console.log(`[backup] Manifest: ok`);
  return { ok: true, name, path: dir };
}

// --- List backups ---
function listBackups() {
  if (!existsSync(BACKUP_ROOT)) return [];
  return readdirSync(BACKUP_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("backup-"))
    .map((d) => d.name)
    .sort()
    .reverse();
}

function listBackupsDetailed() {
  const dirs = listBackups();
  if (dirs.length === 0) {
    console.log("[backup] No backups found");
    return;
  }
  console.log(`[backup] ${dirs.length} backup(s):`);
  for (const d of dirs) {
    const mf = join(BACKUP_ROOT, d, "manifest.json");
    if (existsSync(mf)) {
      try {
        const m = JSON.parse(readFileSync(mf, "utf-8"));
        console.log(`  ${d}  |  ${m.reason || "?"}  |  ${fmtBytes(m.dbSizeBytes || 0)}  |  session=${m.sessionExists ? "yes" : "no"}  |  ${m.createdAt || "?"}`);
      } catch {
        console.log(`  ${d}  |  (invalid manifest)`);
      }
    } else {
      console.log(`  ${d}  |  (no manifest)`);
    }
  }
}

// --- Verify ---
function verifyBackup(name) {
  const dir = join(BACKUP_ROOT, name);
  const errors = [];

  if (!existsSync(dir)) {
    console.log(red(`[backup] ${name} not found`));
    return { ok: false, errors: ["backup folder missing"] };
  }

  const mf = join(dir, "manifest.json");
  if (!existsSync(mf)) {
    errors.push("manifest.json missing");
  } else {
    try {
      const m = JSON.parse(readFileSync(mf, "utf-8"));
      if (!m.version || !m.createdAt || m.dbSizeBytes === undefined) {
        errors.push("manifest missing required fields");
      }
    } catch {
      errors.push("manifest.json is invalid JSON");
    }
  }

  const dbFile = join(dir, "dev.db");
  if (!existsSync(dbFile)) {
    errors.push("dev.db missing");
  } else if (statSync(dbFile).size < 1024) {
    errors.push("dev.db too small");
  }

  const metaFile = join(dir, "metadata.json");
  if (!existsSync(metaFile)) {
    errors.push("metadata.json missing");
  } else {
    try {
      const meta = JSON.parse(readFileSync(metaFile, "utf-8"));
      if (meta.sessionExists && !existsSync(join(dir, "zalo-session.json"))) {
        errors.push("session file expected but missing");
      }
    } catch {
      errors.push("metadata.json invalid JSON");
    }
  }

  if (errors.length === 0) {
    console.log(green(`[backup] ${name}: VERIFIED`));
    return { ok: true, errors: [] };
  }

  console.log(red(`[backup] ${name}: FAILED`));
  errors.forEach((e) => console.log(`  - ${e}`));
  return { ok: false, errors };
}

// --- Restore ---
function restoreBackup(name) {
  const dir = join(BACKUP_ROOT, name);

  const verify = verifyBackup(name);
  if (!verify.ok) {
    console.log(red("[backup] Restore aborted: backup verification failed"));
    return { ok: false };
  }

  console.log(yellow("[backup] Creating pre-restore safety backup..."));
  const safety = createBackup("pre-restore");
  if (!safety.ok) {
    console.log(red("[backup] Restore aborted: could not create safety backup"));
    return { ok: false };
  }

  console.log(yellow("[backup] WARNING: Ensure backend is STOPPED before restore!"));
  console.log("[backup] Continuing in 3 seconds... (Ctrl+C to abort)");

  const srcDb = join(dir, "dev.db");
  copyFileSync(srcDb, DB_PATH);
  console.log(green(`[backup] Restored: ${name}/dev.db → ${DB_PATH}`));

  const srcSession = join(dir, "zalo-session.json");
  if (existsSync(srcSession)) {
    mkdirSync(SESSION_DIR, { recursive: true });
    copyFileSync(srcSession, SESSION_FILE);
    console.log(green(`[backup] Restored: ${name}/zalo-session.json → ${SESSION_FILE}`));
  }

  console.log(green("[backup] Restore complete!"));
  console.log(`[backup] Run: cd ${PROJECT_ROOT} && npm run dev`);
  return { ok: true };
}

// --- Main ---

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case "create": {
      const reasonIdx = args.indexOf("--reason");
      const reason = reasonIdx >= 0 ? args[reasonIdx + 1] || "manual" : "manual";
      const r = createBackup(reason);
      process.exit(r.ok ? 0 : 1);
    }

    case "list": {
      listBackupsDetailed();
      process.exit(0);
    }

    case "verify": {
      const name = args[1];
      if (!name) {
        console.log("Usage: backup-restore.mjs verify <backup-name>");
        process.exit(1);
      }
      const r = verifyBackup(name);
      process.exit(r.ok ? 0 : 1);
    }

    case "restore": {
      const name = args[1];
      if (!name) {
        console.log("Usage: backup-restore.mjs restore <backup-name>");
        process.exit(1);
      }
      const r = restoreBackup(name);
      process.exit(r.ok ? 0 : 1);
    }

    default: {
      console.log("Usage: backup-restore.mjs <create|list|verify|restore> [name] [--reason <reason>]");
      console.log("  create [--reason <reason>]   Create backup");
      console.log("  list                         List backups");
      console.log("  verify <name>                Verify backup integrity");
      console.log("  restore <name>               Restore (with pre-restore safety backup)");
      process.exit(0);
    }
  }
}

main().catch((err) => {
  console.error(red(`[backup] Fatal: ${err.message}`));
  process.exit(1);
});
