/**
 * Heartbeat Service — theo dõi liveness của worker, Zalo listener, connection.
 *
 * Mỗi component gọi heartbeat(name, status, metadata) khi hoạt động.
 * Health endpoint đọc trạng thái để biết component nào đang stale/down.
 *
 * Không tự reconnect — chỉ monitor. Alert để Item 10 làm.
 */

import { prisma } from "../db.js";

// ── Types ────────────────────────────────────────────────────────────

export type HeartbeatStatus = "ok" | "stale" | "down";

export interface HeartbeatEntry {
  name: string;
  status: HeartbeatStatus;
  lastBeatAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  ageSeconds: number | null;
  metadata: Record<string, unknown> | null;
}

export interface HeartbeatInput {
  name: string;
  status?: HeartbeatStatus;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ── Config ───────────────────────────────────────────────────────────

const STALE_THRESHOLD_SECONDS = parseInt(
  process.env.HEARTBEAT_STALE_SECONDS ?? "90",
  10,
);

// ── Known heartbeat keys ─────────────────────────────────────────────

export const HEARTBEAT_KEYS = [
  "backend",
  "zaloListener",
  "zaloConnection",
  "schedulerWorker",
  "messagePipeline",
] as const;

export type HeartbeatKey = (typeof HEARTBEAT_KEYS)[number];

// ── Record heartbeat ─────────────────────────────────────────────────

/**
 * Ghi nhận heartbeat từ một component.
 * Gọi định kỳ từ worker loop, Zalo listener event, hoặc startup.
 */
export async function heartbeat(
  name: string,
  status: HeartbeatStatus = "ok",
  opts?: { error?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const now = new Date();
  const metadataJson = opts?.metadata ? JSON.stringify(opts.metadata) : null;

  try {
    await prisma.systemHeartbeat.upsert({
      where: { name },
      create: {
        name,
        status,
        lastBeatAt: now,
        lastSuccessAt: status === "ok" ? now : null,
        lastErrorAt: status !== "ok" ? now : null,
        lastError: opts?.error ?? null,
        metadata: metadataJson,
      },
      update: {
        status,
        lastBeatAt: now,
        lastSuccessAt: status === "ok" ? now : undefined,
        lastErrorAt: status !== "ok" ? now : undefined,
        lastError: opts?.error ?? undefined,
        metadata: metadataJson ?? undefined,
      },
    });
  } catch (err: unknown) {
    // Non-fatal — heartbeat should never crash the caller
    console.error(
      `[heartbeat] Failed to record heartbeat for "${name}": ${(err as Error).message}`,
    );
  }
}

/**
 * Ghi nhận heartbeat thành công (shortcut).
 */
export async function heartbeatOk(
  name: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  return heartbeat(name, "ok", { metadata });
}

/**
 * Ghi nhận heartbeat lỗi (shortcut).
 */
export async function heartbeatError(
  name: string,
  error: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  return heartbeat(name, "down", { error, metadata });
}

// ── Check stale ──────────────────────────────────────────────────────

/**
 * Đánh dấu tất cả heartbeat quá hạn là "stale" nếu chưa có beat trong STALE_THRESHOLD_SECONDS.
 * Chỉ đánh dấu "stale" nếu status hiện tại là "ok" (không ghi đè "down").
 */
export async function checkAndMarkStale(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_SECONDS * 1000);

  try {
    const result = await prisma.systemHeartbeat.updateMany({
      where: {
        status: "ok",
        lastBeatAt: { lt: cutoff },
      },
      data: {
        status: "stale",
      },
    });
    return result.count;
  } catch (err: unknown) {
    console.error(`[heartbeat] Failed to mark stale: ${(err as Error).message}`);
    return 0;
  }
}

// ── Get all heartbeats ───────────────────────────────────────────────

export async function getAllHeartbeats(): Promise<{
  status: "ok" | "degraded" | "unhealthy";
  staleThresholdSeconds: number;
  items: HeartbeatEntry[];
}> {
  // First, mark any stale heartbeats
  const staleCount = await checkAndMarkStale();

  const rows = await prisma.systemHeartbeat.findMany({
    where: { name: { in: [...HEARTBEAT_KEYS] } },
  });

  const now = Date.now();
  const items: HeartbeatEntry[] = rows.map((row) => ({
    name: row.name,
    status: row.status as HeartbeatStatus,
    lastBeatAt: row.lastBeatAt?.toISOString() ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    lastError: row.lastError,
    ageSeconds: row.lastBeatAt
      ? Math.round((now - row.lastBeatAt.getTime()) / 1000)
      : null,
    metadata: row.metadata ? safeParseJson(row.metadata) : null,
  }));

  // Fill in missing keys with default "down" status
  for (const key of HEARTBEAT_KEYS) {
    if (!items.find((i) => i.name === key)) {
      items.push({
        name: key,
        status: "down",
        lastBeatAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: "No heartbeat recorded yet",
        ageSeconds: null,
        metadata: null,
      });
    }
  }

  // Compute overall status
  let overallStatus: "ok" | "degraded" | "unhealthy" = "ok";
  const criticalKeys = ["backend", "zaloConnection"];
  const hasStale = items.some((i) => i.status === "stale");
  const hasDown = items.some((i) => i.status === "down");
  const criticalDown = items.some(
    (i) => criticalKeys.includes(i.name) && i.status === "down",
  );

  if (criticalDown) {
    overallStatus = "unhealthy";
  } else if (hasDown || hasStale) {
    overallStatus = "degraded";
  }

  return {
    status: overallStatus,
    staleThresholdSeconds: STALE_THRESHOLD_SECONDS,
    items,
  };
}

/**
 * Lấy heartbeat summary cho health endpoint (không đánh dấu stale).
 */
export async function getHeartbeatSummary(): Promise<Record<string, HeartbeatEntry>> {
  const rows = await prisma.systemHeartbeat.findMany({
    where: { name: { in: [...HEARTBEAT_KEYS] } },
  });

  const now = Date.now();
  const result: Record<string, HeartbeatEntry> = {};

  for (const key of HEARTBEAT_KEYS) {
    const row = rows.find((r) => r.name === key);
    if (row) {
      result[key] = {
        name: row.name,
        status: row.status as HeartbeatStatus,
        lastBeatAt: row.lastBeatAt?.toISOString() ?? null,
        lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
        lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
        lastError: row.lastError,
        ageSeconds: row.lastBeatAt
          ? Math.round((now - row.lastBeatAt.getTime()) / 1000)
          : null,
        metadata: row.metadata ? safeParseJson(row.metadata) : null,
      };
    } else {
      result[key] = {
        name: key,
        status: "down",
        lastBeatAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: "No heartbeat recorded yet",
        ageSeconds: null,
        metadata: null,
      };
    }
  }

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────

function safeParseJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
