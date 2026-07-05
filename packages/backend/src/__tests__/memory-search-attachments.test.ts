// =============================================================================
// Phase 3.5A — memory.searchMessages attachment/threadType/date/scope (DB-free)
// =============================================================================
// Injected deps — no DB. Verifies the tool merges attachment matches only when
// includeAttachments=true, passes threadType/date through, and enforces scope
// (non-admin locked to own thread → no cross-thread leak).
// =============================================================================

import { describe, it, expect } from "vitest";
import { createSearchMessagesTool } from "../services/tools/memory/message-tools.js";
import type { MemoryMessage, MessageQuery, AttachmentSearch } from "../services/tools/memory/deps.js";

function makeTool(capture: { msg?: MessageQuery; att?: AttachmentSearch }) {
  return createSearchMessagesTool({
    async getMessages(q: MessageQuery): Promise<MemoryMessage[]> {
      capture.msg = q;
      return [{ id: "m1", threadId: q.threadId ?? "?", role: "user", senderId: "u1", content: "text hit", messageType: "text", createdAt: "2026-05-10T00:00:00Z", source: "message" }];
    },
    async searchAttachments(q: AttachmentSearch): Promise<MemoryMessage[]> {
      capture.att = q;
      return [{ id: "m2", threadId: q.threadId ?? "?", role: "user", senderId: null, content: "Menu cửa hàng B", messageType: "image", createdAt: "2026-05-10T00:00:00Z", attachmentId: "att-1", extractionStatus: "success", source: "attachment" }];
    },
  });
}

const ctx = { threadId: "group-A", threadType: "group" as const, senderId: "u1", role: "basic_chat" as const };

describe("memory.searchMessages — Phase 3.5A", () => {
  it("includeAttachments=false → only message results (no attachment)", async () => {
    const cap: { msg?: MessageQuery; att?: AttachmentSearch } = {};
    const tool = makeTool(cap);
    const res = await tool.execute({ args: { query: "cửa hàng B" }, ctx, role: "basic_chat" } as never);
    const out = (res as any).result;
    expect(out.messages.map((m: MemoryMessage) => m.source)).toEqual(["message"]);
    expect(cap.att).toBeUndefined();
  });

  it("includeAttachments=true → merges attachment match with attachmentId evidence", async () => {
    const cap: { msg?: MessageQuery; att?: AttachmentSearch } = {};
    const tool = makeTool(cap);
    const res = await tool.execute({
      args: { query: "cửa hàng B", includeAttachments: true, threadType: "group", dateFrom: "2026-05-09", dateTo: "2026-05-11" },
      ctx, role: "basic_chat",
    } as never);
    const out = (res as any).result;
    const att = out.messages.find((m: MemoryMessage) => m.source === "attachment");
    expect(att).toBeTruthy();
    expect(att.attachmentId).toBe("att-1");
    expect(att.extractionStatus).toBe("success");
    // threadType + date passed through to both readers
    expect(cap.msg?.threadType).toBe("group");
    expect(cap.att?.threadType).toBe("group");
    expect(cap.att?.dateFrom instanceof Date).toBe(true);
    expect(cap.att?.dateTo instanceof Date).toBe(true);
  });

  it("non-admin requesting another thread is BLOCKED (no cross-thread leak, no attachment query)", async () => {
    const cap: { msg?: MessageQuery; att?: AttachmentSearch } = {};
    const tool = makeTool(cap);
    // Non-admin requests a DIFFERENT thread → resolveThreadScope throws → tool rejects.
    await expect(
      tool.execute({ args: { query: "x", includeAttachments: true, threadId: "group-B" }, ctx, role: "basic_chat" } as never),
    ).rejects.toBeTruthy();
    // Neither reader was invoked with a foreign thread.
    expect(cap.msg).toBeUndefined();
    expect(cap.att).toBeUndefined();
  });

  it("non-admin own-thread request → scoped to ctx thread", async () => {
    const cap: { msg?: MessageQuery; att?: AttachmentSearch } = {};
    const tool = makeTool(cap);
    await tool.execute({ args: { query: "x", includeAttachments: true, threadId: "group-A" }, ctx, role: "basic_chat" } as never);
    expect(cap.msg?.threadId).toBe("group-A");
    expect(cap.att?.threadId).toBe("group-A");
  });
});
