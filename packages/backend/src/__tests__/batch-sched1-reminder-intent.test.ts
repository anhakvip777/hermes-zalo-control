// =============================================================================
// SCHED1: Reminder/Schedule Action Hallucination — Pattern & Parser Tests
// =============================================================================
// Bug: "2p nữa nhắn tôi học bài" was not detected as reminder intent
// because pattern only matched "nhắc" but not "nhắn", and "2p" (compact)
// was not handled by the "X phút nữa nhắn" parser.
// Fix: Added 4 new patterns to detectCreateReminderIntent + 2 new parser
// blocks in parseReminderFromMessage (verb-first+compact + "sau X phút").
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  detectCreateReminderIntent,
  parseReminderFromMessage,
} from "../services/incoming-dispatcher.service.js";

// ── detectCreateReminderIntent ───────────────────────────────────────────────

describe("SCHED1 detectCreateReminderIntent", () => {
  // ── Original bug reproduction ─────────────────────────────────────────────
  it("detects '2p nữa nhắn tôi học bài' (original bug — was MISS)", () => {
    expect(detectCreateReminderIntent("2p nữa nhắn tôi học bài")).toBe(true);
  });

  // ── nhắn synonym ─────────────────────────────────────────────────────────
  it("detects 'nhắn mình 2p nữa học bài'", () => {
    expect(detectCreateReminderIntent("nhắn mình 2p nữa học bài")).toBe(true);
  });

  it("detects 'nhắn tôi 2p nữa học bài'", () => {
    expect(detectCreateReminderIntent("nhắn tôi 2p nữa học bài")).toBe(true);
  });

  it("detects '2 phút nữa nhắn tôi đi ăn'", () => {
    expect(detectCreateReminderIntent("2 phút nữa nhắn tôi đi ăn")).toBe(true);
  });

  // ── sau X phút variant ────────────────────────────────────────────────────
  it("detects 'sau 2 phút nhắc tôi họp'", () => {
    expect(detectCreateReminderIntent("sau 2 phút nhắc tôi họp")).toBe(true);
  });

  it("detects 'sau 2p nhắn tôi uống thuốc'", () => {
    expect(detectCreateReminderIntent("sau 2p nhắn tôi uống thuốc")).toBe(true);
  });

  it("detects 'sau 30 phút nhắc tôi'", () => {
    expect(detectCreateReminderIntent("sau 30 phút nhắc tôi")).toBe(true);
  });

  // ── Compact 2p + nữa + nhắn ──────────────────────────────────────────────
  it("detects '5p nữa nhắn anh'", () => {
    expect(detectCreateReminderIntent("5p nữa nhắn anh")).toBe(true);
  });

  it("detects '10p nữa báo mình'", () => {
    expect(detectCreateReminderIntent("10p nữa báo mình")).toBe(true);
  });

  // ── Pre-existing patterns still work ─────────────────────────────────────
  it("still detects 'nhắc mình 2 phút nữa họp' (pre-existing)", () => {
    expect(detectCreateReminderIntent("nhắc mình 2 phút nữa họp")).toBe(true);
  });

  it("still detects '2 phút nữa nhắc tôi học bài' (pre-existing)", () => {
    expect(detectCreateReminderIntent("2 phút nữa nhắc tôi học bài")).toBe(true);
  });

  it("still detects 'nhắn mình sau 2 phút' (pre-existing nhắn+sau)", () => {
    expect(detectCreateReminderIntent("nhắn mình sau 2 phút")).toBe(true);
  });

  it("still detects 'nhắc mình học bài lúc 20h' (pre-existing lúc)", () => {
    expect(detectCreateReminderIntent("nhắc mình học bài lúc 20h")).toBe(true);
  });

  // ── Negatives — must NOT trigger ─────────────────────────────────────────
  it("does NOT detect 'bạn là ai'", () => {
    expect(detectCreateReminderIntent("bạn là ai")).toBe(false);
  });

  it("does NOT detect 'xin chào bot'", () => {
    expect(detectCreateReminderIntent("xin chào bot")).toBe(false);
  });

  it("does NOT detect 'nhắn tin cho tôi đi' (nhắn tin = send message, not remind)", () => {
    expect(detectCreateReminderIntent("nhắn tin cho tôi đi")).toBe(false);
  });

  it("does NOT detect 'tin nhắn mới'", () => {
    expect(detectCreateReminderIntent("tin nhắn mới")).toBe(false);
  });

  it("does NOT detect 'lịch họp hôm nay là gì' (query, not create)", () => {
    expect(detectCreateReminderIntent("lịch họp hôm nay là gì")).toBe(false);
  });
});

// ── parseReminderFromMessage ─────────────────────────────────────────────────

describe("SCHED1 parseReminderFromMessage", () => {
  const MIN = 60_000;

  // ── Original bug: "2p nữa nhắn tôi học bài" ──────────────────────────────
  it("parses '2p nữa nhắn tôi học bài' → 2 min, content='học bài'", () => {
    const result = parseReminderFromMessage("2p nữa nhắn tôi học bài");
    expect(result).not.toBeNull();
    expect(result!.scheduledAt.getTime() - Date.now()).toBeGreaterThanOrEqual(1 * MIN);
    expect(result!.scheduledAt.getTime() - Date.now()).toBeLessThan(3 * MIN);
    expect(result!.content.toLowerCase()).toContain("học bài");
  });

  // ── verb-first + compact 2p ───────────────────────────────────────────────
  it("parses 'nhắn mình 2p nữa học bài' → 2 min, content='học bài'", () => {
    const result = parseReminderFromMessage("nhắn mình 2p nữa học bài");
    expect(result).not.toBeNull();
    expect(result!.scheduledAt.getTime() - Date.now()).toBeGreaterThanOrEqual(1 * MIN);
    expect(result!.content.toLowerCase()).toContain("học bài");
    // Must NOT include the pronoun
    expect(result!.content.toLowerCase()).not.toMatch(/^(mình|tôi|tui|em|anh|chị)\s/);
  });

  it("parses 'nhắn tôi 2p nữa học bài' → content='học bài' (no pronoun)", () => {
    const result = parseReminderFromMessage("nhắn tôi 2p nữa học bài");
    expect(result).not.toBeNull();
    expect(result!.content.toLowerCase()).toContain("học bài");
    expect(result!.content.toLowerCase()).not.toMatch(/^tôi\s/);
  });

  it("parses 'nhắc mình 2 phút nữa họp' → 2 min, content='họp'", () => {
    const result = parseReminderFromMessage("nhắc mình 2 phút nữa họp");
    expect(result).not.toBeNull();
    expect(result!.content.toLowerCase()).toContain("họp");
  });

  // ── sau X phút variant ────────────────────────────────────────────────────
  it("parses 'sau 2 phút nhắc tôi họp' → 2 min, content='họp'", () => {
    const result = parseReminderFromMessage("sau 2 phút nhắc tôi họp");
    expect(result).not.toBeNull();
    expect(result!.scheduledAt.getTime() - Date.now()).toBeGreaterThanOrEqual(1 * MIN);
    expect(result!.content.toLowerCase()).toContain("họp");
  });

  it("parses 'sau 2p nhắn tôi uống thuốc' → 2 min, content='uống thuốc'", () => {
    const result = parseReminderFromMessage("sau 2p nhắn tôi uống thuốc");
    expect(result).not.toBeNull();
    expect(result!.content.toLowerCase()).toContain("uống thuốc");
  });

  it("parses 'sau 30 phút nhắc tôi tập thể dục' → 30 min", () => {
    const result = parseReminderFromMessage("sau 30 phút nhắc tôi tập thể dục");
    expect(result).not.toBeNull();
    expect(result!.scheduledAt.getTime() - Date.now()).toBeGreaterThanOrEqual(29 * MIN);
    expect(result!.scheduledAt.getTime() - Date.now()).toBeLessThan(31 * MIN);
    expect(result!.content.toLowerCase()).toContain("tập thể dục");
  });

  // ── time-first + nhắn ────────────────────────────────────────────────────
  it("parses '2 phút nữa nhắn tôi đi ăn' → 2 min, content='đi ăn'", () => {
    const result = parseReminderFromMessage("2 phút nữa nhắn tôi đi ăn");
    expect(result).not.toBeNull();
    expect(result!.content.toLowerCase()).toContain("đi ăn");
  });

  // ── Pre-existing patterns still work ─────────────────────────────────────
  it("still parses '2 phút nữa nhắc tôi học bài' (pre-existing)", () => {
    const result = parseReminderFromMessage("2 phút nữa nhắc tôi học bài");
    expect(result).not.toBeNull();
    expect(result!.content.toLowerCase()).toContain("học bài");
  });

  // ── scheduledAt minimum 10s enforced ─────────────────────────────────────
  it("enforces minimum 10s future for very short delays", () => {
    const result = parseReminderFromMessage("1 giây nữa nhắc tôi test");
    expect(result).not.toBeNull();
    expect(result!.scheduledAt.getTime() - Date.now()).toBeGreaterThanOrEqual(8_000);
  });

  // ── Non-reminder content returns null ────────────────────────────────────
  it("returns null for 'bạn là ai' (not a reminder)", () => {
    expect(parseReminderFromMessage("bạn là ai")).toBeNull();
  });

  it("returns null for 'xin chào' (not a reminder)", () => {
    expect(parseReminderFromMessage("xin chào")).toBeNull();
  });

  it("returns null for 'nhắn tin cho tôi đi' (not a reminder)", () => {
    expect(parseReminderFromMessage("nhắn tin cho tôi đi")).toBeNull();
  });
});
