import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const gatewayCalls = vi.hoisted(() => ({
  getApi: vi.fn(() => {
    throw new Error("provider boundary must not be reached");
  }),
  isConnected: vi.fn(() => {
    throw new Error("connection boundary must not be reached");
  }),
  restoreSession: vi.fn(() => {
    throw new Error("session restore must not be reached");
  }),
}));

vi.mock("../config.js", () => ({
  config: {
    autoReply: {
      enabled: true,
      dryRun: false,
      allowedThreads: [],
      cooldownSeconds: 10,
      groupReplyWindowSeconds: 600,
    },
    messageBatching: {
      enabled: false,
      windowMs: 4000,
      maxMessages: 5,
      maxChars: 3000,
      threadTypes: ["user"],
    },
    document: { enabled: false, maxSizeMB: 50, allowedExtensions: ["pdf", "txt"] },
    vision: { enabled: false, maxSizeBytes: 10 * 1024 * 1024 },
    zalo: {
      sessionDir: "/tmp/test-session",
      rateLimitPerMinute: 100,
      rateLimitGlobalPerMinute: 1000,
    },
  },
}));

vi.mock("../db.js", () => ({
  prisma: {
    runtimeSetting: {
      findUnique: vi.fn(async () => ({
        key: "autoReply.dryRun",
        value: "false",
        updatedBy: "legacy",
        updatedAt: new Date(),
      })),
    },
  },
}));

vi.mock("../services/live-test.service.js", () => ({
  shouldSendLiveForThread: vi.fn(async () => ({ live: false, reason: "dry_run" })),
  recordLiveTestSent: vi.fn(),
}));

vi.mock("../services/outbound-guardrails.service.js", () => ({
  applyOutboundGuardrails: vi.fn(),
  recordOutboundDedup: vi.fn(),
  saveOutboundRecord: vi.fn(async () => ({ id: "unused" })),
}));

vi.mock("../services/zalo-gateway.service.js", () => ({
  getZaloGateway: () => gatewayCalls,
}));

const testDir = join(tmpdir(), `bridge-global-live-guard-${process.pid}`);
const imagePath = join(testDir, "image.png");
const filePath = join(testDir, "document.pdf");
const voicePath = join(testDir, "voice.mp3");

beforeAll(() => {
  mkdirSync(testDir, { recursive: true });
  writeFileSync(imagePath, "image");
  writeFileSync(filePath, "document");
  writeFileSync(voicePath, "voice");
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("global live fail-closed guard", () => {
  it("clamps stale runtime and environment false values to effective dry-run", async () => {
    const {
      getCurrentEffectiveDryRun,
      getEffectiveAutoReplyConfig,
      getEffectiveAutoReplyConfigSync,
      initRuntimeConfig,
    } = await import("../services/runtime-config.service.js");

    await initRuntimeConfig();

    expect(getCurrentEffectiveDryRun()).toBe(true);
    expect(getEffectiveAutoReplyConfigSync().dryRun).toBe(true);
    await expect(getEffectiveAutoReplyConfig()).resolves.toMatchObject({ dryRun: true });
  });

  it("keeps text, image, file, and voice away from the provider without a live-test session", async () => {
    const { ZaloMessageSender } = await import("../services/zalo-message-sender.js");
    const sender = new ZaloMessageSender();

    const results = await Promise.all([
      sender.sendMessage("safe dry-run", "thread-guard", "user", "manual", { skipRecord: true }),
      sender.sendImage(imagePath, "thread-guard", "user"),
      sender.sendFile(filePath, "thread-guard", "user"),
      sender.sendVoice(voicePath, "thread-guard", "user"),
    ]);

    expect(results.every((result) => result.success)).toBe(true);
    expect(results.map((result) => result.messageId)).toEqual([
      expect.stringMatching(/^dry-run-/),
      expect.stringMatching(/^dry-run-img-/),
      expect.stringMatching(/^dry-run-file-/),
      expect.stringMatching(/^dry-run-voice-/),
    ]);
    expect(gatewayCalls.isConnected).not.toHaveBeenCalled();
    expect(gatewayCalls.restoreSession).not.toHaveBeenCalled();
    expect(gatewayCalls.getApi).not.toHaveBeenCalled();
  });
});
