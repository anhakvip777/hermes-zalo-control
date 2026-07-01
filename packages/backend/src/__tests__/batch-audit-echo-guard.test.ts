// =============================================================================
// Audit — Prompt Echo Guard Tests (ECHO1 null-safe)
// =============================================================================
// Tests for the null-safe checkPromptEcho guard inside sendOutbound().
// All tests go through sendOutbound() since checkPromptEcho is private.
// =============================================================================

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../db.js";

// ── Mock ZaloMessageSender ─────────────────────────────────────────────
const mockSendMessage = vi.fn().mockResolvedValue({ success: true, messageId: "mock-msg-id" });
const mockSendImage = vi.fn().mockResolvedValue({ success: true, messageId: "mock-img-id" });
const mockSendFile = vi.fn().mockResolvedValue({ success: true, messageId: "mock-file-id" });
const mockSendVoice = vi.fn().mockResolvedValue({ success: true, messageId: "mock-voice-id" });

vi.mock("../services/zalo-message-sender.js", () => ({
  ZaloMessageSender: vi.fn().mockImplementation(() => ({
    sendMessage: mockSendMessage,
    sendImage: mockSendImage,
    sendFile: mockSendFile,
    sendVoice: mockSendVoice,
  })),
}));

// ── Gateway mock ───────────────────────────────────────────────────────
vi.mock("../services/zalo-gateway.service.js", () => ({
  getZaloGateway: vi.fn(() => ({
    isConnected: () => true,
    getApi: () => ({
      sendMessage: mockSendMessage,
      sendImage: mockSendImage,
      sendFile: mockSendFile,
      sendVoice: mockSendVoice,
    }),
    getSelfUserId: () => "self-uid",
    getStatus: () => ({ connected: true }),
  })),
}));

// ── Cleanup ────────────────────────────────────────────────────────────
beforeAll(async () => {
  // Clear cooldowns before test suite
  try {
    const { clearAllCooldowns } = await import("../services/cooldown.service.js");
    await clearAllCooldowns();
  } catch {}
});

afterAll(async () => {
  try {
    const { clearAllCooldowns } = await import("../services/cooldown.service.js");
    await clearAllCooldowns();
  } catch {}
});

beforeEach(async () => {
  mockSendMessage.mockClear();
  // Clear cooldowns between tests
  try {
    const { clearAllCooldowns } = await import("../services/cooldown.service.js");
    await clearAllCooldowns();
  } catch {}
});

// ── Helper ─────────────────────────────────────────────────────────────
async function sendText(content: string, threadId = "thread-echo-test") {
  const { sendOutbound } = await import("../services/outbound-dispatcher.service.js");
  return sendOutbound({
    threadId,
    threadType: "user",
    source: "hermes",
    content,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Echo Guard Tests
// ═══════════════════════════════════════════════════════════════════════

describe("Prompt Echo Guard — null-safe", () => {
  it("null content does NOT crash", async () => {
    const result = await sendText(null as any);
    // Should be a skip (validation), not a crash
    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    // Must not throw
  });

  it("empty string does NOT crash", async () => {
    const result = await sendText("");
    expect(result).toBeDefined();
    // Empty content should not be blocked by echo guard specifically
    // (it may fail validation or pass through)
  });

  it("normal content is allowed", async () => {
    const result = await sendText("Xin chào, tôi là trợ lý AI");
    expect(result).toBeDefined();
    expect(result.decision).not.toBe("block");
    // If dryRun (true in test), should succeed with fake msgId
    if (result.decision === "allow") {
      expect(result.sentMessageId).toBeDefined();
    }
  });

  it("blocks [LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY] marker", async () => {
    const result = await sendText("[LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY]\nUser: xin chào\nAssistant: Chào bạn");
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("prompt_echo_guard");
    expect(result.success).toBe(false);
  });

  it("blocks [TIN NHẮN HIỆN TẠI] marker", async () => {
    const result = await sendText("[TIN NHẮN HIỆN TẠI]\nBạn vừa nói: chào");
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("prompt_echo_guard");
    expect(result.success).toBe(false);
  });

  it("blocks [KẾT THÚC LỊCH SỬ marker", async () => {
    const result = await sendText("[KẾT THÚC LỊCH SỬ]\nĐây là câu trả lời");
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("prompt_echo_guard");
    expect(result.success).toBe(false);
  });

  it("blocks BEGIN_CONTEXT marker", async () => {
    const result = await sendText("BEGIN_CONTEXT\nsystem: bạn là AI\nEND_CONTEXT");
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("prompt_echo_guard");
    expect(result.success).toBe(false);
  });

  it("blocks END_CONTEXT marker", async () => {
    const result = await sendText("END_CONTEXT\nĐây là leak nội bộ");
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("prompt_echo_guard");
    expect(result.success).toBe(false);
  });

  it("'bạn là ai' normal answer is allowed", async () => {
    const result = await sendText("Tôi là trợ lý AI của hệ thống Hermes, sẵn sàng hỗ trợ bạn!");
    expect(result.decision).not.toBe("block");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Attendance Reminder Echo Safety
// ═══════════════════════════════════════════════════════════════════════

describe("Attendance Reminder — echo guard safety", () => {
  it("default reminder content is allowed (not blocked by echo guard)", async () => {
    // The DEFAULT_REMINDER text: "Các huynh đệ điểm danh giúp anh nhé..."
    const result = await sendText("Các huynh đệ điểm danh giúp anh nhé. Ai có mặt nhắn: Có mặt hoặc Con có mặt.");
    expect(result.decision).not.toBe("block");
  });

  it("custom reminder content is allowed", async () => {
    const result = await sendText("Nhắc nhở: vui lòng điểm danh trước 20h tối nay.");
    expect(result.decision).not.toBe("block");
  });
});
