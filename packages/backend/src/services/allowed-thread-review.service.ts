// =============================================================================
// Allowed Thread Review Service — risk scoring + metadata for allowed threads
// =============================================================================
// Provides a safety dashboard to review all threads in the allowlist,
// detect risky configurations (e.g. groups without mention-required),
// and surface activity/error metrics for each thread.

import { prisma } from "../db.js";
import { config } from "../config.js";
import { getCurrentEffectiveDryRun } from "./runtime-config.service.js";

// ── Types ────────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high";

export interface ThreadReviewEntry {
  threadId: string;
  threadType: "user" | "group" | "unknown";
  displayName: string | null;
  inAllowlist: boolean;
  autoReplyEnabled: boolean;
  groupMentionRequired: boolean;
  allowImageUnderstanding: boolean;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  inbound24h: number;
  outbound24h: number;
  agentTasks24h: number;
  failedTasks24h: number;
  schedulesActive: number;
  riskScore: number;
  riskLevel: RiskLevel;
  riskReasons: string[];
}

export interface ThreadReviewSummary {
  totalThreads: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  groupCount: number;
  unknownCount: number;
  dryRun: boolean;
}

export interface ThreadReviewResponse {
  threads: ThreadReviewEntry[];
  summary: ThreadReviewSummary;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function since24h(): Date {
  return new Date(Date.now() - 24 * 3600_000);
}

function iso(d: Date | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === "string") return d;
  return d.toISOString();
}

interface DbMessageRow {
  threadId: string;
  threadType: string;
  isFromBot: boolean | number;
  receivedAt: string | Date;
  createdAt: string | Date;
}

// Resolve thread type from DB records
async function resolveThreadType(threadId: string): Promise<"user" | "group" | "unknown"> {
  // 1. Check ZaloThread table
  const zt = await prisma.zaloThread.findUnique({ where: { id: threadId } });
  if (zt && (zt.type === "user" || zt.type === "group")) {
    return zt.type;
  }

  // 2. Check most recent message's threadType
  const msg = await prisma.message.findFirst({
    where: { threadId },
    orderBy: { receivedAt: "desc" },
    select: { threadType: true },
  });
  if (msg && (msg.threadType === "user" || msg.threadType === "group")) {
    return msg.threadType;
  }

  // 3. Check ThreadSetting — DM threads typically have groupMentionRequired=false
  const ts = await prisma.threadSetting.findUnique({ where: { threadId } });
  if (ts) {
    // Heuristic: DM defaults have mentionRequired=false + replyWindow=0
    // Groups have mentionRequired=true + replyWindow>0 (unless overridden)
    if (ts.groupMentionRequired === false && ts.groupReplyWindowSeconds === 0) {
      return "user";
    }
    if (ts.groupMentionRequired === true && ts.groupReplyWindowSeconds > 0) {
      return "group";
    }
  }

  return "unknown";
}

// ── Core: get thread review entry ─────────────────────────────────────────

async function getThreadReviewEntry(
  threadId: string,
  dryRun: boolean,
): Promise<ThreadReviewEntry> {
  const now = Date.now();
  const cutoff = since24h();

  // Resolve thread type
  const threadType = await resolveThreadType(threadId);

  // Get display name from ZaloThread
  const zt = await prisma.zaloThread.findUnique({
    where: { id: threadId },
    select: { name: true },
  });

  // Get thread settings
  const ts = await prisma.threadSetting.findUnique({
    where: { threadId },
  });

  // Get message stats
  const [inboundMsgs, outboundMsgs, lastInbound, lastOutbound] = await Promise.all([
    prisma.message.count({
      where: { threadId, isFromBot: false, receivedAt: { gte: cutoff } },
    }),
    prisma.message.count({
      where: { threadId, isFromBot: true, receivedAt: { gte: cutoff } },
    }),
    prisma.message.findFirst({
      where: { threadId, isFromBot: false },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
    prisma.message.findFirst({
      where: { threadId, isFromBot: true },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
  ]);

  // Agent task stats for this thread (via messageId linkage)
  const [agentTasks24h, failedTasks24h] = await Promise.all([
    prisma.agentTask.count({
      where: {
        messageId: { not: null },
        createdAt: { gte: cutoff },
        // We can't directly filter by threadId in AgentTask,
        // so we count all recent tasks — thread-specific filtering
        // would require joining with messages
      },
    }),
    prisma.agentTask.count({
      where: {
        status: "failed",
        messageId: { not: null },
        createdAt: { gte: cutoff },
      },
    }),
  ]);

  // Active schedules targeting this thread
  const schedulesActive = await prisma.schedule.count({
    where: {
      targetId: threadId,
      status: { in: ["scheduled", "active"] },
    },
  });

  // ── Risk scoring ─────────────────────────────────────────────────────

  const riskReasons: string[] = [];
  let riskScore = 0;

  const autoReplyEnabled = ts?.autoReplyEnabled ?? true;
  const groupMentionRequired = ts?.groupMentionRequired ?? (threadType === "group");
  const allowImageUnderstanding = (ts as any)?.allowImageUnderstanding ?? false;

  // HIGH risk factors (+30 each)
  if (threadType === "group" && !groupMentionRequired) {
    riskScore += 30;
    riskReasons.push("Group thread without mention-required");
  }
  if (threadType === "group" && !dryRun) {
    riskScore += 30;
    riskReasons.push("Live mode active on group thread");
  }
  if (threadType === "unknown" && autoReplyEnabled) {
    riskScore += 30;
    riskReasons.push("Unknown thread type with auto-reply enabled");
  }

  // MEDIUM risk factors (+15 each)
  if (threadType === "group") {
    riskScore += 15;
    riskReasons.push("Group thread in allowlist");
  }
  if (allowImageUnderstanding) {
    riskScore += 15;
    riskReasons.push("Image understanding enabled");
  }
  if (inboundMsgs === 0 && outboundMsgs === 0) {
    riskScore += 15;
    riskReasons.push("No recent activity (24h)");
  }
  if (threadType === "unknown") {
    riskScore += 15;
    riskReasons.push("Unknown thread type");
  }
  if (!dryRun) {
    riskScore += 15;
    riskReasons.push("Dry-run disabled (live mode)");
  }
  if (failedTasks24h > 0) {
    riskScore += 15;
    riskReasons.push(`${failedTasks24h} failed agent tasks in 24h`);
  }

  // LOW/MEDIUM risk factors (+5 each)
  if (!autoReplyEnabled) {
    riskScore += 5;
    riskReasons.push("Auto-reply disabled");
  }

  // Determine risk level
  let riskLevel: RiskLevel;
  if (riskScore >= 30) {
    riskLevel = "high";
  } else if (riskScore >= 15) {
    riskLevel = "medium";
  } else {
    riskLevel = "low";
  }

  return {
    threadId,
    threadType,
    displayName: zt?.name ?? null,
    inAllowlist: true, // Always true for entries returned here
    autoReplyEnabled,
    groupMentionRequired,
    allowImageUnderstanding,
    lastInboundAt: lastInbound ? iso(lastInbound.receivedAt) : null,
    lastOutboundAt: lastOutbound ? iso(lastOutbound.receivedAt) : null,
    inbound24h: inboundMsgs,
    outbound24h: outboundMsgs,
    agentTasks24h,
    failedTasks24h,
    schedulesActive,
    riskScore,
    riskLevel,
    riskReasons,
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Review all threads in the allowedThreads config.
 * Returns per-thread metadata + risk scoring + summary.
 */
export async function reviewAllowedThreads(): Promise<ThreadReviewResponse> {
  const dryRun = getCurrentEffectiveDryRun();
  const allowedThreads = config.autoReply.allowedThreads;

  if (allowedThreads.length === 0) {
    return {
      threads: [],
      summary: {
        totalThreads: 0,
        highRiskCount: 0,
        mediumRiskCount: 0,
        lowRiskCount: 0,
        groupCount: 0,
        unknownCount: 0,
        dryRun,
      },
    };
  }

  const threads = await Promise.all(
    allowedThreads.map((threadId) => getThreadReviewEntry(threadId, dryRun)),
  );

  // Sort by riskScore descending (highest risk first)
  threads.sort((a, b) => b.riskScore - a.riskScore);

  const highRiskCount = threads.filter((t) => t.riskLevel === "high").length;
  const mediumRiskCount = threads.filter((t) => t.riskLevel === "medium").length;
  const lowRiskCount = threads.filter((t) => t.riskLevel === "low").length;
  const groupCount = threads.filter((t) => t.threadType === "group").length;
  const unknownCount = threads.filter((t) => t.threadType === "unknown").length;

  return {
    threads,
    summary: {
      totalThreads: threads.length,
      highRiskCount,
      mediumRiskCount,
      lowRiskCount,
      groupCount,
      unknownCount,
      dryRun,
    },
  };
}

/**
 * Review a single thread by ID (even if not in allowlist).
 * Returns null if thread not found (no messages, no settings, no zalo record).
 */
export async function reviewSingleThread(
  threadId: string,
): Promise<ThreadReviewEntry | null> {
  const dryRun = getCurrentEffectiveDryRun();

  // Check if thread exists at all
  const hasAnyRecord = await prisma.message.findFirst({
    where: { threadId },
    select: { id: true },
  });

  if (!hasAnyRecord) {
    const zt = await prisma.zaloThread.findUnique({ where: { id: threadId } });
    const ts = await prisma.threadSetting.findUnique({ where: { threadId } });
    if (!zt && !ts) return null;
  }

  const inAllowlist = config.autoReply.allowedThreads.includes(threadId);
  const entry = await getThreadReviewEntry(threadId, dryRun);
  entry.inAllowlist = inAllowlist;
  return entry;
}

/**
 * Get summary-only (fast, no per-thread detail) — for health/config integration.
 */
export async function getThreadReviewSummary(): Promise<ThreadReviewSummary> {
  const dryRun = getCurrentEffectiveDryRun();
  const allowedThreads = config.autoReply.allowedThreads;

  if (allowedThreads.length === 0) {
    return {
      totalThreads: 0,
      highRiskCount: 0,
      mediumRiskCount: 0,
      lowRiskCount: 0,
      groupCount: 0,
      unknownCount: 0,
      dryRun,
    };
  }

  // Fast path: resolve thread types only, no full risk calculation
  const threadTypes = await Promise.all(allowedThreads.map(resolveThreadType));
  const groupCount = threadTypes.filter((t) => t === "group").length;
  const unknownCount = threadTypes.filter((t) => t === "unknown").length;

  // For risk, we need a quick check — use resolveThreadType + ThreadSetting
  const settings = await prisma.threadSetting.findMany({
    where: { threadId: { in: allowedThreads } },
  });
  const settingsMap = new Map(settings.map((s) => [s.threadId, s]));

  let highRiskCount = 0;
  let mediumRiskCount = 0;
  let lowRiskCount = 0;

  for (let i = 0; i < allowedThreads.length; i++) {
    const threadId = allowedThreads[i]!;
    const type = threadTypes[i]!;
    const ts = settingsMap.get(threadId);
    const mentionRequired = ts?.groupMentionRequired ?? (type === "group");
    const autoReplyEnabled = ts?.autoReplyEnabled ?? true;

    let score = 0;
    // HIGH factors (+30)
    if (type === "group" && !mentionRequired) score += 30;
    if (type === "group" && !dryRun) score += 30;
    if (type === "unknown" && autoReplyEnabled) score += 30;
    // MEDIUM factors (+15)
    if (type === "group") score += 15;
    if (type === "unknown") score += 15;
    if (!dryRun) score += 15;

    if (score >= 30) highRiskCount++;
    else if (score >= 15) mediumRiskCount++;
    else lowRiskCount++;
  }

  return {
    totalThreads: allowedThreads.length,
    highRiskCount,
    mediumRiskCount,
    lowRiskCount,
    groupCount,
    unknownCount,
    dryRun,
  };
}
