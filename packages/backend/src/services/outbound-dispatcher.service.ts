// =============================================================================
// OutboundDispatcher — unified entry point for ALL outbound replies
// =============================================================================
//
// Every reply path MUST route through this dispatcher. No direct sender.sendMessage().
//
// Flow:
//   trigger → build OutboundIntent → OutboundDispatcher.send()
//     → safety gate (allowlist, thread setting)
//     → cooldown check
//     → dryRun decision (getCurrentEffectiveDryRun)
//     → liveTest override (shouldSendLiveForThread)
//     → create Assistant Message (status: draft) [text only]
//     → create OutboundRecord
//     → if !dryRun → ZaloMessageSender.send*()
//     → update OutboundRecord (sentMessageId / error)
//     → update Message status [text only]
//     → heartbeat (messagePipeline)
// =============================================================================

import { basename } from "node:path";
import { prisma } from "../db.js";
import { getCurrentEffectiveDryRun } from "./runtime-config.service.js";
import { ZaloMessageSender } from "./zalo-message-sender.js";
import {
  saveOutboundRecord,
  findOutboundByIdempotencyKey,
  reserveOutboundRecord,
  updateOutboundRecordById,
  isUniqueViolation,
} from "./outbound-guardrails.service.js";
import { createHash } from "node:crypto";
import { heartbeatOk } from "./heartbeat.service.js";
import { getEffectiveCooldownSeconds } from "./runtime-config.service.js";
import { getThreadSettings } from "./thread-settings.service.js";
import { normalizeThreadId } from "./thread-id.js";
import { acquireCooldown, setCooldown as csSetCooldown, clearAllCooldowns } from "./cooldown.service.js";

// ── Types ────────────────────────────────────────────────────────────

export type OutboundSource =
  | "hermes"
  | "agent_tool"
  | "rule"
  | "reminder"
  | "batch"
  | "schedule"
  | "manual_test"
  | "manual_media"
  | "manual_voice"
  | "document"
  | "ocr"
  | "image"
  | "file"
  | "error_fallback"
  | "catch_all";

// ── Discriminated union for OutboundIntent ───────────────────────────

type BaseOutboundIntent = {
  threadId: string;
  threadType: "user" | "group";
  source: OutboundSource;
  relatedMessageId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
};

export type TextOutboundIntent = BaseOutboundIntent & {
  kind?: "text"; // default when omitted
  content: string;
};

export type MediaOutboundIntent = BaseOutboundIntent & {
  kind: "media";
  mediaType: "image" | "file";
  filePath: string;
  filename?: string;
  caption?: string;
};

export type VoiceOutboundIntent = BaseOutboundIntent & {
  kind: "voice";
  audioPath: string;
};

export type OutboundIntent =
  | TextOutboundIntent
  | MediaOutboundIntent
  | VoiceOutboundIntent;

export interface OutboundResult {
  success: boolean;
  dryRun: boolean;
  decision: "allow" | "block" | "skip";
  reason: string;
  sentMessageId?: string;
  outboundRecordId?: string;
  assistantMessageId?: string;
  error?: string;
  errorCode?: string;
}

// ── Cooldown (R5): unified DB-backed store ──────────────────────────
// Replaced in-memory Map with ThreadCooldown table.
// This is the SOLE cooldown authority — safetyCheck() no longer gates.
// All cooldown decisions happen here via acquireCooldown().

// Deprecated — kept for backward compat with tests that reference it.
// Tests should migrate to use clearAllCooldowns() from cooldown.service.ts.
export async function resetOutboundCooldowns(): Promise<void> {
  await clearAllCooldowns();
}

// ── Map source to OutboundRecord source ──────────────────────────────

function mapSource(source: OutboundSource): "auto_reply" | "agent_tool" | "schedule" | "media" | "manual" | "create_reminder" {
  switch (source) {
    case "hermes": return "auto_reply";
    case "agent_tool": return "agent_tool";
    case "rule": return "auto_reply";
    case "reminder": return "create_reminder";
    case "batch": return "auto_reply";
    case "schedule": return "schedule";
    case "manual_test": return "manual";
    case "manual_media": return "manual";
    case "manual_voice": return "manual";
    case "document": return "media";
    case "ocr": return "media";
    case "image": return "auto_reply";
    case "file": return "auto_reply";
    case "error_fallback": return "auto_reply";
    case "catch_all": return "auto_reply";
  }
}

// ── Runtime guard: validate intent fields ────────────────────────────

function validateIntent(intent: OutboundIntent): string | null {
  const kind = (intent as any).kind || "text";
  if (kind === "media") {
    const m = intent as MediaOutboundIntent;
    if (!m.mediaType || !m.filePath) return "media intent requires mediaType and filePath";
  }
  if (kind === "voice") {
    const v = intent as VoiceOutboundIntent;
    if (!v.audioPath) return "voice intent requires audioPath";
  }
  if (kind === "text" || !kind) {
    const t = intent as TextOutboundIntent;
    if (!t.content) return "text intent requires content";
  }
  return null;
}

// ── P0: Prompt Echo Guard ─────────────────────────────────────────────
// Markers and detector are now in prompt-safety.service.ts (shared with history filter)

import { containsPromptEchoMarker, PROMPT_ECHO_MARKERS } from "./prompt-safety.service.js";

const PROMPT_ECHO_MARKERS_REEXPORT = PROMPT_ECHO_MARKERS; // kept for direct access

/**
 * Check if the AI response contains internal prompt/context markers.
 * Returns the block reason string if blocked, null if safe.
 * Null-safe: delegates to shared containsPromptEchoMarker.
 */
function checkPromptEcho(content: unknown): string | null {
  if (!containsPromptEchoMarker(content)) return null;
  // Find which marker matched for the detailed reason
  const text = typeof content === "string" ? content.trim().normalize() : "";
  for (const marker of PROMPT_ECHO_MARKERS) {
    if (text.includes(marker)) {
      return `prompt_echo_guard: response contains internal marker "${marker}"`;
    }
  }
  return `prompt_echo_guard: response contains internal marker`;
}

// ── Main dispatcher ──────────────────────────────────────────────────

export async function sendOutbound(intent: OutboundIntent): Promise<OutboundResult> {
  const threadId = normalizeThreadId(intent.threadId);
  const { threadType, source, relatedMessageId, taskId, metadata } = intent;
  const kind = (intent as any).kind || "text";

  // Runtime guard
  const validationErr = validateIntent(intent);
  if (validationErr) {
    return { success: false, dryRun: true, decision: "skip", reason: validationErr };
  }

  // 1. ── Safety: thread allowed? ───────────────────────────────────
  try {
    const setting = await getThreadSettings(threadId, threadType);
    if (setting && setting.autoReplyEnabled === false) {
      return { success: false, dryRun: true, decision: "block", reason: "thread_auto_reply_disabled" };
    }
  } catch { /* non-fatal */ }

  // P0: Prompt echo guard — block AI responses containing internal markers
  if (kind === "text" || !kind) {
    const t = intent as TextOutboundIntent;
    const echoBlock = checkPromptEcho(t.content);
    if (echoBlock) {
      console.log(`[outbound] BLOCKED prompt echo: ${echoBlock} thread=${threadId}`);
      const recordContent = buildRecordContent(intent);
      saveOutboundRecord({
        threadId, threadType, content: recordContent,
        sentMessageId: "", source: mapSource(source), dryRun: true,
        decision: "block", reason: echoBlock,
      }).catch(() => {});
      return { success: false, dryRun: true, decision: "block", reason: echoBlock };
    }
  }
  const cooldownAcquired = await acquireCooldown(threadId);
  if (!cooldownAcquired) {
    const recordContent = buildRecordContent(intent);
    saveOutboundRecord({
      threadId, threadType, content: recordContent,
      sentMessageId: "", source: mapSource(source), dryRun: true,
      decision: "skip", reason: "cooldown",
    }).catch(() => {});
    return { success: false, dryRun: true, decision: "skip", reason: "cooldown" };
  }

  // 3. ── DryRun decision ───────────────────────────────────────────
  let effectiveDryRun = getCurrentEffectiveDryRun();

  // 4. ── LiveTest override ─────────────────────────────────────────
  let liveTestSessionId: string | undefined;
  if (effectiveDryRun) {
    try {
      const { shouldSendLiveForThread } = await import("./live-test.service.js");
      const liveCheck = await shouldSendLiveForThread(threadId);
      if (liveCheck.live) {
        effectiveDryRun = false;
        liveTestSessionId = liveCheck.sessionId;
      }
    } catch { /* non-fatal */ }
  }

  // 4.5 ── Idempotency gate (Phase 4A) — text replies only ───────────
  // Persistent, restart/retry-safe dedup: a given inbound (or identical content)
  // can produce at most ONE outbound. Reserve the record BEFORE the provider send
  // (write-ahead) so a crash/retry never double-sends.
  const idempotencyKey = computeReplyIdempotencyKey(intent);
  let reservedRecordId: string | null = null;
  if (idempotencyKey) {
    const existing = await findOutboundByIdempotencyKey(idempotencyKey);
    if (existing && existing.decision !== "block" && existing.decision !== "skip") {
      console.log(`[outbound] duplicate_idempotency skip: key=${idempotencyKey} existing=${existing.id}`);
      return {
        success: true,
        dryRun: existing.dryRun,
        decision: "skip",
        reason: "duplicate_idempotency",
        sentMessageId: existing.sentMessageId ?? undefined,
        outboundRecordId: existing.id,
      };
    }
    try {
      reservedRecordId = await reserveOutboundRecord({
        idempotencyKey,
        inboundMessageId: relatedMessageId ?? null,
        threadId,
        threadType,
        content: buildRecordContent(intent),
        source: mapSource(source),
        dryRun: effectiveDryRun,
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        // Concurrent reservation won the race → treat as duplicate, do NOT send.
        const dup = await findOutboundByIdempotencyKey(idempotencyKey);
        console.log(`[outbound] duplicate_idempotency (concurrent) skip: key=${idempotencyKey}`);
        return {
          success: true,
          dryRun: dup?.dryRun ?? effectiveDryRun,
          decision: "skip",
          reason: "duplicate_idempotency",
          sentMessageId: dup?.sentMessageId ?? undefined,
          outboundRecordId: dup?.id,
        };
      }
      // Other DB error → continue without a reservation (fail-open to not lose the reply).
      console.error(`[outbound] reservation failed (continuing unkeyed): ${(err as Error).message}`);
      reservedRecordId = null;
    }
  }

  // 5. ── Create Assistant Message (text only) ───────────────────────
  let assistantMessageId: string | undefined;
  if (kind === "text") {
    const t = intent as TextOutboundIntent;
    try {
      const msg = await prisma.message.create({
        data: {
          threadId, threadType,
          content: t.content.slice(0, 4000),
          role: "assistant", isFromBot: true, messageType: "text",
          relatedMessageId: relatedMessageId ?? null,
          metadata: JSON.stringify({
            source: `outbound_${source}`,
            dryRun: effectiveDryRun,
            taskId: taskId ?? null,
            status: effectiveDryRun ? "dryRun" : "sending",
            liveTestSessionId: liveTestSessionId ?? null,
            ...metadata,
          }),
        },
      });
      assistantMessageId = msg.id;
    } catch (err: unknown) {
      console.error(`[outbound-dispatcher] Failed to save assistant message: ${(err as Error).message}`);
    }
  }

  // 6. ── Dry-run path ──────────────────────────────────────────────
  if (effectiveDryRun) {
    let fakeMsgId: string;
    if (kind === "media") {
      const m = intent as MediaOutboundIntent;
      fakeMsgId = `dry-run-${m.mediaType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    } else if (kind === "voice") {
      fakeMsgId = `dry-run-voice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    } else {
      fakeMsgId = `dry-run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }

    if (reservedRecordId) {
      // Update the write-ahead reservation (single record for the keyed path).
      await updateOutboundRecordById(reservedRecordId, { sentMessageId: fakeMsgId, reason: "dry_run" });
    } else {
      const recordContent = buildRecordContent(intent);
      saveOutboundRecord({
        threadId, threadType, content: recordContent,
        sentMessageId: fakeMsgId, source: mapSource(source), dryRun: true,
        decision: "allow", reason: "dry_run",
      }).catch(() => {});
    }

    if (assistantMessageId) {
      updateMessageStatus(assistantMessageId, "dryRun", { sentMessageId: fakeMsgId });
    }

    const dryRunResult: OutboundResult = { success: true, dryRun: true, decision: "allow", reason: "dry_run", sentMessageId: fakeMsgId, assistantMessageId };
    if (reservedRecordId) dryRunResult.outboundRecordId = reservedRecordId;

    csSetCooldown(threadId).catch(() => {});
    const hbType = kind === "media" ? "media" : kind === "voice" ? "voice" : "text";
    heartbeatOk("messagePipeline", { threadId, threadType, messageType: hbType }).catch(() => {});

    return dryRunResult;
  }

  // 7. ── Live send path ────────────────────────────────────────────
  const sender = new ZaloMessageSender();
  let sendResult: { success: boolean; messageId?: string; error?: string; errorCode?: string };

  if (kind === "media") {
    const m = intent as MediaOutboundIntent;
    if (m.mediaType === "image") {
      sendResult = await sender.sendImage(m.filePath, threadId, threadType, m.caption);
    } else {
      sendResult = await sender.sendFile(m.filePath, threadId, threadType, m.caption);
    }
  } else if (kind === "voice") {
    const v = intent as VoiceOutboundIntent;
    sendResult = await sender.sendVoice(v.audioPath, threadId, threadType);
  } else {
    const t = intent as TextOutboundIntent;
    // Keyed path: dispatcher owns the reserved record → tell the sender to skip its own.
    sendResult = await sender.sendMessage(t.content, threadId, threadType, mapSource(source), {
      skipRecord: reservedRecordId != null,
    });
  }

  // 8. ── Update Message status (text only) ─────────────────────────
  if (assistantMessageId) {
    updateMessageStatus(assistantMessageId, sendResult.success ? "sent" : "failed", {
      sentMessageId: sendResult.messageId,
      errorCode: sendResult.errorCode,
      error: sendResult.error,
    });
  }

  // 8.5 ── Update the write-ahead reservation with the live outcome ──
  // On failure the reservation stays (key remains) so accidental retries do NOT
  // double-send; an explicit retry policy is out of scope (Phase 4A).
  if (reservedRecordId) {
    await updateOutboundRecordById(reservedRecordId, {
      sentMessageId: sendResult.messageId ?? "",
      reason: sendResult.success ? (liveTestSessionId ? "live_test" : "single_send") : "send_failed",
      errorCode: sendResult.errorCode ?? null,
    });
  }

  csSetCooldown(threadId).catch(() => {});
  const hbType = kind === "media" ? "media" : kind === "voice" ? "voice" : "text";
  heartbeatOk("messagePipeline", { threadId, threadType, messageType: hbType }).catch(() => {});

  return {
    success: sendResult.success,
    dryRun: false,
    decision: "allow",
    reason: liveTestSessionId ? "live_test" : "single_send",
    sentMessageId: sendResult.messageId ?? undefined,
    outboundRecordId: reservedRecordId ?? undefined,
    assistantMessageId,
    error: sendResult.error,
    errorCode: sendResult.errorCode,
  };
}

// ── Phase 4A: idempotency key for text replies ──────────────────────
// Prefer the EXACT inbound linkage. When there is no inbound (e.g. a proactive
// send), fall back to a content-scoped key so identical repeated content to the
// same thread is de-duplicated persistently (a durable version of the in-memory
// content dedup). Returns null for non-text or when no stable key can be formed.
function computeReplyIdempotencyKey(intent: OutboundIntent): string | null {
  const kind = (intent as any).kind || "text";
  if (kind !== "text") return null;
  const t = intent as TextOutboundIntent;
  const tid = normalizeThreadId(intent.threadId);
  const tt = intent.threadType;
  if (intent.relatedMessageId) {
    return `reply:${intent.relatedMessageId}:${tid}:${tt}`;
  }
  const hash = createHash("sha256").update(t.content ?? "").digest("hex").slice(0, 16);
  return `reply:unknown:${tid}:${tt}:${hash}`;
}

// ── Helper: build safe content string for OutboundRecord ─────────────

function buildRecordContent(intent: OutboundIntent): string {
  const kind = (intent as any).kind || "text";
  if (kind === "media") {
    const m = intent as MediaOutboundIntent;
    const safePath = basename(m.filePath);
    return `[${m.mediaType}: ${safePath}]${m.caption ? ` (${m.caption})` : ""}`;
  }
  if (kind === "voice") {
    const v = intent as VoiceOutboundIntent;
    const safePath = basename(v.audioPath);
    return `[voice: ${safePath}]`;
  }
  return (intent as TextOutboundIntent).content;
}

// ── Helper: update message metadata status ──────────────────────────

async function updateMessageStatus(
  messageId: string,
  status: "draft" | "dryRun" | "sent" | "failed" | "blocked",
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    const existing = await prisma.message.findUnique({ where: { id: messageId }, select: { metadata: true } });
    if (!existing) return;
    let meta: Record<string, unknown> = {};
    try { meta = existing.metadata ? JSON.parse(existing.metadata) : {}; } catch { /* keep empty */ }
    meta.status = status;
    if (extra) Object.assign(meta, extra);
    await prisma.message.update({ where: { id: messageId }, data: { metadata: JSON.stringify(meta) } });
  } catch (err: unknown) {
    console.error(`[outbound-dispatcher] Failed to update message status: ${(err as Error).message}`);
  }
}
