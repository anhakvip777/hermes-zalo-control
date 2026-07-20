// =============================================================================
// Thread Settings API routes — Manage per-thread configuration
// =============================================================================

import type { FastifyInstance } from "fastify";
import {
  peekThreadSettings,
  updateThreadSettings,
  listThreadSettings,
  type ThreadSettingData,
} from "../services/thread-settings.service.js";
import { sendApiError } from "../http/api-error.js";
import { prisma } from "../db.js";
import { normalizeThreadId } from "../services/thread-id.js";

type ThreadSettingsPatchBody = Partial<Omit<ThreadSettingData, "threadId">>;

const THREAD_SETTINGS_ALLOWED_FIELDS = [
  "autoReplyEnabled",
  "groupMentionRequired",
  "groupReplyWindowSeconds",
  "allowCreateReminder",
  "allowMedia",
  "allowImageUnderstanding",
  "allowDocumentUnderstanding",
  "notes",
] as const;

const THREAD_SETTINGS_BOOLEAN_FIELDS = [
  "autoReplyEnabled",
  "groupMentionRequired",
  "allowCreateReminder",
  "allowMedia",
  "allowImageUnderstanding",
  "allowDocumentUnderstanding",
] as const;

const PRISMA_INT_MAX = 2_147_483_647;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function parsePaginationInteger(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function threadSettingsRoutes(app: FastifyInstance) {
  // ═════════════════════════════════════════════════════════════════
  // GET /api/threads/settings — List all thread settings
  // ═════════════════════════════════════════════════════════════════
  app.get("/threads/settings", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const page = parsePaginationInteger(query.page, 1);
    const pageSize = parsePaginationInteger(query.pageSize, 50);
    if (page === null || page < 1 || pageSize === null || pageSize < 1 || pageSize > 100) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "page must be >= 1 and pageSize must be 1-100");
    }

    try {
      const result = await listThreadSettings(page, pageSize);
      const threadIds = result.data.map((setting) => setting.threadId);
      const [threads, messageEvidence] = await Promise.all([
        prisma.zaloThread.findMany({
          where: { id: { in: threadIds } },
          select: { id: true, type: true },
        }),
        prisma.message.groupBy({
          by: ["threadId", "threadType"],
          where: { threadId: { in: threadIds } },
        }),
      ]);

      type EvidenceState = {
        type: "user" | "group" | undefined;
        invalid: boolean;
        conflict: boolean;
      };
      const evidenceByThread = new Map<string, EvidenceState>();
      for (const id of threadIds) {
        evidenceByThread.set(id, { type: undefined, invalid: false, conflict: false });
      }

      const addEvidence = (threadId: string, value: unknown) => {
        const state = evidenceByThread.get(threadId);
        if (!state) return;
        if (value !== "user" && value !== "group") {
          state.invalid = true;
          return;
        }
        if (state.type === undefined) state.type = value;
        else if (state.type !== value) state.conflict = true;
      };

      for (const thread of threads) addEvidence(thread.id, thread.type);
      for (const message of messageEvidence) addEvidence(message.threadId, message.threadType);

      const threadTypes = new Map<string, "user" | "group" | "unknown">();
      for (const [threadId, state] of evidenceByThread) {
        threadTypes.set(
          threadId,
          !state.invalid && !state.conflict && state.type !== undefined ? state.type : "unknown",
        );
      }
      return {
        ...result,
        data: result.data.map((setting) => ({
          ...setting,
          threadType: threadTypes.get(setting.threadId) ?? "unknown",
        })),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendApiError(reply, 500, "THREAD_SETTINGS_LIST_FAILED", msg);
    }
  });

  // ═════════════════════════════════════════════════════════════════
  // GET /api/threads/:threadId/settings — Get single thread settings
  // ═════════════════════════════════════════════════════════════════
  app.get("/threads/:threadId/settings", async (request, reply) => {
    const rawThreadId = (request.params as { threadId?: unknown } | undefined)?.threadId;
    const threadId = typeof rawThreadId === "string" ? normalizeThreadId(rawThreadId) : "";
    if (!threadId) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "threadId is required");
    }
    const query = request.query as Record<string, string>;
    const rawThreadType = query.threadType;
    if (rawThreadType !== undefined && rawThreadType !== "user" && rawThreadType !== "group") {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "threadType must be user or group");
    }

    try {
      let threadType: "user" | "group" | "unknown" = rawThreadType ?? "unknown";
      if (threadType === "unknown") {
        const [thread, messageTypes] = await Promise.all([
          prisma.zaloThread.findUnique({ where: { id: threadId }, select: { type: true } }),
          prisma.message.findMany({
            where: { threadId },
            distinct: ["threadType"],
            select: { threadType: true },
          }),
        ]);
        const evidence = new Set<string>();
        if (thread?.type) evidence.add(thread.type);
        for (const message of messageTypes) evidence.add(message.threadType);
        if (evidence.size === 1) {
          const [only] = evidence;
          if (only === "user" || only === "group") threadType = only;
        }
      }
      if (threadType === "unknown") {
        return {
          data: {
            threadId,
            threadType: "unknown",
            configured: false,
            autoReplyEnabled: false,
            groupMentionRequired: true,
            groupReplyWindowSeconds: 0,
            allowCreateReminder: false,
            allowMedia: false,
            allowImageUnderstanding: false,
            allowDocumentUnderstanding: false,
            notes: null,
          },
        };
      }
      const settings = await peekThreadSettings(threadId, threadType);
      return { data: { ...settings.data, threadType, configured: settings.configured } };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendApiError(reply, 500, "THREAD_SETTINGS_READ_FAILED", msg);
    }
  });

  // ═════════════════════════════════════════════════════════════════
  // PATCH /api/threads/:threadId/settings — Update thread settings
  // ═════════════════════════════════════════════════════════════════
  app.patch("/threads/:threadId/settings", async (request, reply) => {
    const rawThreadId = (request.params as { threadId?: unknown } | undefined)?.threadId;
    const threadId = normalizeThreadId(rawThreadId);
    if (!threadId) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "threadId is required");
    }

    const body = request.body as unknown;

    if (!isPlainObject(body)) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "Request body must be a plain object");
    }

    // Validate allowed fields
    const allowedFields = [...THREAD_SETTINGS_ALLOWED_FIELDS];
    const unknownKeys = Object.keys(body).filter((k) => !allowedFields.includes(k as typeof THREAD_SETTINGS_ALLOWED_FIELDS[number]));
    if (unknownKeys.length > 0) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", `Unknown fields: ${unknownKeys.join(", ")}`, { allowedFields });
    }
    const updateFields = allowedFields.filter((field) => body[field] !== undefined);
    if (updateFields.length === 0) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "At least one setting field is required");
    }

    // Validate every declared field type at the API boundary.
    for (const field of THREAD_SETTINGS_BOOLEAN_FIELDS) {
      if (body[field] !== undefined && typeof body[field] !== "boolean") {
        return sendApiError(reply, 400, "VALIDATION_ERROR", `${field} must be a boolean`);
      }
    }
    const windowSeconds = body.groupReplyWindowSeconds;
    if (windowSeconds !== undefined && (
      typeof windowSeconds !== "number" ||
      !Number.isFinite(windowSeconds) ||
      !Number.isInteger(windowSeconds) ||
      windowSeconds < 0 ||
      windowSeconds > PRISMA_INT_MAX
    )) {
      return sendApiError(
        reply,
        400,
        "VALIDATION_ERROR",
        `groupReplyWindowSeconds must be an integer between 0 and ${PRISMA_INT_MAX}`,
      );
    }
    if (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string") {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "notes must be a string or null");
    }

    try {
      const settings = await updateThreadSettings(threadId, body as ThreadSettingsPatchBody);
      return { data: settings };
    } catch {
      return sendApiError(reply, 500, "THREAD_SETTINGS_UPDATE_FAILED", "Failed to update thread settings");
    }
  });

  // ═════════════════════════════════════════════════════════════════
  // GET /api/threads — List known Zalo threads (merged with settings)
  // ═════════════════════════════════════════════════════════════════
  app.get("/threads", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const page = query.page ? parseInt(query.page, 10) : 1;
    const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 50;

    try {
      const { listThreads } = await import("../services/zalo-receive.js");
      return listThreads({ page, pageSize, type: query.type });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: "Failed to list threads", message: msg });
    }
  });

  // ═════════════════════════════════════════════════════════════
  // GET /api/threads/:threadId/conversation
  // ═════════════════════════════════════════════════════════════

  app.get("/threads/:threadId/conversation", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const query = (request.query ?? {}) as { limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 100;

    try {
      const { buildConversationContext } = await import("../services/conversation-context.service.js");
      const ctx = await buildConversationContext(threadId, { maxMessages: Math.min(limit, 200) });
      return { success: true, data: ctx };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: "Failed to load conversation", message: msg });
    }
  });

  // ═════════════════════════════════════════════════════════════
  // GET /api/threads/:threadId/conversation-state
  // ═════════════════════════════════════════════════════════════

  app.get("/threads/:threadId/conversation-state", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };

    try {
      const { getConversationState } = await import("../services/thread-conversation-state.service.js");
      const state = await getConversationState(threadId);
      return { success: true, data: state };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: "Failed to load state", message: msg });
    }
  });

  // ═════════════════════════════════════════════════════════════
  // DELETE /api/threads/:threadId/conversation-state
  // ═════════════════════════════════════════════════════════════

  app.delete("/threads/:threadId/conversation-state", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };

    try {
      const { clearConversationState } = await import("../services/thread-conversation-state.service.js");
      await clearConversationState(threadId);
      return { success: true, message: "Conversation state cleared" };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: "Failed to clear state", message: msg });
    }
  });
}
