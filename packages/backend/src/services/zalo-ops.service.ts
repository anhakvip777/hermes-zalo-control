// =============================================================================
// ZaloOpsService — Zalo Live-Safe Operations Dashboard backend
// =============================================================================

import { existsSync, statSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { getZaloGateway, findLatestSessionBackup, type ZaloGatewayStatus } from "./zalo-gateway.service.js";
import { getCurrentEffectiveDryRun, getEffectiveCooldownSeconds, getAllRuntimeSettings } from "./runtime-config.service.js";
import { getHeartbeatSummary } from "./heartbeat.service.js";
import { normalizeThreadId } from "./thread-id.js";
// Session safety: info extracted below in getSessionInfo() — no external dep

// ── Types ────────────────────────────────────────────────────────────

export interface ZaloOpsStatus {
  connected: boolean;
  connectionStatus: string;
  selfUserId: string | null;
  selfDisplayName: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  lastMessageAt: string | null;
  listenerActive: boolean;
  dryRun: boolean;
  dryRunSource: "env" | "runtime";
  allowedThreads: string[];
  cooldownSeconds: number;

  session: {
    exists: boolean;
    age: string | null;          // human-readable, e.g. "2 days ago"
    ageSeconds: number | null;
    path: string | null;         // masked: "…/zalo-session/zalo-session.json"
    qrAvailable: boolean;
    qrUpdatedAt: string | null;
    /** S3: file size in bytes (null if file doesn't exist) */
    fileSize: number | null;
    /** S3: ISO timestamp of last modification (null if file doesn't exist) */
    updatedAt: string | null;
    /** S3: list of quarantined session filenames (no content, just names) */
    quarantinedFiles: string[];
    /** S3: warning code if session integrity is at risk */
    warning: "NO_SESSION_FILE" | "SESSION_QUARANTINED" | "CONNECTED_BUT_SESSION_NOT_PERSISTED" | null;
    /** ZR2: true if primary session missing but a backup exists under backups/db/ */
    backupAvailable: boolean;
  };

  /** ZR2: single enum summarizing exactly what reconnect will do next.
   *  "connected" | "session_present" | "backup_available" | "restore_failed"
   *  | "qr_required" | "waiting_qr_scan" | "reconnect_in_progress" */
  connectionDetail: string;

  heartbeats: {
    zaloConnection: { status: string; lastBeatAt: string | null; ageSeconds: number | null };
    zaloListener: { status: string; lastBeatAt: string | null; ageSeconds: number | null };
    messagePipeline: { status: string; lastBeatAt: string | null; ageSeconds: number | null };
  };

  /** KI-H2: listener/session auto-recovery state. */
  recovery: {
    recoveryState: "idle" | "scheduled" | "reconnecting" | "error";
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    lastReconnectAt: string | null;
    lastReconnectError: string | null;
    listenerHeartbeatAgeSeconds: number | null;
  };

  inbound24h: number;
  outbound24h: number;
  failedTasks24h: number;
}

export interface ReconnectResult {
  success: boolean;
  /** ZR2: "already_connected" | "reconnect_in_progress" | "restored" | "restored_from_backup"
   *  | "qr_required" | "restore_failed" | "error" (legacy "needs_qr" kept as alias of qr_required) */
  status: string;
  message: string;
  auditId?: string;
}

export interface DisconnectResult {
  success: boolean;
  status: string;
  auditId?: string;
}

export interface QRStatus {
  qrAvailable: boolean;
  qrUpdatedAt: string | null;
  status: string; // "connected" | "needs_qr" | "connecting" | "error"
  message: string;
}

export interface TestDMInput {
  threadId: string;
  content?: string;
}

export interface TestDMResult {
  allowed: boolean;
  reason?: string;
  auditId?: string;
  agentTaskId?: string;
}

export interface RecentEvent {
  type: "inbound" | "outbound" | "reaction" | "document" | "error";
  timestamp: string;
  threadId?: string;
  senderId?: string;
  senderName?: string;
  content?: string;
  detail?: string;
  errorCode?: string;
}

export interface RecentEventsResponse {
  inbound: RecentEvent[];
  outbound: RecentEvent[];
  errors: RecentEvent[];
}

// ── Session file info ────────────────────────────────────────────────

const SESSION_FILE = "zalo-session.json";
const SESSION_DIR = config.zalo.sessionDir;

function getSessionInfo(): ZaloOpsStatus["session"] {
  const sessionPath = resolve(SESSION_DIR, SESSION_FILE);
  const exists = existsSync(sessionPath);
  let age: string | null = null;
  let ageSeconds: number | null = null;
  let fileSize: number | null = null;
  let updatedAt: string | null = null;

  if (exists) {
    try {
      const st = statSync(sessionPath);
      ageSeconds = Math.round((Date.now() - st.mtimeMs) / 1000);
      if (ageSeconds < 60) age = `${ageSeconds}s ago`;
      else if (ageSeconds < 3600) age = `${Math.round(ageSeconds / 60)}m ago`;
      else if (ageSeconds < 86400) age = `${Math.round(ageSeconds / 3600)}h ago`;
      else age = `${Math.round(ageSeconds / 86400)}d ago`;
      fileSize = st.size;
      updatedAt = st.mtime.toISOString();
    } catch { /* ignore */ }
  }

  // S3: List quarantined files (match pattern: zalo-session.json.<reason>-<timestamp>)
  const quarantinedFiles: string[] = [];
  try {
    const dirEntries = readdirSync(SESSION_DIR);
    for (const entry of dirEntries) {
      if (entry.startsWith(SESSION_FILE + ".")) {
        quarantinedFiles.push(entry);
      }
    }
  } catch { /* directory may not exist */ }

  // Mask the path: only show last 2 segments
  const parts = sessionPath.split(/[\\/]+/).filter(Boolean);
  const maskedPath = parts.length >= 2 ? `…/${parts.slice(-2).join("/")}` : "…/session";

  const gw = getZaloGateway();
  const gwStatus = gw.getStatus();

  // S3: Determine warning based on connected state + file existence
  let warning: ZaloOpsStatus["session"]["warning"] = null;
  if (gwStatus.connected && !exists) {
    warning = "CONNECTED_BUT_SESSION_NOT_PERSISTED";
  } else if (!exists) {
    warning = "NO_SESSION_FILE";
  } else if (quarantinedFiles.length > 0) {
    warning = "SESSION_QUARANTINED";
  }

  // ZR2: only relevant to check when primary is missing — avoids an extra fs scan
  // on the common "connected, session present" path.
  const backupAvailable = !exists && findLatestSessionBackup() !== null;

  return {
    exists,
    age,
    ageSeconds,
    path: maskedPath,
    qrAvailable: gwStatus.qrAvailable,
    qrUpdatedAt: gwStatus.qrUpdatedAt,
    fileSize,
    updatedAt,
    quarantinedFiles,
    warning,
    backupAvailable,
  };
}

// ── Get ops status ───────────────────────────────────────────────────

export async function getZaloOpsStatus(): Promise<ZaloOpsStatus> {
  const gw = getZaloGateway();
  const gwStatus = gw.getStatus();

  // This observational endpoint must not write heartbeat evidence. The
  // gateway lifecycle is the producer of connection/listener heartbeats.
  const listenerIsActive = gw.isListenerActive();

  // Last message timestamp
  const lastMessage = await prisma.message.findFirst({
    where: { isFromBot: false },
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true },
  });

  // 24h counts
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const [inbound24h, outbound24h, failedTasks24h] = await Promise.all([
    prisma.message.count({ where: { isFromBot: false, receivedAt: { gte: since24h } } }),
    prisma.outboundRecord.count({ where: { createdAt: { gte: since24h } } }),
    prisma.agentTask.count({ where: { status: "failed", createdAt: { gte: since24h } } }),
  ]);

  // Heartbeats
  const hbSummary = await getHeartbeatSummary();

  // Dry run source
  const dryRunSource = await getDryRunSource();

  // Allowed threads from runtime config
  const settingsArr = await getAllRuntimeSettings();
  const allowedThreadsSetting = settingsArr.find((s: any) => s.key === "autoReply.allowedThreads");
  const allowedThreads: string[] = allowedThreadsSetting?.value
    ? (() => { try { const v = JSON.parse(allowedThreadsSetting.value); return Array.isArray(v) ? v : []; } catch { return []; } })()
    : config.autoReply.allowedThreads;

  const sessionInfo = getSessionInfo();

  // ZR2: connectionDetail — single source of truth for "what should the operator do next"
  let connectionDetail: string;
  if (gw.isReconnectInProgress()) {
    connectionDetail = "reconnect_in_progress";
  } else if (gwStatus.connected) {
    connectionDetail = "connected";
  } else if (gwStatus.connectionStatus === "waiting_qr_scan" && gwStatus.qrAvailable) {
    connectionDetail = "waiting_qr_scan";
  } else if (sessionInfo.exists) {
    connectionDetail = gwStatus.lastError === "RESTORE_FAILED" || gwStatus.lastError === "SESSION_QUARANTINED" || gwStatus.lastError === "ZALO_LOGIN_FAILED"
      ? "restore_failed"
      : "session_present"; // primary session file present but not yet reconnected — Reconnect button applies
  } else if (sessionInfo.backupAvailable) {
    connectionDetail = "backup_available";
  } else {
    connectionDetail = "qr_required";
  }

  return {
    connected: gwStatus.connected,
    connectionStatus: gwStatus.connectionStatus,
    connectionDetail,
    selfUserId: gwStatus.selfUserId,
    selfDisplayName: gwStatus.selfDisplayName,
    lastConnectedAt: gwStatus.lastConnectedAt,
    lastError: gwStatus.lastError,
    lastMessageAt: lastMessage?.receivedAt?.toISOString() ?? null,
    listenerActive: listenerIsActive,
    dryRun: getCurrentEffectiveDryRun(),
    dryRunSource,
    allowedThreads,
    cooldownSeconds: getEffectiveCooldownSeconds(),

    session: sessionInfo,

    heartbeats: {
      // When disconnected, connection/listener heartbeats are always "down" regardless of DB cache
      zaloConnection: gwStatus.connected
        ? (hbSummary.zaloConnection
            ? { status: hbSummary.zaloConnection.status, lastBeatAt: hbSummary.zaloConnection.lastBeatAt, ageSeconds: hbSummary.zaloConnection.ageSeconds }
            : { status: "down", lastBeatAt: null, ageSeconds: null })
        : { status: "down", lastBeatAt: hbSummary.zaloConnection?.lastBeatAt ?? null, ageSeconds: hbSummary.zaloConnection?.ageSeconds ?? null },
      zaloListener: (gwStatus.connected && listenerIsActive)
        ? (hbSummary.zaloListener
            ? { status: hbSummary.zaloListener.status, lastBeatAt: hbSummary.zaloListener.lastBeatAt, ageSeconds: hbSummary.zaloListener.ageSeconds }
            : { status: "down", lastBeatAt: null, ageSeconds: null })
        : { status: "down", lastBeatAt: hbSummary.zaloListener?.lastBeatAt ?? null, ageSeconds: hbSummary.zaloListener?.ageSeconds ?? null },
      messagePipeline: hbSummary.messagePipeline
        ? { status: hbSummary.messagePipeline.status, lastBeatAt: hbSummary.messagePipeline.lastBeatAt, ageSeconds: hbSummary.messagePipeline.ageSeconds }
        : { status: "down", lastBeatAt: null, ageSeconds: null },
    },

    recovery: (() => {
      const r = gw.getRecoveryStatus();
      return {
        recoveryState: r.recoveryState,
        reconnectAttempts: r.reconnectAttempts,
        maxReconnectAttempts: r.maxReconnectAttempts,
        lastReconnectAt: r.lastReconnectAt,
        lastReconnectError: r.lastReconnectError,
        listenerHeartbeatAgeSeconds: r.listenerHeartbeatAgeSeconds,
      };
    })(),

    inbound24h,
    outbound24h,
    failedTasks24h,
  };
}

async function getDryRunSource(): Promise<"env" | "runtime"> {
  try {
    const dbSetting = await prisma.runtimeSetting.findUnique({
      where: { key: "autoReply.dryRun" },
    });
    return dbSetting ? "runtime" : "env";
  } catch {
    return "env";
  }
}

// ── Safe Reconnect ───────────────────────────────────────────────────

export async function reconnectZalo(userId?: string): Promise<ReconnectResult> {
  const gw = getZaloGateway();

  // 1) Already connected — no-op, never touches the session file.
  if (gw.isConnected()) {
    return {
      success: true,
      status: "already_connected",
      message: "Zalo is already connected. No action needed.",
    };
  }

  // 2) ZR2: reconnect mutex — refuse a second concurrent reconnect instead of racing
  // two restore/login attempts against the same session file.
  if (!gw.beginReconnect()) {
    return {
      success: false,
      status: "reconnect_in_progress",
      message: "A reconnect is already in progress. Please wait for it to finish.",
    };
  }

  try {
    const sessionInfo = getSessionInfo();

    // 3) Primary session file exists — restore from it (restoreSession() itself
    // falls back to the most recent backup when the primary file goes missing
    // mid-flight, so this single call covers both cases 3 and 4 of the plan).
    if (sessionInfo.exists || sessionInfo.backupAvailable) {
      try {
        const restored = await gw.restoreSession({ startListener: true });
        if (restored) {
          const usedBackup = gw.getLastRestoreSource() === "backup";
          await createAudit("zalo.reconnect", usedBackup ? "restored_from_backup" : "restored", userId);
          return {
            success: true,
            status: usedBackup ? "restored_from_backup" : "restored",
            message: usedBackup
              ? "Primary session was missing — restored from the most recent backup. Listener started."
              : "Session restored from saved credentials. Listener started.",
          };
        }
        // restoreSession() returned false without throwing — no valid primary or backup credentials
        await createAudit("zalo.reconnect", "restore_failed", userId);
        return {
          success: false,
          status: "restore_failed",
          message: "Session restore failed (invalid or expired credentials). QR login required.",
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await createAudit("zalo.reconnect", "restore_failed", userId);
        return {
          success: false,
          status: "restore_failed",
          message: `Session restore failed: ${msg}. Manual QR login may be needed.`,
        };
      }
    }

    // 5) No primary session and no backup — QR login is the only path left.
    try {
      const result = await gw.startLogin();
      await createAudit("zalo.reconnect", result.status === "connected" ? "started_dry" : "started_login", userId);

      if (result.status === "connected") {
        // dryRun mode
        return { success: true, status: "connected", message: "Connected (dry-run mode)." };
      }

      return {
        success: true,
        status: "qr_required",
        message: "No saved session or backup found. QR login started — scan QR code to connect.",
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, status: "error", message: msg };
    }
  } finally {
    gw.endReconnect();
  }
}

// ── Safe Disconnect ──────────────────────────────────────────────────

export async function disconnectZalo(userId?: string): Promise<DisconnectResult> {
  const gw = getZaloGateway();
  try {
    await gw.logout();
    await createAudit("zalo.disconnect", "logged_out", userId);
    return { success: true, status: "disconnected" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, status: "error" };
  }
}

// ── QR Status ────────────────────────────────────────────────────────

export function getQRStatus(): QRStatus {
  const gw = getZaloGateway();
  const gwStatus = gw.getStatus();

  if (gwStatus.connected) {
    return { qrAvailable: false, qrUpdatedAt: null, status: "connected", message: "Already connected." };
  }

  if (gwStatus.connectionStatus === "waiting_qr_scan" && gwStatus.qrAvailable) {
    return { qrAvailable: true, qrUpdatedAt: gwStatus.qrUpdatedAt, status: "waiting_qr_scan", message: "QR code ready. Scan to connect." };
  }

  if (gwStatus.connectionStatus === "connecting") {
    return { qrAvailable: false, qrUpdatedAt: null, status: "connecting", message: "Login in progress. QR will appear shortly." };
  }

  if (gwStatus.connectionStatus === "error") {
    return { qrAvailable: false, qrUpdatedAt: null, status: "error", message: gwStatus.lastError ?? "Connection error." };
  }

  const sessionInfo = getSessionInfo();
  if (sessionInfo.exists) {
    return { qrAvailable: false, qrUpdatedAt: null, status: "needs_reconnect", message: "Session exists but not connected. Try Reconnect." };
  }

  return { qrAvailable: false, qrUpdatedAt: null, status: "needs_qr", message: "No session file. Start login to get QR code." };
}

// ── Test DM (dry-run only) ───────────────────────────────────────────

export async function testDM(input: TestDMInput, userId?: string): Promise<TestDMResult> {
  const threadId = normalizeThreadId(input.threadId);
  const { content } = input;

  // Guard 0: a missing/blank thread must never reach settings or evidence writes.
  if (!threadId) {
    return { allowed: false, reason: "MISSING_THREAD_ID" };
  }

  // Guard 1: must be dryRun=true
  if (!getCurrentEffectiveDryRun()) {
    return { allowed: false, reason: "NOT_DRY_RUN: Test DM is only allowed when dryRun=true. Use Safety Mode to switch." };
  }

  // Guard 2: threadId must be in allowedThreads
  const settingsArr = await getAllRuntimeSettings();
  const allowedSetting = settingsArr.find((s: any) => s.key === "autoReply.allowedThreads");
  let rawAllowedThreads: unknown = config.autoReply.allowedThreads;
  if (allowedSetting !== undefined) {
    try {
      rawAllowedThreads = JSON.parse(allowedSetting.value);
    } catch {
      rawAllowedThreads = [];
    }
  }
  const allowedThreads: string[] = Array.isArray(rawAllowedThreads)
    ? rawAllowedThreads.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (allowedThreads.length === 0 || !allowedThreads.includes(threadId)) {
    return { allowed: false, reason: `THREAD_NOT_ALLOWED: threadId ${threadId} not in allowedThreads [${allowedThreads.join(", ")}]` };
  }

  // Guard 3: Zalo must be connected (or dryRun)
  const gw = getZaloGateway();
  if (!config.zalo.dryRun && !gw.isConnected()) {
    return { allowed: false, reason: "ZALO_NOT_CONNECTED" };
  }

  // Create an agent task for the test
  const testContent = content ?? "🔍 [TEST DM] Dry-run test message";
  const task = await prisma.agentTask.create({
    data: {
      agentName: "admin-ui",
      taskType: "test_dm",
      input: JSON.stringify({ threadId, content: testContent }),
      status: "completed",
      result: JSON.stringify({
        skipped: true,
        reason: "test_dm_dry_run",
        dryRun: true,
        threadId,
      }),
    },
  });

  // Create audit log
  const audit = await prisma.auditLog.create({
    data: {
      action: "zalo.test_dm",
      entityType: "agent_task",
      entityId: task.id,
      actor: userId ?? "admin",
      details: JSON.stringify({ threadId, dryRun: true }),
    },
  });

  return {
    allowed: true,
    auditId: audit.id,
    agentTaskId: task.id,
  };
}

// ── Recent Events ────────────────────────────────────────────────────

export async function getRecentEvents(): Promise<RecentEventsResponse> {
  // Last 20 inbound messages
  const inbound = await prisma.message.findMany({
    where: { isFromBot: false },
    orderBy: { receivedAt: "desc" },
    take: 20,
    select: {
      id: true, threadId: true, senderId: true, senderName: true,
      content: true, messageType: true, receivedAt: true,
    },
  });

  // Last 20 outbound records
  const outbound = await prisma.outboundRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true, threadId: true, content: true, decision: true,
      reason: true, source: true, dryRun: true, errorCode: true, createdAt: true,
    },
  });

  // Last 10 errors (failed agent tasks + outbound blocks)
  const failedTasks = await prisma.agentTask.findMany({
    where: { status: "failed", createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, taskType: true, errorMessage: true, createdAt: true },
  });

  const blocks = await prisma.outboundRecord.findMany({
    where: { decision: "block", createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, threadId: true, reason: true, errorCode: true, createdAt: true },
  });

  // Document ingestion errors
  const docErrors = await prisma.document.findMany({
    where: { status: "failed", createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, fileName: true, errorCode: true, errorMessage: true, createdAt: true },
  });

  const inboundEvents: RecentEvent[] = inbound.map(m => ({
    type: m.messageType === "file" ? "document" : m.messageType === "sticker" ? "reaction" : "inbound",
    timestamp: m.receivedAt.toISOString(),
    threadId: m.threadId,
    senderId: m.senderId ?? undefined,
    senderName: m.senderName ?? undefined,
    content: m.content?.slice(0, 200),
  }));

  const outboundEvents: RecentEvent[] = outbound.map(o => ({
    type: "outbound",
    timestamp: o.createdAt.toISOString(),
    threadId: o.threadId,
    content: o.content?.slice(0, 200),
    detail: `${o.decision} · ${o.source}${o.dryRun ? " · dryRun" : ""} · ${o.reason}`,
    errorCode: o.errorCode ?? undefined,
  }));

  const errorEvents: RecentEvent[] = [
    ...failedTasks.map(t => ({
      type: "error" as const,
      timestamp: t.createdAt.toISOString(),
      detail: `AgentTask failed: ${t.taskType} — ${t.errorMessage ?? "no message"}`,
      errorCode: "AGENT_TASK_FAILED",
    })),
    ...blocks.map(b => ({
      type: "outbound" as const,
      timestamp: b.createdAt.toISOString(),
      threadId: b.threadId,
      detail: `Blocked: ${b.reason}`,
      errorCode: b.errorCode ?? "BLOCKED",
    })),
    ...docErrors.map(d => ({
      type: "document" as const,
      timestamp: d.createdAt.toISOString(),
      detail: `Doc failed: ${d.fileName} — ${d.errorCode ?? "UNKNOWN"}: ${d.errorMessage ?? ""}`,
      errorCode: d.errorCode ?? undefined,
    })),
  ];

  return { inbound: inboundEvents, outbound: outboundEvents, errors: errorEvents };
}

// ── Helpers ──────────────────────────────────────────────────────────

async function createAudit(action: string, detail: string, actor?: string): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entityType: "zalo_session",
        actor: actor ?? "admin",
        details: JSON.stringify({ detail }),
      },
    });
  } catch { /* non-fatal: audit log failure should not break reconnect */ }
}
