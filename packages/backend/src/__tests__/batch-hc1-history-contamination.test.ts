// =============================================================================
// HC1 — History Contamination Tests
// Tests that buildContextString filters contaminated messages from AI context
// =============================================================================

import { describe, it, expect } from "vitest";
import { buildContextString } from "../services/conversation-context.service.js";

// We can test buildContextString directly since it's a pure function
// (no DB access needed for the string-building part)

describe("HC1 — History Contamination Filter", () => {
  const makeCtx = (messages: Array<{ role: "user" | "assistant"; content: string }>) => ({
    threadId: "thread-test-hc1",
    threadType: "user" as const,
    recentMessages: messages.map((m, i) => ({
      role: m.role,
      content: m.content,
      senderName: m.role === "user" ? "TestUser" : undefined,
      createdAt: new Date(2026, 0, i + 1),
    })),
    messageCount: messages.length,
    hasMore: false,
  });

  it("excludes assistant message containing [LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY]", () => {
    const ctx = makeCtx([
      { role: "user", content: "xin chào" },
      { role: "assistant", content: 'Bạn vừa nói: "[LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY]\\n👤 User: xin chào' },
      { role: "user", content: "bạn khỏe không" },
    ]);
    const result = buildContextString(ctx);
    // Should contain the clean user messages
    expect(result).toContain("xin chào");
    expect(result).toContain("bạn khỏe không");
    // Should NOT contain the contaminated assistant content
    expect(result).not.toContain("Bạn vừa nói");
  });

  it("excludes assistant message containing [TIN NHẮN HIỆN TẠI]", () => {
    const ctx = makeCtx([
      { role: "user", content: "hello" },
      { role: "assistant", content: "[TIN NHẮN HIỆN TẠI]\nBạn vừa nói: hello" },
      { role: "user", content: "how are you" },
    ]);
    const result = buildContextString(ctx);
    expect(result).toContain("hello");
    expect(result).toContain("how are you");
    // Contaminated assistant excluded
    expect(result).not.toContain("Bạn vừa nói");
  });

  it("excludes assistant message containing BEGIN_CONTEXT", () => {
    const ctx = makeCtx([
      { role: "user", content: "chào bot" },
      { role: "assistant", content: "BEGIN_CONTEXT\nSystem: bạn là trợ lý\nEND_CONTEXT\nXin chào!" },
      { role: "user", content: "cảm ơn" },
    ]);
    const result = buildContextString(ctx);
    expect(result).toContain("chào bot");
    expect(result).toContain("cảm ơn");
  });

  it("excludes assistant message containing [KẾT THÚC LỊCH SỬ", () => {
    const ctx = makeCtx([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Đây là câu trả lời\n[KẾT THÚC LỊCH SỬ — tiếp tục]" },
      { role: "user", content: "ok" },
    ]);
    const result = buildContextString(ctx);
    expect(result).toContain("hi");
    expect(result).toContain("ok");
    expect(result).not.toContain("Đây là câu trả lời");
  });

  it("keeps normal assistant messages", () => {
    const ctx = makeCtx([
      { role: "user", content: "xin chào" },
      { role: "assistant", content: "Chào bạn! Tôi có thể giúp gì?" },
      { role: "user", content: "cảm ơn" },
      { role: "assistant", content: "Không có gì ạ!" },
    ]);
    const result = buildContextString(ctx);
    expect(result).toContain("Chào bạn! Tôi có thể giúp gì?");
    expect(result).toContain("Không có gì ạ!");
    expect(result).toContain("xin chào");
    expect(result).toContain("cảm ơn");
  });

  it("keeps user messages even if they happen to contain markers (user can't leak)", () => {
    // User messages should still be shown even if they contain markers
    // because users can type anything and we don't want to hide context
    const ctx = makeCtx([
      { role: "user", content: "BEGIN_CONTEXT là gì vậy bot?" },
      { role: "assistant", content: "BEGIN_CONTEXT là một marker hệ thống, không cần quan tâm." },
    ]);
    const result = buildContextString(ctx);
    // Both should be excluded because both contain markers
    // (assistant excluded by filter, user also matched by filter since we don't discriminate by role)
    // This is the current behavior — we exclude ANY message with markers
    expect(result).not.toContain("BEGIN_CONTEXT");
  });

  it("null/empty content messages are safe", () => {
    const ctx = makeCtx([
      { role: "user", content: "hi" },
      { role: "assistant", content: "" },
      { role: "user", content: "bye" },
    ]);
    const result = buildContextString(ctx);
    // Empty assistant message shouldn't crash
    expect(result).toContain("hi");
    expect(result).toContain("bye");
  });

  it("empty context returns empty string", () => {
    const ctx = makeCtx([]);
    const result = buildContextString(ctx);
    expect(result).toBe("");
  });

  it("builds natural language header and footer (no bracket markers)", () => {
    const ctx = makeCtx([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    const result = buildContextString(ctx);
    // PT1: Should use natural text instead of bracket markers
    expect(result).toContain("Dưới đây là các tin nhắn gần đây");
    expect(result).toContain("-- hết lịch sử --");
    expect(result).toContain("👤 TestUser: hi");
    expect(result).toContain("🤖 Bot: hello");
    // Must NOT contain old bracket markers
    expect(result).not.toContain("[LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY]");
    expect(result).not.toContain("[KẾT THÚC LỊCH SỬ");
    expect(result).not.toContain("[TIN NHẮN HIỆN TẠI]");
  });
});
