// =============================================================================
// ZaloMessageSender — implements MessageSender using zca-js
// =============================================================================

import type { MessageSender, SendResult } from "./message-sender.js";
import { getZaloGateway } from "./zalo-gateway.service.js";
import { config } from "../config.js";
import { getCurrentEffectiveDryRun } from "./runtime-config.service.js";
import { existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import {
  applyOutboundGuardrails,
  recordOutboundDedup,
  saveOutboundRecord,
} from "./outbound-guardrails.service.js";

export class ZaloMessageSender implements MessageSender {
  async sendMessage(
    content: string,
    threadId: string,
    threadType: "user" | "group",
    source: "auto_reply" | "agent_tool" | "schedule" | "media" | "manual" | "create_reminder" = "auto_reply",
    opts?: { skipRecord?: boolean },
  ): Promise<SendResult> {
    // Phase 4A: when the caller (OutboundDispatcher keyed path) owns a write-ahead
    // reserved OutboundRecord, skip this sender's own record writes to avoid a
    // duplicate row. Delivery + live-test accounting still happen normally.
    const skipRecord = opts?.skipRecord === true;
    // ── Dry-run check with live test override ────────────────
    const liveTestCheck = await (async () => {
      try {
        const { shouldSendLiveForThread } = await import("./live-test.service.js");
        return await shouldSendLiveForThread(threadId);
      } catch {
        return { live: false, reason: "dry_run" };
      }
    })();

    let effectiveDryRun = getCurrentEffectiveDryRun();

    // Live test overrides dry-run for target thread
    if (effectiveDryRun && liveTestCheck.live) {
      effectiveDryRun = false;
    }

    if (effectiveDryRun) {
      const msgId = `dry-run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (!skipRecord) {
        saveOutboundRecord({
          threadId, threadType, content,
          sentMessageId: msgId, source, dryRun: true,
          decision: "allow", reason: liveTestCheck.reason ?? "dry_run",
        }).catch(() => {});
      }
      return { success: true, messageId: msgId };
    }

    // ── Group outbound gate: check reply window ──────────────────
    const gateResult = await checkGroupOutboundGate(threadId, threadType);
    if (gateResult) {
      if (!skipRecord) {
        saveOutboundRecord({
          threadId, threadType, content,
          sentMessageId: "", source, dryRun: false,
          decision: "block", reason: gateResult.errorCode ?? "group_reply_window_closed",
          errorCode: gateResult.errorCode,
        }).catch(() => {});
      }
      return gateResult;
    }

    // ── Outbound guardrails: sanitize + dedup + split ────────────
    const guard = applyOutboundGuardrails(threadId, threadType, content, source, false);
    if (!guard.allowed) {
      return {
        success: false,
        error: guard.reason ?? "Outbound blocked",
        errorCode: guard.errorCode,
      };
    }

    const parts = guard.parts ?? [content];

    // Check connection — try to restore session once if not connected
    const gateway = getZaloGateway();
    if (!gateway.isConnected()) {
      try {
        const restored = await gateway.restoreSession();
        if (restored) { /* proceed */ }
      } catch (e: unknown) {
        console.error("ZaloMessageSender: session restore failed: " + ((e as Error).message || "unknown"));
      }
    }
    if (!gateway.isConnected()) {
      return {
        success: false,
        error: "Zalo not connected",
        errorCode: "ZALO_NOT_CONNECTED",
      };
    }

    // Check rate limits
    const rateLimited = rateLimiter.check(threadId);
    if (rateLimited) {
      return {
        success: false,
        error: "Rate limit exceeded for this thread",
        errorCode: "RATE_LIMITED",
      };
    }

    const api = gateway.getApi();
    if (!api) {
      return {
        success: false,
        error: "Zalo API not available",
        errorCode: "ZALO_API_UNAVAILABLE",
      };
    }

    // Send all parts (split-send)
    const sentMessageIds: string[] = [];
    try {
      const ThreadType = await resolveThreadType();

      for (const part of parts) {
        const result = await api.sendMessage(
          { msg: part },
          threadId,
          threadType === "group" ? ThreadType.Group : ThreadType.User,
        );
        const msgId = result?.messageId ?? result?.msgId ?? `sent-${Date.now()}`;
        sentMessageIds.push(msgId);
      }

      const finalMsgId = sentMessageIds[sentMessageIds.length - 1] ?? `sent-${Date.now()}`;

      // Record for dedup + sent-context
      recordOutboundDedup(threadId, content, finalMsgId);
      if (!skipRecord) {
        saveOutboundRecord({
          threadId, threadType, content,
          sentMessageId: finalMsgId, source, dryRun: false,
          decision: "allow", reason: parts.length > 1 ? "split_send" : "single_send",
        }).catch(() => {});
      }

      // Record live test send if applicable
      if (liveTestCheck.live && liveTestCheck.sessionId) {
        const { recordLiveTestSent } = await import("./live-test.service.js");
        recordLiveTestSent(liveTestCheck.sessionId, threadId, finalMsgId).catch(() => {});
      }

      return { success: true, messageId: finalMsgId };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg, errorCode: "SEND_FAILED" };
    }
  }

  /**
   * Send an image to Zalo. Uses api.sendMessage with attachments.
   * Accepted: jpg, jpeg, png, webp, gif. Max 25MB.
   */
  async sendImage(
    filePath: string,
    threadId: string,
    threadType: "user" | "group",
    caption?: string,
  ): Promise<SendResult> {
    // Validate
    const validateErr = validateMedia(filePath, ["jpg", "jpeg", "png", "webp", "gif"]);
    if (validateErr) return validateErr;

    // Dry-run
    if (getCurrentEffectiveDryRun()) {
      return {
        success: true,
        messageId: `dry-run-img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      };
    }

    // Group outbound gate
    const gateResult = await checkGroupOutboundGate(threadId, threadType);
    if (gateResult) return gateResult;

    return this.sendMediaAttachment(filePath, threadId, threadType, caption);
  }

  /**
   * Send a file to Zalo. Uses api.sendMessage with attachments.
   * Accepted: pdf, doc, docx, xls, xlsx, txt, zip. Max 25MB.
   */
  async sendFile(
    filePath: string,
    threadId: string,
    threadType: "user" | "group",
    caption?: string,
  ): Promise<SendResult> {
    const allowedTypes = ["pdf", "doc", "docx", "xls", "xlsx", "txt", "zip", "rar", "7z"];
    const validateErr = validateMedia(filePath, allowedTypes);
    if (validateErr) return validateErr;

    // Dry-run
    if (getCurrentEffectiveDryRun()) {
      return {
        success: true,
        messageId: `dry-run-file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      };
    }

    // Group outbound gate
    const gateResult = await checkGroupOutboundGate(threadId, threadType);
    if (gateResult) return gateResult;

    return this.sendMediaAttachment(filePath, threadId, threadType, caption);
  }

  /**
   * Send a voice message to Zalo.
   * 1. Uploads MP3 via uploadAttachment → gets fileUrl
   * 2. Sends via api.sendVoice({ voiceUrl }) → native voice bubble
   * Accepted: mp3. Max 25MB.
   */
  async sendVoice(
    filePath: string,
    threadId: string,
    threadType: "user" | "group",
  ): Promise<SendResult> {
    // Validate
    const validateErr = validateMedia(filePath, ["mp3", "m4a"]);
    if (validateErr) return validateErr;

    // Dry-run
    if (getCurrentEffectiveDryRun()) {
      saveOutboundRecord({
        threadId, threadType, content: `[voice: ${filePath}]`,
        sentMessageId: "", source: "media", dryRun: true,
        decision: "allow", reason: "dry_run",
      }).catch(() => {});
      return {
        success: true,
        messageId: `dry-run-voice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      };
    }

    // Group outbound gate
    const gateResult = await checkGroupOutboundGate(threadId, threadType);
    if (gateResult) {
      saveOutboundRecord({
        threadId, threadType, content: `[voice: ${filePath}]`,
        sentMessageId: "", source: "media", dryRun: false,
        decision: "block", reason: gateResult.errorCode ?? "group_reply_window_closed",
        errorCode: gateResult.errorCode,
      }).catch(() => {});
      return gateResult;
    }

    // Rate limit + connection check
    const gateway = getZaloGateway();
    if (!gateway.isConnected()) {
      try {
        const restored = await gateway.restoreSession();
        if (restored) { /* proceed */ }
      } catch (e: unknown) {
        console.error("ZaloMessageSender.sendVoice: session restore failed: " + ((e as Error).message || "unknown"));
      }
    }
    if (!gateway.isConnected()) {
      return { success: false, error: "Zalo not connected", errorCode: "ZALO_NOT_CONNECTED" };
    }

    const rateLimited = rateLimiter.check(threadId);
    if (rateLimited) {
      saveOutboundRecord({
        threadId, threadType, content: `[voice: ${filePath}]`,
        sentMessageId: "", source: "media", dryRun: false,
        decision: "block", reason: "rate_limited",
        errorCode: "RATE_LIMITED",
      }).catch(() => {});
      return { success: false, error: "Rate limit exceeded", errorCode: "RATE_LIMITED" };
    }

    const api = gateway.getApi();
    if (!api) {
      return { success: false, error: "Zalo API not available", errorCode: "ZALO_API_UNAVAILABLE" };
    }

    try {
      const ThreadType = await resolveThreadType();
      const zaloType = threadType === "group" ? ThreadType.Group : ThreadType.User;

      // Step 1: Upload MP3 to Zalo CDN → get URL
      const uploadResult = await api.uploadAttachment([filePath], threadId, zaloType);
      const uploadData = Array.isArray(uploadResult) ? uploadResult[0] : uploadResult;
      const fileUrl = (uploadData as any)?.fileUrl;
      if (!fileUrl) {
        return { success: false, error: "Voice upload failed: no fileUrl returned", errorCode: "VOICE_UPLOAD_FAILED" };
      }

      // Step 2: Send as voice message with the uploaded URL
      const voiceResult = await api.sendVoice(
        { voiceUrl: fileUrl },
        threadId,
        zaloType,
      );
      const msgId = voiceResult?.msgId ?? `voice-${Date.now()}`;

      saveOutboundRecord({
        threadId, threadType, content: `[voice sent]`,
        sentMessageId: msgId, source: "media", dryRun: false,
        decision: "allow", reason: "voice_send",
      }).catch(() => {});

      return { success: true, messageId: msgId };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      saveOutboundRecord({
        threadId, threadType, content: `[voice: ${filePath}]`,
        sentMessageId: "", source: "media", dryRun: false,
        decision: "block", reason: "voice_send_failed",
        errorCode: "SEND_FAILED",
      }).catch(() => {});
      return { success: false, error: msg, errorCode: "SEND_FAILED" };
    }
  }

  /**
   * Shared internal: upload + send attachment via api.sendMessage.
   */
  private async sendMediaAttachment(
    filePath: string,
    threadId: string,
    threadType: "user" | "group",
    caption?: string,
  ): Promise<SendResult> {
    const gateway = getZaloGateway();
    if (!gateway.isConnected()) {
      try {
        const restored = await gateway.restoreSession();
        if (restored) { /* proceed */ }
      } catch (e: unknown) {
        console.error("ZaloMessageSender: session restore failed: " + ((e as Error).message || "unknown"));
      }
    }
    if (!gateway.isConnected()) {
      return { success: false, error: "Zalo not connected", errorCode: "ZALO_NOT_CONNECTED" };
    }

    const rateLimited = rateLimiter.check(threadId);
    if (rateLimited) {
      return { success: false, error: "Rate limit exceeded", errorCode: "RATE_LIMITED" };
    }

    const api = gateway.getApi();
    if (!api) {
      return { success: false, error: "Zalo API not available", errorCode: "ZALO_API_UNAVAILABLE" };
    }

    try {
      const ThreadType = await resolveThreadType();
      const messageContent: Record<string, unknown> = {
        attachments: [filePath],
      };
      if (caption) {
        messageContent.msg = caption;
      }

      const result = await api.sendMessage(
        messageContent,
        threadId,
        threadType === "group" ? ThreadType.Group : ThreadType.User,
      );

      return {
        success: true,
        messageId: result?.messageId ?? result?.msgId ?? `sent-${Date.now()}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg, errorCode: "SEND_FAILED" };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Rate Limiter
// ═══════════════════════════════════════════════════════════════════

interface RateWindow {
  count: number;
  resetAt: number;
}

class RateLimiter {
  private perThread = new Map<string, RateWindow>();
  private global: RateWindow = { count: 0, resetAt: 0 };

  check(threadId: string): boolean {
    const now = Date.now();

    // Check per-thread first
    const w = this.perThread.get(threadId);
    if (!w || now > w.resetAt) {
      this.perThread.set(threadId, { count: 1, resetAt: now + 60_000 });
    } else if (w.count >= config.zalo.rateLimitPerMinute) {
      return true;
    }

    // Check global
    if (now > this.global.resetAt) {
      this.global = { count: 1, resetAt: now + 60_000 };
    } else if (this.global.count >= config.zalo.rateLimitGlobalPerMinute) {
      return true;
    } else {
      this.global.count++;
      // Increment per-thread too (was only set on first message of window)
      if (w && w.count < config.zalo.rateLimitPerMinute) {
        w.count++;
      }
    }

    return false;
  }

  getGlobalRemaining(): number {
    const now = Date.now();
    if (now > this.global.resetAt) return config.zalo.rateLimitGlobalPerMinute;
    return Math.max(0, config.zalo.rateLimitGlobalPerMinute - this.global.count);
  }

  getThreadRemaining(threadId: string): number {
    const now = Date.now();
    const w = this.perThread.get(threadId);
    if (!w || now > w.resetAt) return config.zalo.rateLimitPerMinute;
    return Math.max(0, config.zalo.rateLimitPerMinute - w.count);
  }
}

export const rateLimiter = new RateLimiter();

// ═══════════════════════════════════════════════════════════════════
// Lazy import ThreadType enum from zca-js
// ═══════════════════════════════════════════════════════════════════

let cachedThreadType: any = null;

async function resolveThreadType(): Promise<any> {
  if (cachedThreadType) return cachedThreadType;
  try {
    // Dynamic ESM import — NodeNext compat via `any` annotation
    const mod: { ThreadType: any } = await import("zca-js") as any;
    cachedThreadType = mod.ThreadType;
    return cachedThreadType;
  } catch {
    // Fallback for when zca-js is not installed
    cachedThreadType = { User: "User", Group: "Group" };
    return cachedThreadType;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Group outbound gate (shared across sendMessage/sendImage/sendFile)
// ═══════════════════════════════════════════════════════════════════

async function checkGroupOutboundGate(
  threadId: string,
  threadType: "user" | "group",
): Promise<SendResult | null> {
  if (threadType !== "group") return null;

  const { getGroupReplyWindow, logGroupGateAudit } = await import("./group-safety.service.js");
  const windowExpires = getGroupReplyWindow(threadId);
  if (windowExpires === 0) {
    logGroupGateAudit({
      threadId,
      threadType: "group",
      messageId: null,
      decision: "skip",
      reason: "group_reply_window_closed",
    });
    return {
      success: false,
      error: "Group reply window closed — no recent mention",
      errorCode: "GROUP_REPLY_WINDOW_CLOSED",
    };
  }
  // Window open
  logGroupGateAudit({
    threadId,
    threadType: "group",
    messageId: null,
    decision: "allow",
    reason: "reply_window_open",
    replyWindowUntil: new Date(windowExpires).toISOString(),
  });
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Media validation
// ═══════════════════════════════════════════════════════════════════

const MAX_MEDIA_SIZE = 25 * 1024 * 1024; // 25 MB


function validateMedia(
  filePath: string,
  allowedExtensions: string[],
): SendResult | null {
  // Check file exists
  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}`, errorCode: "FILE_NOT_FOUND" };
  }

  // Check file type
  const ext = extname(filePath).toLowerCase().replace(".", "");
  if (!allowedExtensions.includes(ext)) {
    return {
      success: false,
      error: `Unsupported file type .${ext}. Allowed: ${allowedExtensions.join(", ")}`,
      errorCode: "MEDIA_TYPE_NOT_ALLOWED",
    };
  }

  // Check file size
  const stats = statSync(filePath);
  if (stats.size > MAX_MEDIA_SIZE) {
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
    return {
      success: false,
      error: `File too large: ${sizeMB} MB (max 25 MB)`,
      errorCode: "MEDIA_TOO_LARGE",
    };
  }

  return null;
}

