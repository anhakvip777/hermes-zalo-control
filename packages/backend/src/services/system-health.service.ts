/**
 * System Health Service — tổng hợp snapshot trạng thái toàn hệ thống.
 *
 * Gồm các thành phần: backend, DB, Zalo, auto-reply, worker, backup,
 * process lock, config consistency, message flow, errors.
 *
 * Không leak secret, không gọi API provider, không đụng Zalo session.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../db.js";
import { runConfigChecks } from "../config-consistency.js";
import { readLockFile, checkProcessLock } from "../process-lock.js";
import { config } from "../config.js";
import { getCurrentEffectiveDryRun } from "./runtime-config.service.js";
import { getHeartbeatSummary, type HeartbeatEntry } from "./heartbeat.service.js";
import { BACKUPS_DIR, resolveSqliteDatabasePath } from "../backend-paths.js";

// ── Types ────────────────────────────────────────────────────────────

export interface HealthSnapshot {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptimeSeconds: number;
  version: string;
  backend: {
    pid: number;
    nodeEnv: string;
    port: number;
  };
  db: {
    ok: boolean;
    path: string | null;
    sizeBytes: number;
    criticalTables: Record<string, number | null>;
  };
  zalo: {
    connected: boolean;
    listenerStarted: boolean;
    uid: string | null;
    lastConnectedAt: string | null;
    lastError: string | null;
  };
  autoReply: {
    enabled: boolean;
    dryRun: boolean;
    allowedThreadsCount: number;
    cooldownSeconds: number;
    activeCooldowns: number;
  };
  worker: {
    active: boolean;
    queuedJobs: number;
    failedJobs24h: number;
  };
  backup: {
    latestBackupAt: string | null;
    latestBackupName: string | null;
    backupCount: number;
    latestBackupAgeHours: number | null;
  };
  processLock: {
    locked: boolean;
    ownerPid: number | null;
    isOwner: boolean;
    startedAt: string | null;
  };
  config: {
    status: "CONFIG_OK" | "CONFIG_WARN" | "CONFIG_ERROR";
    pass: number;
    warn: number;
    error: number;
  };
  messages: {
    inbound24h: number;
    outbound24h: number;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
  };
  errors: {
    failedAgentTasks24h: number;
    failedExecutions24h: number;
  };
  heartbeats: Record<string, HeartbeatEntry>;
  allowedThreadsReview: {
    count: number;
    highRiskCount: number;
    groupCount: number;
    unknownCount: number;
  };
  errorsSummary: {
    status: "ok" | "warn" | "error";
    errors24h: number;
    warnings24h: number;
    topErrorCode: string | null;
    lastErrorAt: string | null;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function getDbPath(): string | null {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  return resolveSqliteDatabasePath(url);
}

function hoursAgo(isoString: string | null): number | null {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  const now = Date.now();
  return Math.round((now - then) / (3600 * 1000) * 10) / 10;
}

// ── Sub-collectors ───────────────────────────────────────────────────

async function collectDb(): Promise<HealthSnapshot["db"]> {
  const dbPath = getDbPath();
  if (dbPath === null) {
    return { ok: false, path: null, sizeBytes: 0, criticalTables: {} };
  }

  const exists = existsSync(dbPath);
  const sizeBytes = exists ? statSync(dbPath).size : 0;

  const criticalTables: Record<string, number | null> = {};
  let ok = exists && sizeBytes > 0;

  if (exists) {
    try {
      const tableRows = (await prisma.$queryRawUnsafe(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
      )) as { name: string }[];

      const existingNames = tableRows.map((r) => r.name);
      const required = ["Message", "AgentTask", "Schedule", "ScheduleJob", "ThreadSetting", "OutboundRecord"];

      for (const table of required) {
        if (existingNames.includes(table)) {
          const result = (await prisma.$queryRawUnsafe(
            `SELECT COUNT(*) as cnt FROM "${table}"`
          )) as { cnt: number | bigint }[];
          const cnt = result[0]?.cnt;
          criticalTables[table] = cnt != null ? Number(cnt) : null;
        } else {
          criticalTables[table] = null;
          ok = false;
        }
      }
    } catch {
      ok = false;
    }
  }

  return { ok, path: dbPath, sizeBytes, criticalTables };
}

function collectZalo(): HealthSnapshot["zalo"] {
  try {
    // Dynamic import to avoid circular deps in worker context
    // We use require-style dynamic import to get the singleton
    return {
      connected: false,
      listenerStarted: false,
      uid: null,
      lastConnectedAt: null,
      lastError: "Gateway not loaded (worker mode or not yet initialized)",
    };
  } catch {
    return {
      connected: false,
      listenerStarted: false,
      uid: null,
      lastConnectedAt: null,
      lastError: "ERROR",
    };
  }
}

async function collectZaloFromGateway(): Promise<HealthSnapshot["zalo"]> {
  try {
    const { getZaloGateway } = await import("./zalo-gateway.service.js");
    const gw = getZaloGateway();
    const status = gw.getStatus();
    return {
      connected: status.connected,
      listenerStarted: status.connected, // listener starts automatically on connect
      uid: status.selfUserId,
      lastConnectedAt: status.lastConnectedAt,
      lastError: status.lastError,
    };
  } catch {
    return collectZalo();
  }
}

function collectAutoReply(): HealthSnapshot["autoReply"] {
  const ar = config.autoReply;
  return {
    enabled: ar.enabled,
    dryRun: getCurrentEffectiveDryRun(),
    allowedThreadsCount: ar.allowedThreads.length,
    cooldownSeconds: ar.cooldownSeconds,
    activeCooldowns: 0, // requires in-memory cooldown map — not accessible from health
  };
}

async function collectWorker(): Promise<HealthSnapshot["worker"]> {
  try {
    const [queuedJobs, failedJobs24h, heartbeats] = await Promise.all([
      prisma.scheduleJob.count({ where: { status: { in: ["queued", "active"] } } }),
      prisma.scheduleJob.count({
        where: {
          status: "failed",
          createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
        },
      }),
      getHeartbeatSummary(),
    ]);
    const workerHeartbeat = heartbeats["schedulerWorker"];
    const active = workerHeartbeat?.status === "ok";
    return { active, queuedJobs, failedJobs24h };
  } catch {
    return { active: false, queuedJobs: 0, failedJobs24h: 0 };
  }
}

function collectBackup(): HealthSnapshot["backup"] {
  const backupsDir = resolve(BACKUPS_DIR, "system");

  try {
    if (!existsSync(backupsDir)) {
      // also check old path
      const dbBackupsDir = resolve(BACKUPS_DIR, "db");
      if (existsSync(dbBackupsDir)) {
        const files = readdirSync(dbBackupsDir).filter(f => f.endsWith(".sqlite") || f.endsWith(".db"));
        files.sort().reverse(); // newest first by name convention
        const latestName = files[0] ?? null;
        const latestPath = latestName ? resolve(dbBackupsDir, latestName) : null;
        const latestAt = latestPath ? statSync(latestPath).mtime.toISOString() : null;
        return {
          latestBackupAt: latestAt,
          latestBackupName: latestName,
          backupCount: files.length,
          latestBackupAgeHours: hoursAgo(latestAt),
        };
      }
      return { latestBackupAt: null, latestBackupName: null, backupCount: 0, latestBackupAgeHours: null };
    }

    const dirs = readdirSync(backupsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const fullPath = resolve(backupsDir, d.name, "manifest.json");
        let createdAt: number | null = null;
        if (existsSync(fullPath)) {
          try {
            const m = JSON.parse(readFileSync(fullPath, "utf-8"));
            createdAt = new Date(m.createdAt).getTime();
          } catch { /* skip */ }
        }
        return { name: d.name, createdAt: createdAt ?? statSync(resolve(backupsDir, d.name)).mtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    const latest = dirs[0] ?? null;
    const latestAt = latest ? new Date(latest.createdAt).toISOString() : null;

    return {
      latestBackupAt: latestAt,
      latestBackupName: latest?.name ?? null,
      backupCount: dirs.length,
      latestBackupAgeHours: hoursAgo(latestAt),
    };
  } catch {
    return { latestBackupAt: null, latestBackupName: null, backupCount: -1, latestBackupAgeHours: null };
  }
}

function collectProcessLock(): HealthSnapshot["processLock"] {
  const lockCheck = checkProcessLock();
  const lockInfo = readLockFile();
  let isOwner = false;
  try {
    isOwner = lockInfo !== null && lockInfo.pid === process.pid;
  } catch {
    // ignore
  }
  return {
    locked: lockCheck.locked && !lockCheck.stale,
    ownerPid: lockCheck.info?.pid ?? null,
    isOwner,
    startedAt: lockCheck.info?.startedAt ?? null,
  };
}

async function collectMessages(): Promise<HealthSnapshot["messages"]> {
  const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  try {
    const [inbound24h, outbound24h, lastInboundArr, lastOutboundArr] = await Promise.all([
      prisma.message.count({
        where: { isFromBot: false, receivedAt: { gte: oneDayAgo } },
      }),
      prisma.message.count({
        where: { isFromBot: true, receivedAt: { gte: oneDayAgo } },
      }),
      prisma.message.findFirst({
        where: { isFromBot: false },
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true },
      }),
      prisma.message.findFirst({
        where: { isFromBot: true },
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true },
      }),
    ]);

    return {
      inbound24h,
      outbound24h,
      lastInboundAt: lastInboundArr?.receivedAt?.toISOString?.() ?? null,
      lastOutboundAt: lastOutboundArr?.receivedAt?.toISOString?.() ?? null,
    };
  } catch {
    return { inbound24h: 0, outbound24h: 0, lastInboundAt: null, lastOutboundAt: null };
  }
}

async function collectErrors(): Promise<HealthSnapshot["errors"]> {
  const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  try {
    const [failedAgentTasks24h, failedExecutions24h] = await Promise.all([
      prisma.agentTask.count({
        where: { status: "failed", createdAt: { gte: oneDayAgo } },
      }),
      prisma.scheduleExecution.count({
        where: { status: "failed", createdAt: { gte: oneDayAgo } },
      }),
    ]);
    return { failedAgentTasks24h, failedExecutions24h };
  } catch {
    return { failedAgentTasks24h: 0, failedExecutions24h: 0 };
  }
}

async function collectAllowedThreadsReview(): Promise<HealthSnapshot["allowedThreadsReview"]> {
  try {
    const { getThreadReviewSummary } = await import("./allowed-thread-review.service.js");
    const summary = await getThreadReviewSummary();
    return {
      count: summary.totalThreads,
      highRiskCount: summary.highRiskCount,
      groupCount: summary.groupCount,
      unknownCount: summary.unknownCount,
    };
  } catch {
    return { count: 0, highRiskCount: 0, groupCount: 0, unknownCount: 0 };
  }
}

async function collectErrorsSummary(): Promise<HealthSnapshot["errorsSummary"]> {
  try {
    const { getErrorSummary } = await import("./error-summary.service.js");
    const summary = await getErrorSummary(24);
    const topGroup = summary.groups[0];
    return {
      status: summary.status,
      errors24h: summary.totals.errors,
      warnings24h: summary.totals.warnings,
      topErrorCode: topGroup ? `${topGroup.source}:${topGroup.errorCode}` : null,
      lastErrorAt: summary.recent[0]?.seenAt ?? null,
    };
  } catch {
    return { status: "ok", errors24h: 0, warnings24h: 0, topErrorCode: null, lastErrorAt: null };
  }
}

// ── Compute overall status ───────────────────────────────────────────

function computeOverallStatus(snapshot: Omit<HealthSnapshot, "status">): HealthSnapshot["status"] {
  const { db, processLock: pl, config: cfg, allowedThreadsReview: atr } = snapshot;

  // unhealthy triggers
  if (!db.ok) return "unhealthy";
  if (Object.values(db.criticalTables).some((v) => v === null)) return "unhealthy";
  if (!pl.isOwner && pl.locked) return "unhealthy";

  // degraded triggers
  if (!snapshot.zalo.connected) return "degraded";
  if (snapshot.backup.latestBackupAgeHours !== null && snapshot.backup.latestBackupAgeHours > 24)
    return "degraded";
  if (cfg.status === "CONFIG_WARN") return "degraded";
  if (!snapshot.worker.active) return "degraded";
  if (snapshot.errors.failedAgentTasks24h > 10 || snapshot.errors.failedExecutions24h > 5)
    return "degraded";
  // High-risk allowed threads: degrade if live mode + high risk
  if (atr.highRiskCount > 0 && !snapshot.autoReply.dryRun) return "degraded";
  // Error summary indicates critical errors
  if (snapshot.errorsSummary.status === "error") return "degraded";

  // healthy
  if (cfg.status === "CONFIG_ERROR") return "degraded"; // config error but STRICT_CHECK might not be enabled

  return "healthy";
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Lấy health snapshot đầy đủ (dành cho admin).
 * Gọi từ /api/system/health/detail.
 */
export async function getHealthSnapshot(): Promise<HealthSnapshot> {
  const [db, zalo, worker, messages, errors, heartbeats, allowedThreadsReview, errorsSummary] = await Promise.all([
    collectDb(),
    collectZaloFromGateway(),
    collectWorker(),
    collectMessages(),
    collectErrors(),
    getHeartbeatSummary(),
    collectAllowedThreadsReview(),
    collectErrorsSummary(),
  ]);

  const configResult = runConfigChecks();
  const snapshot = {
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    version: "0.1.0",
    backend: {
      pid: process.pid,
      nodeEnv: config.nodeEnv,
      port: config.port,
    },
    db,
    zalo,
    autoReply: collectAutoReply(),
    worker,
    backup: collectBackup(),
    processLock: collectProcessLock(),
    config: {
      status: configResult.status,
      pass: configResult.summary.pass,
      warn: configResult.summary.warn,
      error: configResult.summary.error,
    },
    messages,
    errors,
    heartbeats,
    allowedThreadsReview,
    errorsSummary,
  };

  return {
    ...snapshot,
    status: computeOverallStatus(snapshot),
  };
}

/**
 * Lấy health cơ bản (public endpoint).
 * Không leak config detail, backup path, DB schema, message counts.
 */
export function getPublicHealth() {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
    nodeVersion: process.version,
    nodeEnv: config.nodeEnv,
  };
}
