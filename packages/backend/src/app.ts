import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { scheduleRoutes } from "./routes/schedules.js";
import { executionRoutes } from "./routes/executions.js";
import { adminRoutes } from "./routes/admin.js";
import { zaloRoutes, zaloPublicOpsRoutes } from "./routes/zalo.js";
import { agentRoutes } from "./routes/agent.js";
import { attendanceRoutes } from "./routes/attendance.js";
import { threadSettingsRoutes } from "./routes/thread-settings.js";
import { systemRoutes } from "./routes/system.js";
import { ruleRoutes } from "./routes/rules.js";
import { documentRoutes } from "./routes/documents.js";
import { internalRoutes } from "./routes/internal.js";
import { accessRoutes } from "./routes/access.js";
import { traceRoutes } from "./routes/trace.js";
import { errorHandler } from "./middleware/error-handler.js";
import { adminAuth } from "./middleware/auth.js";
import { strictRateLimit, agentRateLimit } from "./middleware/rate-limit.js";
import { initializeDefaultSettings } from "./services/settings.service.js";

// A route plugin as used across this app: an async function taking the instance.
type RoutePlugin = (app: FastifyInstance) => Promise<void>;
type PreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;

/**
 * Register a protected route group behind adminAuth + a rate limiter.
 *
 * IMPORTANT: passing `preHandler` through `app.register(routes, { preHandler })`
 * does NOT attach the hook to the plugin's routes in Fastify — it is silently
 * ignored. Hooks must be added INSIDE the plugin's (encapsulated) scope. We
 * create a child scope, add the preHandler hooks there, then register the routes
 * within it so the hooks apply to every route the plugin defines.
 */
export async function registerProtected(
  app: FastifyInstance,
  routes: RoutePlugin,
  rateLimit: PreHandler,
): Promise<void> {
  await app.register(async (scope) => {
    scope.addHook("preHandler", adminAuth);
    scope.addHook("preHandler", rateLimit);
    await scope.register(routes as never, { prefix: "/api" });
  });
}

export async function buildApp() {
  // Initialize default app settings on first run
  await initializeDefaultSettings();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.isDev ? { target: "pino-pretty", options: { colorize: true } } : undefined,
    },
    // M8: Trust X-Forwarded-* headers when behind nginx reverse proxy
    // This ensures rate limiter sees real client IPs, not 127.0.0.1
    trustProxy: true,
  });

  // CORS
  await app.register(cors, {
    origin: config.cors.origin,
    credentials: true,
  });

  // Error handler
  app.setErrorHandler(errorHandler);

  // ── Public routes (no admin auth) ────────────────────────────────
  await app.register(healthRoutes, { prefix: "/api" });
  // System status — intentionally public (unchanged; never had admin auth)
  await app.register(systemRoutes, { prefix: "/api" });
  // Internal auth — localhost + token, guarded inside the plugin (no admin middleware)
  await app.register(internalRoutes, { prefix: "/api" });
  // Access control — adminAuth is enforced PER-ROUTE inside access.ts
  await app.register(accessRoutes, { prefix: "/api" });

  // ── Protected routes (adminAuth + rate limit via encapsulated scope) ──
  await registerProtected(app, scheduleRoutes, strictRateLimit);
  await registerProtected(app, executionRoutes, strictRateLimit);
  await registerProtected(app, adminRoutes, strictRateLimit);
  await registerProtected(app, zaloRoutes, strictRateLimit);
  // B1: zalo ops (status + recent-events) return real inbound content → admin-only
  await registerProtected(app, zaloPublicOpsRoutes, strictRateLimit);
  await registerProtected(app, agentRoutes, agentRateLimit);
  await registerProtected(app, attendanceRoutes, strictRateLimit);
  await registerProtected(app, threadSettingsRoutes, strictRateLimit);
  await registerProtected(app, ruleRoutes, strictRateLimit);
  await registerProtected(app, documentRoutes, strictRateLimit);
  await registerProtected(app, traceRoutes, strictRateLimit); // Decision trace — read-only, admin only

  return app;
}
