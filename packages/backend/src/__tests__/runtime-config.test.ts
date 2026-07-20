import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getEffectiveAutoReplyConfig,
  getEffectiveAutoReplyConfigSync,
  getCurrentEffectiveDryRun,
  setRuntimeConfig,
  getRuntimeConfig,
  getRuntimeConfigAudit,
  initRuntimeConfig,
} from "../services/runtime-config.service.js";
import { prisma } from "../db.js";

describe("Runtime Config — init", () => {
  it("initRuntimeConfig does not throw", async () => {
    await expect(initRuntimeConfig()).resolves.not.toThrow();
  });

  it("global effective dry-run remains enabled", () => {
    expect(getCurrentEffectiveDryRun()).toBe(true);
    expect(getEffectiveAutoReplyConfigSync().dryRun).toBe(true);
  });

  it("getEffectiveAutoReplyConfig returns valid config", async () => {
    const cfg = await getEffectiveAutoReplyConfig();
    expect(typeof cfg.enabled).toBe("boolean");
    expect(cfg.dryRun).toBe(true);
    expect(Array.isArray(cfg.allowedThreads)).toBe(true);
    expect(["env", "runtime"]).toContain(cfg.dryRunSource);
  });

  it("clamps a stale persisted false value to effective dry-run", async () => {
    await prisma.runtimeSetting.upsert({
      where: { key: "autoReply.dryRun" },
      create: { key: "autoReply.dryRun", value: "false", updatedBy: "test" },
      update: { value: "false", updatedBy: "test" },
    });

    try {
      await initRuntimeConfig();
      expect(getCurrentEffectiveDryRun()).toBe(true);
      expect(getEffectiveAutoReplyConfigSync().dryRun).toBe(true);
      await expect(getEffectiveAutoReplyConfig()).resolves.toMatchObject({
        dryRun: true,
        dryRunSource: "runtime",
      });
    } finally {
      await prisma.runtimeSetting.deleteMany({ where: { key: "autoReply.dryRun" } });
      await initRuntimeConfig();
    }
  });

  it("getRuntimeConfig returns array", async () => {
    const entries = await getRuntimeConfig();
    expect(Array.isArray(entries)).toBe(true);
  });
});

describe("Runtime Config — validation", () => {
  it.each([
    { confirmText: "wrong", reason: "Testing invalid confirm text" },
    { confirmText: "", reason: "Testing empty confirm" },
    { confirmText: "ENABLE LIVE MODE", reason: "short" },
    { confirmText: "ENABLE LIVE MODE", reason: "" },
  ])("rejects every global-live request before other validation", async ({ confirmText, reason }) => {
    const result = await setRuntimeConfig({ dryRun: false, confirmText, reason });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("GLOBAL_LIVE_DISABLED");
  });

  it("rejects toggle to dry-run with wrong confirmText", async () => {
    const result = await setRuntimeConfig({
      dryRun: true,
      confirmText: "ENABLE LIVE MODE",
      reason: "Testing wrong confirm for dry-run",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("BAD_CONFIRM_TEXT");
  });
});

describe("Runtime Config — dry-run toggle (safe)", () => {
  // Clean up after
  afterAll(async () => {
    try {
      await prisma.runtimeSetting.deleteMany({
        where: { key: "autoReply.dryRun" },
      });
      await prisma.runtimeConfigAudit.deleteMany({
        where: { key: "autoReply.dryRun" },
      });
    } catch {
      // ignore
    }
    // Reset cache
    await initRuntimeConfig();
  });

  it("toggles to dry-run successfully", async () => {
    const result = await setRuntimeConfig({
      dryRun: true,
      confirmText: "ENABLE DRY RUN",
      reason: "Unit test — return to safe mode",
    });
    expect(result.success).toBe(true);
    expect(result.oldValue).toBeTruthy();
    expect(result.newValue).toBe("true");

    // Verify cache updated
    expect(getCurrentEffectiveDryRun()).toBe(true);
  });

  it("effective config reflects runtime after toggle", async () => {
    const cfg = await getEffectiveAutoReplyConfig();
    expect(cfg.dryRun).toBe(true);
    expect(cfg.dryRunSource).toBe("runtime");
  });

  it("getRuntimeConfig returns the entry after toggle", async () => {
    const entries = await getRuntimeConfig();
    const dryRunEntry = entries.find((e) => e.key === "autoReply.dryRun");
    expect(dryRunEntry).toBeDefined();
    expect(dryRunEntry!.value).toBe("true");
  });

  it("audit log records the toggle", async () => {
    const audit = await getRuntimeConfigAudit(10);
    const toggleAudit = audit.find(
      (a) =>
        a.key === "autoReply.dryRun" && a.reason === "Unit test — return to safe mode",
    );
    expect(toggleAudit).toBeDefined();
    expect(toggleAudit!.newValue).toBe("true");
    expect(toggleAudit!.changedBy).toBe("admin");
  });

  it("toggle to dry-run again is idempotent", async () => {
    const result = await setRuntimeConfig({
      dryRun: true,
      confirmText: "ENABLE DRY RUN",
      reason: "Unit test — idempotent dry-run",
    });
    expect(result.success).toBe(true);
  });
});

describe("Runtime Config — no secrets in audit", () => {
  it("audit log does not contain raw API keys", async () => {
    const audit = await getRuntimeConfigAudit(50);
    const json = JSON.stringify(audit);
    expect(json).not.toContain("sk-");
    expect(json).not.toContain("password");
    expect(json).not.toContain("ADMIN_PASSWORD");
  });
});
