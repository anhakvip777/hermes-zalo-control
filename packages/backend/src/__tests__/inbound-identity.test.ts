// =============================================================================
// KI-H1 — inbound identity/threadId/senderId resolution (DB-free)
// =============================================================================
// Unit tests for normalizeInboundIdentity() + normalizeMessage() derivation.
// No DB, no live, no network — pure parsing.
// =============================================================================

import { describe, it, expect } from "vitest";
import { normalizeInboundIdentity } from "../services/inbound-identity.js";
import { normalizeMessage } from "../services/zalo-receive.js";

describe("KI-H1 normalizeInboundIdentity", () => {
  it("case 1: group with threadId=null, groupId present, isGroup=true → group/derived", () => {
    const id = normalizeInboundIdentity({
      isGroup: true,
      groupId: "111222333444555666",
      data: { content: "hi", senderId: "900900900" },
    });
    expect(id.threadType).toBe("group");
    expect(id.threadId).toBe("111222333444555666");
    expect(id.senderId).toBe("900900900");
    expect(id.identityConfidence).toBe("derived");
    expect(id.identitySource).toContain("threadId:groupId");
  });

  it("case 2: DM with threadId=null, senderId present → user/derived, threadId=senderId", () => {
    const id = normalizeInboundIdentity({
      data: { content: "hello", senderId: "6792540503378312397" },
    });
    expect(id.threadType).toBe("user");
    expect(id.threadId).toBe("6792540503378312397");
    expect(id.senderId).toBe("6792540503378312397");
    expect(id.identityConfidence).toBe("derived");
  });

  it("case 2b: DM derives threadId from `from` when senderId missing", () => {
    const id = normalizeInboundIdentity({ isGroup: false, data: { from: "555000555", content: "x" } });
    expect(id.threadType).toBe("user");
    expect(id.threadId).toBe("555000555");
  });

  it("case 3: blank senderId → senderId null, confidence not exact", () => {
    const id = normalizeInboundIdentity({
      type: 1,
      threadId: "111222333444555666",
      data: { content: "@bot xin chào" }, // no senderId at all
    });
    expect(id.senderId).toBeNull();
    expect(id.threadType).toBe("group");
    // explicit type + explicit threadId, but sender is blank → still resolvable thread,
    // confidence is exact for the THREAD (sender-blank is handled by the dispatcher guard).
    expect(id.threadId).toBe("111222333444555666");
  });

  it("case 4: explicit numeric type maps 0→user, non-zero→group (no id collision at type level)", () => {
    const user = normalizeInboundIdentity({ type: 0, threadId: "77", data: { senderId: "77" } });
    const group = normalizeInboundIdentity({ type: 1, threadId: "77", data: { senderId: "aa" } });
    expect(user.threadType).toBe("user");
    expect(group.threadType).toBe("group");
    // Same threadId string, different threadType → callers key allow/deny by (id,type).
    expect(user.threadId).toBe(group.threadId);
    expect(user.threadType).not.toBe(group.threadType);
  });

  it("case 7: nothing resolvable → threadType=unknown, threadId=null, confidence=unknown, no crash", () => {
    const id = normalizeInboundIdentity({ data: { content: "??" } });
    expect(id.threadType).toBe("unknown");
    expect(id.threadId).toBeNull();
    expect(id.senderId).toBeNull();
    expect(id.identityConfidence).toBe("unknown");
  });

  it("never derives senderId from a display name", () => {
    const id = normalizeInboundIdentity({
      type: 0,
      threadId: "123",
      data: { senderName: "Tỷ Đoàn Phương", fromName: "Muội" }, // names only, no id
    });
    expect(id.senderId).toBeNull();
    expect(id.senderName).toBe("Tỷ Đoàn Phương");
  });

  it("null/garbage input → safe unknown, no throw", () => {
    expect(() => normalizeInboundIdentity(null)).not.toThrow();
    expect(normalizeInboundIdentity(null).identityConfidence).toBe("unknown");
    expect(normalizeInboundIdentity(undefined).threadType).toBe("unknown");
  });
});

describe("KI-H1 normalizeMessage derivation (case 6: not-null when fallback valid)", () => {
  it("keeps a group message whose threadId is null but groupId is present", () => {
    const msg = normalizeMessage({
      isGroup: true,
      groupId: "111222333444555666",
      data: { content: "chào cả nhà", messageId: "m-1", senderId: "900900900", groupName: "Nhóm A" },
    });
    expect(msg).not.toBeNull();
    expect(msg!.threadId).toBe("111222333444555666"); // not null
    expect(msg!.threadType).toBe("group"); // not null
    expect(msg!.identityConfidence).toBe("derived");
    // metadata carries the identity confidence for the trace
    const meta = JSON.parse(msg!.rawMetadata) as Record<string, unknown>;
    expect((meta._identity as Record<string, unknown>).confidence).toBe("derived");
  });

  it("resolves a DM whose threadId is null from senderId", () => {
    const msg = normalizeMessage({
      data: { content: "cho hỏi", messageId: "m-2", senderId: "6792540503378312397" },
    });
    expect(msg).not.toBeNull();
    expect(msg!.threadType).toBe("user");
    expect(msg!.threadId).toBe("6792540503378312397");
  });

  it("still drops a message with no resolvable threadId at all", () => {
    const msg = normalizeMessage({ data: { content: "??" } });
    expect(msg).toBeNull();
  });

  it("stores threadType=user for an unknown resolution but marks confidence=unknown", () => {
    // Has a threadId (explicit) but no type/group signal and no sender.
    const msg = normalizeMessage({ threadId: "999888777", data: { content: "hey" } });
    expect(msg).not.toBeNull();
    // No sender, no group signal, but threadId present + senderAsDM not triggered
    // (no sender) → threadType unknown → stored as "user", confidence unknown.
    expect(msg!.threadType).toBe("user");
    expect(msg!.identityConfidence).toBe("unknown");
  });
});
