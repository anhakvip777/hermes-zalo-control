#!/usr/bin/env node
/**
 * DB Guard — prevents accidental database reset/loss.
 *
 * Modes:
 *   --status           Check DB health and report
 *   --backup           Create timestamped backup
 *   --before-db-push   Guard: require backup before prisma db push
 *   --before-reset     Guard: require ALLOW_DB_RESET=true + backup
 *
 * Env vars:
 *   ALLOW_DB_RESET=true       Required for --before-reset
 *   DB_BACKUP_KEEP=10         Number of backups to retain (default: 10)
 *   DATABASE_URL=file:./dev.db  DB path (read from .env or explicit)
 */

import { readFileSync, existsSync, statSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const BACKUP_DIR = resolve(PROJECT_ROOT, "backups", "db");

// Critical tables that MUST have data in a healthy DB
const CRITICAL_TABLES = [
  "Message",
  "ZaloThread",
  "AgentTask",
  "Schedule",
  "ScheduleJob",
  "ScheduleExecution",
  "ScheduleRevision",
  "ThreadSetting",
  "OutboundRecord",
  "ThreadConversationState",
  "RuntimeSetting",
  "RuntimeConfigAudit",
  "SystemHeartbeat",
  "SystemAlert",
  "AuditLog",
  "AttendanceSession",
  "AttendanceRecord",
  "AppSetting",
];

// Tables that could legitimately be empty (new install)
const WARN_IF_EMPTY = [
  "Message",
  "ZaloThread",
  "AgentTask",
  "AppSetting",
  "RuntimeSetting",
];

// --- Helpers ---

function loadEnv() {
  const envPath = resolve(PROJECT_ROOT, ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // strip quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

function getDbPath() {
  const url = process.env.DATABASE_URL || "file:./dev.db";
  const match = url.match(/^file:(.+)$/);
  if (!match) throw new Error(`Cannot parse DATABASE_URL: ${url}`);
  const relative = match[1];
  // Prisma resolves relative paths from the prisma/ directory
  return resolve(PROJECT_ROOT, "prisma", relative);
}

function getDbSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function red(s) { return `\x1b[31m${s}\x1b[0m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }

// --- Core functions ---

function status(dbPath) {
  console.log(`[db-guard] Database: ${dbPath}`);
  const exists = existsSync(dbPath);
  const size = getDbSize(dbPath);
  console.log(`[db-guard] Exists: ${exists ? green("YES") : red("NO")}`);
  console.log(`[db-guard] Size: ${formatBytes(size)}`);

  if (!exists) {
    console.log(red("[db-guard] CRITICAL: Database file not found!"));
    return { ok: false, warnings: ["DB file missing"] };
  }

  if (size < 1024) {
    console.log(red(`[db-guard] WARNING: DB size suspiciously small (${formatBytes(size)})`));
  }

  const warnings = [];
  let db;
  let existingTables = [];
  try {
    db = new Database(dbPath, { readonly: true });

    // Check critical tables
    existingTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);

    const missingTables = CRITICAL_TABLES.filter((t) => !existingTables.includes(t));
    if (missingTables.length > 0) {
      const msg = `Missing critical tables: ${missingTables.join(", ")}`;
      console.log(red(`[db-guard] ${msg}`));
      warnings.push(msg);
    }

    // Check table row counts
    for (const table of existingTables) {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM "${table}"`).get();
      const count = row.cnt;
      if (WARN_IF_EMPTY.includes(table) && count === 0) {
        const msg = `${table} table empty`;
        console.log(yellow(`[db-guard] WARNING: ${msg}`));
        warnings.push(msg);
      }
    }

    console.log(green("[db-guard] Status check complete."));
  } catch (err) {
    const msg = `Cannot open database: ${err.message}`;
    console.log(red(`[db-guard] ${msg}`));
    return { ok: false, warnings: [msg] };
  } finally {
    if (db) db.close();
  }

  return {
    ok: warnings.length === 0 || warnings.every((w) => w.includes("empty")),
    warnings,
    tables: existingTables,
  };
}

function backup(dbPath) {
  if (!existsSync(dbPath)) {
    console.log(red("[db-guard] Cannot backup: database file not found"));
    return { ok: false };
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "");
  const backupName = `dev.db.backup-${timestamp}.sqlite`;
  const backupPath = join(BACKUP_DIR, backupName);

  copyFileSync(dbPath, backupPath);
  console.log(green(`[db-guard] Backup created: ${backupPath}`));
  console.log(`[db-guard] Size: ${formatBytes(statSync(backupPath).size)}`);

  // Retention
  const keep = parseInt(process.env.DB_BACKUP_KEEP || "10", 10);
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("dev.db.backup-") && f.endsWith(".sqlite"))
    .sort()
    .reverse(); // newest first

  let deleted = 0;
  for (let i = keep; i < files.length; i++) {
    unlinkSync(join(BACKUP_DIR, files[i]));
    deleted++;
  }
  if (deleted > 0) {
    console.log(`[db-guard] Retention: removed ${deleted} old backup(s), keeping ${keep}`);
  }

  // Also backup zalo-session if exists
  const sessionDir = resolve(PROJECT_ROOT, "..", "zalo-session");
  if (existsSync(sessionDir)) {
    const sessionBackup = resolve(BACKUP_DIR, `zalo-session-${timestamp}`);
    // Simple copy of the session directory (just the JSON file)
    const sessionJson = resolve(sessionDir, "zalo-session.json");
    if (existsSync(sessionJson)) {
      mkdirSync(sessionBackup, { recursive: true });
      copyFileSync(sessionJson, resolve(sessionBackup, "zalo-session.json"));
      console.log(green(`[db-guard] Session backup: ${sessionBackup}/zalo-session.json`));
    }
  }

  return { ok: true, path: backupPath };
}

// --- Main ---

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const mode = args.find((a) => a.startsWith("--")) || "--status";

  let dbPath;
  try {
    dbPath = getDbPath();
  } catch (err) {
    console.error(red(`[db-guard] ${err.message}`));
    process.exit(1);
  }

  switch (mode) {
    case "--status": {
      const result = status(dbPath);
      console.log(`\n[db-guard] HEALTH: ${result.ok ? green("PASS") : red("FAIL")}`);
      if (result.warnings?.length) {
        console.log(`[db-guard] Warnings: ${result.warnings.length}`);
        result.warnings.forEach((w) => console.log(`  - ${w}`));
      }
      process.exit(result.ok ? 0 : 1);
    }

    case "--backup": {
      const result = backup(dbPath);
      process.exit(result.ok ? 0 : 1);
    }

    case "--before-db-push": {
      // Always require a backup before db push
      console.log("[db-guard] Pre-push guard: creating backup...");
      const result = backup(dbPath);
      if (!result.ok) {
        console.log(red("[db-guard] Backup failed — aborting db push"));
        process.exit(1);
      }
      console.log(green("[db-guard] Safe to proceed with db push"));
      process.exit(0);
    }

    case "--before-reset": {
      // Require ALLOW_DB_RESET=true AND a backup
      if (process.env.ALLOW_DB_RESET !== "true") {
        console.log(red("[db-guard] BLOCKED: ALLOW_DB_RESET is not 'true'"));
        console.log("[db-guard] Set ALLOW_DB_RESET=true to allow database reset");
        process.exit(1);
      }

      console.log("[db-guard] Pre-reset guard: creating backup...");
      const result = backup(dbPath);
      if (!result.ok) {
        console.log(red("[db-guard] Backup failed — aborting reset"));
        process.exit(1);
      }

      console.log(green("[db-guard] ALLOW_DB_RESET=true + backup exists — safe to proceed"));
      process.exit(0);
    }

    default: {
      console.log("Usage: db-guard.mjs [--status|--backup|--before-db-push|--before-reset]");
      console.log(`  --status          Check DB health`);
      console.log(`  --backup          Create backup`);
      console.log(`  --before-db-push  Backup, then allow db push`);
      console.log(`  --before-reset    Require ALLOW_DB_RESET=true + backup`);
      process.exit(0);
    }
  }
}

main().catch((err) => {
  console.error(red(`[db-guard] Fatal: ${err.message}`));
  process.exit(1);
});
