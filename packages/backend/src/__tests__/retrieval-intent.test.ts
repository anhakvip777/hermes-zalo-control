// =============================================================================
// Retrieval intent — search-term derivation (relevance guard)
// =============================================================================
// Pure, DB-free. Guards the rule that a subject-less request (only generic
// command/intent words) must NOT produce a search term — otherwise a query like
// "gửi tôi menu" would search for "menu" and match unrelated evidence, returning
// a false "found". A concrete subject ("cửa hàng B") must survive stripping.
// =============================================================================

import { describe, it, expect } from "vitest";
import { detectRetrievalIntent } from "../services/retrieval-intent.js";

describe("detectRetrievalIntent — generic vs concrete subject", () => {
  it("keeps a concrete subject after stripping filler/intent words", () => {
    const r = detectRetrievalIntent("gửi tôi thực đơn cửa hàng B");
    expect(r.isRetrieval).toBe(true);
    expect(r.searchQuery).toBeTruthy();
    expect(r.searchQuery!).toContain("cửa hàng");
    expect(r.searchQuery!).not.toContain("gửi");
    expect(r.searchQuery!).not.toContain("thực đơn");
  });

  it("keeps a nonsense-but-concrete token (this is the not-found subject)", () => {
    const r = detectRetrievalIntent("gửi tôi xyz-khong-ton-tai-999");
    expect(r.isRetrieval).toBe(true);
    expect(r.searchQuery).toBe("xyz-khong-ton-tai-999");
  });

  // Generic-only requests must NOT yield a search term (req #4/#5): no concrete
  // subject remains, so we do not run a search that could false-match.
  it.each([
    "gửi tôi",
    "cho tôi xem",
    "tìm",
    "lục lại",
    "menu",
    "thực đơn",
  ])("generic-only %j → not a searchable retrieval", (text) => {
    const r = detectRetrievalIntent(text);
    expect(r.isRetrieval).toBe(false);
    expect(r.searchQuery).toBeUndefined();
  });

  it("chit-chat → not retrieval", () => {
    expect(detectRetrievalIntent("hi").isRetrieval).toBe(false);
    expect(detectRetrievalIntent("cảm ơn nhé").isRetrieval).toBe(false);
  });
});
