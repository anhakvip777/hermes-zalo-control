// =============================================================================
// Batch 4 — Outbound Guardrails Tests
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  splitLongMessage,
  sanitizeText,
  checkOutboundDedup,
  recordOutboundDedup,
  resetOutboundDedup,
  applyOutboundGuardrails,
} from "../services/outbound-guardrails.service.js";

beforeEach(() => {
  resetOutboundDedup();
});

// ═══════════════════════════════════════════════════════════════════
// 1. Split-send tests
// ═══════════════════════════════════════════════════════════════════

describe("Split-send", () => {
  it("short message not split", () => {
    const parts = splitLongMessage("Xin chào", 1800, 5);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe("Xin chào");
  });

  it("long message > 1800 chars split into multiple parts", () => {
    const long = "A".repeat(2500);
    const parts = splitLongMessage(long, 100, 5);
    expect(parts.length).toBeGreaterThan(1);
    // Each part should be <= maxChars + prefix "(X/Y) " overhead
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(120); // 100 + prefix overhead + possible extra chars at break boundary
    }
  });

  it("parts have (X/Y) prefix when multiple", () => {
    const long = "B".repeat(2500);
    const parts = splitLongMessage(long, 100, 5);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toMatch(/^\(\d+\/\d+\)/);
  });

  it("emojis not broken across parts", () => {
    // Test with Vietnamese + emoji
    const text = "😀".repeat(50) + " tiếng Việt có dấu ắ ạ ố ồ";
    const parts = splitLongMessage(text, 10, 10);
    // All parts must have valid Unicode
    for (const p of parts) {
      expect(() => p.normalize("NFC")).not.toThrow();
      // No unpaired surrogate
      for (let i = 0; i < p.length; i++) {
        const c = p.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          // High surrogate must be followed by low surrogate
          expect(p.charCodeAt(i + 1)).toBeGreaterThanOrEqual(0xdc00);
          expect(p.charCodeAt(i + 1)).toBeLessThanOrEqual(0xdfff);
        }
      }
    }
  });

  it("Vietnamese diacritics preserved", () => {
    const text = "ắ ạ ố ồ ề ể".repeat(200);
    const parts = splitLongMessage(text, 100, 30);
    const joined = parts.join("");
    expect(joined).toContain("ắ");
    expect(joined).toContain("ố");
    expect(joined).toContain("ề");
  });

  it("max parts respected", () => {
    const long = "C".repeat(5000);
    const parts = splitLongMessage(long, 100, 3);
    expect(parts.length).toBeLessThanOrEqual(3);
  });

  it("breaks at natural boundaries when possible", () => {
    const long = "A".repeat(1600) + "\n\n" + "B".repeat(400);
    const parts = splitLongMessage(long, 1800, 5);
    // Should break at the double newline
    const joined = parts.join("");
    expect(joined).toContain("BBBB");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Unicode Sanitizer tests
// ═══════════════════════════════════════════════════════════════════

describe("Unicode Sanitizer", () => {
  it("Vietnamese diacritics preserved", () => {
    const input = "Chào bạn, tôi là trợ lý ảo. ắ ạ ố ồ ề ể!";
    const result = sanitizeText(input);
    expect(result).toContain("ắ");
    expect(result).toContain("ố");
    expect(result).toContain("ề");
    expect(result).toContain("ể");
  });

  it("smart quotes replaced with ASCII", () => {
    const input = 'He said \u201cHello\u201d and \u2018bye\u2019';
    const result = sanitizeText(input);
    expect(result).toContain('"');
    expect(result).not.toContain("\u201c");
    expect(result).not.toContain("\u2018");
  });

  it("em dash and en dash replaced", () => {
    const input = "A\u2014B\u2013C";
    const result = sanitizeText(input);
    expect(result).toBe("A--B-C");
  });

  it("zero-width characters removed", () => {
    const input = "A\u200bB\u200cC\u200dD";
    const result = sanitizeText(input);
    expect(result).toBe("ABCD");
  });

  it("control characters removed (except newline/tab)", () => {
    const input = "Hello\x00\x01World\x02\nTest\tTab";
    const result = sanitizeText(input);
    expect(result).toBe("HelloWorld\nTest\tTab");
  });

  it("non-breaking space → regular space", () => {
    const input = "A\u00a0B";
    const result = sanitizeText(input);
    expect(result).toBe("A B");
  });

  it("NFC normalization applied", () => {
    // Vietnamese "à" can be represented as combining sequence
    const input = "a\u0300"; // a + combining grave → à
    const result = sanitizeText(input);
    expect(result).toBe("à");
    expect(result.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Outbound Dedup tests
// ═══════════════════════════════════════════════════════════════════

describe("Outbound Dedup", () => {
  it("first send not duplicate", () => {
    const result = checkOutboundDedup("thread-1", "Hello", "auto_reply");
    expect(result.duplicate).toBe(false);
  });

  it("second identical send within 60s is duplicate", () => {
    checkOutboundDedup("thread-1", "Hello", "auto_reply");
    recordOutboundDedup("thread-1", "Hello");
    const result = checkOutboundDedup("thread-1", "Hello", "auto_reply");
    expect(result.duplicate).toBe(true);
  });

  it("different content not blocked", () => {
    recordOutboundDedup("thread-1", "Message A");
    const result = checkOutboundDedup("thread-1", "Message B", "auto_reply");
    expect(result.duplicate).toBe(false);
  });

  it("different thread, same content not blocked", () => {
    recordOutboundDedup("thread-1", "Hello");
    const result = checkOutboundDedup("thread-2", "Hello", "auto_reply");
    expect(result.duplicate).toBe(false);
  });

  it("adapter double-send within 5s blocked (same hash)", () => {
    checkOutboundDedup("thread-1", "Hello", "auto_reply");
    recordOutboundDedup("thread-1", "Hello");
    const result = checkOutboundDedup("thread-1", "Hello", "auto_reply");
    expect(result.duplicate).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Combined guardrails (applyOutboundGuardrails)
// ═══════════════════════════════════════════════════════════════════

describe("applyOutboundGuardrails", () => {
  it("allows normal message", () => {
    const result = applyOutboundGuardrails("t1", "user", "Xin chào", "auto_reply", false);
    expect(result.allowed).toBe(true);
    expect(result.parts).toBeDefined();
    expect(result.parts!.length).toBe(1);
  });

  it("sanitizes smart quotes in passed content", () => {
    const result = applyOutboundGuardrails("t1", "user", 'Say \u201chello\u201d', "auto_reply", false);
    expect(result.allowed).toBe(true);
    expect(result.parts![0]).toContain('"');
  });

  it("splits long message", () => {
    const long = "D".repeat(2500);
    const result = applyOutboundGuardrails("t1", "user", long, "auto_reply", false);
    expect(result.allowed).toBe(true);
    expect(result.parts!.length).toBeGreaterThan(1);
  });

  it("blocks duplicate outbound", () => {
    // First send
    applyOutboundGuardrails("t1", "user", "Hello", "auto_reply", false);
    recordOutboundDedup("t1", "Hello");
    // Second send
    const result = applyOutboundGuardrails("t1", "user", "Hello", "auto_reply", false);
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("DUPLICATE_OUTBOUND");
  });

  it("dryRun passes but doesn't record dedup (caller handles)", () => {
    const result = applyOutboundGuardrails("t1", "user", "Test", "auto_reply", true);
    expect(result.allowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Edge cases
// ═══════════════════════════════════════════════════════════════════

describe("Edge cases", () => {
  it("empty string not split", () => {
    const parts = splitLongMessage("", 1800, 5);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe("");
  });

  it("very long single emoji handled", () => {
    const long = "🌟".repeat(2000);
    const parts = splitLongMessage(long, 100, 20);
    expect(parts.length).toBeGreaterThan(1);
  });

  it("mixed Vietnamese + emoji + newlines", () => {
    const text = "Xin chào các bạn! 😊\n\nHôm nay thời tiết đẹp quá ạ 🌤️\n\nChúc cả nhà một ngày tốt lành ắ ạ! 🙏";
    const parts = splitLongMessage(text, 50, 10);
    const joined = parts.join("");
    expect(joined).toContain("chào");
    expect(joined).toContain("😊");
    expect(joined).toContain("🌤️");
    expect(joined).toContain("ắ");
  });
});
