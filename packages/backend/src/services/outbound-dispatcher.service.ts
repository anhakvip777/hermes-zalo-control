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
import { saveOutboundRecord } from "./outbound-guardrails.service.js";
import { heartbeatOk } from "./heartbeat.service.js";
import { getEffectiveCooldownSeconds } from "./runtime-config.service.js";
import { getThreadSettings } from "./thread-settings.service.js";
import { normalizeThreadId } from "./thread-id.js";

// ── Types ────────────────────────────────────────────────────────────

export type OutboundSource =
  | "hermes"
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

// ── In-memory cooldown (shared with existing dispatcher) ────────────

const lastReplyAt = new Map<string, number>();

export function resetOutboundCooldowns(): void {
  lastReplyAt.clear();
}

function isInCooldown(threadId: string): boolean {
  const last = lastReplyAt.get(threadId);
  if (!last) return false;
  return Date.now() - last < getEffectiveCooldownSeconds() * 1000;
}

function setCooldown(threadId: string): void {
  lastReplyAt.set(threadId, Date.now());
}

// ── Map source to OutboundRecord source ──────────────────────────────

function mapSource(source: OutboundSource): "auto_reply" | "schedule" | "media" | "manual" | "create_reminder" {
  switch (source) {
    case "hermes": return "auto_reply";
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

  // 2. ── Cooldown check ────────────────────────────────────────────
  if (isInCooldown(threadId)) {
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

    const recordContent = buildRecordContent(intent);
    saveOutboundRecord({
      threadId, threadType, content: recordContent,
      sentMessageId: fakeMsgId, source: mapSource(source), dryRun: true,
      decision: "allow", reason: "dry_run",
    }).catch(() => {});

    if (assistantMessageId) {
      updateMessageStatus(assistantMessageId, "dryRun", { sentMessageId: fakeMsgId });
    }

    setCooldown(threadId);
    const hbType = kind === "media" ? "media" : kind === "voice" ? "voice" : "text";
    heartbeatOk("messagePipeline", { threadId, threadType, messageType: hbType }).catch(() => {});

    return { success: true, dryRun: true, decision: "allow", reason: "dry_run", sentMessageId: fakeMsgId, assistantMessageId };
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
    sendResult = await sender.sendMessage(t.content, threadId, threadType, mapSource(source));
  }

  // 8. ── Update Message status (text only) ─────────────────────────
  if (assistantMessageId) {
    updateMessageStatus(assistantMessageId, sendResult.success ? "sent" : "failed", {
      sentMessageId: sendResult.messageId,
      errorCode: sendResult.errorCode,
      error: sendResult.error,
    });
  }

  setCooldown(threadId);
  const hbType = kind === "media" ? "media" : kind === "voice" ? "voice" : "text";
  heartbeatOk("messagePipeline", { threadId, threadType, messageType: hbType }).catch(() => {});

  return {
    success: sendResult.success,
    dryRun: false,
    decision: "allow",
    reason: liveTestSessionId ? "live_test" : "single_send",
    sentMessageId: sendResult.messageId ?? undefined,
    assistantMessageId,
    error: sendResult.error,
    errorCode: sendResult.errorCode,
  };
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
