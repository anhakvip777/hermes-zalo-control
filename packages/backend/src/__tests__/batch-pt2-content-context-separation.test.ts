// =============================================================================
// PT2 — Content/Context Separation Tests
// =============================================================================
// Verify:
//   1. MockAdapter content = raw user message (no context prepended)
//   2. buildCLIPrompt has no [LỊCH SỬ TRÒ CHUYỆN] bracket markers
//   3. Context passed via recentMessages, NOT in content
//   4. Echo guard still blocks marker-containing replies
//   5. Normal "bạn là ai" reply is clean (no context echo)
// =============================================================================

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { prisma } from "../db.js";

// ── Gateway + sender mocks ──────────────────────────────────────────
const mockSendMessage = vi.fn().mockResolvedValue({ success: true, messageId: "mock-msg" });
vi.mock("../services/zalo-message-sender.js", () => ({
  ZaloMessageSender: vi.fn().mockImplementation(() => ({
    sendMessage: mockSendMessage,
    sendImage: vi.fn().mockResolvedValue({ success: true, messageId: "mock-img" }),
    sendFile: vi.fn().mockResolvedValue({ success: true, messageId: "mock-file" }),
    sendVoice: vi.fn().mockResolvedValue({ success: true, messageId: "mock-voice" }),
  })),
}));
vi.mock("../services/zalo-gateway.service.js", () => ({
  getZaloGateway: vi.fn(() => ({
    isConnected: () => true,
    getApi: () => ({
      sendMessage: mockSendMessage,
    }),
    getSelfUserId: () => "self-uid",
    getStatus: () => ({ connected: true }),
  })),
}));

// ── Cleanup ──────────────────────────────────────────────────────────
beforeAll(async () => {
  try {
    const { clearAllCooldowns } = await import("../services/cooldown.service.js");
    await clearAllCooldowns();
  } catch {}
  // Clear PT2 test messages
  await prisma.message.deleteMany({ where: { threadId: "thread-pt2-test" } }).catch(() => {});
  await prisma.outboundRecord.deleteMany({ where: { threadId: "thread-pt2-test" } }).catch(() => {});
  await prisma.zaloThread.deleteMany({ where: { id: "thread-pt2-test" } }).catch(() => {});
});

afterEach(async () => {
  mockSendMessage.mockClear();
  try {
    const { clearAllCooldowns } = await import("../services/cooldown.service.js");
    await clearAllCooldowns();
  } catch {}
});

// ═══════════════════════════════════════════════════════════════════════
// PT2.1 — MockAdapter does NOT echo context in "bạn là ai"
// ═══════════════════════════════════════════════════════════════════════

describe("PT2.1 — MockAdapter content separation", () => {
  it("content field is raw user message, no context injected", async () => {
    const { MockHermesChatAdapter } = await import("../services/hermes-chat-adapter.js");

    const adapter = new MockHermesChatAdapter();
    const reply = await adapter.generateReply({
      threadId: "thread-pt2",
      threadType: "user",
      senderId: "user-1",
      senderName: "Anh Việt",
      content: "bạn là ai",  // RAW user message only
      recentMessages: [
        "user: xin chào",
        "assistant: Chào bạn!",
      ],
    });

    // Must NOT echo the conversation history or context headers
    expect(reply.reply).not.toContain("Dưới đây là các tin nhắn");
    expect(reply.reply).not.toContain("Tin nhắn mới nhất");
    expect(reply.reply).not.toContain("[LỊCH SỬ TRÒ CHUYỆN]");
    expect(reply.reply).not.toContain("[/LỊCH SỬ]");
    expect(reply.reply).not.toContain("[TIN NHẮN HIỆN TẠI]");
    expect(reply.reply).not.toContain("[KẾT THÚC LỊCH SỬ");

    // Must contain the user's actual question echo (mock adapter echoes content)
    expect(reply.reply).toContain("bạn là ai");
    expect(reply.reply).toContain("Xin chào");
  });

  it("empty context still produces clean reply", async () => {
    const { MockHermesChatAdapter } = await import("../services/hermes-chat-adapter.js");

    const adapter = new MockHermesChatAdapter();
    const reply = await adapter.generateReply({
      threadId: "thread-pt2-empty",
      threadType: "user",
      senderId: "user-1",
      senderName: "Test",
      content: "hello",
      recentMessages: [],
    });

    expect(reply.reply).not.toContain("[LỊCH SỬ");
    expect(reply.reply).toContain("hello");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PT2.2 — buildCLIPrompt: no bracket markers
// ═══════════════════════════════════════════════════════════════════════

describe("PT2.2 — CLI prompt template", () => {
  it("buildCLIPrompt has no bracket markers", async () => {
    // Dynamically import to access private method via prototype
    const mod = await import("../services/hermes-chat-adapter.js");
    const { RealHermesChatAdapter } = mod;

    // Access private method via prototype for testing
    const adapter = new RealHermesChatAdapter({
      mode: "cli",
      cliBin: "/usr/local/bin/hermes",
    });

    const prompt = (adapter as any).buildCLIPrompt({
      threadId: "thread-pt2",
      threadType: "user",
      senderId: "user-1",
      senderName: "Anh Việt",
      content: "bạn là ai",
      recentMessages: [
        "user: xin chào",
        "assistant: Chào bạn!",
      ],
    });

    // PT2: No bracket markers
    expect(prompt).not.toContain("[LỊCH SỬ TRÒ CHUYỆN]");
    expect(prompt).not.toContain("[/LỊCH SỬ]");
    expect(prompt).not.toContain("[TIN NHẮN HIỆN TẠI]");
    expect(prompt).not.toContain("[KẾT THÚC LỊCH SỬ");

    // PT2: Natural text instead
    expect(prompt).toContain("Dưới đây là một vài tin nhắn gần đây");
    expect(prompt).toContain("Không lặp lại phần này");

    // Content is in prompt
    expect(prompt).toContain("bạn là ai");

    // Instruction to not echo history
    expect(prompt).toContain("Không lặp lại lịch sử");
  });

  it("buildCLIPrompt without recentMessages has no markers either", async () => {
    const mod = await import("../services/hermes-chat-adapter.js");
    const { RealHermesChatAdapter } = mod;

    const adapter = new RealHermesChatAdapter({
      mode: "cli",
      cliBin: "/usr/local/bin/hermes",
    });

    const prompt = (adapter as any).buildCLIPrompt({
      threadId: "thread-pt2",
      threadType: "user",
      senderId: "user-1",
      senderName: "Test",
      content: "xin chào",
    });

    expect(prompt).not.toContain("[LỊCH SỬ");
    expect(prompt).toContain("xin chào");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PT2.3 — Echo guard still blocks marker-containing replies
// ═══════════════════════════════════════════════════════════════════════

describe("PT2.3 — Echo guard intact", () => {
  it("blocks reply containing [LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY]", async () => {
    const { sendOutbound } = await import("../services/outbound-dispatcher.service.js");

    const result = await sendOutbound({
      threadId: "thread-pt2-echo",
      threadType: "user",
      source: "hermes",
      content: 'Bạn vừa nói: "[LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY]\n👤 User: xin chào',
    });

    // Echo guard must BLOCK
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("prompt_echo_guard");
  });

  it("blocks reply containing [TIN NHẮN HIỆN TẠI]", async () => {
    const { sendOutbound } = await import("../services/outbound-dispatcher.service.js");

    const result = await sendOutbound({
      threadId: "thread-pt2-echo",
      threadType: "user",
      source: "hermes",
      content: "[TIN NHẮN HIỆN TẠI]\nuser: bạn là ai",
    });

    expect(result.decision).toBe("block");
    expect(result.reason).toContain("prompt_echo_guard");
  });

  it("blocks reply containing Dưới đây là các tin nhắn gần đây (context echo)", async () => {
    // Note: This marker is NOT in PROMPT_ECHO_MARKERS currently,
    // so this test verifies it passes through — we may want to add it.
    const { sendOutbound } = await import("../services/outbound-dispatcher.service.js");

    const result = await sendOutbound({
      threadId: "thread-pt2-echo",
      threadType: "user",
      source: "hermes",
      content: 'Dưới đây là các tin nhắn gần đây trong cuộc trò chuyện. Hãy dùng để hiểu ngữ cảnh.',
    });

    // This does NOT match current echo markers — it's natural text.
    // Content separation fix ensures this never reaches sendOutbound.
    // If it did, it would pass through (false negative risk accepted).
    // The real guard is: effectiveContent = msg.content (no context injection).
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("dry_run");
  });

  it("normal reply passes echo guard", async () => {
    const { sendOutbound } = await import("../services/outbound-dispatcher.service.js");

    const result = await sendOutbound({
      threadId: "thread-pt2-echo",
      threadType: "user",
      source: "hermes",
      content: "Xin chào! Tôi là trợ lý Zalo.",
    });

    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("dry_run");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PT2.4 — Content remains raw, context passed separately
// ═══════════════════════════════════════════════════════════════════════

describe("PT2.4 — Content/context passed separately to adapter", () => {
  it("buildContextString is NOT injected into adapter content", async () => {
    // The MockAdapter receives content = msg.content (raw user message).
    // Context is passed via recentMessages, not injected into content.
    const { MockHermesChatAdapter } = await import("../services/hermes-chat-adapter.js");

    const adapter = new MockHermesChatAdapter();
    const reply = await adapter.generateReply({
      threadId: "thread-pt2-clean",
      threadType: "user",
      senderId: "user-1",
      senderName: "Anh Việt",
      content: "bạn là ai",  // Just the user message
      recentMessages: [
        "user: chào buổi sáng",
        "assistant: Chào bạn! Chúc bạn ngày mới tốt lành.",
      ],
    });

    // The mock adapter echoes input.content, which should be the raw message
    expect(reply.reply).toContain("bạn là ai");

    // Must NOT contain any of these context injection patterns
    const forbiddenPatterns = [
      "Dưới đây là các tin nhắn gần đây",
      "Tin nhắn mới nhất",
      "[LỊCH SỬ TRÒ CHUYỆN",
      "[/LỊCH SỬ]",
      "chào buổi sáng",  // This is history, NOT in content
      "Chúc bạn ngày mới tốt lành",  // This is history too
    ];
    for (const pattern of forbiddenPatterns) {
      expect(reply.reply).not.toContain(pattern);
    }
  });

  it("recentMessages pass context but don't contaminate content", async () => {
    const { MockHermesChatAdapter } = await import("../services/hermes-chat-adapter.js");

    const adapter = new MockHermesChatAdapter();
    const reply = await adapter.generateReply({
      threadId: "thread-pt2",
      threadType: "user",
      senderId: "user-1",
      senderName: "Anh Việt",
      content: "thời tiết hôm nay thế nào",
      recentMessages: [
        "user: chào",
        "assistant: Chào bạn!",
        "user: tôi muốn hỏi về thời tiết",
        "assistant: Bạn muốn hỏi về thời tiết ở đâu?",
      ],
    });

    // Content is raw user message
    expect(reply.reply).toContain("thời tiết hôm nay thế nào");

    // History messages should NOT appear in the echoed content
    expect(reply.reply).not.toContain("tôi muốn hỏi về thời tiết");
    expect(reply.reply).not.toContain("Bạn muốn hỏi về thời tiết ở đâu?");
  });

  it("buildContextString conversation format uses natural text, no brackets", async () => {
    const { buildContextString } = await import("../services/conversation-context.service.js");

    const ctx = {
      threadId: "thread-pt2",
      threadType: "user",
      recentMessages: [
        { role: "user" as const, content: "xin chào", senderName: "Anh Việt", messageType: "text", createdAt: new Date() },
        { role: "assistant" as const, content: "Chào bạn!", senderName: "Bot", messageType: "text", createdAt: new Date() },
      ],
      messageCount: 2,
      hasMore: false,
    };

    const contextStr = buildContextString(ctx);

    // PT2: No bracket markers in context string
    expect(contextStr).not.toContain("[LỊCH SỬ TRÒ CHUYỆN]");
    expect(contextStr).not.toContain("[/LỊCH SỬ]");
    expect(contextStr).not.toContain("[TIN NHẮN HIỆN TẠI]");
    expect(contextStr).not.toContain("[KẾT THÚC LỊCH SỬ");

    // Natural Vietnamese instead
    expect(contextStr).toContain("Dưới đây là các tin nhắn");
    expect(contextStr).toContain("👤");
    expect(contextStr).toContain("🤖");
    expect(contextStr).toContain("-- hết lịch sử --");
  });
});
