import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { resolve, normalize, relative, sep } from "node:path";
import { SendMessageSchema } from "@hermes/shared";
import { getZaloGateway } from "../services/zalo-gateway.service.js";
import { ZaloMessageSender } from "../services/zalo-message-sender.js";
import { listThreads, listMessages } from "../services/zalo-receive.js";
import { config } from "../config.js";
import { getCurrentEffectiveDryRun } from "../services/runtime-config.service.js";
import { prisma } from "../db.js";

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
      return reply.status(500).send({ error: "LoginFailed", message: msg });
    }
  });

  // ═════════════════════════════════════════════════════════════════
  // GET /api/zalo/login/status
  // ═════════════════════════════════════════════════════════════════
  app.get("/zalo/login/status", async () => {
    const status = getZaloGateway().getStatus();
    const qrExists = existsSync(resolve(config.zalo.sessionDir, "..", "qr.png")) ||
                     existsSync(resolve(process.cwd(), "qr.png"));
    return {
      ...status,
      qrAvailable: qrExists,
    };
  });

  // ═════════════════════════════════════════════════════════════════
  // GET /api/zalo/login/qr
  // ═════════════════════════════════════════════════════════════════
  app.get("/zalo/login/qr", async (request, reply) => {
    const qrPath1 = resolve(config.zalo.sessionDir, "..", "qr.png");
    const qrPath2 = resolve(process.cwd(), "qr.png");
    const qrPath = existsSync(qrPath1) ? qrPath1 : existsSync(qrPath2) ? qrPath2 : null;

    if (!qrPath) {
      return reply.status(404).send({ error: { code: "QR_NOT_FOUND", message: "QR code not yet generated or expired. Call POST /api/zalo/login/start first." } });
    }

    const data = readFileSync(qrPath);
    reply.header("Content-Type", "image/png");
    reply.header("Content-Disposition", "inline; filename=\"zalo-qr.png\"");
    return reply.send(data);
  });

  // ═════════════════════════════════════════════════════════════════
  // POST /api/zalo/send-test
  // ═════════════════════════════════════════════════════════════════
  app.post("/zalo/send-test", async (request, reply) => {
    const input = SendMessageSchema.parse(request.body);
    const sender = new ZaloMessageSender();

    const result = await sender.sendMessage(
      input.content,
      input.threadId,
      input.threadType,
    );

    return { data: result };
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
    const body = request.body as {
      type: "image" | "file";
      path: string;
      threadId: string;
      threadType?: "user" | "group";
      caption?: string;
    };

    if (!body.type || !body.path || !body.threadId) {
      reply.status(400);
      return { success: false, error: "Missing required fields: type, path, threadId" };
    }

    // Safe media path validation
    const pathCheck = validateSafeMediaPath(body.path);
    if (!pathCheck.allowed) {
      reply.status(403);
      return { success: false, error: (pathCheck as { allowed: false; error: string }).error, errorCode: "MEDIA_PATH_BLOCKED" };
    }

    const sender = new ZaloMessageSender();
    const threadType = body.threadType || "user";

    if (body.type === "image") {
      return sender.sendImage(pathCheck.resolvedPath, body.threadId, threadType, body.caption);
    }
    if (body.type === "file") {
      return sender.sendFile(pathCheck.resolvedPath, body.threadId, threadType, body.caption);
    }

    reply.status(400);
    return { success: false, error: `Invalid type: ${body.type}. Use "image" or "file".` };
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

    // ── Send voice via ZaloMessageSender ───────────────────────
    if (!audioPath) {
      return { success: false, error: "No audio path", errorCode: "TTS_NO_AUDIO_PATH" };
    }

    // Note: dryRun behavior is now controlled by getCurrentEffectiveDryRun()
    // The body.dryRun parameter is for audit recording only
    try {
      const sender = new ZaloMessageSender();
      const result = await sender.sendVoice(audioPath, body.threadId, threadType);

      saveVoiceAudit({
        threadId: body.threadId,
        threadType,
        text: body.text,
        textHash: ttsResult.textHash ?? null,
        audioPath: audioPath,
        duration: ttsResult.duration ?? null,
        dryRun: dryRun ?? getCurrentEffectiveDryRun(),
        decision: result.success ? "allow" : "block",
        reason: result.success ? "voice_sent" : (result.error ?? "voice_send_failed"),
        sentMessageId: result.messageId ?? null,
        errorCode: result.errorCode ?? null,
      }).catch(() => {});

      return {
        success: result.success,
        audioPath: audioPath,
        duration: ttsResult.duration,
        sentMessageId: result.messageId ?? null,
        error: result.error,
        errorCode: result.errorCode,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg, errorCode: "VOICE_SEND_FAILED" };
    }
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

  app.get("/zalo/ops/status", async () => {
    const { getZaloOpsStatus } = await import("../services/zalo-ops.service.js");
    return getZaloOpsStatus();
  });

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

  app.post("/zalo/ops/test-dm", async (request) => {
    const body = request.body as { threadId: string; content?: string; userId?: string };
    if (!body.threadId) {
      return { allowed: false, reason: "MISSING_THREAD_ID" };
    }
    const { testDM } = await import("../services/zalo-ops.service.js");
    return testDM({ threadId: body.threadId, content: body.content }, body.userId);
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
