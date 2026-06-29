import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config
const mockConfig = vi.hoisted(() => ({
  autoReply: {
    enabled: true,
    dryRun: true,
    allowedThreads: ["thread-123"],
    cooldownSeconds: 10,
    groupReplyWindowSeconds: 600,
  },
  messageBatching: {
    enabled: true,
    windowMs: 4000,
    maxMessages: 5,
    maxChars: 3000,
    threadTypes: ["user"],
  },
  document: {
    enabled: true,
    maxSizeMB: 50,
    allowedExtensions: ["pdf", "docx", "txt"],
  },
  vision: {
    enabled: true,
    maxSizeBytes: 10 * 1024 * 1024,
  },
}));

vi.mock("../config.js", () => ({ config: mockConfig }));

// Mock prisma
const mockPrismaStore: Record<string, { key: string; value: string; updatedBy: string; updatedAt: Date }> = {};
const mockAuditStore: Array<Record<string, unknown>> = [];

vi.mock("../db.js", () => ({
  prisma: {
    runtimeSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const row = mockPrismaStore[where.key];
        return row || null;
      }),
      findMany: vi.fn(async () => {
        return Object.values(mockPrismaStore);
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        mockPrismaStore[where.key] = {
          key: create?.key || where.key,
          value: create?.value || update?.value,
          updatedBy: create?.updatedBy || update?.updatedBy || "admin",
          updatedAt: new Date(),
        };
        return mockPrismaStore[where.key];
      }),
    },
    runtimeConfigAudit: {
      create: vi.fn(async ({ data }: any) => {
        mockAuditStore.push(data);
        return { id: "audit-" + mockAuditStore.length, ...data };
      }),
      findMany: vi.fn(async () => {
        return mockAuditStore.map((a, i) => ({ id: "audit-" + i, ...a, createdAt: new Date() }));
      }),
      count: vi.fn(async () => 0),
    },
    appSetting: {
      upsert: vi.fn(async () => ({})),
    },
    systemHeartbeat: {
      upsert: vi.fn(async () => ({})),
    },
  },
}));

// We need to clear the module cache and hot cache to get fresh state
beforeEach(async () => {
  // Clear mock stores
  for (const k of Object.keys(mockPrismaStore)) delete mockPrismaStore[k];
  mockAuditStore.length = 0;

  // Reset hot cache by re-importing the module fresh
  // We use vi.resetModules() and re-import to reset module-level state
  vi.resetModules();
});

// Dynamic import to get fresh module after reset
async function getService() {
  return await import("../services/runtime-config.service.js");
}

describe("Batch 15 — Runtime Settings Service", () => {
  it("getSettingMeta returns all setting definitions", async () => {
    const { getSettingMeta } = await getService();
    const meta = getSettingMeta();
    expect(meta.length).toBeGreaterThanOrEqual(10);
    const keys = meta.map((m) => m.key);
    expect(keys).toContain("autoReply.cooldownSeconds");
    expect(keys).toContain("messageBatching.enabled");
    expect(keys).toContain("messageBatching.windowMs");
    expect(keys).toContain("document.enabled");
    expect(keys).toContain("vision.enabled");
    expect(keys).toContain("ruleEngine.enabled");
  });

  it("getAllRuntimeSettings returns effective values with env defaults", async () => {
    const { getAllRuntimeSettings } = await getService();
    const settings = await getAllRuntimeSettings();
    expect(settings.length).toBeGreaterThan(0);

    const cooldown = settings.find((s) => s.key === "autoReply.cooldownSeconds");
    expect(cooldown).toBeDefined();
    expect(cooldown!.value).toBe("10");

    const batchWindow = settings.find((s) => s.key === "messageBatching.windowMs");
    expect(batchWindow).toBeDefined();
    expect(batchWindow!.value).toBe("4000");
  });

  it("getRuntimeSettingValue returns env default when no DB override", async () => {
    const { getRuntimeSettingValue } = await getService();
    const val = await getRuntimeSettingValue("autoReply.cooldownSeconds");
    expect(val).toBe("10");
  });

  it("setRuntimeSetting: valid windowMs update succeeds and returns success", async () => {
    const { setRuntimeSetting, getRuntimeSettingValue } = await getService();
    const result = await setRuntimeSetting({
      key: "messageBatching.windowMs",
      value: 6000,
      reason: "Testing runtime config update",
    });
    expect(result.success).toBe(true);
    expect(result.newValue).toBe("6000");

    const newVal = await getRuntimeSettingValue("messageBatching.windowMs");
    expect(newVal).toBe("6000");
  });

  it("setRuntimeSetting: invalid windowMs (<1000) rejected", async () => {
    const { setRuntimeSetting } = await getService();
    const result = await setRuntimeSetting({
      key: "messageBatching.windowMs",
      value: 500,
      reason: "Test invalid",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("VALIDATION_ERROR");
  });

  it("setRuntimeSetting: invalid windowMs (>15000) rejected", async () => {
    const { setRuntimeSetting } = await getService();
    const result = await setRuntimeSetting({
      key: "messageBatching.windowMs",
      value: 20000,
      reason: "Test invalid",
    });
    expect(result.success).toBe(false);
  });

  it("setRuntimeSetting: invalid maxMessages rejected", async () => {
    const { setRuntimeSetting } = await getService();
    const result = await setRuntimeSetting({
      key: "messageBatching.maxMessages",
      value: 50,
      reason: "Test invalid",
    });
    expect(result.success).toBe(false);
  });

  it("setRuntimeSetting: cooldownSeconds updates and getter returns new value", async () => {
    const { setRuntimeSetting, getEffectiveCooldownSeconds } = await getService();
    expect(getEffectiveCooldownSeconds()).toBe(10);

    const result = await setRuntimeSetting({
      key: "autoReply.cooldownSeconds",
      value: 30,
      reason: "Increase cooldown",
    });
    expect(result.success).toBe(true);
    expect(getEffectiveCooldownSeconds()).toBe(30);
  });

  it("setRuntimeSetting: batching window updates and getter returns new value", async () => {
    const { setRuntimeSetting, getEffectiveBatchingConfig } = await getService();
    const initial = getEffectiveBatchingConfig();
    expect(initial.windowMs).toBe(4000);

    await setRuntimeSetting({
      key: "messageBatching.windowMs",
      value: 8000,
      reason: "Double window",
    });

    const updated = getEffectiveBatchingConfig();
    expect(updated.windowMs).toBe(8000);
  });

  it("setRuntimeSetting: audit record is created", async () => {
    const { setRuntimeSetting } = await getService();
    expect(mockAuditStore.length).toBe(0);

    await setRuntimeSetting({
      key: "messageBatching.maxChars",
      value: 5000,
      reason: "Increase char limit",
    });

    expect(mockAuditStore.length).toBe(1);
    const audit = mockAuditStore[0] as any;
    expect(audit.key).toBe("messageBatching.maxChars");
    expect(audit.newValue).toBe("5000");
    expect(audit.reason).toBe("Increase char limit");
  });

  it("setRuntimeSetting: unknown key rejected", async () => {
    const { setRuntimeSetting } = await getService();
    const result = await setRuntimeSetting({
      key: "nonexistent.setting",
      value: "test",
      reason: "Test",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("UNKNOWN_KEY");
  });

  it("setRuntimeSetting: dangerous document extension rejected", async () => {
    const { setRuntimeSetting } = await getService();
    const result = await setRuntimeSetting({
      key: "document.allowedExtensions",
      value: ["exe", "sh"],
      reason: "Test dangerous",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not allowed");
  });

  it("setRuntimeSetting: empty allowedThreads when autoReply enabled rejected", async () => {
    const { setRuntimeSetting } = await getService();
    await setRuntimeSetting({
      key: "autoReply.enabled",
      value: true,
      reason: "Enable",
    });

    const result = await setRuntimeSetting({
      key: "autoReply.allowedThreads",
      value: [],
      reason: "Clear threads",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("CONTEXT_VALIDATION_ERROR");
  });
});
