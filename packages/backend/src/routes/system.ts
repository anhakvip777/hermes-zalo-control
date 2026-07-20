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
import { sendApiError } from "../http/api-error.js";

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
        return sendApiError(reply, 400, "MISSING_DRYRUN", "dryRun (boolean) is required");
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
          : result.errorCode === "GLOBAL_LIVE_DISABLED" || result.errorCode === "CONFIG_ERROR" || result.errorCode === "NO_BACKUP"
            ? 409
            : 500;
        return sendApiError(
          reply,
          code,
          result.errorCode ?? "RUNTIME_CONFIG_FAILED",
          result.error ?? "Runtime configuration update failed",
        );
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

  // ═══════════════════════════════════════════════════════════════════
  // Batch 15 — Runtime Settings (general-purpose key-value)
  // ═══════════════════════════════════════════════════════════════════

  const {
    getAllRuntimeSettings,
    setRuntimeSetting,
    getSettingMeta,
  } = await import("../services/runtime-config.service.js");

  // ── GET /api/system/runtime-settings — admin-only ────────────────
  app.get(
    "/system/runtime-settings",
    { preHandler: [adminAuth] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const [settings, meta] = await Promise.all([
        getAllRuntimeSettings(),
        Promise.resolve(getSettingMeta()),
      ]);
      return reply.send({ settings, meta });
    },
  );

  // ── PATCH /api/system/runtime-settings — admin-only ──────────────
  app.patch(
    "/system/runtime-settings",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as Record<string, unknown>;
      const key = body?.key as string | undefined;
      const value = body?.value;
      const reason = (body?.reason as string) ?? "";
      const ipAddress = (req.headers["x-forwarded-for"] as string) ?? req.ip;
      const userAgent = (req.headers["user-agent"] as string) ?? undefined;

      if (!key || typeof key !== "string") {
        return reply.status(400).send({ success: false, error: "key (string) is required", errorCode: "MISSING_KEY" });
      }
      if (value === undefined || value === null) {
        return reply.status(400).send({ success: false, error: "value is required", errorCode: "MISSING_VALUE" });
      }

      // Block direct dryRun changes via this endpoint — must use Safety Mode
      if (key === "autoReply.dryRun") {
        return reply.status(403).send({
          success: false,
          error: "dryRun must be toggled via /api/system/runtime-config/auto-reply with confirmation text",
          errorCode: "USE_SAFETY_MODE",
        });
      }

      const result = await setRuntimeSetting({ key, value, reason, ipAddress, userAgent });

      if (!result.success) {
        const code = result.errorCode === "VALIDATION_ERROR" || result.errorCode === "INVALID_TYPE"
          ? 400
          : result.errorCode === "CONTEXT_VALIDATION_ERROR" || result.errorCode === "UNKNOWN_KEY"
            ? 422
            : 500;
        return reply.status(code).send(result);
      }

      return reply.send(result);
    },
  );

  // ── GET /api/system/runtime-settings/audit — admin-only ──────────
  app.get(
    "/system/runtime-settings/audit",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as Record<string, string>;
      const limit = Math.min(parseInt(query.limit ?? "50", 10) || 50, 200);
      const allAudit = await getRuntimeConfigAudit(limit);
      // Filter out dryRun audits (those go through Safety Mode) & secrets
      const filtered = allAudit.filter((a) => a.key !== "autoReply.dryRun");
      return reply.send(filtered);
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

  // ═══════════════════════════════════════════════════════════════════
  // Batch 17 — Production Readiness Gate
  // ═══════════════════════════════════════════════════════════════════

  app.get(
    "/system/production-readiness",
    { preHandler: [adminAuth] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        const { getProductionReadiness } = await import(
          "../services/production-readiness.service.js"
        );
        const result = await getProductionReadiness();
        return reply.send(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "ReadinessCheckFailed", message: msg });
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // Batch 18 — Controlled Live Test Mode
  // ═══════════════════════════════════════════════════════════════════

  app.post(
    "/system/live-test/start",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const { startLiveTest } = await import("../services/live-test.service.js");
        const result = await startLiveTest({
          threadId: body?.threadId as string ?? "",
          maxMessages: (body.maxMessages === undefined ? 1 : body.maxMessages) as number,
          ttlSeconds: (body.ttlSeconds === undefined ? 120 : body.ttlSeconds) as number,
          confirmText: (body?.confirmText as string) ?? "",
          reason: (body?.reason as string) ?? "",
          createdBy: (body?.createdBy as string) ?? "admin",
        });
        if (!result.success) {
          const code = result.errorCode === "BAD_CONFIRM" || result.errorCode === "REASON_TOO_SHORT" || result.errorCode === "INVALID_THREAD_ID" || result.errorCode === "INVALID_MAX_MESSAGES" || result.errorCode === "INVALID_TTL"
            ? 400 : result.errorCode === "NOT_READY" || result.errorCode === "THREAD_NOT_ALLOWED" || result.errorCode === "GROUP_NOT_ALLOWED" || result.errorCode === "THREAD_UNVERIFIED" || result.errorCode === "THREAD_TYPE_CONFLICT" || result.errorCode === "SESSION_EXISTS" || result.errorCode === "ALREADY_LIVE"
            ? 409 : 500;
          return sendApiError(
            reply,
            code,
            result.errorCode ?? "LIVE_TEST_START_FAILED",
            result.error ?? "Controlled live test could not start",
          );
        }
        return reply.send(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "LiveTestStartFailed", message: msg });
      }
    },
  );

  app.post(
    "/system/live-test/stop",
    { preHandler: [adminAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = req.body as Record<string, unknown> | undefined;
        const { stopLiveTest } = await import("../services/live-test.service.js");
        const result = await stopLiveTest((body?.createdBy as string) ?? "admin");
        if (!result.success) {
          return reply.status(404).send(result);
        }
        return reply.send(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "LiveTestStopFailed", message: msg });
      }
    },
  );

  app.get(
    "/system/live-test/status",
    { preHandler: [adminAuth] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        const { getLiveTestStatus } = await import("../services/live-test.service.js");
        const result = await getLiveTestStatus();
        return reply.send(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "LiveTestStatusFailed", message: msg });
      }
    },
  );
}
