// =============================================================================
// Zalo media send tests — sendImage/sendFile + validation + outbound gate
// =============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ZaloMessageSender } from "../services/zalo-message-sender.js";

// Mock config
vi.mock("../config.js", () => ({
  config: {
    zalo: {
      dryRun: false,
      sessionDir: "/tmp/test-session",
      rateLimitPerMinute: 100,
      rateLimitGlobalPerMinute: 1000,
    },
    autoReply: {
      enabled: true,
      dryRun: false,
      allowedThreads: [],
      cooldownSeconds: 10,
      groupReplyWindowSeconds: 600,
    },
    hermesChat: { adapter: "mock", mode: "http", endpoint: "", cliBin: "", timeoutMs: 30000, cliTimeoutMs: 60000, minConfidence: 0.5 },
  },
}));

// Mock runtime-config to allow test-controlled dryRun
const { mockGetCurrentEffectiveDryRun } = vi.hoisted(() => ({
  mockGetCurrentEffectiveDryRun: vi.fn().mockReturnValue(false),
}));
vi.mock("../services/runtime-config.service.js", () => ({
  getCurrentEffectiveDryRun: mockGetCurrentEffectiveDryRun,
  initRuntimeConfig: vi.fn(),
  getRuntimeConfig: vi.fn().mockReturnValue([]),
  setRuntimeConfig: vi.fn(),
}));

// Mock group-safety service
const mockGetGroupReplyWindow = vi.fn().mockReturnValue(Date.now() + 600_000);
const mockLogGroupGateAudit = vi.fn();
vi.mock("../services/group-safety.service.js", () => ({
  getGroupReplyWindow: (...args: unknown[]) => mockGetGroupReplyWindow(...args),
  touchGroupReplyWindow: vi.fn(),
  closeGroupReplyWindow: vi.fn(),
  resetGroupReplyWindows: vi.fn(),
  getActiveReplyWindows: vi.fn().mockReturnValue([]),
  logGroupGateAudit: (...args: unknown[]) => mockLogGroupGateAudit(...args),
}));

// Mock zalo-gateway
const mockSendMessage = vi.fn().mockResolvedValue({ messageId: "real-msg-123", msgId: "real-msg-123" });
const mockIsConnected = vi.fn().mockReturnValue(true);
const mockGetApi = vi.fn().mockReturnValue({ sendMessage: mockSendMessage });
const mockRestoreSession = vi.fn().mockResolvedValue(true);
vi.mock("../services/zalo-gateway.service.js", () => ({
  getZaloGateway: () => ({
    isConnected: mockIsConnected,
    getApi: mockGetApi,
    restoreSession: mockRestoreSession,
  }),
}));

// Use real filesystem — create test files
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "hermes-media-test-" + Date.now());
mkdirSync(TEST_DIR, { recursive: true });

function createTestFile(name: string, size: number = 1024): string {
  const p = join(TEST_DIR, name);
  writeFileSync(p, Buffer.alloc(size, "x"));
  return p;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsConnected.mockReturnValue(true);
  mockGetApi.mockReturnValue({ sendMessage: mockSendMessage });
  mockSendMessage.mockResolvedValue({ messageId: "real-msg-123", msgId: "real-msg-123" });
  mockGetGroupReplyWindow.mockReturnValue(Date.now() + 600_000);
});

const dmThread = { threadId: "6792540503378312397", threadType: "user" as const };
const groupThread = { threadId: "7977263179157568314", threadType: "group" as const };

describe("Zalo Media Send", () => {
  const sender = new ZaloMessageSender();

  // ── Image: DM allowed ────────────────────────────────────────────
  it("sends image to DM successfully", async () => {
    const img = createTestFile("test.png");
    const result = await sender.sendImage(img, dmThread.threadId, dmThread.threadType);
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("real-msg-123");
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const call = mockSendMessage.mock.calls[0]![0];
    expect(call.attachments).toEqual([img]);
  });

  // ── Image: Group with reply window open ──────────────────────────
  it("sends image to group when reply window is open", async () => {
    mockGetGroupReplyWindow.mockReturnValue(Date.now() + 600_000);
    const img = createTestFile("group-photo.jpg");
    const result = await sender.sendImage(img, groupThread.threadId, groupThread.threadType);
    expect(result.success).toBe(true);
  });

  // ── Image: Group with reply window closed ────────────────────────
  it("blocks image to group when reply window is closed", async () => {
    mockGetGroupReplyWindow.mockReturnValue(0);
    const img = createTestFile("blocked.png");
    const result = await sender.sendImage(img, groupThread.threadId, groupThread.threadType);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("GROUP_REPLY_WINDOW_CLOSED");
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  // ── File: DM allowed ─────────────────────────────────────────────
  it("sends file to DM successfully", async () => {
    const f = createTestFile("doc.pdf");
    const result = await sender.sendFile(f, dmThread.threadId, dmThread.threadType);
    expect(result.success).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  // ── File: Group with window open ─────────────────────────────────
  it("sends file to group when reply window is open", async () => {
    mockGetGroupReplyWindow.mockReturnValue(Date.now() + 300_000);
    const f = createTestFile("report.xlsx");
    const result = await sender.sendFile(f, groupThread.threadId, groupThread.threadType);
    expect(result.success).toBe(true);
  });

  // ── Dry-run: no zca-js call ──────────────────────────────────────
  it("dry-run image does NOT call zca-js", async () => {
    mockGetCurrentEffectiveDryRun.mockReturnValue(true);
    const img = createTestFile("dry.png");
    const result = await sender.sendImage(img, dmThread.threadId, dmThread.threadType);
    expect(result.success).toBe(true);
    expect(result.messageId).toContain("dry-run-img-");
    expect(mockSendMessage).not.toHaveBeenCalled();
    mockGetCurrentEffectiveDryRun.mockReturnValue(false);
  });

  // ── Unsupported file type blocked ────────────────────────────────
  it("blocks unsupported image type", async () => {
    const f = createTestFile("bad.bmp");
    const result = await sender.sendImage(f, dmThread.threadId, dmThread.threadType);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("MEDIA_TYPE_NOT_ALLOWED");
  });

  // ── Oversize file blocked ────────────────────────────────────────
  it("blocks file over 25MB", async () => {
    const f = createTestFile("big.zip", 26 * 1024 * 1024 + 1);
    const result = await sender.sendFile(f, dmThread.threadId, dmThread.threadType);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("MEDIA_TOO_LARGE");
    // Clean up big file
    try { unlinkSync(f); } catch {}
  });

  // ── Audit log created ────────────────────────────────────────────
  it("logs audit when group gate allows", async () => {
    mockGetGroupReplyWindow.mockReturnValue(Date.now() + 600_000);
    const img = createTestFile("audit.jpg");
    await sender.sendImage(img, groupThread.threadId, groupThread.threadType);
    expect(mockLogGroupGateAudit).toHaveBeenCalled();
    const auditCall = mockLogGroupGateAudit.mock.calls[0]![0];
    expect(auditCall.decision).toBe("allow");
    expect(auditCall.reason).toBe("reply_window_open");
  });

  // ── Text sendMessage regression ──────────────────────────────────
  it("existing text sendMessage still works", async () => {
    mockGetGroupReplyWindow.mockReturnValue(Date.now() + 600_000);
    const result = await sender.sendMessage("hello", dmThread.threadId, dmThread.threadType);
    expect(result.success).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });
});
