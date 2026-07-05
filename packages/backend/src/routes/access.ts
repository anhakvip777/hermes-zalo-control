// =============================================================================
// P1.2 — Access Control Routes
// =============================================================================
// Admin-only API endpoints for managing ZaloPrincipal permissions:
//   GET    /access/principals
//   GET    /access/principals/:id
//   POST   /access/principals
//   PATCH  /access/principals/:id/role
//   PATCH  /access/principals/:id/status
//   PATCH  /access/principals/:id
//   GET    /access/audit
// =============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { adminAuth } from "../middleware/auth.js";
import {
  listPrincipals,
  getPrincipalById,
  createPrincipal,
  updatePrincipalRole,
  updatePrincipalStatus,
  updatePrincipal,
  listAudit,
  VALID_ROLES,
  VALID_STATUSES,
  VALID_TYPES,
} from "../services/principal.service.js";
import type { PrincipalRole, PrincipalStatus, PrincipalType } from "../services/principal.service.js";

// ═══════════════════════════════════════════════════════════════════
// Validation helpers
// ═══════════════════════════════════════════════════════════════════

function badRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message } });
}

function validateRole(role: unknown): role is PrincipalRole {
  return typeof role === "string" && (VALID_ROLES as readonly string[]).includes(role);
}

function validateStatus(status: unknown): status is PrincipalStatus {
  return typeof status === "string" && (VALID_STATUSES as readonly string[]).includes(status);
}

function validateType(type: unknown): type is PrincipalType {
  return typeof type === "string" && (VALID_TYPES as readonly string[]).includes(type);
}

// ═══════════════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════════════

export async function accessRoutes(app: FastifyInstance) {
  // ── GET /api/access/principals ─────────────────────────────────────
  app.get(
    "/access/principals",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as Record<string, string | undefined>;

      // Validate optional filter values
      if (query.role && !validateRole(query.role)) {
        return badRequest(reply, `Invalid role: ${query.role}. Must be one of: ${VALID_ROLES.join(", ")}`);
      }
      if (query.status && !validateStatus(query.status)) {
        return badRequest(reply, `Invalid status: ${query.status}. Must be one of: ${VALID_STATUSES.join(", ")}`);
      }
      if (query.type && !validateType(query.type)) {
        return badRequest(reply, `Invalid type: ${query.type}. Must be one of: ${VALID_TYPES.join(", ")}`);
      }

      const result = await listPrincipals({
        q: query.q,
        role: query.role as PrincipalRole | undefined,
        status: query.status as PrincipalStatus | undefined,
        type: query.type as PrincipalType | undefined,
        threadId: query.threadId,
      });

      return reply.send(result);
    },
  );

  // ── GET /api/access/principals/:id ──────────────────────────────────
  app.get(
    "/access/principals/:id",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const principal = await getPrincipalById(id);

      if (!principal) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Principal not found: ${id}` },
        });
      }

      return reply.send(principal);
    },
  );

  // ── POST /api/access/principals ────────────────────────────────────
  app.post(
    "/access/principals",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as Record<string, unknown>;

      const principalId = body?.principalId;
      const type = body?.type;
      const role = body?.role;

      // Required fields
      if (!principalId || typeof principalId !== "string" || principalId.trim().length === 0) {
        return badRequest(reply, "principalId is required and must be a non-empty string");
      }
      if (!validateType(type)) {
        return badRequest(
          reply,
          `type is required and must be one of: ${VALID_TYPES.join(", ")}`,
        );
      }
      if (!validateRole(role)) {
        return badRequest(
          reply,
          `role is required and must be one of: ${VALID_ROLES.join(", ")}`,
        );
      }

      // Optional fields validation
      const status = body?.status;
      if (status !== undefined && !validateStatus(status)) {
        return badRequest(
          reply,
          `status must be one of: ${VALID_STATUSES.join(", ")}`,
        );
      }

      const threadId = body?.threadId;
      if (threadId !== undefined && threadId !== null && typeof threadId !== "string") {
        return badRequest(reply, "threadId must be a string or null");
      }

      const displayName = body?.displayName;
      if (displayName !== undefined && displayName !== null && typeof displayName !== "string") {
        return badRequest(reply, "displayName must be a string or null");
      }

      try {
        const principal = await createPrincipal({
          principalId: principalId.trim(),
          type: type as PrincipalType,
          role: role as PrincipalRole,
          status: status !== undefined ? (status as PrincipalStatus) : undefined,
          threadId: threadId !== undefined ? (threadId as string | null) : null,
          displayName: displayName !== undefined ? (displayName as string | null) : null,
          notes: body?.notes as string | undefined,
          createdBy: "admin", // Admin-authenticated route
        });

        return reply.status(201).send(principal);
      } catch (err: any) {
        if (err?.code === "DUPLICATE_PRINCIPAL") {
          return reply.status(409).send({
            error: { code: "DUPLICATE_PRINCIPAL", message: err.message },
          });
        }
        throw err;
      }
    },
  );

  // ── PATCH /api/access/principals/:id/role ──────────────────────────
  app.patch(
    "/access/principals/:id/role",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;

      const role = body?.role;
      if (!validateRole(role)) {
        return badRequest(
          reply,
          `role is required and must be one of: ${VALID_ROLES.join(", ")}`,
        );
      }

      try {
        const updated = await updatePrincipalRole(id, {
          role: role as PrincipalRole,
          actor: (body?.actor as string) ?? "admin",
          reason: body?.reason as string | undefined,
        });

        return reply.send(updated);
      } catch (err: any) {
        if (err?.code === "NOT_FOUND") {
          return reply.status(404).send({
            error: { code: "NOT_FOUND", message: err.message },
          });
        }
        throw err;
      }
    },
  );

  // ── PATCH /api/access/principals/:id/status ────────────────────────
  app.patch(
    "/access/principals/:id/status",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;

      const status = body?.status;
      if (!validateStatus(status)) {
        return badRequest(
          reply,
          `status is required and must be one of: ${VALID_STATUSES.join(", ")}`,
        );
      }

      try {
        const updated = await updatePrincipalStatus(id, {
          status: status as PrincipalStatus,
          actor: (body?.actor as string) ?? "admin",
          reason: body?.reason as string | undefined,
        });

        return reply.send(updated);
      } catch (err: any) {
        if (err?.code === "NOT_FOUND") {
          return reply.status(404).send({
            error: { code: "NOT_FOUND", message: err.message },
          });
        }
        throw err;
      }
    },
  );

  // ── PATCH /api/access/principals/:id ───────────────────────────────
  app.patch(
    "/access/principals/:id",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;

      try {
        const updated = await updatePrincipal(id, {
          displayName: body?.displayName as string | null | undefined,
          notes: body?.notes as string | null | undefined,
          threadId: body?.threadId as string | null | undefined,
          actor: (body?.actor as string) ?? "admin",
          reason: body?.reason as string | undefined,
        });

        return reply.send(updated);
      } catch (err: any) {
        if (err?.code === "NOT_FOUND") {
          return reply.status(404).send({
            error: { code: "NOT_FOUND", message: err.message },
          });
        }
        throw err;
      }
    },
  );

  // ── GET /api/access/audit ──────────────────────────────────────────
  app.get(
    "/access/audit",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as Record<string, string | undefined>;
      const principalId = query.principalId;
      const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 100, 500) : 100;

      const result = await listAudit(principalId, limit);
      return reply.send(result);
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // AllowThreads — discover real Zalo friends/groups + manage allowlist
  // ═══════════════════════════════════════════════════════════════════

  // ── GET /api/access/threads/discover ───────────────────────────────
  // Query: type=user|group|all, query=, limit=, cursor=
  app.get(
    "/access/threads/discover",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as Record<string, string | undefined>;
      const type = (q.type ?? "all") as "user" | "group" | "all";
      if (!["user", "group", "all"].includes(type)) {
        return badRequest(reply, "type must be one of: user, group, all");
      }
      const limit = q.limit ? parseInt(q.limit, 10) : undefined;

      const { getZaloProvider } = await import("../services/zalo-provider/zca-js-provider.js");
      const { getAllowedThreads } = await import("../services/allowlist.service.js");
      const { discoverThreads } = await import("../services/threads-access.service.js");

      const allowedEntries = await getAllowedThreads();
      const result = await discoverThreads(
        { type, query: q.query, limit, cursor: q.cursor },
        { provider: getZaloProvider(), allowedEntries },
      );

      if (!result.connected) {
        return reply.status(503).send({
          error: { code: result.errorCode ?? "ZALO_NOT_CONNECTED", message: result.error ?? "Zalo not connected" },
          items: [],
        });
      }
      return reply.send({
        items: result.items,
        nextCursor: result.nextCursor ?? null,
        ...(result.errorCode ? { warning: { code: result.errorCode, message: result.error } } : {}),
      });
    },
  );

  // ── GET /api/access/threads/allowed ────────────────────────────────
  // Current persistent allowlist (threadId + threadType).
  app.get(
    "/access/threads/allowed",
    { preHandler: [adminAuth] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const { getAllowedThreads } = await import("../services/allowlist.service.js");
      const data = await getAllowedThreads();
      return reply.send({ data, total: data.length });
    },
  );

  // ── PATCH /api/access/threads/allow ────────────────────────────────
  // Body: { changes: [{ threadId, threadType: "user"|"group", allowed: boolean }] }
  app.patch(
    "/access/threads/allow",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as { changes?: unknown; reason?: string };
      if (!Array.isArray(body?.changes) || body.changes.length === 0) {
        return badRequest(reply, "changes must be a non-empty array");
      }
      const changes: Array<{ threadId: string; threadType: "user" | "group"; allowed: boolean }> = [];
      for (const c of body.changes as Array<Record<string, unknown>>) {
        if (typeof c?.threadId !== "string" || c.threadId.trim().length === 0) {
          return badRequest(reply, "each change requires a non-empty threadId");
        }
        if (c.threadType !== "user" && c.threadType !== "group") {
          return badRequest(reply, "each change requires threadType 'user' or 'group'");
        }
        if (typeof c.allowed !== "boolean") {
          return badRequest(reply, "each change requires boolean 'allowed'");
        }
        changes.push({ threadId: c.threadId.trim(), threadType: c.threadType, allowed: c.allowed });
      }

      const { applyAllowChanges } = await import("../services/allowlist.service.js");
      const data = await applyAllowChanges(
        changes,
        "admin",
        typeof body.reason === "string" ? body.reason : undefined,
      );
      return reply.send({ data, total: data.length });
    },
  );
}
