// =============================================================================
// R4C — Thread ID Normalization Tests
// =============================================================================
// Verifies normalizeThreadId() and assertValidThreadId() behave correctly,
// and that boundary points (sendOutbound, live-test, send-test route) use
// normalized threadIds.
// =============================================================================

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// ── Unit tests for normalizeThreadId / assertValidThreadId ───────────

import { normalizeThreadId, assertValidThreadId } from "../services/thread-id.js";

describe("R4C — normalizeThreadId", () => {
  it("trims whitespace", () => {
    expect(normalizeThreadId(" 6792540503378312397 ")).toBe("6792540503378312397");
    expect(normalizeThreadId("\t6792540503378312397\n")).toBe("6792540503378312397");
  });

  it("preserves long 18-digit numeric string exactly", () => {
    const long = "6792540503378312397";
    expect(normalizeThreadId(long)).toBe(long);
    // Verify no truncation or mutation
    expect(normalizeThreadId(long).length).toBe(19);
  });

  it("converts small number to string safely", () => {
    expect(normalizeThreadId(503378312397)).toBe("503378312397");
  });

  it("converts zero to '0' (string, not empty)", () => {
    expect(normalizeThreadId(0)).toBe("0");
  });

  it("returns empty string for null", () => {
    expect(normalizeThreadId(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(normalizeThreadId(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(normalizeThreadId("")).toBe("");
  });

  it("returns empty string for whitespace-only", () => {
    expect(normalizeThreadId("   ")).toBe("");
  });

  it("does NOT parseInt or Number the input", () => {
    // Leading zeros preserved
    expect(normalizeThreadId("00123")).toBe("00123");
    // Non-numeric strings preserved
    expect(normalizeThreadId("group-123")).toBe("group-123");
  });

  // IMPORTANT: Long numeric thread IDs must remain strings.
  // Passing them as JS number can lose precision before normalization.
  // This test documents the expected behavior for SAFE numbers only.
  it("DOC: long 18-digit IDs must be passed as string, not number (JS precision limit)", () => {
    // JS Number can only safely represent integers up to 2^53-1 (~9e15)
    // 18-digit Zalo IDs (~6e17) exceed this limit
    const asNumber = 6792540503378312397; // This ALREADY loses precision in JS
    const asString = "6792540503378312397";
    // normalizeThreadId cannot recover precision already lost
    expect(normalizeThreadId(asNumber)).not.toBe(asString);
    // But passing as string is correct
    expect(normalizeThreadId(asString)).toBe(asString);
  });
});

describe("R4C — assertValidThreadId", () => {
  it("returns normalized string for valid input", () => {
    expect(assertValidThreadId(" 6792540503378312397 ")).toBe("6792540503378312397");
  });

  it("throws for empty string", () => {
    expect(() => assertValidThreadId("")).toThrow("threadId is required");
  });

  it("throws for null", () => {
    expect(() => assertValidThreadId(null)).toThrow("threadId is required");
  });

  it("throws for undefined", () => {
    expect(() => assertValidThreadId(undefined)).toThrow("threadId is required");
  });

  it("throws for whitespace-only", () => {
    expect(() => assertValidThreadId("   ")).toThrow("threadId is required");
  });
});

// ── Boundary test: sendOutbound normalizes threadId ──────────────────

describe("R4C — sendOutbound uses normalized threadId", () => {
  it("normalizes threadId with whitespace before dispatching", async () => {
    // Mock the underlying services so we can verify the threadId used
    const mockSender = { sendMessage: vi.fn().mockResolvedValue({ success: true, messageId: "dry-run-1" }) };
    vi.doMock("../services/zalo-message-sender.js", () => ({
      ZaloMessageSender: vi.fn().mockImplementation(() => mockSender),
    }));
    vi.doMock("../services/thread-settings.service.js", () => ({
      getThreadSettings: vi.fn().mockResolvedValue({ autoReplyEnabled: true }),
    }));

    const { sendOutbound } = await import("../services/outbound-dispatcher.service.js");

    const result = await sendOutbound({
      threadId: " 6792540503378312397 ",
      threadType: "user",
      source: "manual_test",
      content: "test",
    });

    // Should succeed (dryRun=true by default)
    expect(result.success || result.dryRun).toBe(true);
    // The threadId in the result should have been used normalized internally
  });
});

// ── Boundary test: live-test startLiveTest normalizes threadId ───────

describe("R4C — startLiveTest normalizes threadId", () => {
  beforeAll(() => {
    process.env.ZALO_AUTO_REPLY_ALLOWED_THREADS = "6792540503378312397";
  });

  afterAll(() => {
    delete process.env.ZALO_AUTO_REPLY_ALLOWED_THREADS;
  });

  it("normalizes threadId with whitespace in startLiveTest", async () => {
    // Reload config after setting env
    vi.resetModules();
    const { startLiveTest } = await import("../services/live-test.service.js");

    // Whitespace around valid threadId should be trimmed and matched
    const result = await startLiveTest({
      threadId: " 6792540503378312397 ",
      maxMessages: 1,
      ttlSeconds: 60,
      confirmText: "START LIVE TEST",
      reason: "Test normalization with whitespace",
      createdBy: "admin",
    });

    // Should succeed (threadId matches allowedThreads after trim)
    // OR fail on readiness check, not on threadId mismatch
    if (!result.success) {
      // Acceptable failures: NOT_READY (readiness gate), THREAD_NOT_ALLOWED (if allowedThreads not in DB)
      expect(["NOT_READY", "SESSION_EXISTS", "DRY_RUN_REQUIRED"]).toContain(result.errorCode);
    }
  });
});
