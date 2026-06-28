import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getEffectiveAutoReplyConfig,
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

  it("getCurrentEffectiveDryRun returns boolean", () => {
    expect(typeof getCurrentEffectiveDryRun()).toBe("boolean");
  });

  it("getEffectiveAutoReplyConfig returns valid config", async () => {
    const cfg = await getEffectiveAutoReplyConfig();
    expect(typeof cfg.enabled).toBe("boolean");
    expect(typeof cfg.dryRun).toBe("boolean");
    expect(Array.isArray(cfg.allowedThreads)).toBe(true);
    expect(["env", "runtime"]).toContain(cfg.dryRunSource);
  });

  it("getRuntimeConfig returns array", async () => {
    const entries = await getRuntimeConfig();
    expect(Array.isArray(entries)).toBe(true);
  });
});

describe("Runtime Config — validation", () => {
  it("rejects toggle to live with wrong confirmText", async () => {
    const result = await setRuntimeConfig({
      dryRun: false,
      confirmText: "wrong",
      reason: "Testing invalid confirm text",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("BAD_CONFIRM_TEXT");
  });

  it("rejects toggle to live without confirmText", async () => {
    const result = await setRuntimeConfig({
      dryRun: false,
      confirmText: "",
      reason: "Testing empty confirm",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("BAD_CONFIRM_TEXT");
  });

  it("rejects toggle to live with short reason", async () => {
    const result = await setRuntimeConfig({
      dryRun: false,
      confirmText: "ENABLE LIVE MODE",
      reason: "short",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("REASON_TOO_SHORT");
  });

  it("rejects toggle to live without reason", async () => {
    const result = await setRuntimeConfig({
      dryRun: false,
      confirmText: "ENABLE LIVE MODE",
      reason: "",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("REASON_TOO_SHORT");
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
