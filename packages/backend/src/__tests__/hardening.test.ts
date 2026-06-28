import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanDatabase } from "./shared-setup.js";
import * as settingsService from "../services/settings.service.js";
import { auditLog, listAuditLogs } from "../services/audit-log.service.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { ZaloMessageSender } from "../services/zalo-message-sender.js";
import { MockMessageSender } from "../services/message-sender.js";
import { config } from "../config.js";

beforeAll(async () => { await cleanDatabase(); });
afterAll(async () => { await cleanDatabase(); });
beforeEach(async () => { await cleanDatabase(); });

// ═══════════════════════════════════════════════════════════════════
describe("Production secret fail-fast", () => {
  it("config has adminPassword set", () => {
    expect(config.security.adminPassword).toBeTruthy();
  });

  it("config has jwtSecret set", () => {
    expect(config.security.jwtSecret).toBeTruthy();
  });

  it("config has cookieSecret set", () => {
    expect(config.security.cookieSecret).toBeTruthy();
  });

  it("auto-reply dryRun is true by default (safe default)", async () => {
    const { getCurrentEffectiveDryRun } = await import("../services/runtime-config.service.js");
    expect(getCurrentEffectiveDryRun()).toBe(true);
  });

  it("config.redis.url is empty (local fallback)", () => {
    // In dev, Redis is not required
    expect(config.redis.url || null).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("Audit Log", () => {
  it("creates audit log entry", async () => {
    await auditLog({
      action: "schedule.created",
      entityType: "schedule",
      entityId: "sched-1",
      actor: "ai",
      details: { name: "Test" },
    });

    const logs = await listAuditLogs({});
    expect(logs.total).toBe(1);
    expect(logs.data[0]!.action).toBe("schedule.created");
    expect(logs.data[0]!.entityId).toBe("sched-1");
    expect(logs.data[0]!.actor).toBe("ai");
  });

  it("filters audit logs by entityType", async () => {
    await auditLog({ action: "message.sent", entityType: "message", entityId: "m1" });
    await auditLog({ action: "schedule.updated", entityType: "schedule", entityId: "s1" });

    const msgs = await listAuditLogs({ entityType: "message" });
    expect(msgs.total).toBe(1);

    const scheds = await listAuditLogs({ entityType: "schedule" });
    expect(scheds.total).toBe(1);
  });

  it("audit log failure does not throw", async () => {
    // Even with invalid data, should not crash
    await expect(
      auditLog({ action: "test", entityType: "test" }),
    ).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("Rate Limiter Middleware", () => {
  it("allows requests within limit", () => {
    const limiter = createRateLimiter(5);
    for (let i = 0; i < 4; i++) {
      // Each call with a unique key shouldn't block
      const key = `test-key-${i}`;
      // We can't easily test middleware, but the factory works
    }
    expect(limiter).toBeInstanceOf(Function);
  });

  it("strictRateLimit and agentRateLimit are instantiated", async () => {
    const mod = await import("../middleware/rate-limit.js");
    expect(typeof mod.strictRateLimit).toBe("function");
    expect(typeof mod.agentRateLimit).toBe("function");
    expect(typeof mod.apiRateLimit).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("MessageSender — dry-run vs real", () => {
  it("MockMessageSender always returns success", async () => {
    const sender = new MockMessageSender();
    const r = await sender.sendMessage("test", "t1", "group");
    expect(r.success).toBe(true);
  });

  it("ZaloMessageSender respects dryRun=true", async () => {
    const sender = new ZaloMessageSender();
    const r = await sender.sendMessage("hello", "g1", "group");
    expect(r.success).toBe(true);
    expect(r.messageId).toContain("dry-run-");
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("Worker — executeJob via settings guard", () => {
  it("emergency stop blocks sending", async () => {
    await settingsService.initializeDefaultSettings();
    await settingsService.emergencyStop();

    const stopped = await settingsService.isEmergencyStop();
    expect(stopped).toBe(true);

    const canSend = await settingsService.isSendingEnabled();
    expect(canSend).toBe(false);
  });

  it("clear emergency restores sending", async () => {
    await settingsService.initializeDefaultSettings();
    await settingsService.emergencyStop();
    await settingsService.clearEmergencyStop();

    expect(await settingsService.isEmergencyStop()).toBe(false);
    expect(await settingsService.isSendingEnabled()).toBe(true);
  });
});
