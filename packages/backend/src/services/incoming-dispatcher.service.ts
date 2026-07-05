// =============================================================================
// IncomingMessageDispatcher — routes Zalo messages to Hermes for auto-reply
// =============================================================================

import { config } from "../config.js";
import { getCurrentEffectiveDryRun, getEffectiveBatchingConfig, getEffectiveCooldownSeconds } from "./runtime-config.service.js";
import { isThreadAllowedCached } from "./allowlist.service.js";
import { prisma } from "../db.js";
import { getHermesChatAdapter } from "./hermes-chat-adapter.js";
import * as agentTaskService from "./agent-task.service.js";
import * as scheduleService from "./schedule.service.js";
import * as jobService from "./job.service.js";
import * as threadSettingsService from "./thread-settings.service.js";
import type { ThreadSettingData } from "./thread-settings.service.js";
import {
  getGroupReplyWindow,
  touchGroupReplyWindow,
  closeGroupReplyWindow,
  logGroupGateAudit,
  getActiveReplyWindows,
} from "./group-safety.service.js";
import type { NormalizedMessage } from "./zalo-receive.js";
import type { ConversationState } from "./thread-conversation-state.service.js";
import { saveOutboundRecord } from "./outbound-guardrails.service.js";
import { sendOutbound } from "./outbound-dispatcher.service.js";
import { hasUnsupportedSystemClaim, hasScheduleEvidence } from "./unsupported-claim-guard.service.js";
import { clearAllCooldowns, getActiveCooldowns, clearCooldown } from "./cooldown.service.js";
import { redact } from "./tool-gateway/redaction.js";

// KI-B4: redact secrets from any user content BEFORE it is persisted (previews,
// audit records). Redact the FULL content first, then slice — slicing first
// could split a secret and leave a fragment un-masked.
function redactPreview(content: string | undefined | null, max: number): string {
  if (!content) return "";
  return (redact(content) as string).slice(0, max);
}

// ── Cooldown (R5): unified DB-backed store ───────────────────────────
// Replaced dual in-memory Maps with ThreadCooldown table.
// safetyCheck() no longer gates on cooldown — cooldown is enforced
// solely in sendOutbound() (dispatcher is single authority).
// See cooldown.service.ts for acquireCooldown / setCooldown / clearAll.

export async function resetAutoReplyCooldowns(): Promise<void> {
  await clearAllCooldowns();
}

// ── Safety checks ───────────────────────────────────────────────────

interface SafetyResult {
  allowed: boolean;
  reason?: string;
}

function safetyCheck(msg: NormalizedMessage, selfUserId?: string | null): SafetyResult {
  // ── Defense-in-depth: self-message guard ──────────────────
  // Check BEFORE all other gates. The upstream listener also
  // drops self messages, but this catches any bypass.
  if (msg.isSelf === true || msg.isFromBot === true) {
    return { allowed: false, reason: "self_message" };
  }
  if (selfUserId && msg.senderId === selfUserId) {
    return { allowed: false, reason: "self_message" };
  }

  const cfg = config.autoReply;

  if (!cfg.enabled) {
    return { allowed: false, reason: "auto_reply_disabled" };
  }

  if (!msg.threadId) {
    return { allowed: false, reason: "no_threadId" };
  }

  if (!isThreadAllowedCached(msg.threadId, msg.threadType)) {
    return { allowed: false, reason: "thread_not_allowed" };
  }

  if (msg.content.trim().length === 0) {
    return { allowed: false, reason: "empty_content" };
  }

  if (msg.messageType !== "text" && msg.messageType !== "image" && msg.messageType !== "file") {
    return { allowed: false, reason: "non_text_message" };
  }

  // ── Cooldown (R5): moved to sendOutbound() — dispatcher is sole authority.
  // safetyCheck() no longer gates on cooldown. This means cooldown-blocked
  // messages still reach Hermes for processing, but the outbound is blocked
  // at send time. The 10s cooldown window makes the compute waste acceptable.

  return { allowed: true };
}

// ── Group safety gate (async — needs ThreadSettings from DB) ─────

interface GroupGateResult {
  allowed: boolean;
  reason?: string;
  settings?: ThreadSettingData;
}

/**
 * Check group-specific safety gates: mention requirement + reply window.
 * DM threads always pass through (groupMentionRequired=false by default).
 */
async function groupGateCheck(
  msg: NormalizedMessage,
  selfUserId?: string | null,
): Promise<GroupGateResult> {
  const settings = await threadSettingsService.getThreadSettings(msg.threadId, msg.threadType);

  // DM threads: no group gates needed
  if (msg.threadType === "user") {
    return { allowed: true, settings };
  }

  // ── Group: autoReplyEnabled check ──────────────────────────
  if (!settings.autoReplyEnabled) {
    logGroupGateAudit({
      threadId: msg.threadId,
      threadType: "group",
      messageId: msg.zaloMessageId,
      decision: "skip",
      reason: "group_disabled",
    });
    return { allowed: false, reason: "group_disabled" };
  }

  // ── Group: mention required check ─────────────────────────
  if (settings.groupMentionRequired) {
    if (!selfUserId) {
      // Cannot check mentions without selfUserId — skip safely
      logGroupGateAudit({
        threadId: msg.threadId,
        threadType: "group",
        messageId: msg.zaloMessageId,
        decision: "skip",
        reason: "bot_not_mentioned",
        mentioned: false,
      });
      return { allowed: false, reason: "bot_not_mentioned" };
    }

    const mentions = msg.mentions;
    const isMentioned = mentions
      ? mentions.includes(selfUserId)
      : // Fallback: check content for @mention patterns if no structured mentions
        // Zalo group messages may not always have structured mention data
        checkTextMention(msg.content, selfUserId);

    if (!isMentioned) {
      logGroupGateAudit({
        threadId: msg.threadId,
        threadType: "group",
        messageId: msg.zaloMessageId,
        decision: "skip",
        reason: "bot_not_mentioned",
        mentioned: false,
      });
      return { allowed: false, reason: "bot_not_mentioned" };
    }

    // Mention detected → open reply window
    touchGroupReplyWindow(msg.threadId, settings);
    const replyWindowUntil = getGroupReplyWindow(msg.threadId);

    logGroupGateAudit({
      threadId: msg.threadId,
      threadType: "group",
      messageId: msg.zaloMessageId,
      decision: "allow",
      reason: "mentioned",
      mentioned: true,
      replyWindowUntil: replyWindowUntil
        ? new Date(replyWindowUntil).toISOString()
        : undefined,
    });

    return { allowed: true, settings };
  }

  // Group without mention requirement → allow through
  return { allowed: true, settings };
}

/**
 * Fallback text-based mention detection when structured mentions are unavailable.
 * Checks if the bot's UID appears in the raw content or common mention patterns.
 */
function checkTextMention(content: string, selfUserId: string): boolean {
  // Direct UID in content (rare but possible)
  if (content.includes(selfUserId)) return true;

  // Content starts with @ (Zalo strips @mention formatting from text content,
  // but sometimes the raw text may contain it)
  return false;
}

// ── Create-reminder intent detection + parsing ──────────────────

/** Detect if user wants to CREATE a reminder (not just query existing ones). */
export function detectCreateReminderIntent(content: string): boolean {
  const patterns = [
    /nhắc\s+(mình|tôi|tui|em|anh|chị)\s+\d+\s*(p|phút|giây|giờ|h|tiếng|ngày)\s*(nữa|later)/i,
    /\d+\s*(p|phút|giây|giờ|h|tiếng|ngày)\s*(nữa|later)\s+nhắc/i,
    /nhắc\s+(mình|tôi|tui|em|anh|chị)\s+lúc\s+\d+/i,
    /nhắc\s+(mình|tôi|tui)\s+về\s+\w/i,
    /(nhắn|nhắc|báo)\s+(mình|tôi|tui)\s+(sau|lúc|vào)/i,
    // Batch 14.1: "nhắc [target] <content> lúc <time>" — multi-word content
    /\bnhắc\s+(?:mình|tôi|tui|em|anh|chị)?\s*.+?\s+lúc\s+\d+/iu,
    // SCHED1: "nhắn" synonym + compact "2p" + "sau X phút/p" patterns
    /\d+p\s*(nữa|later)\s+(nhắn|nhắc|báo)/i,
    /(nhắn|nhắc|báo)\s+(mình|tôi|tui|em|anh|chị)\s+\d+p\s*(nữa|later)/i,
    /sau\s+\d+\s*(p|phút|giây|giờ|h|tiếng|ngày)\s+(nhắn|nhắc|báo|remind)/i,
    /\d+\s*(p|phút|giây|giờ|h)\s*(nữa|later)\s+(nhắn|báo)/i,
  ];
  return patterns.some((p) => p.test(content));
}

interface ParsedReminder {
  content: string;
  scheduledAt: Date;
  timeDescription: string;
}

/**
 * Batch 14.1: Parse "lúc <time>" patterns.
 * Supports: "19h", "7h sáng", "19:00", "7h tối", "19h tối nay", etc.
 */
function parseLúcTime(
  timeStr: string,
  now: Date,
): { scheduledAt: Date; timeDescription: string } | null {
  const lower = timeStr.toLowerCase().trim();

  // Extract hour + optional minute
  const match = lower.match(/(\d{1,2})(?:h|:(\d{2}))?/);
  if (!match) return null;

  let hour = parseInt(match[1]!, 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;

  // Detect period: sáng, chiều, tối, trưa
  const hasSang = /sáng/.test(lower);
  const hasChieu = /chiều/.test(lower);
  const hasToi = /tối/.test(lower);
  const hasTrua = /trưa/.test(lower);

  // Adjust hour for 12h notation
  if (hasSang && hour <= 12) { /* keep as is */ }
  else if (hasChieu && hour < 12) hour += 12;
  else if (hasToi && hour < 12) hour += 12;
  else if (hasTrua && hour < 12) hour += 12;
  // Default: if hour <= 6, assume PM (e.g. "lúc 3h" → 15:00)
  // Only auto-PM if no period specified and hour < 7
  else if (!hasSang && !hasChieu && !hasToi && !hasTrua) {
    // If hour is ambiguous (1-6), assume PM for Vietnamese casual speech
    if (hour >= 1 && hour <= 6) hour += 12;
  }

  // Build Date
  const scheduledAt = new Date(now);
  scheduledAt.setHours(hour, minute, 0, 0);

  const periodLabel = hasSang ? "sáng" : hasChieu ? "chiều" : hasToi ? "tối" : hasTrua ? "trưa" : "";
  const timeDescription = `${hour}:${String(minute).padStart(2, "0")}${periodLabel ? " " + periodLabel : ""}`;

  return { scheduledAt, timeDescription };
}

/** Parse reminder time and content from natural language. */
export function parseReminderFromMessage(content: string): ParsedReminder | null {
  const now = new Date();
  let offsetMs = 0;
  let reminderContent = content;
  let timeDesc = "";

  // ── Batch 14.1: Normalize multi-line input for pattern matching ──
  // Combined batch text may have newlines (e.g. "Nhắc mình\nĐi Lễ Phật\nLúc 19h").
  // Normalize to "Nhắc mình Đi Lễ Phật Lúc 19h" for pattern matching while
  // keeping the original `content` for audit purposes.
  const normalized = content.replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  // ── Batch 14.1: "nhắc [target] <content> lúc <time>" ──
  // Examples:
  //   "Nhắc mình Đi Lễ Phật Lúc 19h" → content="Đi Lễ Phật", time="19h"
  //   "nhắc đi lễ Phật lúc 19h"      → content="đi lễ Phật", time="19h"
  const matchLúcContent = lower.match(
    /\bnhắc\s+(?:mình|tôi|tui|em|anh|chị)?\s*(?<reminderContent>.+?)\s+lúc\s+(?<timeStr>\d{1,2}(?:h|:\d{2})?(?:\s*(?:sáng|chiều|tối|trưa|nay|mai))?)/iu,
  );
  if (matchLúcContent && matchLúcContent.groups) {
    const rawContent = matchLúcContent.groups.reminderContent?.trim();
    const rawTime = matchLúcContent.groups.timeStr?.trim();

    if (rawContent && rawContent.length > 0 && rawTime && rawTime.length > 0) {
      // Extract content from the ORIGINAL normalized string (preserves case)
      // The regex matched on `lower` so we need to map indices back
      const contentStart = matchLúcContent.index! + matchLúcContent[0].indexOf(rawContent);
      const casePreservedContent = normalized.slice(
        contentStart,
        contentStart + rawContent.length,
      );
      const parsedTime = parseLúcTime(rawTime, now);
      if (parsedTime) {
        offsetMs = parsedTime.scheduledAt.getTime() - now.getTime();
        if (offsetMs < 0) offsetMs += 24 * 3600_000; // next day if passed
        reminderContent = casePreservedContent;
        timeDesc = parsedTime.timeDescription;
      }
    }
  }

  // Pattern: "Nhắc mình X phút/giây nữa ..."
  const matchNua = lower.match(/nhắc\s+\p{L}+\s+(\d+)\s*(p|phút|giây|giờ|h|tiếng|ngày)\s*(nữa|later)/iu);
  if (matchNua && matchNua[1] && matchNua[2]) {
    const num = parseInt(matchNua[1], 10);
    const unit = matchNua[2].toLowerCase();
    if (unit === "giây" || unit === "s") offsetMs = num * 1000;
    else if (unit === "p" || unit === "phút") offsetMs = num * 60_000;
    else if (unit === "h" || unit === "giờ" || unit === "tiếng") offsetMs = num * 3600_000;
    else if (unit === "ngày") offsetMs = num * 86400_000;
    timeDesc = `${num} ${unit} nữa`;
    // Extract the reminder content (everything after "nữa")
    let afterNua = content.slice(matchNua.index! + matchNua[0].length).trim();
    // Strip leading "nhắc <target>" prefix so content is just the reminder
    afterNua = afterNua.replace(/^nhắc\s+\p{L}+\s*/iu, "").trim();
    reminderContent = afterNua || "Nhắc bạn";
  }

  // Pattern: "nhắc/nhắn TARGET Xp nữa CONTENT" — SCHED1: verb-first + compact time
  const matchVerbTimeNua = lower.match(/(nhắc|nhắn|báo)\s+\p{L}+\s+(\d+)\s*(p|phút|giây|giờ|h|tiếng|ngày)\s*(nữa|later)/iu);
  if (matchVerbTimeNua && matchVerbTimeNua[2] && matchVerbTimeNua[3] && offsetMs === 0) {
    const num = parseInt(matchVerbTimeNua[2], 10);
    const unit = matchVerbTimeNua[3].toLowerCase();
    if (unit === "giây" || unit === "s") offsetMs = num * 1000;
    else if (unit === "p" || unit === "phút") offsetMs = num * 60_000;
    else if (unit === "h" || unit === "giờ" || unit === "tiếng") offsetMs = num * 3600_000;
    else if (unit === "ngày") offsetMs = num * 86400_000;
    timeDesc = `${num} ${unit} nữa`;
    let afterTime = content.slice(matchVerbTimeNua.index! + matchVerbTimeNua[0].length).trim();
    // Strip "nữa/later" if still present at start
    afterTime = afterTime.replace(/^(nữa|later)\s*/i, "").trim();
    // Strip leading pronoun only (not content words) — SCHED1 fix
    afterTime = afterTime.replace(/^(mình|tôi|tui|em|anh|chị|bạn)\s+/iu, "").trim();
    reminderContent = afterTime || "Nhắc bạn";
  }

  // Pattern: "X phút nữa nhắc/nhắn ..." — SCHED1: includes "nhắn" + compact "2p"
  const matchNumNua = lower.match(/(\d+)\s*(p|phút|giây|giờ|h)\s*(nữa|later)\s+(nhắc|nhắn|báo)/i);
  if (matchNumNua && matchNumNua[1] && matchNumNua[2] && offsetMs === 0) {
    const num = parseInt(matchNumNua[1], 10);
    const unit = matchNumNua[2].toLowerCase();
    if (unit === "giây" || unit === "s") offsetMs = num * 1000;
    else if (unit === "p" || unit === "phút") offsetMs = num * 60_000;
    else if (unit === "h" || unit === "giờ") offsetMs = num * 3600_000;
    timeDesc = `${num} ${unit} nữa`;
    let afterNua = content.slice(matchNumNua.index! + matchNumNua[0].length).trim();
    // For "X phút nữa nhắc/nhắn TARGET CONTENT", strip TARGET pronoun
    afterNua = afterNua.replace(/^\p{L}+\s+/u, "").trim();
    reminderContent = afterNua || "Nhắc bạn";
  }

  // Pattern: "sau X phút/p nhắc/nhắn ..." — SCHED1: "sau" prefix variant
  const matchSau = lower.match(/sau\s+(\d+)\s*(p|phút|giây|giờ|h|tiếng|ngày)\s+(nhắc|nhắn|báo|remind)/i);
  if (matchSau && matchSau[1] && matchSau[2] && offsetMs === 0) {
    const num = parseInt(matchSau[1], 10);
    const unit = matchSau[2].toLowerCase();
    if (unit === "giây" || unit === "s") offsetMs = num * 1000;
    else if (unit === "p" || unit === "phút") offsetMs = num * 60_000;
    else if (unit === "h" || unit === "giờ" || unit === "tiếng") offsetMs = num * 3600_000;
    else if (unit === "ngày") offsetMs = num * 86400_000;
    timeDesc = `${num} ${unit} nữa`;
    let afterVerb = content.slice(matchSau.index! + matchSau[0].length).trim();
    afterVerb = afterVerb.replace(/^\p{L}+\s+/u, "").trim();
    reminderContent = afterVerb || "Nhắc bạn";
  }

  if (offsetMs === 0) return null;

  const scheduledAt = new Date(now.getTime() + offsetMs);
  // Ensure minimum 10s in the future
  if (scheduledAt.getTime() - now.getTime() < 10_000) {
    scheduledAt.setTime(now.getTime() + 10_000);
    timeDesc = "10 giây nữa";
  }

  return { content: reminderContent, scheduledAt, timeDescription: timeDesc };
}

// ── Batch 8.1: Context-aware reminder pronoun resolution ─────────

/** Pronoun patterns that refer to previous context. */
const CONTEXT_PRONOUNS = [
  /việc\s+đó/i,
  /cái\s+đó/i,
  /chuyện\s+đó/i,
  /nội\s+dung\s+đó/i,
  /việc\s+ấy/i,
  /cái\s+ấy/i,
  /chuyện\s+ấy/i,
];

/**
 * Detect if user wants to create a reminder using context pronouns.
 * Example: "nhắc mình việc đó lúc 19h", "nhắc mình cái đó 7h tối"
 */
function detectContextReminderIntent(content: string): boolean {
  const lower = content.toLowerCase();
  const hasReminderWord = /nhắc|nhắn|báo/i.test(lower);
  if (!hasReminderWord) return false;
  const hasPronoun = CONTEXT_PRONOUNS.some((p) => p.test(lower));
  if (!hasPronoun) return false;
  const hasTime = /lúc\s+\d+|lúc\s+\d+h|\d+\s*(p|phút|giây|giờ|h|tiếng|ngày)\s*nữa|\d+h[^a-z]/i.test(lower);
  if (!hasTime) return false;
  return true;
}

/**
 * Parse time from a context-reminder message.
 * Handles: "lúc 19h", "lúc 19", "7h tối", "X phút nữa"
 */
function parseContextReminderTime(content: string): { offsetMs: number; timeDesc: string } | null {
  const lower = content.toLowerCase();
  const now = new Date();
  let offsetMs = 0;
  let timeDesc = "";

  // Pattern: "lúc 19h" or "lúc 19"
  const matchLuc = lower.match(/lúc\s+(\d+)\s*(h|giờ|g)?/i);
  if (matchLuc && matchLuc[1]) {
    let hour = parseInt(matchLuc[1], 10);
    const hasPm = /tối|chiều|pm/i.test(lower);
    if (hasPm && hour < 12) hour += 12;
    const target = new Date(now);
    target.setHours(hour, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    offsetMs = target.getTime() - now.getTime();
    timeDesc = `lúc ${hour}h`;
    if (offsetMs < 60_000) offsetMs = 60_000;
    return { offsetMs, timeDesc };
  }

  // Pattern: "X phút/giờ nữa"
  const matchNua = lower.match(/(\d+)\s*(p|phút|giây|giờ|h|tiếng)\s*nữa/i);
  if (matchNua && matchNua[1] && matchNua[2]) {
    const num = parseInt(matchNua[1], 10);
    const unit = matchNua[2].toLowerCase();
    if (unit === "giây" || unit === "s") offsetMs = num * 1000;
    else if (unit === "p" || unit === "phút") offsetMs = num * 60_000;
    else if (unit === "h" || unit === "giờ" || unit === "tiếng") offsetMs = num * 3600_000;
    timeDesc = `${num} ${unit} nữa`;
    if (offsetMs < 10_000) offsetMs = 10_000;
    return { offsetMs, timeDesc };
  }

  // Pattern: "lúc 7h tối"
  const matchNL = lower.match(/(\d+)\s*h\s*(tối|chiều|sáng|trưa)/i);
  if (matchNL && matchNL[1] && matchNL[2]) {
    let hour = parseInt(matchNL[1], 10);
    const period = matchNL[2].toLowerCase();
    if (period === "tối" || period === "chiều") { if (hour < 12) hour += 12; }
    const target = new Date(now);
    target.setHours(hour, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    offsetMs = target.getTime() - now.getTime();
    if (offsetMs < 60_000) offsetMs = 60_000;
    timeDesc = `lúc ${hour}h`;
    return { offsetMs, timeDesc };
  }

  return null;
}

/**
 * Resolve reminder content from recent conversation context.
 * Priority: OCR text > last assistant reply > last user message.
 */
async function resolveReminderContentFromContext(
  threadId: string,
): Promise<string | null> {
  try {
    const messages = await prisma.message.findMany({
      where: { threadId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { content: true, role: true, metadata: true, messageType: true },
    });

    // Priority 1: OCR metadata on recent image messages
    for (const msg of messages) {
      if (msg.messageType === "image" && msg.metadata) {
        try {
          const meta = JSON.parse(msg.metadata);
          if (meta?.vision?.ocrText && typeof meta.vision.ocrText === "string") {
            const text = meta.vision.ocrText.trim();
            if (text.length >= 3) {
              console.log(`[dispatcher] resolved context: OCR (${text.slice(0, 60)}...)`);
              return text;
            }
          }
        } catch { /* ignore */ }
      }
    }

    // Priority 2: Last assistant reply (topic-rich)
    for (const msg of messages) {
      if (msg.role === "assistant") {
        const text = msg.content.trim();
        if (text.length >= 5 && !text.startsWith("✅ Đã đặt lịch") && !text.startsWith("📷")) {
          if (/[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text)) {
            console.log(`[dispatcher] resolved context: assistant (${text.slice(0, 60)}...)`);
            return text;
          }
        }
      }
    }

    // Priority 3: Last user message
    for (const msg of messages) {
      if (msg.role === "user" && msg.messageType !== "image") {
        const text = msg.content.trim();
        if (text.length >= 3 && /[à-ỹđ]/i.test(text)) {
          console.log(`[dispatcher] resolved context: user (${text.slice(0, 60)}...)`);
          return text;
        }
      }
    }

    return null;
  } catch (err) {
    console.error(`[dispatcher] resolve context error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Reminder intent detection (query) ─────────────────────────────

const REMINDER_KEYWORDS = [
  "nhắc", "chưa nhắc", "sao chưa nhắc", "đã nhắc chưa",
  "lịch đâu", "sao không gửi", "gửi chưa", "nhắc nhở",
  "lịch nhắc", "có nhắc", "nhắc chưa", "sao chưa gửi",
];

function hasReminderIntent(content: string): boolean {
  const lower = content.toLowerCase();
  return REMINDER_KEYWORDS.some((k) => lower.includes(k));
}

// ── Schedule context pre-fetch ───────────────────────────────────

interface ScheduleContext {
  hasData: boolean;
  summary: string;
}

async function fetchScheduleContext(threadId: string): Promise<ScheduleContext> {
  try {
    // Query recent successful executions for this thread
    const successExec = await prisma.scheduleExecution.findMany({
      where: {
        targetId: threadId,
        status: "success",
        actualRunAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) },
      },
      orderBy: { actualRunAt: "desc" },
      take: 5,
      select: { messageContent: true, actualRunAt: true },
    });

    // Query recent failed executions
    const failedExec = await prisma.scheduleExecution.findMany({
      where: {
        targetId: threadId,
        status: "failed",
        plannedRunAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) },
      },
      orderBy: { plannedRunAt: "desc" },
      take: 3,
      select: { messageContent: true, errorMessage: true, plannedRunAt: true },
    });

    // Query pending/queued schedules
    const pendingSchedules = await prisma.schedule.findMany({
      where: {
        targetId: threadId,
        status: { in: ["scheduled", "active"] },
      },
      orderBy: { nextRunAt: "asc" },
      take: 5,
      select: { name: true, messageContent: true, nextRunAt: true, cronExpression: true },
    });

    if (successExec.length === 0 && failedExec.length === 0 && pendingSchedules.length === 0) {
      return {
        hasData: false,
        summary: "KHÔNG CÓ LỊCH NHẮC NÀO: Hệ thống chưa có lịch nhắc nào cho cuộc trò chuyện này.",
      };
    }

    const parts: string[] = [];
    parts.push("DỮ LIỆU LỊCH NHẮC THỰC TẾ (dùng thông tin này, không bịa):");

    if (successExec.length > 0) {
      parts.push("ĐÃ GỬI THÀNH CÔNG:");
      for (const e of successExec) {
        const time = e.actualRunAt ? new Date(e.actualRunAt).toLocaleString("vi-VN") : "?";
        parts.push(`- ${time}: "${e.messageContent.slice(0, 80)}"`);
      }
    }

    if (failedExec.length > 0) {
      parts.push("GỬI THẤT BẠI:");
      for (const e of failedExec) {
        const time = e.plannedRunAt ? new Date(e.plannedRunAt).toLocaleString("vi-VN") : "?";
        parts.push(`- ${time}: "${e.messageContent.slice(0, 80)}" → lỗi: ${e.errorMessage?.slice(0, 60) || "không rõ"}`);
      }
    }

    if (pendingSchedules.length > 0) {
      parts.push("ĐANG CHỜ GỬI:");
      for (const s of pendingSchedules) {
        const time = s.nextRunAt ? new Date(s.nextRunAt).toLocaleString("vi-VN") : "chưa có giờ";
        const repeat = s.cronExpression ? ` (lặp: ${s.cronExpression})` : "";
        parts.push(`- ${time}: "${s.messageContent.slice(0, 80)}"${repeat}`);
      }
    }

    parts.push("QUAN TRỌNG: Chỉ trả lời dựa trên dữ liệu trên. Nếu user hỏi về nhắc/lịch, hãy dùng thông tin này. Không gọi tool session_search/cronjob list.");
    return { hasData: true, summary: parts.join("\n") };
  } catch {
    return { hasData: false, summary: "KHÔNG THỂ KIỂM TRA: Hệ thống lịch nhắc tạm thời không truy cập được." };
  }
}

// ── Unsupported system claim detection ──────────────────────────────
// Extracted to unsupported-claim-guard.service.ts (shared with AgentBridge).
// Imported below; call sites (hasUnsupportedSystemClaim / hasScheduleEvidence)
// are unchanged.

// ── Phase 5: structured AgentBridge (flag-gated, default OFF) ────────
/**
 * Try the structured AgentBridge. Returns a {reply, confidence} on success, or
 * null to signal the caller to fall back to the text-only HermesChatAdapter.
 * Any error / safe-fallback → null (never throws), so the text-only path is
 * never broken. Only invoked when config.hermesAgentBridge.enabled is true.
 */
async function tryAgentBridgeReply(
  msg: NormalizedMessage,
  content: string,
  recentMessages: string[],
  scheduleContext: string | undefined,
): Promise<{ reply: string; confidence?: number } | null> {
  try {
    const { getAgentBridge } = await import("./agent-bridge/index.js");
    const role = ((msg as any).__principalRole ?? "form_only") as
      | "form_only"
      | "basic_chat"
      | "advanced"
      | "admin";
    const result = await getAgentBridge().run({
      threadId: msg.threadId,
      threadType: msg.threadType,
      senderId: msg.senderId,
      senderName: msg.senderName,
      role,
      principalId: msg.senderId ?? null,
      content,
      recentMessages,
      scheduleContext,
      agentName: "hermes",
      relatedMessageId: msg.zaloMessageId ?? undefined,
      runtime: { dryRun: getCurrentEffectiveDryRun(), live: false },
    });
    // On any safe fallback (error/timeout/too-many-rounds/claim), defer to the
    // proven text-only path rather than sending the bridge's canned fallback.
    if (result.usedFallback) return null;
    const text = (result.text ?? "").trim();
    if (!text) return null;
    return { reply: text, confidence: result.confidence };
  } catch (err: unknown) {
    console.error(`[dispatcher] AgentBridge error (fallback to text-only): ${(err as Error)?.message ?? "unknown"}`);
    return null;
  }
}

// ── Batch Processing ────────────────────────────────────────────────

/**
 * Process a ready batch: claim it, build synthetic message from combined content,
 * and run through the full pipeline (rules, reminders, Hermes).
 */
async function processBatchNow(
  batchId: string,
  threadId: string,
  threadType: "user" | "group",
): Promise<void> {
  const { claimBatch, getBatch, completeBatch } = await import("./message-batch.service.js");

  const claimed = await claimBatch(batchId);
  if (!claimed) {
    console.log(`[batch] batch ${batchId.slice(0, 8)} already claimed by another worker`);
    return;
  }

  const batch = await getBatch(batchId);
  if (!batch || !batch.combinedText) {
    console.error(`[batch] batch ${batchId.slice(0, 8)} not found or has no combined text`);
    return;
  }

  console.log(`[batch] processing batch ${batchId.slice(0, 8)}: ${batch.messageCount} msgs, ${batch.totalChars} chars, thread=${threadId}`);

  // Build synthetic NormalizedMessage from combined batch text
  const messageIds: string[] = JSON.parse(batch.messageIds);
  const syntheticMsg: NormalizedMessage = {
    zaloMessageId: messageIds[messageIds.length - 1] ?? null, // Use last message ID for reply threading
    threadId,
    threadType,
    senderId: "",  // Will be resolved by dispatcher from last message
    content: batch.combinedText,
    messageType: "text",
    rawMetadata: JSON.stringify({ source: "message_batch", batchId, messageIds }),
    mentions: undefined,
  };

  // Update AgentTask metadata to include batch info
  const batchMeta = {
    source: "message_batch",
    batchId,
    messageCount: batch.messageCount,
    messageIds,
    combinedTextPreview: batch.combinedText.slice(0, 200),
  };

  try {
    // Reset cooldown so the synthetic batch message isn't blocked
    // (cooldown was set when the batch became ready)
    clearCooldown(threadId).catch(() => {});

    // Run through the standard pipeline
    const result = await handleIncomingMessage(syntheticMsg);

    // Complete the batch
    await completeBatch(batchId, {
      dispatched: result.dispatched,
      reason: result.reason,
      messageCount: batch.messageCount,
      totalChars: batch.totalChars,
    });

    console.log(
      `[batch] batch ${batchId.slice(0, 8)} processed: ` +
      `dispatched=${result.dispatched} reason=${result.reason ?? "none"}`,
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[batch] batch ${batchId.slice(0, 8)} processing error: ${errorMsg}`);

    await completeBatch(batchId, {
      dispatched: false,
      reason: "batch_processing_error",
      error: errorMsg.slice(0, 500),
      messageCount: batch.messageCount,
      totalChars: batch.totalChars,
    });
  }
}

// ── Dispatcher ──────────────────────────────────────────────────────

export async function handleIncomingMessage(
  msg: NormalizedMessage,
  selfUserId?: string | null,
): Promise<{ dispatched: boolean; reason?: string }> {
  const safe = safetyCheck(msg, selfUserId);

  if (!safe.allowed) {
    console.log(`[dispatcher] skip: ${safe.reason} (thread=${msg.threadId})`);

    // ── Cooldown audit: record block decision for visibility ──
    if (safe.reason === "cooldown") {
      saveOutboundRecord({
        threadId: msg.threadId,
        threadType: (msg.threadType as "user" | "group") || "user",
        content: redactPreview(msg.content, 500),
        sentMessageId: "",
        source: "auto_reply",
        dryRun: getCurrentEffectiveDryRun(),
        decision: "block",
        reason: "cooldown",
      }).catch(() => {
        // Non-fatal — audit best-effort
      });
    }

    return { dispatched: false, reason: safe.reason };
  }

  // ── Heartbeat: message pipeline active ─────────────────────────
  import("./heartbeat.service.js").then(({ heartbeatOk }) =>
    heartbeatOk("messagePipeline", {
      threadId: msg.threadId,
      threadType: msg.threadType,
      messageType: msg.messageType ?? "text",
      contentLength: msg.content?.length ?? 0,
    }),
  ).catch(() => {});

  // ── Group safety gate (async — mention check + reply window) ──
  const group = await groupGateCheck(msg, selfUserId);
  if (!group.allowed) {
    console.log(`[dispatcher] skip group-gate: ${group.reason} (thread=${msg.threadId})`);
    return { dispatched: false, reason: group.reason };
  }

  // ═══════════════════════════════════════════════════════════════════
  // P1.1 — Permission gate (after safetyCheck + groupGate, before dispatch)
  // ═══════════════════════════════════════════════════════════════════
  // ── KI-H1: identity guard BEFORE principal resolution ────────────────
  // If we cannot confidently identify the sender, never elevate. In particular a
  // BLANK senderId in a GROUP must not fall back to the groupId as a principal id
  // (resolvePrincipal would otherwise use threadId), which could inherit a role
  // attached to that group. Force the lowest role and skip elevation entirely.
  const cannotIdentifySender =
    msg.identityConfidence === "unknown" ||
    (!msg.senderId && msg.threadType === "group");
  if (cannotIdentifySender) {
    (msg as any).__principalRole = "form_only";
    (msg as any).__principalStatus = "active";
    console.log(
      `[dispatcher] identity guard: form_only (thread=${msg.threadId} type=${msg.threadType} ` +
      `conf=${msg.identityConfidence ?? "n/a"} hasSender=${!!msg.senderId})`,
    );
  } else {
  // Resolve the effective role for this sender.
  // Permission is matched by senderId — displayName NEVER used.
  try {
    const { resolvePrincipal, checkPermission, isBlocked, logPermissionDecision } =
      await import("./principal.service.js");

    const ctx = await resolvePrincipal(msg.senderId, msg.threadId);

    // Blocked → silent skip
    if (isBlocked(ctx.status)) {
      logPermissionDecision({
        allowed: false,
        reason: "blocked",
        currentRole: ctx.role,
        action: "any",
        senderId: msg.senderId,
        threadId: msg.threadId,
        threadType: msg.threadType,
      });
      console.log(`[dispatcher] skip blocked: senderId=${msg.senderId} thread=${msg.threadId}`);
      return { dispatched: false, reason: "blocked" };
    }

    // Attach resolved role to message metadata so downstream (Hermes, rules) can use it
    (msg as any).__principalRole = ctx.role;
    (msg as any).__principalStatus = ctx.status;

    console.log(
      `[dispatcher] principal resolved: senderId=${msg.senderId.slice(0, 12)}… ` +
      `role=${ctx.role} status=${ctx.status} fromDb=${ctx.fromDb} thread=${msg.threadId}`,
    );
  } catch (err: unknown) {
    // Permission lookup error → fail safe (form_only default)
    const msg2 = err instanceof Error ? err.message : String(err);
    console.error(`[dispatcher] principal lookup failed: ${msg2} — using form_only default`);
    (msg as any).__principalRole = "form_only";
  }
  } // end identity guard (else)

  // Create agent task
  const task = await agentTaskService.createAgentTask({
    agentName: "hermes",
    taskType: "zalo_auto_reply",
    input: {
      threadId: msg.threadId,
      threadType: msg.threadType,
      senderId: msg.senderId,
      senderName: msg.senderName,
      contentPreview: redactPreview(msg.content, 200),
      zaloMessageId: msg.zaloMessageId,
    },
    messageId: msg.zaloMessageId ?? undefined,
  });

  // ── Batch 14: Message Batching / Debounce ──────────────────
  // If batching is enabled and this is a text DM, add to batch
  // and return early. The batch worker will process later.
  // Skip if this is a synthetic message from batch processing itself.
  const batchingCfg = getEffectiveBatchingConfig();
  if (batchingCfg.enabled && msg.messageType === "text" && !msg.rawMetadata?.includes("message_batch")) {
    try {
      const { addToBatch } = await import("./message-batch.service.js");
      const batchResult = await addToBatch(msg);
      if (batchResult) {
        // Message was added to a batch — skip individual processing
        await agentTaskService.markAgentTaskCompleted(task.id, {
          skipped: true,
          reason: "added_to_batch",
          batchId: batchResult.batchId,
          batchMessageCount: batchResult.messageCount,
          batchIsNew: batchResult.isNew,
          batchIsReady: batchResult.isReady,
          dryRun: getCurrentEffectiveDryRun(),
        });

        // If batch became ready due to limits, set cooldown to prevent
        // immediate next message from also being processed individually
        if (batchResult.isReady) {
            // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
        }

        console.log(
          `[dispatcher] message added to batch ${batchResult.batchId.slice(0, 8)} ` +
          `(${batchResult.messageCount}/${batchingCfg.maxMessages} msgs, ` +
          `${batchResult.totalChars}/${batchingCfg.maxChars} chars) ` +
          `ready=${batchResult.isReady} thread=${msg.threadId}`,
        );

        // If batch is ready (limits hit), process immediately
        if (batchResult.isReady) {
          processBatchNow(batchResult.batchId, msg.threadId, msg.threadType).catch((err) => {
            console.error(`[dispatcher] batch immediate processing error: ${err instanceof Error ? err.message : String(err)}`);
          });
        }

        return { dispatched: false, reason: "batched" };
      }
    } catch (batchErr: unknown) {
      // Batch error is non-fatal — fall through to normal pipeline
      console.error(`[dispatcher] batch error, falling through to normal pipeline: ${batchErr instanceof Error ? batchErr.message : String(batchErr)}`);
    }
  }

  // ── Image Understanding Pipeline ─────────────────────────
  if (msg.messageType === "image" && msg.imageUrl) {
    // Check thread settings for image understanding permission
    if (!group.settings?.allowImageUnderstanding) {
      console.log(`[dispatcher] skip: image understanding not allowed (thread=${msg.threadId})`);
      await agentTaskService.markAgentTaskCompleted(task.id, {
        skipped: true,
        reason: "image_understanding_disabled",
        dryRun: getCurrentEffectiveDryRun(),
      });
      return { dispatched: false, reason: "image_understanding_disabled" };
    }

    if (!config.vision.enabled) {
      console.log(`[dispatcher] skip: vision not enabled (thread=${msg.threadId})`);
      await agentTaskService.markAgentTaskCompleted(task.id, {
        skipped: true,
        reason: "vision_disabled",
        dryRun: getCurrentEffectiveDryRun(),
      });
      return { dispatched: false, reason: "vision_disabled" };
    }

    try {
      // Download image safely
      const { downloadImage, cleanupDownloadedImage } = await import("./image-download.service.js");
      const downloadResult = await downloadImage(
        msg.imageUrl,
        msg.threadId,
        msg.zaloMessageId ?? "unknown",
      );

      if (!downloadResult.success) {
        console.error(`[dispatcher] image download failed: ${downloadResult.error} (thread=${msg.threadId})`);
        await agentTaskService.markAgentTaskCompleted(task.id, {
          skipped: true,
          reason: "image_download_failed",
          downloadError: downloadResult.error,
          dryRun: getCurrentEffectiveDryRun(),
        });

        // Send fallback reply via unified dispatcher
        sendOutbound({
          threadId: msg.threadId,
          threadType: msg.threadType,
          source: "image",
          content: "Mình không tải được ảnh bạn gửi. Bạn thử gửi lại nhé.",
          relatedMessageId: msg.zaloMessageId ?? undefined,
          taskId: task.id,
          metadata: { downloadError: downloadResult.error },
        }).catch(() => {});

          // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
        return { dispatched: false, reason: "image_download_failed" };
      }

      // Analyze image
      const { analyzeImage } = await import("./image-understanding.service.js");
      const caption = msg.content !== "[Ảnh Zalo]" ? msg.content : undefined;
      const prompt = caption
        ? `Người dùng nói: "${caption}". Hãy mô tả nội dung ảnh bằng tiếng Việt và trả lời câu hỏi của người dùng nếu có. Liệt kê chữ viết trong ảnh nếu có.`
        : undefined;

      const visionResult = await analyzeImage(downloadResult.filePath!, prompt);

      // ── Gap 1: Save OCR/vision to incoming Message metadata ──
      // Update the original inbound message so conversation context
      // can surface OCR text and description in subsequent turns.
      try {
        if (msg.zaloMessageId) {
          const visionMeta: Record<string, unknown> = {};
          if (visionResult.description) visionMeta.description = visionResult.description;
          if (visionResult.ocrText) visionMeta.ocrText = visionResult.ocrText;
          if (visionResult.confidence !== undefined) visionMeta.confidence = visionResult.confidence;
          if (visionResult.success) {
            visionMeta.analyzed = true;
          }
          if (Object.keys(visionMeta).length > 0) {
            await prisma.message.updateMany({
              where: { zaloMessageId: msg.zaloMessageId },
              data: {
                metadata: JSON.stringify({
                  source: "zalo_receive",
                  vision: visionMeta,
                }),
              },
            });
            console.log(`[dispatcher] vision metadata saved to message ${msg.zaloMessageId.slice(0, 12)}...`);
          }
        }
      } catch (metaErr) {
        console.error(`[dispatcher] failed to save vision metadata: ${metaErr instanceof Error ? metaErr.message : String(metaErr)}`);
      }

      // Build reply from vision result
      let replyText = "";
      if (visionResult.success) {
        const parts: string[] = [];
        if (visionResult.description) {
          parts.push(`📷 Mô tả ảnh:\n${visionResult.description}`);
        }
        if (visionResult.ocrText && visionResult.ocrText.trim()) {
          parts.push(`📝 Chữ trong ảnh:\n${visionResult.ocrText}`);
        }
        replyText = parts.join("\n\n") || "Mình đã xem ảnh nhưng chưa phân tích được nội dung.";
      } else {
        replyText = "Mình chưa phân tích được ảnh này. Bạn thử mô tả bằng chữ nhé.";
      }

      // Build result for AgentTask
      const imageResult: Record<string, unknown> = {
        replyPreview: replyText.slice(0, 200),
        confidence: visionResult.confidence ?? 0.5,
        dryRun: getCurrentEffectiveDryRun(),
        imagePath: downloadResult.filePath,
        imageHash: downloadResult.hash,
        imageDescription: visionResult.description,
        ocrText: visionResult.ocrText,
        provider: visionResult.provider,
        model: visionResult.model,
        imageSizeBytes: downloadResult.sizeBytes,
        imageMimeType: downloadResult.mimeType,
      };

      // Unified outbound via dispatcher for image analysis reply (R1.2)
      const obResult = await sendOutbound({
        threadId: msg.threadId,
        threadType: msg.threadType,
        source: "image",
        content: replyText,
        relatedMessageId: msg.zaloMessageId ?? undefined,
        taskId: task.id,
        metadata: { imageDescription: visionResult.description, provider: visionResult.provider },
      });
      imageResult.sentMessageId = obResult.sentMessageId;
      imageResult.sendSuccess = obResult.success;
      imageResult.dryRun = obResult.dryRun;

      await agentTaskService.markAgentTaskCompleted(task.id, imageResult);
      console.log(
        `[dispatcher] image processed: ` +
        `provider=${visionResult.provider} confidence=${visionResult.confidence} ` +
        `(thread=${msg.threadId})`,
      );

        // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
      return { dispatched: true };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[dispatcher] image pipeline error: ${errorMsg}`);
      await agentTaskService.markAgentTaskCompleted(task.id, {
        skipped: true,
        reason: "image_pipeline_error",
        error: errorMsg.slice(0, 500),
        dryRun: getCurrentEffectiveDryRun(),
      });
        // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
      return { dispatched: false, reason: "image_pipeline_error" };
    }
  }

  // ── Zalo File Ingestion Pipeline (Batch 13) ──────────────────
  if (msg.messageType === "file" && msg.fileUrl) {
    // Check thread settings for document understanding permission
    if (!group.settings?.allowDocumentUnderstanding) {
      console.log(`[dispatcher] skip: document understanding not allowed (thread=${msg.threadId})`);
      await agentTaskService.markAgentTaskCompleted(task.id, {
        skipped: true,
        reason: "document_understanding_disabled",
        dryRun: getCurrentEffectiveDryRun(),
      });
      return { dispatched: false, reason: "document_understanding_disabled" };
    }

    if (!config.document?.enabled) {
      console.log(`[dispatcher] skip: document ingestion disabled (thread=${msg.threadId})`);
      await agentTaskService.markAgentTaskCompleted(task.id, {
        skipped: true,
        reason: "document_ingestion_disabled",
        dryRun: getCurrentEffectiveDryRun(),
      });
      return { dispatched: false, reason: "document_ingestion_disabled" };
    }

    // Validate file extension
    const ext = msg.fileExtension;
    if (!ext || !config.document.allowedExtensions.includes(ext)) {
      console.log(`[dispatcher] skip: unsupported file extension .${ext ?? "?"} (thread=${msg.threadId})`);
      await agentTaskService.markAgentTaskCompleted(task.id, {
        skipped: true,
        reason: "unsupported_extension",
        fileExtension: ext ?? "unknown",
        dryRun: getCurrentEffectiveDryRun(),
      });
      // Notify user about unsupported file via unified dispatcher
      sendOutbound({
        threadId: msg.threadId,
        threadType: msg.threadType,
        source: "file",
        content: `Mình chưa hỗ trợ đọc file .${ext ?? "này"}. Các định dạng hỗ trợ: PDF, DOCX, TXT, MD, CSV, PPTX, XLSX.`,
        relatedMessageId: msg.zaloMessageId ?? undefined,
        taskId: task.id,
        metadata: { unsupportedExtension: ext ?? "unknown" },
      }).catch(() => {});
        // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
      return { dispatched: false, reason: "unsupported_extension" };
    }

    try {
      // Download file safely
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { createHash } = await import("node:crypto");
      const { basename } = await import("node:path");

      const safeDir = config.document.allowedBaseDir;
      await mkdir(safeDir, { recursive: true });

      // Determine safe filename
      const safeFileName = msg.fileName || `zalo-file-${Date.now()}.${ext}`;
      // Block sensitive filenames
      const blockedPatterns = [/^\.env/i, /session/i, /credentials/i, /token/i, /secret/i, /key$/i, /passwd/i, /shadow/i];
      for (const p of blockedPatterns) {
        if (p.test(safeFileName)) {
          throw new Error(`Blocked file name pattern: ${safeFileName}`);
        }
      }

      const destPath = `${safeDir}/${safeFileName}`;

      // Download file from Zalo URL
      console.log(`[dispatcher] downloading file: ${msg.fileUrl} → ${destPath}`);
      const response = await fetch(msg.fileUrl, {
        signal: AbortSignal.timeout(30_000), // 30s download timeout
      });
      if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const fileSize = buffer.length;

      // Size check
      const maxBytes = (config.document.maxSizeMB || 50) * 1024 * 1024;
      if (fileSize > maxBytes) {
        throw new Error(`File too large: ${(fileSize / 1024 / 1024).toFixed(1)}MB > ${config.document.maxSizeMB}MB`);
      }

      await writeFile(destPath, buffer);
      console.log(`[dispatcher] file downloaded: ${safeFileName} (${fileSize}B)`);

      // Create document + job via ingestDocument
      const { ingestDocument: docIngest } = await import("./document-ingestion.service.js");
      const ingestResult = await docIngest(destPath, {
        source: "zalo",
        threadId: msg.threadId,
        messageId: msg.zaloMessageId ?? undefined,
      });

      const fileResult: Record<string, unknown> = {
        documentId: ingestResult.documentId,
        jobId: ingestResult.jobId,
        method: ingestResult.method,
        fileName: ingestResult.fileName,
        fileSize,
        fileExtension: ext,
        dryRun: getCurrentEffectiveDryRun(),
        source: "zalo_file",
        zaloMessageId: msg.zaloMessageId,
      };

      // Unified outbound via dispatcher for file confirmation (R1.2)
      const replyText = `✅ Đã nhận tài liệu "${ingestResult.fileName}" và đang xử lý.\nSau khi xong bạn có thể hỏi mình về nội dung.`;
      const obResult = await sendOutbound({
        threadId: msg.threadId,
        threadType: msg.threadType,
        source: "file",
        content: replyText,
        relatedMessageId: msg.zaloMessageId ?? undefined,
        taskId: task.id,
        metadata: { documentId: ingestResult.documentId, fileName: ingestResult.fileName },
      });
      fileResult.sentMessageId = obResult.sentMessageId;
      fileResult.sendSuccess = obResult.success;
      fileResult.dryRun = obResult.dryRun;
      fileResult.replyPreview = replyText.slice(0, 200);
      await agentTaskService.markAgentTaskCompleted(task.id, fileResult);

        // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
      return { dispatched: true };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[dispatcher] file ingestion error: ${errorMsg}`);

      await agentTaskService.markAgentTaskCompleted(task.id, {
        skipped: true,
        reason: "file_ingestion_error",
        error: errorMsg.slice(0, 500),
        fileUrl: msg.fileUrl?.slice(0, 200),
        dryRun: getCurrentEffectiveDryRun(),
      });

      // Send error notification via unified dispatcher
      sendOutbound({
        threadId: msg.threadId,
        threadType: msg.threadType,
        source: "file",
        content: "Mình nhận được file nhưng chưa xử lý được. Bạn thử lại sau nhé.",
        relatedMessageId: msg.zaloMessageId ?? undefined,
        taskId: task.id,
        metadata: { error: errorMsg.slice(0, 200) },
      }).catch(() => {});

        // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
      return { dispatched: false, reason: "file_ingestion_error" };
    }
  }

  // ── Gap 3: Load conversation state early ──────────────────
  // Check for active pending state BEFORE create-reminder keyword routing.
  // Active state takes priority — don't let keyword rules steal the turn.
  let activeConvState: ConversationState | null = null;
  try {
    const { getConversationState } = await import("./thread-conversation-state.service.js");
    activeConvState = await getConversationState(msg.threadId);
    if (activeConvState) {
      console.log(`[dispatcher] active conversation state: intent=${activeConvState.pendingIntent} ` +
        `missingSlots=${JSON.stringify(activeConvState.missingSlots)} (thread=${msg.threadId})`);
    }
  } catch (stateErr) {
    // Non-fatal — proceed without state
    console.error(`[dispatcher] failed to load conversation state: ${stateErr instanceof Error ? stateErr.message : String(stateErr)}`);
  }

  // ── Create-reminder flow: parse + create real schedule ─────
  // Do NOT call Hermes for create-reminder intents — Admin Center
  // creates the schedule directly, then replies with the result.
  // BUT: if there's an active conversation state pending, skip keyword routing
  // and let Hermes handle the turn (state context takes priority).
  if (!activeConvState && detectCreateReminderIntent(msg.content)) {
    const parsed = parseReminderFromMessage(msg.content);
    if (parsed) {
      try {
        const schedule = await scheduleService.createSchedule({
          name: parsed.content.slice(0, 50),
          type: "zalo_message",
          scheduledAt: parsed.scheduledAt.toISOString(),
          messageContent: parsed.content,
          targetId: msg.threadId,
          targetName: msg.threadName || msg.senderName || undefined,
          repeatEnabled: false,
          createdBy: "ai",
          originalCommand: msg.content,
          metadata: JSON.stringify({
            source: "zalo_auto_reply_create_reminder",
            threadType: msg.threadType,
            threadId: msg.threadId,
            createdFromMessageId: msg.zaloMessageId,
          }),
        });

        // Create the job so the worker picks it up
        const job = await jobService.createScheduleJob({
          scheduleId: schedule.id,
          scheduleVersion: schedule.version,
          type: "zalo_message",
          scheduledAt: parsed.scheduledAt,
        });

        const replyText = `✅ Đã đặt lịch nhắc: "${parsed.content}" sau ${parsed.timeDescription}.

Lịch ID: ${schedule.id.slice(0, 8)}...`;

        const createResult: Record<string, unknown> = {
          replyPreview: replyText.slice(0, 200),
          confidence: 1.0,
          dryRun: getCurrentEffectiveDryRun(),
          scheduleId: schedule.id,
          jobId: job.id,
          scheduleCreated: true,
        };

        // Unified outbound via dispatcher for reminder confirmation (R1.2)
        const obResult = await sendOutbound({
          threadId: msg.threadId,
          threadType: msg.threadType,
          source: "reminder",
          content: replyText,
          relatedMessageId: msg.zaloMessageId ?? undefined,
          taskId: task.id,
          metadata: { scheduleId: schedule.id, jobId: job.id },
        });
        createResult.sentMessageId = obResult.sentMessageId;
        createResult.sendSuccess = obResult.success;
        createResult.dryRun = obResult.dryRun;
        await agentTaskService.markAgentTaskCompleted(task.id, createResult);
        console.log(`[dispatcher] schedule-created: ${schedule.id} msgId=${obResult.sentMessageId} (thread=${msg.threadId})`);

          // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
        return { dispatched: true };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failReply = "Mình chưa tạo được lịch nhắc trong hệ thống. Bạn thử nói lại rõ thời gian và nội dung nhé.";
        const failResult: Record<string, unknown> = {
          replyPreview: failReply,
          confidence: 1.0,
          dryRun: getCurrentEffectiveDryRun(),
          scheduleCreationFailed: true,
          error: errorMsg.slice(0, 200),
        };

        // Unified outbound via dispatcher for failure reply (R1.2)
        const obFailResult = await sendOutbound({
          threadId: msg.threadId,
          threadType: msg.threadType,
          source: "reminder",
          content: failReply,
          relatedMessageId: msg.zaloMessageId ?? undefined,
          taskId: task.id,
          metadata: { scheduleCreationFailed: true, error: errorMsg.slice(0, 200) },
        });
        failResult.sentMessageId = obFailResult.sentMessageId;
        failResult.sendSuccess = obFailResult.success;
        failResult.dryRun = obFailResult.dryRun;
        await agentTaskService.markAgentTaskCompleted(task.id, failResult);

        console.error(`[dispatcher] schedule-creation failed: ${errorMsg}`);
          // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
        return { dispatched: true };
      }
    }
    // Fall through to Hermes if parsing failed
  }

  // ── Batch 8.1: Context-aware reminder ──────────────────────────
  // Handles: "nhắc mình việc đó lúc 19h", "nhắc mình cái đó 7h tối"
  if (!activeConvState && detectContextReminderIntent(msg.content)) {
    const timeParsed = parseContextReminderTime(msg.content);
    if (timeParsed) {
      const resolvedContent = await resolveReminderContentFromContext(msg.threadId);
      if (resolvedContent) {
        try {
          const scheduledAt = new Date(Date.now() + timeParsed.offsetMs);
          const schedule = await scheduleService.createSchedule({
            name: resolvedContent.slice(0, 50),
            type: "zalo_message",
            scheduledAt: scheduledAt.toISOString(),
            messageContent: resolvedContent,
            targetId: msg.threadId,
            targetName: msg.threadName || msg.senderName || undefined,
            repeatEnabled: false,
            createdBy: "ai",
            originalCommand: msg.content,
            metadata: JSON.stringify({
              source: "zalo_auto_reply_context_reminder",
              threadType: msg.threadType,
              threadId: msg.threadId,
              createdFromMessageId: msg.zaloMessageId,
              resolvedFrom: "conversation_context",
            }),
          });

          const job = await jobService.createScheduleJob({
            scheduleId: schedule.id,
            scheduleVersion: schedule.version,
            type: "zalo_message",
            scheduledAt,
          });

          const replyText = `✅ Đã đặt lịch nhắc: "${resolvedContent.slice(0, 80)}" ${timeParsed.timeDesc}.\n\nLịch ID: ${schedule.id.slice(0, 8)}...`;

          const ctxResult: Record<string, unknown> = {
            replyPreview: replyText.slice(0, 200),
            confidence: 1.0,
            dryRun: getCurrentEffectiveDryRun(),
            scheduleId: schedule.id,
            jobId: job.id,
            scheduleCreated: true,
            resolvedFromContext: true,
            resolvedContent: resolvedContent.slice(0, 200),
          };

          // Unified outbound via dispatcher (R1.1)
          const obResult = await sendOutbound({
            threadId: msg.threadId,
            threadType: msg.threadType,
            source: "reminder",
            content: replyText,
            relatedMessageId: msg.zaloMessageId ?? undefined,
            taskId: task.id,
            metadata: { scheduleId: schedule.id, jobId: job.id, resolvedFromContext: true },
          });
          ctxResult.sentMessageId = obResult.sentMessageId;
          ctxResult.sendSuccess = obResult.success;
          ctxResult.dryRun = obResult.dryRun;
          await agentTaskService.markAgentTaskCompleted(task.id, ctxResult);
          console.log(`[dispatcher] context-reminder created: ${schedule.id} msgId=${obResult.sentMessageId} (thread=${msg.threadId})`);

            // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
          return { dispatched: true };
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const failReply = `Mình hiểu bạn muốn nhắc "${resolvedContent.slice(0, 60)}" nhưng chưa tạo được lịch. Bạn thử lại nhé.`;
          const failResult: Record<string, unknown> = {
            replyPreview: failReply,
            confidence: 1.0,
            dryRun: getCurrentEffectiveDryRun(),
            scheduleCreationFailed: true,
            resolvedFromContext: true,
            error: errorMsg.slice(0, 200),
          };

          // Unified outbound via dispatcher for error message (R1.1)
          const obFailResult = await sendOutbound({
            threadId: msg.threadId,
            threadType: msg.threadType,
            source: "reminder",
            content: failReply,
            relatedMessageId: msg.zaloMessageId ?? undefined,
            taskId: task.id,
            metadata: { scheduleCreationFailed: true, error: errorMsg.slice(0, 200) },
          });
          failResult.sentMessageId = obFailResult.sentMessageId;
          failResult.sendSuccess = obFailResult.success;
          await agentTaskService.markAgentTaskCompleted(task.id, failResult);
            // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
          return { dispatched: true };
        }
      } else {
        // No context found — ask for clarification
        const clarifyReply = "Mình chưa rõ bạn muốn nhắc việc gì. Bạn nói rõ nội dung nhắc nhở nhé.";
        await agentTaskService.markAgentTaskCompleted(task.id, {
          replyPreview: clarifyReply,
          confidence: 1.0,
          dryRun: getCurrentEffectiveDryRun(),
          contextResolved: false,
          reason: "no_context_for_pronoun",
        });
        // Unified outbound via dispatcher for clarification (R1.2)
        sendOutbound({
          threadId: msg.threadId,
          threadType: msg.threadType,
          source: "reminder",
          content: clarifyReply,
          relatedMessageId: msg.zaloMessageId ?? undefined,
          taskId: task.id,
          metadata: { reason: "no_context_for_pronoun" },
        }).catch(() => {});
          // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
        return { dispatched: true };
      }
    }
    // Fall through to Hermes if time parsing failed
  }

  // ── Rule Engine ──────────────────────────────────────────────
  // Evaluate against enabled rules. Rules run AFTER safety gates
  // (allowlist, mention, cooldown) but BEFORE Hermes fallback.
  // Rule actions NEVER bypass safety gates or dryRun.
  try {
    const { evaluateRules, recordRuleExecution: saveRuleExec } = await import("./rule-engine.service.js");
    const ruleResult = await evaluateRules({
      threadId: msg.threadId,
      threadType: msg.threadType,
      senderId: msg.senderId,
      content: msg.content,
      messageType: msg.messageType ?? "text",
      messageId: msg.zaloMessageId ?? undefined,
    });

    if (ruleResult.matched && ruleResult.winningRule) {
      const winning = ruleResult.winningRule;

      // ── Rule action: ignore ─────────────────────────────────
      if (winning.actionType === "ignore") {
        await saveRuleExec({
          ruleId: winning.id,
          messageId: msg.zaloMessageId ?? undefined,
          threadId: msg.threadId,
          matched: true,
          actionTaken: "ignore",
          result: "ignored",
          metadata: { ruleName: winning.name, actionConfig: winning.actionConfig },
        });
        await agentTaskService.markAgentTaskCompleted(task.id, {
          skipped: true,
          reason: `rule_ignore:${winning.name}`,
          dryRun: getCurrentEffectiveDryRun(),
        });
        console.log(`[dispatcher] rule ignore: ${winning.name} (thread=${msg.threadId})`);
        return { dispatched: false, reason: `rule_ignore:${winning.name}` };
      }

      // ── Rule action: fixed_reply ─────────────────────────────
      if (winning.actionType === "fixed_reply") {
        const reply = (winning.actionConfig.reply as string) ?? "Xin chào!";

        // Unified outbound via dispatcher (R1.1)
        const obResult = await sendOutbound({
          threadId: msg.threadId,
          threadType: msg.threadType,
          source: "rule",
          content: reply,
          relatedMessageId: msg.zaloMessageId ?? undefined,
          taskId: task.id,
          metadata: { ruleId: winning.id, ruleName: winning.name },
        });

        const ruleResultPayload: Record<string, unknown> = {
          replyPreview: reply.slice(0, 200),
          confidence: 1.0,
          dryRun: obResult.dryRun,
          ruleId: winning.id,
          ruleName: winning.name,
          actionType: "fixed_reply",
          source: "rule_engine",
          sentMessageId: obResult.sentMessageId,
          sendSuccess: obResult.success,
        };

        await agentTaskService.markAgentTaskCompleted(task.id, ruleResultPayload);
        await saveRuleExec({
          ruleId: winning.id,
          messageId: msg.zaloMessageId ?? undefined,
          threadId: msg.threadId,
          matched: true,
          actionTaken: "fixed_reply",
          result: obResult.dryRun ? "dry_run" : (obResult.success ? "sent" : "send_failed"),
          errorCode: obResult.errorCode,
          errorMessage: obResult.error,
          metadata: { ruleName: winning.name, sentMessageId: obResult.sentMessageId, dryRun: obResult.dryRun },
        });

        // Update rule match count
        prisma.rule.update({
          where: { id: winning.id },
          data: { matchCount: { increment: 1 }, lastMatchedAt: new Date() },
        }).catch(() => {});

          // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
        return { dispatched: true };
      }

      // ── Rule action: route_to_hermes ─────────────────────────
      if (winning.actionType === "route_to_hermes") {
        // Continue to Hermes but with rule context
        console.log(`[dispatcher] rule route_to_hermes: ${winning.name} (thread=${msg.threadId})`);
        // Fall through to Hermes below
      }
    }
  } catch (ruleErr: unknown) {
    // Rule engine error — non-fatal, fall through to Hermes
    console.error(`[dispatcher] rule engine error: ${ruleErr instanceof Error ? ruleErr.message : String(ruleErr)}`);
  }

  try {
    // ── Load conversation context (recent messages) ──────────
    const { buildConversationContext, buildContextString } = await import("./conversation-context.service.js");
    const convContext = await buildConversationContext(msg.threadId);
    const contextString = buildContextString(convContext);

    // ── Reuse conversation state loaded earlier (Gap 3) ───────
    // activeConvState was populated before the create-reminder check.
    // No need to reload — just build the context string.
    const { buildStateContextString } = await import("./thread-conversation-state.service.js");
    const convState = activeConvState;
    const stateContext = convState ? buildStateContextString(convState) : "";

    // Build full context for Hermes (passed separately, NOT in content)
    const fullContext = [stateContext, contextString].filter(Boolean).join("\n");
    // PT2: Content MUST remain the raw user message only.
    // Never inject context/history into content — the adapter/model will echo it back.
    const effectiveContent = msg.content;

    // Pre-fetch schedule context for reminder-related queries
    let scheduleContext: string | undefined;
    if (hasReminderIntent(msg.content)) {
      const ctx = await fetchScheduleContext(msg.threadId);
      scheduleContext = ctx.summary;
    }

    // Generate reply: structured AgentBridge (flag-gated, default OFF) → text-only fallback.
    // With HERMES_AGENT_BRIDGE_ENABLED=false (default) this branch is skipped and
    // behavior is identical to the text-only path.
    const recentForReply = convContext.recentMessages.map((m) => `${m.role}: ${m.content}`);
    let chatReply: { reply: string; confidence?: number } | null = null;
    if (config.hermesAgentBridge.enabled) {
      chatReply = await tryAgentBridgeReply(msg, effectiveContent, recentForReply, scheduleContext);
    }
    if (!chatReply) {
      const adapter = getHermesChatAdapter();
      chatReply = await adapter.generateReply({
        threadId: msg.threadId,
        threadType: msg.threadType,
        senderId: msg.senderId,
        senderName: msg.senderName,
        content: effectiveContent,
        recentMessages: recentForReply,
        scheduleContext,
      });
    }

    // ── Safety: Empty reply ───────────────────────────────────────
    const replyText = (chatReply.reply ?? "").trim();
    if (replyText.length === 0) {
      await agentTaskService.markAgentTaskFailed(task.id, "empty_reply");
      console.log(`[dispatcher] skip: empty reply (thread=${msg.threadId})`);
      return { dispatched: false, reason: "empty_reply" };
    }

    // ── Safety: Unsupported system claim guard ──────────────────
    // Block replies that claim system actions (đã gửi, đã nhắc, etc.)
    // unless there is real DB evidence (ScheduleExecution with status=success).
    if (hasUnsupportedSystemClaim(replyText)) {
      const evidence = await hasScheduleEvidence(msg.threadId);
      if (!evidence) {
        const result: Record<string, unknown> = {
          replyPreview: replyText.slice(0, 200),
          needsReview: true,
          reason: "unsupported_system_claim",
          dryRun: true,
        };
        await agentTaskService.markAgentTaskCompleted(task.id, result);
        console.log(
          `[dispatcher] blocked: unsupported system claim (thread=${msg.threadId}, ` +
          `preview="${replyText.slice(0, 60)}...")`,
        );
        return { dispatched: false, reason: "unsupported_system_claim" };
      }
    }

    // ── Safety: Length truncation (>2000 Zalo char limit) ─────────
    const MAX_LENGTH = 2000;
    let finalReply = replyText;
    let truncated = false;
    if (finalReply.length > MAX_LENGTH) {
      finalReply = finalReply.slice(0, MAX_LENGTH - 14) + "... (đã cắt)";
      truncated = true;
    }

    // ── Safety: Confidence gate ───────────────────────────────────
    const cfg = config.hermesChat;
    const confidence = chatReply.confidence;

    const result: Record<string, unknown> = {
      replyPreview: finalReply.slice(0, 200),
      confidence,
      dryRun: getCurrentEffectiveDryRun(),
    };
    if (truncated) {
      result.truncated = true;
      result.originalLength = replyText.length;
    }

    // Low confidence → force dry-run, don't send real reply
    if (confidence !== undefined && confidence < cfg.minConfidence) {
      result.dryRun = true;
      result.confidenceTooLow = true;
      result.minConfidence = cfg.minConfidence;
      await agentTaskService.markAgentTaskCompleted(task.id, result);
      console.log(
        `[dispatcher] skip: confidence ${confidence} < ${cfg.minConfidence} (thread=${msg.threadId})`,
      );
      return { dispatched: false, reason: "confidence_too_low" };
    }

    // ── Unified outbound via dispatcher (R1.1) ──────────────────
    const obResult = await sendOutbound({
      threadId: msg.threadId,
      threadType: msg.threadType,
      source: "hermes",
      content: finalReply,
      relatedMessageId: msg.zaloMessageId ?? undefined,
      taskId: task.id,
      metadata: { confidence, truncated: truncated || undefined },
    });
    
    result.sentMessageId = obResult.sentMessageId;
    result.sendSuccess = obResult.success;
    result.dryRun = obResult.dryRun;

    if (obResult.success || obResult.dryRun) {
      await agentTaskService.markAgentTaskCompleted(task.id, result);
      console.log(`[dispatcher] ${obResult.dryRun ? "dry-run" : "sent"} reply: "${finalReply.slice(0, 60)}..." (thread=${msg.threadId})`);
    } else {
      await agentTaskService.markAgentTaskFailed(
        task.id,
        obResult.error ?? "SEND_FAILED",
      );
      console.error(`[dispatcher] send failed: ${obResult.error} (thread=${msg.threadId})`);
    }

    // ── Detect if this reply is a question (potential multi-turn) ──
    detectAndSetConversationState(msg.threadId, finalReply, msg.content).catch(() => {});

    // Cooldown (R5): handled by sendOutbound() — removed intermediate setCooldown
    return { dispatched: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Mark task with safe-failure result (no fabricated claims, no retry spam)
    const failResult: Record<string, unknown> = {
      safeReplySuppressed: true,
      adapterError: errorMsg.slice(0, 500),
      dryRun: getCurrentEffectiveDryRun(),
    };
    await agentTaskService.markAgentTaskCompleted(task.id, failResult);
    // Also store the raw error for debugging
    await agentTaskService.markAgentTaskFailed(task.id, errorMsg).catch(() => {});
    console.error(`[dispatcher] error (safe-suppressed): ${errorMsg}`);
    return { dispatched: false, reason: "hermes_error" };
  }
}

// ── Conversation state detection ──────────────────────────────────

/**
 * Detect if a bot reply is asking a question that starts a multi-turn conversation.
 * Sets ThreadConversationState so subsequent messages can fill in the answer.
 */
async function detectAndSetConversationState(
  threadId: string,
  botReply: string,
  userMessage: string,
): Promise<void> {
  try {
    const { setConversationState } = await import("./thread-conversation-state.service.js");

    // Detect weather location ask
    if (
      /(ở đâu|thành phố|tỉnh|địa chỉ|khu vực|location)/i.test(botReply) &&
      /thời tiết|weather|nhiệt độ|mưa|nắng/i.test(userMessage + " " + botReply)
    ) {
      await setConversationState({
        threadId,
        pendingIntent: "weather_location",
        missingSlots: ["location"],
        collectedSlots: { topic: "thời tiết" },
        lastAssistantQuestion: botReply.slice(0, 200),
      });
      console.log(`[dispatcher] conversation state set: weather_location (thread=${threadId})`);
      return;
    }

    // Detect general question asking for more info
    if (
      /(bạn đang|bạn ở|cho mình biết|nói mình nghe|bạn muốn|bạn cần)/i.test(botReply) &&
      botReply.includes("?")
    ) {
      await setConversationState({
        threadId,
        pendingIntent: "awaiting_clarification",
        missingSlots: ["clarification"],
        collectedSlots: {},
        lastAssistantQuestion: botReply.slice(0, 200),
        ttlMs: 2 * 60 * 1000, // 2 min TTL for clarification
      });
      console.log(`[dispatcher] conversation state set: awaiting_clarification (thread=${threadId})`);
      return;
    }
  } catch {
    // Non-fatal
  }
}

// ── Status getter for admin endpoint ────────────────────────────────

export async function getAutoReplyStatus() {
  const cfg = config.autoReply;
  const activeCooldownRows = await getActiveCooldowns();
  return {
    enabled: cfg.enabled,
    dryRun: cfg.dryRun,
    allowedThreads: cfg.allowedThreads,
    cooldownSeconds: cfg.cooldownSeconds,
    groupReplyWindowSeconds: cfg.groupReplyWindowSeconds,
    activeCooldowns: activeCooldownRows.map((r) => ({
      threadId: r.threadId,
      since: r.lastReplyAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    })),
    activeReplyWindows: getActiveReplyWindows(),
  };
}
