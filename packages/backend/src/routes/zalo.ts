import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { resolve, normalize, relative, sep } from "node:path";
import { SendMessageSchema } from "@hermes/shared";
import { getZaloGateway } from "../services/zalo-gateway.service.js";
import { listThreads, listMessages } from "../services/zalo-receive.js";
import { config } from "../config.js";
import { getCurrentEffectiveDryRun } from "../services/runtime-config.service.js";
import { sendOutbound } from "../services/outbound-dispatcher.service.js";
import { normalizeThreadId } from "../services/thread-id.js";
import { prisma } from "../db.js";
import { sendApiError } from "../http/api-error.js";

/**
 * Validate that a file path is within the allowed media base directory.
 * Blocks: path traversal (../), absolute paths outside base dir, .env/session/backup files.
 */
function validateSafeMediaPath(filePath: string): { allowed: false; error: string } | { allowed: true; resolvedPath: string } {
  // Resolve to absolute path
  const resolved = resolve(filePath);
  const baseDir = resolve(config.zalo.mediaAllowedBaseDir);

  // Block path traversal attempts
  const rel = relative(baseDir, resolved);
  if (rel.startsWith("..") || rel.startsWith(`${sep}..`) || normalize(filePath).includes("..")) {
    return { allowed: false, error: "Path traversal blocked" };
  }

  // Block paths outside allowed base directory
  if (!resolved.startsWith(baseDir + sep) && resolved !== baseDir) {
    return { allowed: false, error: `File outside allowed directory: ${baseDir}` };
  }

  // Block sensitive file names
  const basename = resolved.split(sep).pop()?.toLowerCase() ?? "";
  const blockedNames = [".env", "credentials", "backup", "session", "cookie", "token", "secret", "key"];
  if (blockedNames.some((n) => basename.includes(n))) {
    return { allowed: false, error: `Blocked sensitive file name: ${basename}` };
  }

  return { allowed: true, resolvedPath: resolved };
}

export async function zaloRoutes(app: FastifyInstance) {
  // Authentication is owned by registerProtected() in app.ts. Keeping it at
  // that boundary prevents duplicate hooks and weaker route-local checks.
  // ═════════════════════════════════════════════════════════════════
  // GET /api/zalo/status
  // ═════════════════════════════════════════════════════════════════
  app.get("/zalo/status", async () => {
    return getZaloGateway().getStatus();
  });

  // ═════════════════════════════════════════════════════════════════
  // POST /api/zalo/login/start
  // ═════════════════════════════════════════════════════════════════
  app.post("/zalo/login/start", async (request, reply) => {
    try {
      const result = await getZaloGateway().startLogin();
      if (result.status === "already_in_progress") {
        return reply.status(409).send({
          error: { code: "LOGIN_ALREADY_IN_PROGRESS", message: result.qrImage },
        });
      }
      if (result.status === "already_connected") {
        return { data: result };
      }
      return { data: result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendApiError(reply, 500, "LOGIN_FAILED", msg);
    }
  });

  // ═════════════════════════════════════════════════════════════════
  // GET /api/zalo/login/status
  // ═════════════════════════════════════════════════════════════════
  app.get("/zalo/login/status", async () => {
    // Merge runtime dryRun (may differ from static config.zalo.dryRun)
    const status = getZaloGateway().getStatus();
    return { ...status, dryRun: getCurrentEffectiveDryRun() };
  });

  // ═════════════════════════════════════════════════════════════════
  // POST /api/zalo/login/cancel
  // ═════════════════════════════════════════════════════════════════
  app.post("/zalo/login/cancel", async (_request, _reply) => {
    // Admin-only: enforced by global adminAuth preHandler in app.ts
    const result = getZaloGateway().cancelLogin();
    return { data: result };
  });

  // ═════════════════════════════════════════════════════════════════
  // POST /api/zalo/session/save (S4: admin-only session persistence)
  // ═════════════════════════════════════════════════════════════════
  app.post("/zalo/session/save", async (_request, reply) => {
    const result = await getZaloGateway().persistSession();
    if (!result.ok) {
      return sendApiError(reply, 400, "SESSION_PERSIST_FAILED", result.message);
    }
    return {
      ok: true,
      session: {
        exists: true,
        fileSize: result.fileSize,
        updatedAt: new Date().toISOString(),
      },
    };
  });

  // ═════════════════════════════════════════════════════════════════
  // GET /api/zalo/login/qr
  // ═════════════════════════════════════════════════════════════════
  app.get("/zalo/login/qr", async (request, reply) => {
    // Admin-only: enforced by global adminAuth preHandler in app.ts

    // Gateway stores QR at sessionDir/qr-current.png
    const qrPath = resolve(config.zalo.sessionDir, "qr-current.png");

    if (!existsSync(qrPath)) {
      return reply.status(404).send({ error: { code: "QR_NOT_FOUND", message: "QR code not yet generated or expired. Call POST /api/zalo/login/start first." } });
    }

    // Check file is recent enough (not expired — gateway sets qrUpdatedAt=null on expire)
    const status = getZaloGateway().getStatus();
    if (!status.qrAvailable) {
      return reply.status(404).send({ error: { code: "QR_EXPIRED", message: "QR code has expired. Call POST /api/zalo/login/start to generate a new one." } });
    }

    const data = readFileSync(qrPath);
    // Return as base64 data URL so frontend can display inline without extra auth headers
    const b64 = data.toString("base64");
    return { qrDataURL: `data:image/png;base64,${b64}`, updatedAt: status.qrUpdatedAt };
  });

  // ═════════════════════════════════════════════════════════════════
  // POST /api/zalo/send-test
  // ═════════════════════════════════════════════════════════════════
  app.post("/zalo/send-test", async (request) => {
    const input = SendMessageSchema.parse(request.body);
    const tid = normalizeThreadId(input.threadId);

    const result = await sendOutbound({
      threadId: tid,
      threadType: input.threadType as "user" | "group",
      source: "manual_test",
      content: input.content,
      metadata: {
        route: "zalo/send-test",
        initiatedBy: "admin",
      },
    });

    return {
      data: {
        success: result.success || result.dryRun,
        decision: result.decision === "allow"
          ? (result.dryRun ? "dry_run" : "sent")
          : result.decision,
        dryRun: result.dryRun,
        sentMessageId: result.sentMessageId ?? null,
        outboundRecordId: result.outboundRecordId ?? null,
        reason: result.reason,
        error: result.error ?? null,
      },
    };
  });

  // ═════════════════════════════════════════════════════════════════
  // POST /api/zalo/logout
  // ═════════════════════════════════════════════════════════════════
  app.post("/zalo/logout", async () => {
    await getZaloGateway().logout();
    return { data: { success: true } };
  });

  // ═════════════════════════════════════════════════════════════════
  // GET /api/zalo/threads
  // ═════════════════════════════════════════════════════════════════
  app.get("/zalo/threads", async (request) => {
    const query = request.query as Record<string, string>;
    return listThreads({
      type: query.type,
      page: query.page ? parseInt(query.page, 10) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : 50,
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // GET /api/zalo/messages
  // ═════════════════════════════════════════════════════════════════
  app.get("/zalo/messages", async (request) => {
    const query = request.query as Record<string, string>;
    return listMessages({
      threadId: query.threadId,
      search: query.search,
      page: query.page ? parseInt(query.page, 10) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : 50,
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // POST /api/zalo/send-media
  // ═════════════════════════════════════════════════════════════════
  app.post("/zalo/send-media", async (request, reply) => {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "Media payload must be a JSON object");
    }

    const body = request.body as {
      type?: "image" | "file";
      path?: string;
      threadId?: string;
      threadType?: "user" | "group";
      caption?: string;
    };

    const bodyKeys = Object.keys(body);
    const allowedKeys = new Set(["type", "path", "threadId", "threadType", "caption"]);
    const unknownKeys = bodyKeys.filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "Unknown media fields", { unknownKeys });
    }
    if (
      !body.type ||
      !["image", "file"].includes(body.type) ||
      typeof body.path !== "string" ||
      body.path.trim().length === 0 ||
      typeof body.threadId !== "string" ||
      normalizeThreadId(body.threadId).length === 0
    ) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "Required media fields are invalid");
    }
    if (body.threadType !== undefined && !["user", "group"].includes(body.threadType)) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "threadType must be user or group");
    }
    if (body.caption !== undefined && typeof body.caption !== "string") {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "caption must be a string");
    }

    // The required-field guard above narrows these values at runtime. Keep local
    // constants so TypeScript and the dispatcher contract share that invariant.
    const mediaPath = body.path;
    const threadId = normalizeThreadId(body.threadId);
    const mediaType = body.type;

    // Safe media path validation
    const pathCheck = validateSafeMediaPath(mediaPath);
    if (!pathCheck.allowed) {
      return sendApiError(reply, 403, "MEDIA_PATH_BLOCKED", "Media path is not allowed");
    }

    const threadType = body.threadType || "user";
    const safeFilename = mediaPath.split(/[\\/]/).pop() || mediaPath;

    const result = await sendOutbound({
      kind: "media",
      threadId,
      threadType: threadType as "user" | "group",
      source: "manual_media",
      mediaType,
      filePath: pathCheck.resolvedPath,
      filename: safeFilename,
      caption: body.caption,
      metadata: {
        route: "zalo/send-media",
        mediaType,
        basename: safeFilename,
      },
    });

    return {
      success: result.success,
      messageId: result.sentMessageId ?? null,
      sentMessageId: result.sentMessageId ?? null,
      decision: result.decision === "allow" ? (result.dryRun ? "dry_run" : "sent") : result.decision,
      dryRun: result.dryRun,
      outboundRecordId: result.outboundRecordId ?? null,
      error: result.error ?? null,
      errorCode: result.errorCode ?? null,
    };
  });

  // POST /api/zalo/create-poll
  app.post("/zalo/create-poll", async (request, reply) => {
    const body = request.body as {
      groupId: string;
      question: string;
      options: string[];
      expiredTime?: number;
      allowMultiChoices?: boolean;
      allowAddNewOption?: boolean;
      hideVotePreview?: boolean;
      isAnonymous?: boolean;
    };

    if (!body.groupId || !body.question || !body.options?.length) {
      reply.status(400);
      return { success: false, error: "Missing required fields: groupId, question, options" };
    }

    const { createPollInGroup } = await import("../services/zalo-poll.service.js");
    return createPollInGroup({
      groupId: body.groupId,
      question: body.question,
      options: body.options,
      expiredTime: body.expiredTime ?? 0,
      allowMultiChoices: body.allowMultiChoices ?? false,
      allowAddNewOption: body.allowAddNewOption ?? false,
      hideVotePreview: body.hideVotePreview ?? false,
      isAnonymous: body.isAnonymous ?? false,
    });
  });

  // GET /api/zalo/groups — list all joined groups
  app.get("/zalo/groups", async (_request, reply) => {
    const gw = getZaloGateway();
    if (!gw.isConnected()) {
      reply.status(503);
      return { success: false, error: "ZALO_NOT_CONNECTED" };
    }
    const api = gw.getApi();
    if (!api) {
      reply.status(503);
      return { success: false, error: "ZALO_API_UNAVAILABLE" };
    }
    try {
      // Step 1: get all group IDs
      const allGroups = await api.getAllGroups();
      const groupIds = Object.keys(allGroups.gridVerMap || {});
      
      if (groupIds.length === 0) {
        return { success: true, groups: [], total: 0 };
      }

      // Step 2: get info for all groups (batch)
      const info = await api.getGroupInfo(groupIds);
      const groups = groupIds.map((gid: string) => {
        const gi = info.gridInfoMap?.[gid];
        return {
          groupId: gid,
          name: gi?.name || "Unknown",
          memberCount: gi?.totalMember || gi?.memberCount || 0,
          avatar: gi?.avatar || null,
        };
      });

      return { success: true, groups, total: groups.length };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ═══════════════════════════════════════════════════════════
  // POST /api/zalo/send-voice
  // Generate TTS audio + send as voice message via Zalo.
  // ═══════════════════════════════════════════════════════════
  app.post("/zalo/send-voice", async (request, reply) => {
    const body = request.body as {
      threadId: string;
      threadType?: "user" | "group";
      text: string;
      voice?: string;
      dryRun?: boolean;
    };

    if (!body.threadId || !body.text) {
      reply.status(400);
      return { success: false, error: "Missing required fields: threadId, text" };
    }

    // ── Feature flag: voice disabled by default ──────────────────
    if (!config.zalo.voiceEnabled) {
      reply.status(503);
      return {
        success: false,
        error: "Voice/TTS feature is not enabled. Set ZALO_VOICE_ENABLED=true to enable.",
        errorCode: "VOICE_NOT_SUPPORTED",
      };
    }

    const threadType = body.threadType || "user";
    const dryRun = body.dryRun ?? config.zalo.dryRun;

    // ── TTS: text → audio ──────────────────────────────────────
    // ── TTS: text → audio ──────────────────────────────────────
    const { getTtsService, convertToM4a } = await import("../services/zalo-tts.service.js");
    const tts = getTtsService();
    const ttsResult = await tts.generateSpeech({
      text: body.text,
      voice: body.voice || "vi-VN-NamMinhNeural",
    });

    if (!ttsResult.success) {
      saveVoiceAudit({
        threadId: body.threadId,
        threadType,
        text: body.text,
        textHash: null,
        audioPath: null,
        duration: null,
        dryRun,
        decision: "block",
        reason: ttsResult.error ?? "TTS_GENERATION_FAILED",
        errorCode: ttsResult.errorCode ?? "TTS_GENERATION_FAILED",
      }).catch(() => {});
      reply.status(422);
      return ttsResult;
    }

    // ── Convert MP3 → M4A for Zalo voice compatibility ──────────
    const m4aPath = await convertToM4a(ttsResult.audioPath!);
    const audioPath = m4aPath || ttsResult.audioPath!; // fallback to MP3 if conversion fails

    // ── Safe path check ────────────────────────────────────────
    const baseDir = config.zalo.mediaAllowedBaseDir;
    if (baseDir && audioPath && !audioPath.startsWith(baseDir)) {
      saveVoiceAudit({
        threadId: body.threadId,
        threadType,
        text: body.text,
        textHash: ttsResult.textHash ?? null,
        audioPath: audioPath,
        duration: ttsResult.duration ?? null,
        dryRun,
        decision: "block",
        reason: "Audio file outside allowed directory",
        errorCode: "MEDIA_PATH_BLOCKED",
      }).catch(() => {});
      reply.status(403);
      return { success: false, error: "Audio file outside allowed directory", errorCode: "MEDIA_PATH_BLOCKED" };
    }

    // ── Save audit: tts generated successfully ─────────────────
    saveVoiceAudit({
      threadId: body.threadId,
      threadType,
      text: body.text,
      textHash: ttsResult.textHash ?? null,
      audioPath: audioPath ?? null,
      duration: ttsResult.duration ?? null,
      dryRun,
      decision: "allow",
      reason: m4aPath ? "tts_converted_to_m4a" : "tts_generated_mp3",
      errorCode: null,
    }).catch(() => {});

    // ── Send voice via Unified Outbound Dispatcher ────────────
    if (!audioPath) {
      return { success: false, error: "No audio path", errorCode: "TTS_NO_AUDIO_PATH" };
    }

    const voiceResult = await sendOutbound({
      kind: "voice",
      threadId: normalizeThreadId(body.threadId),
      threadType: threadType as "user" | "group",
      source: "manual_voice",
      audioPath,
      metadata: {
        route: "zalo/send-voice",
        mediaType: "voice",
        basename: audioPath.split("/").pop() || audioPath,
        textLength: body.text?.length,
      },
    });

    saveVoiceAudit({
      threadId: body.threadId,
      threadType,
      text: body.text,
      textHash: ttsResult.textHash ?? null,
      audioPath: audioPath,
      duration: ttsResult.duration ?? null,
      dryRun: voiceResult.dryRun,
      decision: voiceResult.success ? "allow" : "block",
      reason: voiceResult.success ? "voice_sent" : (voiceResult.error ?? "voice_send_failed"),
      sentMessageId: voiceResult.sentMessageId ?? null,
      errorCode: voiceResult.errorCode ?? null,
    }).catch(() => {});

    return {
      success: voiceResult.success || voiceResult.dryRun,
      audioPath: audioPath,
      duration: ttsResult.duration,
      sentMessageId: voiceResult.sentMessageId ?? null,
      decision: voiceResult.decision === "allow" ? (voiceResult.dryRun ? "dry_run" : "sent") : voiceResult.decision,
      dryRun: voiceResult.dryRun,
      outboundRecordId: voiceResult.outboundRecordId ?? null,
      error: voiceResult.error,
      errorCode: voiceResult.errorCode,
    };
  });

  // ═════════════════════════════════════════════════════════════
  // Vision / Image Understanding API
  // ═════════════════════════════════════════════════════════════

  app.get("/zalo/messages/:id/vision", async (request, reply) => {
    const { id } = request.params as { id: string };
    const msg = await prisma.message.findUnique({
      where: { id },
      select: { id: true, zaloMessageId: true, threadId: true, content: true, messageType: true, metadata: true },
    });
    if (!msg) {
      reply.status(404);
      return { success: false, error: "Message not found" };
    }

    // Find associated AgentTask for this message
    const task = await prisma.agentTask.findFirst({
      where: { messageId: msg.zaloMessageId ?? undefined },
      orderBy: { createdAt: "desc" },
    });

    const visionData = task?.result ? JSON.parse(task.result) : null;

    return {
      success: true,
      message: {
        id: msg.id,
        type: msg.messageType,
        content: msg.content,
        hasImage: msg.messageType === "image",
      },
      vision: visionData ? {
        description: visionData.imageDescription ?? null,
        ocrText: visionData.ocrText ?? null,
        provider: visionData.provider ?? null,
        model: visionData.model ?? null,
        confidence: visionData.confidence ?? null,
        imageHash: visionData.imageHash ?? null,
      } : null,
    };
  });

  app.post("/vision/analyze", async (request, reply) => {
    const { imagePath, prompt } = request.body as {
      imagePath?: string;
      prompt?: string;
    };

    if (!imagePath) {
      reply.status(400);
      return { success: false, error: "imagePath required" };
    }

    // Validate path is within safe directory
    const { validateSafeDownloadPath } = await import("../services/image-download.service.js");
    if (!validateSafeDownloadPath(imagePath)) {
      reply.status(403);
      return { success: false, error: "Path outside allowed directory", errorCode: "UNSAFE_PATH" };
    }

    try {
      const { analyzeImage } = await import("../services/image-understanding.service.js");
      const result = await analyzeImage(imagePath, prompt);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.status(500);
      return { success: false, error: msg.slice(0, 500) };
    }
  });

  // ═════════════════════════════════════════════════════════════════
  // Batch 16 — Zalo Live-Safe Operations Dashboard endpoints
  // ═════════════════════════════════════════════════════════════════

  app.post("/zalo/ops/reconnect", async (request) => {
    const body = request.body as { userId?: string } | undefined;
    const { reconnectZalo } = await import("../services/zalo-ops.service.js");
    return reconnectZalo(body?.userId);
  });

  app.post("/zalo/ops/disconnect", async (request) => {
    const body = request.body as { userId?: string } | undefined;
    const { disconnectZalo } = await import("../services/zalo-ops.service.js");
    return disconnectZalo(body?.userId);
  });

  app.get("/zalo/ops/qr", async () => {
    const { getQRStatus } = await import("../services/zalo-ops.service.js");
    return getQRStatus();
  });

  app.post("/zalo/ops/test-dm", async (request, reply) => {
    const body = request.body as { threadId?: unknown; content?: string; userId?: string } | null | undefined;
    const threadId = normalizeThreadId(body?.threadId);
    if (!threadId) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "threadId is required");
    }
    const { testDM } = await import("../services/zalo-ops.service.js");
    return testDM({ threadId, content: body?.content }, body?.userId);
  });


}


// ═══════════════════════════════════════════════════════════
// Public Ops Routes — no auth required (used by /zalo-ops dashboard)
// Exposed as a separate plugin registered WITHOUT adminAuth.
// ═══════════════════════════════════════════════════════════
export async function zaloPublicOpsRoutes(app: FastifyInstance) {
  app.get("/zalo/ops/status", async () => {
    const { getZaloOpsStatus } = await import("../services/zalo-ops.service.js");
    return getZaloOpsStatus();
  });

  app.get("/zalo/ops/recent-events", async () => {
    const { getRecentEvents } = await import("../services/zalo-ops.service.js");
    return getRecentEvents();
  });
}

// ═══════════════════════════════════════════════════════════
// Voice audit helper
// ═══════════════════════════════════════════════════════════

interface VoiceAuditEntry {
  threadId: string;
  threadType: "user" | "group";
  text: string;
  textHash: string | null;
  audioPath: string | null;
  duration: number | null;
  dryRun: boolean;
  decision: "allow" | "block";
  reason: string;
  sentMessageId?: string | null;
  errorCode?: string | null;
}

async function saveVoiceAudit(entry: VoiceAuditEntry): Promise<void> {
  const timestamp = new Date().toISOString();
  const logLine = JSON.stringify({
    ...entry,
    timestamp,
    module: "voice-tts",
  });
  // Write to audit log file (same pattern as other audit logs)
  const { appendFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const auditPath = join(process.cwd(), "logs", "voice-audit.jsonl");
  try {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(process.cwd(), "logs"), { recursive: true });
    appendFileSync(auditPath, logLine + "\n");
  } catch {
    // Non-critical — log to console as fallback
    console.log(`[voice-audit] ${logLine}`);
  }
}
