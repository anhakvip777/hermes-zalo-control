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
const mockZaloMessageSender = vi.fn().mockImplementation(() => ({
  sendMessage: mockSendMessage,
  sendImage: mockSendImage,
  sendFile: mockSendFile,
  sendVoice: mockSendVoice,
}));

const outboundRuntime = {
  dryRun: true,
  live: false,
};
const mockShouldSendLiveForThread = vi.fn(async () => ({
  live: outboundRuntime.live,
  sessionId: outboundRuntime.live ? "live-session-task5" : undefined,
}));

vi.mock("../services/runtime-config.service.js", () => ({
  getCurrentEffectiveDryRun: () => outboundRuntime.dryRun,
  getEffectiveCooldownSeconds: () => 0,
}));

vi.mock("../services/live-test.service.js", () => ({
  shouldSendLiveForThread: (...args: unknown[]) => mockShouldSendLiveForThread(...args),
}));

vi.mock("../services/zalo-message-sender.js", () => ({
  ZaloMessageSender: mockZaloMessageSender,
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
  mockZaloMessageSender.mockClear();
  mockShouldSendLiveForThread.mockClear();
  outboundRuntime.dryRun = true;
  outboundRuntime.live = false;
  // Clear cooldowns between tests
  try {
    const { clearAllCooldowns } = await import("../services/cooldown.service.js");
    await clearAllCooldowns();
  } catch {}
});

describe("Outbound delivery policy", () => {
  it.each([
    ["global runtime live", false, false],
    ["active controlled live test", true, true],
  ])("forces dry-run-only under %s and preserves idempotency", async (_caseName, globalDryRun, liveTestActive) => {
    outboundRuntime.dryRun = globalDryRun;
    outboundRuntime.live = liveTestActive;
    const { sendOutbound } = await import("../services/outbound-dispatcher.service.js");
    const { clearAllCooldowns } = await import("../services/cooldown.service.js");
    const relatedMessageId = `task5-policy-${_caseName.replaceAll(" ", "-")}-${Date.now()}`;
    const intent = {
      threadId: "thread-task5-policy",
      threadType: "user" as const,
      source: "agent_tool" as const,
      content: "Structured dry-run reply",
      relatedMessageId,
      taskId: "task-task5-policy",
      deliveryPolicy: "dry_run_only" as const,
    };

    const first = await sendOutbound(intent);
    expect(first).toMatchObject({ success: true, dryRun: true, decision: "allow", reason: "dry_run" });
    expect(first.outboundRecordId).toBeTruthy();
    expect(first.assistantMessageId).toBeTruthy();
    expect(mockShouldSendLiveForThread).not.toHaveBeenCalled();
    expect(mockZaloMessageSender).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();

    await clearAllCooldowns();
    const replay = await sendOutbound(intent);
    expect(replay).toMatchObject({ success: true, dryRun: true, decision: "skip", reason: "duplicate_idempotency" });
    expect(replay.outboundRecordId).toBe(first.outboundRecordId);
    expect(replay.assistantMessageId).toBe(first.assistantMessageId);
    expect(mockZaloMessageSender).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("fails closed when strict idempotency lookup evidence is unavailable", async () => {
    const { sendOutbound } = await import("../services/outbound-dispatcher.service.js");
    const originalFindUnique = prisma.outboundRecord.findUnique.bind(prisma.outboundRecord);
    const failure = vi
      .spyOn(prisma.outboundRecord, "findUnique")
      .mockRejectedValueOnce(new Error("raw lookup failure"));
    let result;
    try {
      result = await sendOutbound({
        threadId: "thread-task5-strict-lookup",
        threadType: "user",
        source: "agent_tool",
        content: "Strict evidence lookup",
        relatedMessageId: `strict-lookup-${Date.now()}`,
        taskId: "task-strict-lookup",
        deliveryPolicy: "dry_run_only",
      });
    } finally {
      failure.mockRestore();
      Object.defineProperty(prisma.outboundRecord, "findUnique", {
        configurable: true,
        writable: true,
        value: originalFindUnique,
      });
    }
    expect(result).toMatchObject({
      success: false,
      dryRun: true,
      decision: "block",
      reason: "outbound_evidence_persistence_failed",
      errorCode: "OUTBOUND_EVIDENCE_PERSISTENCE_FAILED",
    });
    expect(mockZaloMessageSender).not.toHaveBeenCalled();
  });

  it("fails closed when strict outbound reservation cannot be persisted", async () => {
    const { sendOutbound } = await import("../services/outbound-dispatcher.service.js");
    const originalCreate = prisma.outboundRecord.create.bind(prisma.outboundRecord);
    const failure = vi
      .spyOn(prisma.outboundRecord, "create")
      .mockRejectedValueOnce(new Error("raw reservation failure"));
    let result;
    try {
      result = await sendOutbound({
        threadId: "thread-task5-strict-reserve",
        threadType: "user",
        source: "agent_tool",
        content: "Strict reservation",
        relatedMessageId: `strict-reserve-${Date.now()}`,
        taskId: "task-strict-reserve",
        deliveryPolicy: "dry_run_only",
      });
    } finally {
      failure.mockRestore();
      Object.defineProperty(prisma.outboundRecord, "create", {
        configurable: true,
        writable: true,
        value: originalCreate,
      });
    }
    expect(result).toMatchObject({
      success: false,
      dryRun: true,
      decision: "block",
      reason: "outbound_evidence_persistence_failed",
      errorCode: "OUTBOUND_EVIDENCE_PERSISTENCE_FAILED",
    });
    expect(mockZaloMessageSender).not.toHaveBeenCalled();
  });

  it("fails closed when strict assistant evidence cannot be persisted", async () => {
    const { sendOutbound } = await import("../services/outbound-dispatcher.service.js");
    const originalCreate = prisma.message.create.bind(prisma.message);
    const failure = vi
      .spyOn(prisma.message, "create")
      .mockRejectedValueOnce(new Error("raw assistant evidence failure"));
    let result;
    try {
      result = await sendOutbound({
        threadId: "thread-task5-strict-assistant",
        threadType: "user",
        source: "agent_tool",
        content: "Strict assistant evidence",
        relatedMessageId: `strict-assistant-${Date.now()}`,
        taskId: "task-strict-assistant",
        deliveryPolicy: "dry_run_only",
      });
    } finally {
      failure.mockRestore();
      Object.defineProperty(prisma.message, "create", {
        configurable: true,
        writable: true,
        value: originalCreate,
      });
    }
    expect(result).toMatchObject({
      success: false,
      dryRun: true,
      decision: "block",
      reason: "outbound_evidence_persistence_failed",
      errorCode: "OUTBOUND_EVIDENCE_PERSISTENCE_FAILED",
    });
    expect(result?.assistantMessageId).toBeUndefined();
    expect(mockZaloMessageSender).not.toHaveBeenCalled();
  });

  it("fails closed when strict outbound reservation cannot be finalized", async () => {
    const { sendOutbound } = await import("../services/outbound-dispatcher.service.js");
    const originalUpdate = prisma.outboundRecord.update.bind(prisma.outboundRecord);
    const failure = vi
      .spyOn(prisma.outboundRecord, "update")
      .mockRejectedValueOnce(new Error("raw outbound finalize failure"));
    let result;
    try {
      result = await sendOutbound({
        threadId: "thread-task5-strict-finalize",
        threadType: "user",
        source: "agent_tool",
        content: "Strict finalization",
        relatedMessageId: `strict-finalize-${Date.now()}`,
        taskId: "task-strict-finalize",
        deliveryPolicy: "dry_run_only",
      });
    } finally {
      failure.mockRestore();
      Object.defineProperty(prisma.outboundRecord, "update", {
        configurable: true,
        writable: true,
        value: originalUpdate,
      });
    }
    expect(result).toMatchObject({
      success: false,
      dryRun: true,
      decision: "block",
      reason: "outbound_evidence_persistence_failed",
      errorCode: "OUTBOUND_EVIDENCE_PERSISTENCE_FAILED",
    });
    expect(mockZaloMessageSender).not.toHaveBeenCalled();
  });

  it("treats an incomplete reserved record as fail-closed, not a durable duplicate", async () => {
    const { sendOutbound } = await import("../services/outbound-dispatcher.service.js");
    const { reserveOutboundRecord } = await import("../services/outbound-guardrails.service.js");
    const relatedMessageId = `task5-incomplete-reserved-${Date.now()}`;
    const threadId = "thread-task5-incomplete-reserved";
    await reserveOutboundRecord({
      idempotencyKey: `reply:${relatedMessageId}:${threadId}:user`,
      inboundMessageId: relatedMessageId,
      threadId,
      threadType: "user",
      content: "Incomplete reservation",
      source: "agent_tool",
      dryRun: true,
    });

    const result = await sendOutbound({
      threadId,
      threadType: "user",
      source: "agent_tool",
      content: "Structured retry",
      relatedMessageId,
      taskId: "task-task5-incomplete",
      deliveryPolicy: "dry_run_only",
    });

    expect(result).toMatchObject({
      success: false,
      dryRun: true,
      decision: "block",
      reason: "outbound_idempotency_incomplete",
      errorCode: "OUTBOUND_IDEMPOTENCY_INCOMPLETE",
    });
    expect(mockZaloMessageSender).not.toHaveBeenCalled();
  });

  it("fails closed for a historical outbound record without linked assistant evidence", async () => {
    outboundRuntime.dryRun = false;
    outboundRuntime.live = true;
    const { sendOutbound } = await import("../services/outbound-dispatcher.service.js");
    const { reserveOutboundRecord, updateOutboundRecordById } =
      await import("../services/outbound-guardrails.service.js");
    const relatedMessageId = `task5-historical-live-${Date.now()}`;
    const threadId = "thread-task5-historical-live";
    const idempotencyKey = `reply:${relatedMessageId}:${threadId}:user`;
    const historicalId = await reserveOutboundRecord({
      idempotencyKey,
      inboundMessageId: relatedMessageId,
      threadId,
      threadType: "user",
      content: "Historical live reply",
      source: "agent_tool",
      dryRun: false,
    });
    await updateOutboundRecordById(historicalId, {
      sentMessageId: "historical-live-message-id",
      reason: "single_send",
    });

    const replay = await sendOutbound({
      threadId,
      threadType: "user",
      source: "agent_tool",
      content: "Structured dry-run replay",
      relatedMessageId,
      taskId: "task-task5-historical-live",
      deliveryPolicy: "dry_run_only",
    });

    expect(replay).toMatchObject({
      success: false,
      dryRun: true,
      decision: "block",
      reason: "outbound_idempotency_incomplete",
      errorCode: "OUTBOUND_IDEMPOTENCY_INCOMPLETE",
      outboundRecordId: historicalId,
    });
    expect(mockShouldSendLiveForThread).not.toHaveBeenCalled();
    expect(mockZaloMessageSender).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    await expect(prisma.outboundRecord.findUnique({ where: { id: historicalId } }))
      .resolves.toMatchObject({ dryRun: false });
  });
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
