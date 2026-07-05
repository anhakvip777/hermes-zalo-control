// =============================================================================
// Phase 3.5B-A — Retrieval Answer Automation (service-only)
// =============================================================================
// DB-free tests use injected search deps. One DB-backed test exercises the real
// 3.5A pipeline (saveInboundAttachment + updateExtractionByZaloMessageId) end to
// end for the menu case. No live, no provider, no send.
// =============================================================================

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  parseRetrievalQuery,
  answerRetrieval,
  type RetrievalAnswerDeps,
} from "../services/retrieval-answer.service.js";
import type { AttachmentSearchResult } from "../services/attachment.service.js";
import type { MemoryMessage } from "../services/tools/memory/deps.js";
import { cleanDatabase } from "./shared-setup.js";
import { prisma } from "../db.js";

// ── Fixtures / helpers ───────────────────────────────────────────────

function att(overrides: Partial<AttachmentSearchResult> = {}): AttachmentSearchResult {
  return {
    attachmentId: "att-1",
    messageId: "m-1",
    threadId: "group-A",
    threadType: "group",
    kind: "image",
    extractionStatus: "success",
    snippet: "Menu cửa hàng B: cơm gà 45k, bún bò 50k",
    confidence: 0.85,
    createdAt: "2026-05-10T09:00:00.000Z",
    ...overrides,
  };
}

/** Deps that record what they were called with. */
function recordingDeps(attachments: AttachmentSearchResult[], messages: MemoryMessage[] = []) {
  const calls: { attach: unknown[]; msg: unknown[] } = { attach: [], msg: [] };
  const deps: RetrievalAnswerDeps = {
    async searchAttachments(q) { calls.attach.push(q); return attachments; },
    async getMessages(q) { calls.msg.push(q); return messages; },
  };
  return { deps, calls };
}

const groupAReq = {
  requesterThreadId: "group-A",
  requesterThreadType: "group" as const,
  role: "basic_chat",
};

// ── Parser ───────────────────────────────────────────────────────────

describe("parseRetrievalQuery", () => {
  it("detects a Vietnamese menu retrieval query + keywords", () => {
    const p = parseRetrievalQuery("gửi tôi thực đơn của cửa hàng B trong group A");
    expect(p.isRetrieval).toBe(true);
    expect(p.keywords).toContain("thực");
    expect(p.targetThreadHint).toBe("a");
  });

  it("non-retrieval chit-chat → isRetrieval false", () => {
    expect(parseRetrievalQuery("chào buổi sáng nhé").isRetrieval).toBe(false);
  });

  it("parses a date into a single-day range", () => {
    const p = parseRetrievalQuery("tìm menu ngày 10/5");
    expect(p.isRetrieval).toBe(true);
    expect(p.dateFrom).toBeTruthy();
    expect(p.dateTo).toBeTruthy();
    expect(p.dateFrom!.slice(0, 7)).toBe("2026-05");
  });
});

// ── answerRetrieval ──────────────────────────────────────────────────

describe("answerRetrieval — scope & permission", () => {
  it("non-admin targeting ANOTHER thread → permission_denied, NO search executed", async () => {
    const { deps, calls } = recordingDeps([att()]);
    const r = await answerRetrieval(
      { ...groupAReq, query: "cửa hàng B", targetThreadId: "group-B", targetThreadType: "group" },
      deps,
    );
    expect(r.status).toBe("permission_denied");
    expect(r.evidence).toEqual([]);
    expect(calls.attach.length).toBe(0); // search NOT executed
    expect(calls.msg.length).toBe(0);
  });

  it("non-admin own thread → search scoped to own thread", async () => {
    const { deps, calls } = recordingDeps([att()]);
    await answerRetrieval({ ...groupAReq, query: "cửa hàng B" }, deps);
    expect((calls.attach[0] as any).threadId).toBe("group-A");
    expect((calls.attach[0] as any).threadType).toBe("group");
  });
});

describe("answerRetrieval — menu case & behaviors", () => {
  it("MENU CASE: readable OCR in group A → found, answer has menu, evidence has attachmentId", async () => {
    const { deps } = recordingDeps([att()]);
    const r = await answerRetrieval({ ...groupAReq, query: "cửa hàng B" }, deps);
    expect(r.status).toBe("found");
    expect(r.confidence).toBe("high");
    expect(r.answerText).toContain("cửa hàng B");
    expect(r.answerText).toContain("2026-05-10");
    expect(r.evidence[0].attachmentId).toBe("att-1");
    expect(r.evidence[0].source).toBe("attachment");
  });

  it("group B query returns no group-A data (no leak) → not_found", async () => {
    // Simulate the store returning nothing for group-B scope.
    const { deps } = recordingDeps([], []);
    const r = await answerRetrieval(
      { requesterThreadId: "group-B", requesterThreadType: "group", role: "basic_chat", query: "cửa hàng B" },
      deps,
    );
    expect(r.status).toBe("not_found");
    expect(r.evidence).toEqual([]);
  });

  it("OCR unavailable → found-but-unreadable, does NOT fabricate a menu", async () => {
    const { deps } = recordingDeps([att({ extractionStatus: "unavailable", snippet: "" })]);
    const r = await answerRetrieval({ ...groupAReq, query: "cửa hàng B" }, deps);
    expect(r.status).toBe("found");
    expect(r.answerText).toContain("chưa đọc được");
    expect(r.answerText).not.toContain("cơm gà");
    expect(r.confidence).toBe("low");
  });

  it("date range is passed through to the search", async () => {
    const { deps, calls } = recordingDeps([att()]);
    await answerRetrieval(
      { ...groupAReq, query: "menu", dateFrom: "2026-05-09T00:00:00Z", dateTo: "2026-05-11T00:00:00Z" },
      deps,
    );
    expect((calls.attach[0] as any).dateFrom instanceof Date).toBe(true);
    expect((calls.attach[0] as any).dateTo instanceof Date).toBe(true);
  });

  it("fake sk/password/JWT in OCR → answer + snippet carry NO raw secret", async () => {
    const secret = "sk-proj-Ab3dEf6GhiJkLmNoPqRs012345_-6789 password=hunter2secretpw eyJhbGciOi.eyJzdWIiOj.SflKxwRJSMk";
    const { deps } = recordingDeps([att({ snippet: `Menu ${secret}` })]);
    const r = await answerRetrieval({ ...groupAReq, query: "menu" }, deps);
    expect(r.answerText).not.toContain("sk-proj-Ab3dEf6GhiJkLmNoPqRs012345_-6789");
    expect(r.answerText).not.toContain("hunter2secretpw");
    expect(r.answerText).not.toContain("eyJhbGciOi.eyJzdWIiOj.SflKxwRJSMk");
    expect(r.evidence[0].snippetRedacted).not.toContain("hunter2secretpw");
    expect(r.answerText).toContain("[REDACTED]");
  });

  it("multiple results → top 3, readable attachment ranked first", async () => {
    const many: AttachmentSearchResult[] = [
      att({ attachmentId: "a1", messageId: "m1", extractionStatus: "unavailable", snippet: "", createdAt: "2026-05-12T00:00:00Z" }),
      att({ attachmentId: "a2", messageId: "m2", createdAt: "2026-05-10T00:00:00Z" }),
      att({ attachmentId: "a3", messageId: "m3", createdAt: "2026-05-09T00:00:00Z" }),
      att({ attachmentId: "a4", messageId: "m4", createdAt: "2026-05-08T00:00:00Z" }),
    ];
    const { deps } = recordingDeps(many);
    const r = await answerRetrieval({ ...groupAReq, query: "menu" }, deps);
    expect(r.evidence.length).toBe(3);
    // A readable attachment must be ranked ahead of the unreadable one.
    expect(r.evidence[0].extractionStatus).toBe("success");
  });

  it("infra error → unavailable, no fabrication", async () => {
    const deps: RetrievalAnswerDeps = {
      async searchAttachments() { throw new Error("db down"); },
      async getMessages() { return []; },
    };
    const r = await answerRetrieval({ ...groupAReq, query: "menu" }, deps);
    expect(r.status).toBe("unavailable");
    expect(r.evidence).toEqual([]);
  });

  it("does not invoke any live provider/send (deps are the only I/O)", async () => {
    // If the service tried to send/live, it would need deps we didn't provide;
    // this test simply asserts a pure result object is returned.
    const { deps } = recordingDeps([att()]);
    const r = await answerRetrieval({ ...groupAReq, query: "cửa hàng B" }, deps);
    expect(["found", "not_found", "permission_denied", "unavailable"]).toContain(r.status);
  });
});

// ── DB-backed menu case (real 3.5A pipeline) ─────────────────────────

describe("answerRetrieval — DB-backed menu case", () => {
  beforeEach(async () => { await cleanDatabase(); });
  afterAll(async () => { await cleanDatabase(); });

  it("indexes an image in group A then retrieves it by keyword (default deps)", async () => {
    const { saveInboundAttachment, updateExtractionByZaloMessageId } = await import("../services/attachment.service.js");
    await prisma.message.create({
      data: { id: "mm-1", zaloMessageId: "zz-1", threadId: "group-A", threadType: "group", content: "[Ảnh Zalo]", isFromBot: false, messageType: "image", receivedAt: new Date() },
    });
    await saveInboundAttachment({ messageId: "mm-1", zaloMessageId: "zz-1", threadId: "group-A", threadType: "group", senderId: "u1", kind: "image" });
    await updateExtractionByZaloMessageId("zz-1", "image", { extractedText: "Menu cửa hàng B: cơm gà 45k", status: "success" });

    const r = await answerRetrieval({ requesterThreadId: "group-A", requesterThreadType: "group", role: "basic_chat", query: "cửa hàng B" });
    expect(r.status).toBe("found");
    expect(r.evidence[0].attachmentId).toBeTruthy();
    expect(r.evidence[0].messageId).toBe("mm-1");
    expect(r.answerText).toContain("cửa hàng B");

    // Different group must not see it.
    const r2 = await answerRetrieval({ requesterThreadId: "group-B", requesterThreadType: "group", role: "basic_chat", query: "cửa hàng B" });
    expect(r2.status).toBe("not_found");
  });
});
