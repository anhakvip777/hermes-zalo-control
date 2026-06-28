import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { runConfigChecks } from "../config-consistency.js";
import { getHealthSnapshot, getPublicHealth } from "../services/system-health.service.js";
import {
  getEffectiveAutoReplyConfig,
  getRuntimeConfig,
  setRuntimeConfig,
  getRuntimeConfigAudit,
} from "../services/runtime-config.service.js";
import { getAllHeartbeats } from "../services/heartbeat.service.js";
import { adminAuth } from "../middleware/auth.js";

export async function systemRoutes(app: FastifyInstance) {
  // ── GET /api/system/config-check — admin-only ──────────────────────
  app.get("/system/config-check", { preHandler: [adminAuth] }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const result = runConfigChecks();
    return reply.send(result);
  });

  // ── GET /api/system/health — public basic health ───────────────────
  app.get("/system/health", async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(getPublicHealth());
  });

  // ── GET /api/system/health/detail — admin-only full snapshot ───────
  app.get(
    "/system/health/detail",
    { preHandler: [adminAuth] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const snapshot = await getHealthSnapshot();
      return reply.send(snapshot);
    },
  );

  // ── GET /api/system/runtime-config — admin-only ────────────────────
  app.get(
    "/system/runtime-config",
    { preHandler: [adminAuth] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const [effective, entries, audit] = await Promise.all([
        getEffectiveAutoReplyConfig(),
        getRuntimeConfig(),
        getRuntimeConfigAudit(10),
      ]);
      return reply.send({ effective, overrides: entries, recentAudit: audit });
    },
  );

  // ── PATCH /api/system/runtime-config/auto-reply — admin-only ───────
  app.patch(
    "/system/runtime-config/auto-reply",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as Record<string, unknown>;
      const dryRun = body?.dryRun as boolean | undefined;
      const confirmText = (body?.confirmText as string) ?? "";
      const reason = (body?.reason as string) ?? "";
      const ipAddress = (req.headers["x-forwarded-for"] as string) ?? req.ip;
      const userAgent = (req.headers["user-agent"] as string) ?? undefined;

      if (typeof dryRun !== "boolean") {
        return reply.status(400).send({
          success: false,
          error: "dryRun (boolean) is required",
          errorCode: "MISSING_DRYRUN",
        });
      }

      const result = await setRuntimeConfig({
        dryRun,
        confirmText,
        reason,
        ipAddress,
        userAgent,
      });

      if (!result.success) {
        const code = result.errorCode === "BAD_CONFIRM_TEXT" || result.errorCode === "REASON_TOO_SHORT"
          ? 400
          : result.errorCode === "CONFIG_ERROR" || result.errorCode === "NO_BACKUP"
            ? 409
            : 500;
        return reply.status(code).send(result);
      }

      return reply.send(result);
    },
  );

  // ── GET /api/system/runtime-config/audit — admin-only ──────────────
  app.get(
    "/system/runtime-config/audit",
    { preHandler: [adminAuth] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const audit = await getRuntimeConfigAudit(50);
      return reply.send(audit);
    },
  );

  // ── GET /api/system/heartbeats — admin-only ─────────────────────────
  app.get(
    "/system/heartbeats",
    { preHandler: [adminAuth] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const result = await getAllHeartbeats();
      return reply.send(result);
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // Error Summary — aggregate + alert
  // ═══════════════════════════════════════════════════════════════════

  // ── GET /api/system/errors/summary — admin-only ──────────────────
  app.get(
    "/system/errors/summary",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const query = req.query as Record<string, string>;
        const hours = query.hours ? parseInt(query.hours, 10) : 24;
        const { getErrorSummary } = await import(
          "../services/error-summary.service.js"
        );
        const summary = await getErrorSummary(hours);
        return reply.send(summary);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "ErrorSummaryFailed", message: msg });
      }
    },
  );

  // ── GET /api/system/errors/recent — admin-only ───────────────────
  app.get(
    "/system/errors/recent",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const query = req.query as Record<string, string>;
        const limit = query.limit ? parseInt(query.limit, 10) : 50;
        const { getErrorSummary } = await import(
          "../services/error-summary.service.js"
        );
        const summary = await getErrorSummary(72);
        const recent = summary.recent.slice(0, Math.min(limit, 100));
        return reply.send({ recent, total: recent.length });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "RecentErrorsFailed", message: msg });
      }
    },
  );

  // ── POST /api/system/errors/test-alert — admin-only ──────────────
  app.post(
    "/system/errors/test-alert",
    { preHandler: [adminAuth] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        const { triggerTestAlert } = await import(
          "../services/error-summary.service.js"
        );
        const result = await triggerTestAlert();
        return reply.send(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "TestAlertFailed", message: msg });
      }
    },
  );
}
