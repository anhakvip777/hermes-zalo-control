// =============================================================================
// IncomingDispatcher tests
// =============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    autoReply: {
      enabled: true,
      dryRun: true,
      allowedThreads: ["thread-allowed", "group-allowed"],
      cooldownSeconds: 10,
      groupReplyWindowSeconds: 600,
    },
    hermesChat: {
      adapter: "mock",
      mode: "http",
      endpoint: "",
      cliBin: "",
      timeoutMs: 30000,
      cliTimeoutMs: 60000,
      minConfidence: 0.5,
    },
    zalo: { dryRun: false },
    messageBatching: { enabled: false, windowMs: 4000, maxMessages: 5, maxChars: 3000, threadTypes: ["user"] },
    document: { enabled: false, allowedBaseDir: "/tmp/test", processedDir: "/tmp/test/processed", maxSizeMB: 50, allowedExtensions: ["pdf", "txt"], doclingBin: "/bin/true", doclingTimeoutMs: 60000, doclingKillGraceMs: 5000, doclingMaxOutputBytes: 1048576, chunkSize: 1200, chunkOverlap: 150 },
    vision: { enabled: false },
  },
}));

// Mock prisma for DB evidence checks (system claim guard + schedule pre-fetch)
const mockPrismaFindFirst = vi.fn().mockResolvedValue(null);
const mockPrismaFindMany = vi.fn().mockResolvedValue([]);
const mockScheduleFindMany = vi.fn().mockResolvedValue([]);
vi.mock("../db.js", () => ({
  prisma: {
    scheduleExecution: {
      findFirst: (...args: unknown[]) => mockPrismaFindFirst(...args),
      findMany: (...args: unknown[]) => mockPrismaFindMany(...args),
    },
    schedule: {
      findMany: (...args: unknown[]) => mockScheduleFindMany(...args),
    },
  },
}));

const mockSendMessage = vi.fn();
vi.mock("../services/zalo-message-sender.js", () => ({
  ZaloMessageSender: vi.fn().mockImplementation(() => ({
    sendMessage: mockSendMessage,
  })),
}));

const mockCreateTask = vi.fn();
const mockComplete = vi.fn();
const mockFail = vi.fn();
vi.mock("../services/agent-task.service.js", () => ({
  createAgentTask: (...args: unknown[]) => mockCreateTask(...args),
  markAgentTaskCompleted: (...args: unknown[]) => mockComplete(...args),
  markAgentTaskFailed: (...args: unknown[]) => mockFail(...args),
}));

const mockGenerateReply = vi.fn().mockResolvedValue({ reply: "Mock reply", confidence: 0.9 });

vi.mock("../services/hermes-chat-adapter.js", () => ({
  getHermesChatAdapter: () => ({
    generateReply: mockGenerateReply,
  }),
}));

// ── Mock thread settings service ──────────────────────────────────
vi.mock("../services/thread-settings.service.js", () => ({
  getThreadSettings: vi.fn().mockImplementation(
    (threadId: string, threadType: string) =>
      Promise.resolve({
        threadId,
        autoReplyEnabled: true,
        groupMentionRequired: threadType === "group",
        groupReplyWindowSeconds: 600,
        allowCreateReminder: true,
        allowMedia: false,
      }),
  ),
  updateThreadSettings: vi.fn(),
  listThreadSettings: vi.fn(),
}));

// ── Mock group safety service ─────────────────────────────────────
vi.mock("../services/group-safety.service.js", () => ({
  getGroupReplyWindow: vi.fn().mockReturnValue(Date.now() + 600_000),
  touchGroupReplyWindow: vi.fn(),
  closeGroupReplyWindow: vi.fn(),
  resetGroupReplyWindows: vi.fn(),
  getActiveReplyWindows: vi.fn().mockReturnValue([]),
  logGroupGateAudit: vi.fn(),
}));

vi.mock("../services/conversation-context.service.js", () => ({
  buildConversationContext: vi.fn().mockResolvedValue({
    threadId: "thread-allowed",
    threadType: "user",
    recentMessages: [],
    messageCount: 0,
    hasMore: false,
  }),
  buildContextString: vi.fn().mockReturnValue(""),
  saveOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

const mockSaveOutboundRecord = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/outbound-guardrails.service.js", () => ({
  saveOutboundRecord: (...args: unknown[]) => mockSaveOutboundRecord(...args),
  getRecentSentContext: vi.fn().mockResolvedValue([]),
  splitLongMessage: vi.fn().mockImplementation((s: string) => [s]),
  sanitizeOutbound: vi.fn().mockImplementation((s: string) => s),
}));

vi.mock("../services/thread-conversation-state.service.js", () => ({
  getConversationState: vi.fn().mockResolvedValue(null),
  setConversationState: vi.fn().mockResolvedValue({}),
  clearConversationState: vi.fn().mockResolvedValue(undefined),
  tryFillSlot: vi.fn().mockReturnValue(null),
  isIntentComplete: vi.fn().mockReturnValue(false),
  buildStateContextString: vi.fn().mockReturnValue(""),
}));

// ...existing imports...

import {
  handleIncomingMessage,
  getAutoReplyStatus,
  resetAutoReplyCooldowns,
} from "../services/incoming-dispatcher.service.js";
import type { NormalizedMessage } from "../services/zalo-receive.js";

const baseMsg = (overrides: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  zaloMessageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
  threadId: "thread-allowed",
  threadType: "user",
  senderId: "sender-1",
  senderName: "Test User",
  content: "Xin chào",
  messageType: "text",
  rawMetadata: "{}",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetAutoReplyCooldowns();
  mockCreateTask.mockResolvedValue({ id: "task-1" });
  mockComplete.mockResolvedValue(undefined);
  mockFail.mockResolvedValue(undefined);
  mockSendMessage.mockResolvedValue({ success: true, messageId: "sent-1" });
  mockPrismaFindFirst.mockResolvedValue(null);
  mockPrismaFindMany.mockResolvedValue([]);
  mockScheduleFindMany.mockResolvedValue([]);
  mockSaveOutboundRecord.mockResolvedValue(undefined);
});

describe("IncomingDispatcher", () => {
  it("skips when thread not in allowlist", async () => {
    const r = await handleIncomingMessage(baseMsg({ threadId: "thread-other" }));
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("thread_not_allowed");
  });

  it("skips empty content", async () => {
    const r = await handleIncomingMessage(baseMsg({ content: "   " }));
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("empty_content");
  });

  it("skips non-text messages", async () => {
    const r = await handleIncomingMessage(baseMsg({ messageType: "sticker" }));
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("non_text_message");
  });

  it("skips when threadId is empty", async () => {
    const r = await handleIncomingMessage(baseMsg({ threadId: "" }));
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("no_threadId");
  });

  it("dryRun=true creates completed AgentTask without sending", async () => {
    const r = await handleIncomingMessage(baseMsg({ zaloMessageId: "dry-1" }));
    expect(r.dispatched).toBe(true);
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).not.toHaveBeenCalled();
    const ca = mockComplete.mock.calls[0]?.[1];
    expect(ca).toHaveProperty("dryRun", true);
    expect(ca).toHaveProperty("replyPreview");
  });

  it("creates AgentTask with taskType=zalo_auto_reply", async () => {
    await handleIncomingMessage(baseMsg({ zaloMessageId: "type-1" }));
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: "zalo_auto_reply" }),
    );
  });

  it("includes message metadata in AgentTask input", async () => {
    await handleIncomingMessage(baseMsg({ zaloMessageId: "meta-1", content: "Hello" }));
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          threadId: "thread-allowed",
          contentPreview: "Hello",
        }),
      }),
    );
  });

  it("marks AgentTask failed if adapter throws", async () => {
    mockGenerateReply.mockRejectedValueOnce(new Error("DOWN"));
    const r = await handleIncomingMessage(baseMsg({ zaloMessageId: "err-1" }));
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("hermes_error");
    expect(mockFail).toHaveBeenCalledTimes(1);
  });

  it("getAutoReplyStatus returns config", () => {
    const s = getAutoReplyStatus();
    expect(s.enabled).toBe(true);
    expect(s.dryRun).toBe(true);
    expect(s.allowedThreads).toEqual(["thread-allowed", "group-allowed"]);
    expect(s.cooldownSeconds).toBe(10);
    expect(Array.isArray(s.activeCooldowns)).toBe(true);
  });

  it("dispatches valid message successfully", async () => {
    const r = await handleIncomingMessage(baseMsg({ zaloMessageId: "ok-1" }));
    expect(r.dispatched).toBe(true);
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  // ── P0 Batch 1: isSelf guard ──────────────────────────────────

  it("skips when isSelf=true (defense-in-depth)", async () => {
    const r = await handleIncomingMessage(
      baseMsg({ isSelf: true, zaloMessageId: "self-1" }),
    );
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("self_message");
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("skips when isFromBot=true", async () => {
    const r = await handleIncomingMessage(
      baseMsg({ isFromBot: true, zaloMessageId: "bot-1" }),
    );
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("self_message");
  });

  it("skips when senderId matches selfUserId", async () => {
    const r = await handleIncomingMessage(
      baseMsg({ senderId: "621835795753666607", zaloMessageId: "uid-1" }),
      "621835795753666607",
    );
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("self_message");
  });

  // ── P0 Batch 1: Unsupported system claim guard ───────────────

  it("blocks reply with fabricated system claim (no DB evidence)", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Tôi đã gửi tin nhắn nhắc nhở rồi bạn nhé",
      confidence: 0.9,
    });
    mockPrismaFindFirst.mockResolvedValueOnce(null); // no evidence

    const r = await handleIncomingMessage(
      baseMsg({ content: "Hi sao bạn chưa nhắc", zaloMessageId: "claim-1" }),
    );
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("unsupported_system_claim");
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const ca = mockComplete.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(ca).toHaveProperty("needsReview", true);
    expect(ca).toHaveProperty("reason", "unsupported_system_claim");
  });

  it("allows system claim reply when DB evidence exists", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Đã nhắc bạn rồi nhé, kiểm tra lại xem",
      confidence: 0.9,
    });
    mockPrismaFindFirst.mockResolvedValueOnce({ id: "exec-1" }); // evidence exists

    const r = await handleIncomingMessage(
      baseMsg({ content: "Nhắc chưa vậy", zaloMessageId: "claim-2" }),
    );
    // Should NOT be blocked — evidence exists
    expect(r.dispatched).toBe(true);
  });

  it("normal reply without system claims passes through", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Chào bạn, mình có thể giúp gì cho bạn?",
      confidence: 0.9,
    });

    const r = await handleIncomingMessage(
      baseMsg({ zaloMessageId: "normal-1" }),
    );
    expect(r.dispatched).toBe(true);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  // ── Schedule context pre-fetch ─────────────────────────────

  it("pre-fetches schedule context for reminder queries (no data)", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Mình chưa thấy lịch nhắc nào trong hệ thống cho cuộc trò chuyện này.",
      confidence: 0.9,
    });

    const r = await handleIncomingMessage(
      baseMsg({ content: "Hi sao bạn chưa nhắc", zaloMessageId: "pre-1" }),
    );
    expect(r.dispatched).toBe(true);
    // Should NOT timeout — adapter was called with scheduleContext
    expect(mockGenerateReply).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleContext: expect.any(String) }),
    );
  });

  it("pre-fetches schedule context with success execution", async () => {
    mockPrismaFindMany.mockResolvedValueOnce([
      { messageContent: "Nhắc tụng kinh 22h", actualRunAt: new Date().toISOString() },
    ]);
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Lịch nhắc tụng kinh đã được gửi lúc 22h rồi bạn nhé.",
      confidence: 0.9,
    });

    const r = await handleIncomingMessage(
      baseMsg({ content: "sao chưa nhắc", zaloMessageId: "pre-2" }),
    );
    expect(r.dispatched).toBe(true);
    // scheduleContext should contain the success data
    expect(mockGenerateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleContext: expect.stringContaining("ĐÃ GỬI THÀNH CÔNG"),
      }),
    );
  });

  it("pre-fetches schedule context with failed execution", async () => {
    mockPrismaFindMany.mockResolvedValueOnce([]); // no success
    mockPrismaFindMany.mockResolvedValueOnce([
      { messageContent: "Nhắc họp", errorMessage: "SEND_FAILED", plannedRunAt: new Date().toISOString() },
    ]);
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Lịch nhắc họp đã được lên nhưng gửi thất bại do lỗi hệ thống.",
      confidence: 0.9,
    });

    const r = await handleIncomingMessage(
      baseMsg({ content: "sao không gửi", zaloMessageId: "pre-3" }),
    );
    expect(r.dispatched).toBe(true);
    // scheduleContext should contain failed data
    expect(mockGenerateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleContext: expect.stringContaining("GỬI THẤT BẠI"),
      }),
    );
  });

  it("does NOT pre-fetch schedule context for non-reminder queries", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Chào bạn!",
      confidence: 0.9,
    });

    const r = await handleIncomingMessage(
      baseMsg({ content: "xin chào", zaloMessageId: "pre-4" }),
    );
    expect(r.dispatched).toBe(true);
    // scheduleContext should be undefined for non-reminder queries
    expect(mockGenerateReply).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleContext: undefined }),
    );
  });

  it("reminder query with fabricated claim still blocked by guard", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Hệ thống đã gửi nhắc rồi nhưng bị lỗi gửi tin nhé bạn.",
      confidence: 0.9,
    });
    // No DB evidence
    mockPrismaFindFirst.mockResolvedValueOnce(null);

    const r = await handleIncomingMessage(
      baseMsg({ content: "Hi sao bạn chưa nhắc", zaloMessageId: "pre-5" }),
    );
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("unsupported_system_claim");
  });

  // ── Batch 1: Group Safety Foundation ─────────────────────────

  describe("Group safety gates", () => {
    it("skips group not in allowlist", async () => {
      const r = await handleIncomingMessage(
        baseMsg({ threadId: "group-other", threadType: "group", zaloMessageId: "g-1" }),
      );
      expect(r.dispatched).toBe(false);
      expect(r.reason).toBe("thread_not_allowed");
    });

    it("skips group with autoReply disabled", async () => {
      // Override getThreadSettings mock for this test
      const { getThreadSettings } = await import("../services/thread-settings.service.js");
      (getThreadSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        threadId: "group-allowed",
        autoReplyEnabled: false,
        groupMentionRequired: true,
        groupReplyWindowSeconds: 600,
        allowCreateReminder: true,
        allowMedia: false,
      });

      const r = await handleIncomingMessage(
        baseMsg({ threadId: "group-allowed", threadType: "group", zaloMessageId: "g-2" }),
      );
      expect(r.dispatched).toBe(false);
      expect(r.reason).toBe("group_disabled");
      expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it("skips group without @mention (mentionRequired=true)", async () => {
      const { getThreadSettings } = await import("../services/thread-settings.service.js");
      (getThreadSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        threadId: "group-allowed",
        autoReplyEnabled: true,
        groupMentionRequired: true,
        groupReplyWindowSeconds: 600,
        allowCreateReminder: true,
        allowMedia: false,
      });

      const r = await handleIncomingMessage(
        baseMsg({
          threadId: "group-allowed",
          threadType: "group",
          content: "Hello just chatting",
          mentions: ["other-user-1"],
          zaloMessageId: "g-3",
        }),
        "bot-uid-1",
      );
      expect(r.dispatched).toBe(false);
      expect(r.reason).toBe("bot_not_mentioned");
      expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it("allows group with @mention and opens reply window", async () => {
      const { getThreadSettings } = await import("../services/thread-settings.service.js");
      (getThreadSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        threadId: "group-allowed",
        autoReplyEnabled: true,
        groupMentionRequired: true,
        groupReplyWindowSeconds: 600,
        allowCreateReminder: true,
        allowMedia: false,
      });

      const r = await handleIncomingMessage(
        baseMsg({
          threadId: "group-allowed",
          threadType: "group",
          content: "Hello",
          mentions: ["bot-uid-1", "other-user-1"],
          zaloMessageId: "g-4",
        }),
        "bot-uid-1",
      );
      expect(r.dispatched).toBe(true);
      expect(mockCreateTask).toHaveBeenCalledTimes(1);
    });

    it("DM threads pass through group gate without mention check", async () => {
      const r = await handleIncomingMessage(
        baseMsg({ zaloMessageId: "dm-1", threadType: "user" }),
      );
      expect(r.dispatched).toBe(true);
      expect(mockCreateTask).toHaveBeenCalledTimes(1);
    });

    it("create-reminder in DM still works after group gate", async () => {
      const r = await handleIncomingMessage(
        baseMsg({
          threadId: "thread-allowed",
          threadType: "user",
          content: "Nhắc mình 5 phút nữa học bài",
          zaloMessageId: "dm-reminder-1",
        }),
      );
      expect(r.dispatched).toBe(true);
    });
  });

  // ── Cooldown Skip Audit (OutboundRecord) ──────────────────────

  describe("Cooldown audit", () => {
    it("creates OutboundRecord with decision=block, reason=cooldown when cooldown blocks", async () => {
      // First message: succeeds and starts cooldown
      // (R1.1: Unified dispatcher creates OutboundRecord for every outbound — 1 for first msg)
      await handleIncomingMessage(baseMsg({ zaloMessageId: "cooldown-1" }));

      // Second message within 10s cooldown: should be blocked
      const r = await handleIncomingMessage(baseMsg({ zaloMessageId: "cooldown-2" }));
      expect(r.dispatched).toBe(false);
      expect(r.reason).toBe("cooldown");

      // Should have created 2 OutboundRecords:
      // 1 from first message (allowed via unified dispatcher)
      // 1 from second message (blocked by cooldown)
      expect(mockSaveOutboundRecord).toHaveBeenCalledTimes(2);
      
      // Second call should be the cooldown block
      const blockCall = mockSaveOutboundRecord.mock.calls[1]?.[0] as Record<string, unknown>;
      expect(blockCall.decision).toBe("block");
      expect(blockCall.reason).toBe("cooldown");
      expect(blockCall.source).toBe("auto_reply");
      expect(blockCall.threadId).toBe("thread-allowed");
      expect(blockCall.dryRun).toBe(true);
    });

    it("does NOT create AgentTask when cooldown blocks", async () => {
      // First message: starts cooldown
      await handleIncomingMessage(baseMsg({ zaloMessageId: "no-task-1" }));

      // Clear mock to check second message independently
      mockCreateTask.mockClear();
      mockComplete.mockClear();

      // Second message: cooldown block
      const r = await handleIncomingMessage(baseMsg({ zaloMessageId: "no-task-2" }));
      expect(r.dispatched).toBe(false);
      expect(r.reason).toBe("cooldown");

      // AgentTask should NOT be created
      expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it("does NOT send Zalo message when cooldown blocks", async () => {
      // First message: starts cooldown
      await handleIncomingMessage(baseMsg({ zaloMessageId: "no-send-1" }));

      mockSendMessage.mockClear();

      // Second message: cooldown block
      const r = await handleIncomingMessage(baseMsg({ zaloMessageId: "no-send-2" }));
      expect(r.dispatched).toBe(false);
      expect(r.reason).toBe("cooldown");

      // ZaloSender should NOT be called
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it("first message after cooldown expiry creates audit with decision=allow", async () => {
      // First message should dispatch normally
      const r = await handleIncomingMessage(baseMsg({ zaloMessageId: "first-msg" }));
      expect(r.dispatched).toBe(true);
      expect(mockCreateTask).toHaveBeenCalledTimes(1);

      // R1.1: Unified dispatcher creates OutboundRecord for every outbound (including allowed)
      // This is the expected behavior — audit trail for all outbound attempts
      expect(mockSaveOutboundRecord).toHaveBeenCalledTimes(1);
      const call = mockSaveOutboundRecord.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call.decision).toBe("allow");
      expect(call.dryRun).toBe(true);
    });

    it("multiple cooldown blocks each create separate OutboundRecords", async () => {
      // First message: starts cooldown
      // (R1.1: Creates OutboundRecord via unified dispatcher)
      await handleIncomingMessage(baseMsg({ zaloMessageId: "multi-1" }));

      // Second message: blocked by cooldown
      await handleIncomingMessage(baseMsg({ zaloMessageId: "multi-2" }));

      // R1.1: 2 OutboundRecords — 1 from first (allowed via dispatcher), 1 from second (blocked)
      expect(mockSaveOutboundRecord).toHaveBeenCalledTimes(2);

      // Wait for cooldown to expire (not possible in test — skip)
      // But we can reset cooldowns and try again to verify new audit
      resetAutoReplyCooldowns();
      mockSaveOutboundRecord.mockClear();

      // Fresh message after reset: should dispatch, creates OutboundRecord
      await handleIncomingMessage(baseMsg({ zaloMessageId: "multi-3" }));
      // R1.1: Unified dispatcher creates OutboundRecord for allowed messages too
      expect(mockSaveOutboundRecord).toHaveBeenCalledTimes(1);
      const call = mockSaveOutboundRecord.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call.decision).toBe("allow");
    });
  });
});

// ── R1.2 Smoke: Image/File paths via unified dispatcher ───────────

describe("R1.2 — Image/File outbound source types", () => {
  // Import sendOutbound for direct testing
  let sendOutboundFn: typeof import("../services/outbound-dispatcher.service.js").sendOutbound;

  beforeAll(async () => {
    const mod = await import("../services/outbound-dispatcher.service.js");
    sendOutboundFn = mod.sendOutbound;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetAutoReplyCooldowns();
    mockSaveOutboundRecord.mockResolvedValue(undefined);
  });

  it("sendOutbound with source=image creates OutboundRecord with source=auto_reply", async () => {
    await sendOutboundFn({
      threadId: "thread-allowed",
      threadType: "user",
      source: "image",
      content: "Image analysis reply",
      relatedMessageId: "msg-img-1",
      taskId: "task-img-1",
    });

    // Dispatcher creates OutboundRecord for every outbound
    expect(mockSaveOutboundRecord).toHaveBeenCalledTimes(1);
    const record = mockSaveOutboundRecord.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(record.source).toBe("auto_reply"); // mapSource("image") → "auto_reply"
    expect(record.decision).toBe("allow");
    expect(record.dryRun).toBe(true);
  });

  it("sendOutbound with source=file creates OutboundRecord with source=auto_reply", async () => {
    await sendOutboundFn({
      threadId: "thread-allowed",
      threadType: "user",
      source: "file",
      content: "File confirmation reply",
      relatedMessageId: "msg-file-1",
      taskId: "task-file-1",
    });

    // Dispatcher creates OutboundRecord for every outbound
    expect(mockSaveOutboundRecord).toHaveBeenCalledTimes(1);
    const record = mockSaveOutboundRecord.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(record.source).toBe("auto_reply"); // mapSource("file") → "auto_reply"
    expect(record.decision).toBe("allow");
    expect(record.dryRun).toBe(true);
  });

  it("sendOutbound with source=error_fallback creates OutboundRecord", async () => {
    await sendOutboundFn({
      threadId: "thread-allowed",
      threadType: "user",
      source: "error_fallback",
      content: "Error fallback message",
      relatedMessageId: "msg-err-1",
      taskId: "task-err-1",
    });

    expect(mockSaveOutboundRecord).toHaveBeenCalledTimes(1);
    const record = mockSaveOutboundRecord.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(record.source).toBe("auto_reply");
    expect(record.decision).toBe("allow");
  });

  it("sendOutbound with source=catch_all creates OutboundRecord", async () => {
    await sendOutboundFn({
      threadId: "thread-allowed",
      threadType: "user",
      source: "catch_all",
      content: "Catch-all default reply",
      relatedMessageId: "msg-catch-1",
      taskId: "task-catch-1",
    });

    expect(mockSaveOutboundRecord).toHaveBeenCalledTimes(1);
    const record = mockSaveOutboundRecord.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(record.source).toBe("auto_reply");
    expect(record.decision).toBe("allow");
  });
});
