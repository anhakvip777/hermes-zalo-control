// =============================================================================
// Internal API — worker-to-backend outbound dispatch
// =============================================================================
// Only accessible from localhost with a shared INTERNAL_API_TOKEN.
// Workers POST outbound intents here instead of creating their own
// ZaloMessageSender. Backend is the sole Zalo session owner.
// =============================================================================

import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { sendOutbound } from "../services/outbound-dispatcher.service.js";
import type { OutboundSource } from "../services/outbound-dispatcher.service.js";

// ── Helpers ──────────────────────────────────────────────────────────

export function isLocalRequest(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

export function safeTokenEquals(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]! : null;
}

// ── Body schema ──────────────────────────────────────────────────────

interface InternalOutboundBody {
  threadId: string;
  threadType: "user" | "group";
  source: string; // "schedule" | "batch" | "worker"
  content: string;
  relatedMessageId?: string;
  metadata?: Record<string, unknown>;
}

// ── Register routes ──────────────────────────────────────────────────

export async function internalRoutes(app: FastifyInstance) {
  const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN;

  // ── Fail-safe gateway: reject if no token configured ───────────────
  if (!INTERNAL_TOKEN) {
    console.error("[internal-api] INTERNAL_API_TOKEN not set — internal API disabled.");
    // Register a route that always rejects so we don't silently open
    app.post("/internal/outbound/send", async (_req, reply) => {
      return reply.status(503).send({
        ok: false,
        error: "INTERNAL_API_NOT_CONFIGURED",
        message: "Internal API token not set. Set INTERNAL_API_TOKEN.",
      });
    });
    return;
  }

  console.log("[internal-api] Internal API enabled (token configured, localhost-only).");

  // ── POST /api/internal/outbound/send ───────────────────────────────
  app.post("/internal/outbound/send", async (req, reply) => {
    // 1. ── Localhost check ──────────────────────────────────────────
    const clientIp = req.ip;
    if (!isLocalRequest(clientIp)) {
      return reply.status(403).send({
        ok: false,
        error: "FORBIDDEN",
        message: "Internal API only accessible from localhost.",
      });
    }

    // 2. ── Token check ──────────────────────────────────────────────
    const token = extractBearerToken(req.headers.authorization);
    if (!token || !safeTokenEquals(token, INTERNAL_TOKEN)) {
      return reply.status(401).send({
        ok: false,
        error: "UNAUTHORIZED",
        message: "Invalid or missing internal API token.",
      });
    }

    // 3. ── Validate body ────────────────────────────────────────────
    const body = req.body as InternalOutboundBody;
    if (!body || !body.threadId || !body.content || !body.source) {
      return reply.status(400).send({
        ok: false,
        error: "BAD_REQUEST",
        message: "Missing required fields: threadId, content, source.",
      });
    }

    const threadType = body.threadType === "group" ? "group" : "user";

    // 4. ── Validate source ──────────────────────────────────────────
    const validSources: OutboundSource[] = ["schedule", "batch", "hermes"];
    const source = validSources.includes(body.source as OutboundSource)
      ? (body.source as OutboundSource)
      : "schedule"; // safe default

    // 5. ── Dispatch via Unified Outbound Dispatcher ──────────────────
    try {
      const result = await sendOutbound({
        threadId: body.threadId,
        threadType,
        source,
        content: body.content,
        relatedMessageId: body.relatedMessageId,
        metadata: body.metadata,
      });

      return reply.send({
        ok: result.success || result.dryRun,
        decision: result.dryRun
          ? "dry_run"
          : result.success
            ? "sent"
            : result.decision === "block" || result.decision === "skip"
              ? "blocked"
              : "failed",
        outboundRecordId: result.outboundRecordId,
        sentMessageId: result.sentMessageId,
        dryRun: result.dryRun,
        reason: result.reason,
        error: result.error,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[internal-api] dispatch error: ${msg}`);
      return reply.status(500).send({
        ok: false,
        decision: "failed",
        error: "DISPATCH_FAILED",
        message: msg.slice(0, 500),
      });
    }
  });

  // ── POST /api/internal/messages/handle-batch (R3.2) ─────────────────
  // Worker sends batch content here. Backend (which owns Zalo session)
  // calls handleIncomingMessage() in the backend process.
  app.post("/internal/messages/handle-batch", async (req, reply) => {
    // 1. Localhost check
    const clientIp = req.ip;
    if (!isLocalRequest(clientIp)) {
      return reply.status(403).send({ ok: false, error: "FORBIDDEN", message: "Internal API only accessible from localhost." });
    }

    // 2. Token check
    const token = extractBearerToken(req.headers.authorization);
    if (!token || !safeTokenEquals(token, INTERNAL_TOKEN)) {
      return reply.status(401).send({ ok: false, error: "UNAUTHORIZED", message: "Invalid or missing internal API token." });
    }

    // 3. Validate body
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body.threadId !== "string" || !body.threadId) {
      return reply.status(400).send({ ok: false, error: "BAD_REQUEST", message: "Missing required field: threadId." });
    }
    const threadType = body.threadType === "group" ? "group" : "user";
    const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
    if (messages.length === 0) {
      return reply.status(400).send({ ok: false, error: "BAD_REQUEST", message: "messages array must not be empty." });
    }
    const combinedContent = typeof body.combinedContent === "string" ? body.combinedContent : "";
    if (!combinedContent) {
      return reply.status(400).send({ ok: false, error: "BAD_REQUEST", message: "combinedContent must not be empty." });
    }

    // 4. Build synthetic NormalizedMessage and dispatch via handleIncomingMessage
    //    (runs in backend process — has Zalo session)
    try {
      const { handleIncomingMessage } = await import("../services/incoming-dispatcher.service.js");
      const { resolveLastBatchMessageIdentity } = await import("../services/message-batch.service.js");

      const messageIds = messages.map((m) => String(m.messageId ?? ""));
      const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata as Record<string, unknown>
        : {};
      const canonicalMessageCount = metadata.messageCount;
      if (
        typeof canonicalMessageCount !== "number" ||
        !Number.isInteger(canonicalMessageCount) ||
        canonicalMessageCount < 1 ||
        canonicalMessageCount !== messages.length
      ) {
        return reply.status(409).send({
          ok: false,
          error: "BATCH_MESSAGE_COUNT_MISMATCH",
          message: "Canonical batch count does not match the messages array.",
        });
      }
      const identity = await resolveLastBatchMessageIdentity(
        messageIds,
        body.threadId as string,
        canonicalMessageCount,
      );
      if (!identity) {
        return reply.status(409).send({
          ok: false,
          error: "BATCH_MESSAGE_ID_UNRESOLVED",
          message: "The last batch message has no matching internal record.",
        });
      }
      const syntheticMsg = {
        zaloMessageId: identity.zaloMessageId,
        dbMessageId: identity.dbMessageId,
        threadId: body.threadId as string,
        threadType: threadType as "user" | "group",
        senderId: (body.senderId as string) ?? "",
        content: combinedContent,
        messageType: "text",
        rawMetadata: JSON.stringify({
          source: "message_batch",
          batchId: metadata.batchId ?? null,
          messageIds,
          messageCount: messages.length,
          ...metadata,
        }),
        mentions: undefined,
      };

      const result = await handleIncomingMessage(syntheticMsg);

      return reply.send({
        ok: true,
        dispatched: result.dispatched,
        reason: result.reason ?? null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[internal-api] handle-batch error: ${msg}`);
      return reply.status(500).send({ ok: false, error: "BATCH_PROCESSING_FAILED", message: msg.slice(0, 500) });
    }
  });
}
