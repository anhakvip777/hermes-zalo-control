// =============================================================================
// ZaloOpsService — Zalo Live-Safe Operations Dashboard backend
// =============================================================================

import { existsSync, statSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { getZaloGateway, type ZaloGatewayStatus } from "./zalo-gateway.service.js";
import { getCurrentEffectiveDryRun, getEffectiveCooldownSeconds, getAllRuntimeSettings } from "./runtime-config.service.js";
import { getHeartbeatSummary, heartbeatOk } from "./heartbeat.service.js";
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
  };

  heartbeats: {
    zaloConnection: { status: string; lastBeatAt: string | null; ageSeconds: number | null };
    zaloListener: { status: string; lastBeatAt: string | null; ageSeconds: number | null };
    messagePipeline: { status: string; lastBeatAt: string | null; ageSeconds: number | null };
  };

  inbound24h: number;
  outbound24h: number;
  failedTasks24h: number;
}

export interface ReconnectResult {
  success: boolean;
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
  const parts = sessionPath.split("/");
  const maskedPath = parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : sessionPath;

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
  };
}

// ── Get ops status ───────────────────────────────────────────────────

export async function getZaloOpsStatus(): Promise<ZaloOpsStatus> {
  const gw = getZaloGateway();
  const gwStatus = gw.getStatus();

  // Refresh heartbeats when connected; when disconnected let them go stale/down naturally
  if (gwStatus.connected) {
    heartbeatOk("zaloConnection", { connected: true, via: "ops/status" }).catch(() => {});
  }
  const listenerIsActive: boolean = (gw as any).listenerActive === true;
  if (gwStatus.connected && listenerIsActive) {
    heartbeatOk("zaloListener", { via: "ops/status" }).catch(() => {});
  }

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

  return {
    connected: gwStatus.connected,
    connectionStatus: gwStatus.connectionStatus,
    selfUserId: gwStatus.selfUserId,
    selfDisplayName: gwStatus.selfDisplayName,
    lastConnectedAt: gwStatus.lastConnectedAt,
    lastError: gwStatus.lastError,
    lastMessageAt: lastMessage?.receivedAt?.toISOString() ?? null,
    listenerActive: (gw as any).listenerActive === true,
    dryRun: getCurrentEffectiveDryRun(),
    dryRunSource,
    allowedThreads,
    cooldownSeconds: getEffectiveCooldownSeconds(),

    session: getSessionInfo(),

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
  const sessionInfo = getSessionInfo();

  // If already connected, no-op
  if (gw.isConnected()) {
    return {
      success: true,
      status: "already_connected",
      message: "Zalo is already connected. No action needed.",
    };
  }

  // If session file exists, restore it
  if (sessionInfo.exists) {
    try {
      const restored = await gw.restoreSession({ startListener: true });
      if (restored) {
        await createAudit("zalo.reconnect", "restored", userId);
        return {
          success: true,
          status: "restored",
          message: "Session restored from saved credentials. Listener started.",
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Session restore failed, fall through to QR
      return {
        success: false,
        status: "restore_failed",
        message: `Session restore failed: ${msg}. Manual QR login may be needed.`,
      };
    }
  }

  // No session file — need QR login
  try {
    const result = await gw.startLogin();
    await createAudit("zalo.reconnect", result.status === "connected" ? "started_dry" : "started_login", userId);

    if (result.status === "connected") {
      // dryRun mode
      return { success: true, status: "connected", message: "Connected (dry-run mode)." };
    }

    return {
      success: true,
      status: "needs_qr",
      message: "No saved session found. QR login started — scan QR code to connect.",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, status: "error", message: msg };
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
  const { threadId, content } = input;

  // Guard 1: must be dryRun=true
  if (!getCurrentEffectiveDryRun()) {
    return { allowed: false, reason: "NOT_DRY_RUN: Test DM is only allowed when dryRun=true. Use Safety Mode to switch." };
  }

  // Guard 2: threadId must be in allowedThreads
  const settingsArr = await getAllRuntimeSettings();
  const allowedSetting = settingsArr.find((s: any) => s.key === "autoReply.allowedThreads");
  const allowedThreads: string[] = allowedSetting?.value
    ? (() => { try { const v = JSON.parse(allowedSetting.value); return Array.isArray(v) ? v : []; } catch { return []; } })()
    : config.autoReply.allowedThreads;

  if (allowedThreads.length > 0 && !allowedThreads.includes(threadId)) {
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
