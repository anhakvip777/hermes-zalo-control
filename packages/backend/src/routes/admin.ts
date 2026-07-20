import type { FastifyInstance } from "fastify";
import * as settingsService from "../services/settings.service.js";
import * as executionService from "../services/execution.service.js";
import { config } from "../config.js";

export async function adminRoutes(app: FastifyInstance) {
  // Protected by registerProtected() in app.ts. Returns metadata only and is
  // never cacheable because it authenticates the current Authorization header.
  app.get("/admin/session", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Vary", "Authorization");
    return { authenticated: true, username: config.security.adminUsername };
  });

  // =========================================================================
  // GET /api/admin/status
  // =========================================================================
  app.get("/admin/status", async () => {
    return settingsService.getAdminStatus();
  });

  // =========================================================================
  // POST /api/admin/pause-sending
  // =========================================================================
  app.post("/admin/pause-sending", async () => {
    await settingsService.pauseSending();
    return { success: true, sendingEnabled: false };
  });

  // =========================================================================
  // POST /api/admin/resume-sending
  // =========================================================================
  app.post("/admin/resume-sending", async () => {
    await settingsService.resumeSending();
    return { success: true, sendingEnabled: true };
  });

  // =========================================================================
  // POST /api/admin/emergency-stop
  // =========================================================================
  app.post("/admin/emergency-stop", async () => {
    await settingsService.emergencyStop();
    return { success: true, emergencyStop: true, sendingEnabled: false, schedulesActive: false };
  });

  // =========================================================================
  // POST /api/admin/clear-emergency
  // =========================================================================
  app.post("/admin/clear-emergency", async () => {
    await settingsService.clearEmergencyStop();
    return { success: true, emergencyStop: false, sendingEnabled: true, schedulesActive: true };
  });

  // =========================================================================
  // GET /api/admin/executions — recent executions
  // =========================================================================
  app.get("/admin/executions", async () => {
    return executionService.getRecentExecutions(50);
  });

  // =========================================================================
  // GET /api/admin/settings — list all known settings
  // =========================================================================
  app.get("/admin/settings", async () => {
    const knownKeys = [
      "global.sending_enabled",
      "global.schedules_active",
      "global.emergency_stop",
      "retry.max_attempts",
      "retry.base_delay_ms",
    ];
    return settingsService.getSettings(knownKeys);
  });
}
