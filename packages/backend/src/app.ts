import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { scheduleRoutes } from "./routes/schedules.js";
import { executionRoutes } from "./routes/executions.js";
import { adminRoutes } from "./routes/admin.js";
import { zaloRoutes } from "./routes/zalo.js";
import { agentRoutes } from "./routes/agent.js";
import { attendanceRoutes } from "./routes/attendance.js";
import { threadSettingsRoutes } from "./routes/thread-settings.js";
import { systemRoutes } from "./routes/system.js";
import { ruleRoutes } from "./routes/rules.js";
import { documentRoutes } from "./routes/documents.js";
import { internalRoutes } from "./routes/internal.js";
import { errorHandler } from "./middleware/error-handler.js";
import { adminAuth } from "./middleware/auth.js";
import { strictRateLimit, agentRateLimit } from "./middleware/rate-limit.js";
import { initializeDefaultSettings } from "./services/settings.service.js";

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

  // Global admin auth middleware for protected route prefixes
  const withAdminAuth = { preHandler: [adminAuth] } as const;

  // Public routes
  await app.register(healthRoutes, { prefix: "/api" });

  // Protected routes (auth + rate limit)
  await app.register(scheduleRoutes, { prefix: "/api", preHandler: [adminAuth, strictRateLimit] });
  await app.register(executionRoutes, { prefix: "/api", preHandler: [adminAuth, strictRateLimit] });
  await app.register(adminRoutes, { prefix: "/api", preHandler: [adminAuth, strictRateLimit] });
  await app.register(zaloRoutes, { prefix: "/api", preHandler: [adminAuth, strictRateLimit] });
  await app.register(agentRoutes, { prefix: "/api", preHandler: [adminAuth, agentRateLimit] });
  await app.register(attendanceRoutes, { prefix: "/api", preHandler: [adminAuth, strictRateLimit] });
  await app.register(threadSettingsRoutes, { prefix: "/api", preHandler: [adminAuth, strictRateLimit] });
  await app.register(systemRoutes, { prefix: "/api" });
  await app.register(ruleRoutes, { prefix: "/api", preHandler: [adminAuth, strictRateLimit] });
  await app.register(documentRoutes, { prefix: "/api", preHandler: [adminAuth, strictRateLimit] });
  await app.register(internalRoutes, { prefix: "/api" }); // Internal auth — localhost + token, no admin middleware

  return app;
}
