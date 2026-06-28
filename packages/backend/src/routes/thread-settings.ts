// =============================================================================
// Thread Settings API routes — Manage per-thread configuration
// =============================================================================

import type { FastifyInstance } from "fastify";
import {
  getThreadSettings,
  updateThreadSettings,
  listThreadSettings,
} from "../services/thread-settings.service.js";
import { config } from "../config.js";

export async function threadSettingsRoutes(app: FastifyInstance) {
  // ═════════════════════════════════════════════════════════════════
  // GET /api/threads/settings — List all thread settings
  // ═════════════════════════════════════════════════════════════════
  app.get("/threads/settings", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const page = query.page ? parseInt(query.page, 10) : 1;
    const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 50;
    return listThreadSettings(page, pageSize);
  });

  // ═════════════════════════════════════════════════════════════════
  // GET /api/threads/:threadId/settings — Get single thread settings
  // ═════════════════════════════════════════════════════════════════
  app.get("/threads/:threadId/settings", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const query = request.query as Record<string, string>;
    const threadType = (query.threadType as "user" | "group") || "user";

    try {
      const settings = await getThreadSettings(threadId, threadType);
      return { data: settings };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: "Failed to get thread settings", message: msg });
    }
  });

  // ═════════════════════════════════════════════════════════════════
  // PATCH /api/threads/:threadId/settings — Update thread settings
  // ═════════════════════════════════════════════════════════════════
  app.patch("/threads/:threadId/settings", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const body = request.body as {
      autoReplyEnabled?: boolean;
      groupMentionRequired?: boolean;
      groupReplyWindowSeconds?: number;
      allowCreateReminder?: boolean;
      allowMedia?: boolean;
      notes?: string;
    };

    // Validate allowed fields
    const allowedFields = [
      "autoReplyEnabled",
      "groupMentionRequired",
      "groupReplyWindowSeconds",
      "allowCreateReminder",
      "allowMedia",
      "allowImageUnderstanding",
      "notes",
    ];
    const unknownKeys = Object.keys(body).filter((k) => !allowedFields.includes(k));
    if (unknownKeys.length > 0) {
      return reply.status(400).send({
        error: `Unknown fields: ${unknownKeys.join(", ")}`,
        allowedFields,
      });
    }

    // Validate types
    if (body.groupReplyWindowSeconds !== undefined) {
      if (typeof body.groupReplyWindowSeconds !== "number" || body.groupReplyWindowSeconds < 0) {
        return reply.status(400).send({
          error: "groupReplyWindowSeconds must be a non-negative number",
        });
      }
    }

    try {
      const settings = await updateThreadSettings(threadId, body);
      return { data: settings };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: "Failed to update thread settings", message: msg });
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
