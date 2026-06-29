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
//     → create Assistant Message (status: draft)
//     → create OutboundRecord
//     → if !dryRun → ZaloMessageSender.send()
//     → update OutboundRecord (sentMessageId / error)
//     → update Message status
//     → heartbeat (messagePipeline)
// =============================================================================

import { prisma } from "../db.js";
import { getCurrentEffectiveDryRun } from "./runtime-config.service.js";
import { ZaloMessageSender } from "./zalo-message-sender.js";
import { saveOutboundRecord } from "./outbound-guardrails.service.js";
import { heartbeatOk } from "./heartbeat.service.js";
import { getEffectiveCooldownSeconds } from "./runtime-config.service.js";
import { getThreadSettings } from "./thread-settings.service.js";

// ── Types ────────────────────────────────────────────────────────────

export type OutboundSource =
  | "hermes"
  | "rule"
  | "reminder"
  | "batch"
  | "schedule"
  | "manual_test"
  | "document"
  | "ocr"
  | "image"
  | "file"
  | "error_fallback"
  | "catch_all";

export interface OutboundIntent {
  threadId: string;
  threadType: "user" | "group";
  source: OutboundSource;
  content: string;
  relatedMessageId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

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
    case "document": return "media";
    case "ocr": return "media";
    case "image": return "auto_reply";
    case "file": return "auto_reply";
    case "error_fallback": return "auto_reply";
    case "catch_all": return "auto_reply";
  }
}

// ── Main dispatcher ──────────────────────────────────────────────────

export async function sendOutbound(intent: OutboundIntent): Promise<OutboundResult> {
  const { threadId, threadType, source, content, relatedMessageId, taskId, metadata } = intent;

  // 1. ── Safety: thread allowed? ───────────────────────────────────
  try {
    const setting = await getThreadSettings(threadId, threadType);
    if (setting && setting.autoReplyEnabled === false) {
      return {
        success: false, dryRun: true, decision: "block",
        reason: "thread_auto_reply_disabled",
      };
    }
  } catch {
    // Non-fatal — proceed if thread setting check fails
  }

  // 2. ── Cooldown check ────────────────────────────────────────────
  if (isInCooldown(threadId)) {
    // Record the skip for audit
    saveOutboundRecord({
      threadId, threadType, content,
      sentMessageId: "", source: mapSource(source), dryRun: true,
      decision: "skip", reason: "cooldown",
    }).catch(() => {});
    return {
      success: false, dryRun: true, decision: "skip",
      reason: "cooldown",
    };
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
    } catch {
      // Non-fatal — proceed with current dryRun
    }
  }

  // 5. ── Create Assistant Message ──────────────────────────────────
  let assistantMessageId: string | undefined;
  try {
    const msg = await prisma.message.create({
      data: {
        threadId,
        threadType,
        content: content.slice(0, 4000),
        role: "assistant",
        isFromBot: true,
        messageType: "text",
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

  // 6. ── Dry-run path ──────────────────────────────────────────────
  if (effectiveDryRun) {
    const fakeMsgId = `dry-run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // Save OutboundRecord with dryRun=true
    saveOutboundRecord({
      threadId, threadType, content,
      sentMessageId: fakeMsgId, source: mapSource(source), dryRun: true,
      decision: "allow", reason: liveTestSessionId ? "dry_run" : "dry_run",
    }).catch(() => {});

    // Update message status
    if (assistantMessageId) {
      updateMessageStatus(assistantMessageId, "dryRun", { sentMessageId: fakeMsgId });
    }

    setCooldown(threadId);
    heartbeatOk("messagePipeline", { threadId, threadType, messageType: "text", contentLength: content.length })
      .catch(() => {});

    return {
      success: true, dryRun: true, decision: "allow",
      reason: "dry_run",
      sentMessageId: fakeMsgId,
      outboundRecordId: undefined,
      assistantMessageId,
    };
  }

  // 7. ── Live send path ────────────────────────────────────────────
  const sender = new ZaloMessageSender();
  const sendResult = await sender.sendMessage(content, threadId, threadType, mapSource(source));

  // 8. ── Update Message status ─────────────────────────────────────
  if (assistantMessageId) {
    const status = sendResult.success ? "sent" : "failed";
    updateMessageStatus(assistantMessageId, status, {
      sentMessageId: sendResult.messageId,
      errorCode: sendResult.errorCode,
      error: sendResult.error,
    });
  }

  setCooldown(threadId);
  heartbeatOk("messagePipeline", { threadId, threadType, messageType: "text", contentLength: content.length })
    .catch(() => {});

  return {
    success: sendResult.success,
    dryRun: false,
    decision: "allow",
    reason: liveTestSessionId ? "live_test" : "single_send",
    sentMessageId: sendResult.messageId ?? undefined,
    outboundRecordId: undefined,
    assistantMessageId,
    error: sendResult.error,
    errorCode: sendResult.errorCode,
  };
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
    try {
      meta = existing.metadata ? JSON.parse(existing.metadata) : {};
    } catch { /* keep empty */ }

    meta.status = status;
    if (extra) Object.assign(meta, extra);

    await prisma.message.update({
      where: { id: messageId },
      data: { metadata: JSON.stringify(meta) },
    });
  } catch (err: unknown) {
    console.error(`[outbound-dispatcher] Failed to update message status: ${(err as Error).message}`);
  }
}
