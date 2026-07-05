// =============================================================================
// Phase 3.5B-B — memory.retrievalAnswer read-only tool wrapper
// =============================================================================
// The wrapper delegates to answerRetrieval() (3.5B-A). Tests inject search deps
// so no DB/live/provider is touched. Also asserts registration is inert.
// =============================================================================

import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../services/tool-gateway/registry.js";
import { buildMemoryTools } from "../services/tools/memory/index.js";
import { createRetrievalAnswerTool } from "../services/tools/memory/retrieval-tools.js";
import type { RetrievalAnswerDeps } from "../services/retrieval-answer.service.js";
import type { AttachmentSearchResult } from "../services/attachment.service.js";
import type { MemoryMessage } from "../services/tools/memory/deps.js";
import type { ToolDefinition, ToolRole } from "../services/tool-gateway/types.js";

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

function recordingDeps(attachments: AttachmentSearchResult[], messages: MemoryMessage[] = []) {
  const calls: { attach: unknown[]; msg: unknown[] } = { attach: [], msg: [] };
  const deps: RetrievalAnswerDeps = {
    async searchAttachments(q) { calls.attach.push(q); return attachments; },
    async getMessages(q) { calls.msg.push(q); return messages; },
  };
  return { deps, calls };
}

/** Invoke a tool the way the gateway would, minus dispatch machinery. */
async function run(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  ctx: { threadId: string; threadType: "user" | "group" },
  role: ToolRole,
) {
  const out = await tool.execute({
    args,
    ctx: { threadId: ctx.threadId, threadType: ctx.threadType, role },
    dryRun: false,
    liveAllowed: false,
    role,
    principalId: null,
  });
  return out.result as {
    status: string;
    answerText: string;
    evidence: Array<Record<string, unknown>>;
    confidence: string;
  };
}

const groupACtx = { threadId: "group-A", threadType: "group" as const };

// ── Metadata / registration ──────────────────────────────────────────

describe("memory.retrievalAnswer — definition & registration", () => {
  it("has read-only, basic_chat, own_thread metadata", () => {
    const tool = createRetrievalAnswerTool();
    expect(tool.name).toBe("memory.retrievalAnswer");
    expect(tool.kind).toBe("read");
    expect(tool.minRole).toBe("basic_chat");
    expect(tool.dataScope).toBe("own_thread");
  });

  it("is included in buildMemoryTools()", () => {
    const names = buildMemoryTools().map((t) => t.name);
    expect(names).toContain("memory.retrievalAnswer");
  });

  it("registering the tool does NOT auto-invoke it (bridge OFF)", async () => {
    const { deps, calls } = recordingDeps([att()]);
    const registry = new ToolRegistry();
    registry.register(createRetrievalAnswerTool(deps));
    // Present in the registry, but nothing ran it.
    expect(registry.has("memory.retrievalAnswer")).toBe(true);
    expect(calls.attach.length).toBe(0);
    expect(calls.msg.length).toBe(0);
  });
});

// ── Behavior (delegates to answerRetrieval) ──────────────────────────

describe("memory.retrievalAnswer — behavior", () => {
  it("MENU CASE: found with attachmentId evidence", async () => {
    const { deps } = recordingDeps([att()]);
    const tool = createRetrievalAnswerTool(deps);
    const r = await run(tool, { query: "cửa hàng B" }, groupACtx, "basic_chat");
    expect(r.status).toBe("found");
    expect(r.confidence).toBe("high");
    expect(r.answerText).toContain("cửa hàng B");
    expect(r.answerText).toContain("2026-05-10");
    expect(r.evidence[0].attachmentId).toBe("att-1");
    expect(r.evidence[0].source).toBe("attachment");
  });

  it("non-admin targeting ANOTHER thread → permission_denied, NO search executed", async () => {
    const { deps, calls } = recordingDeps([att()]);
    const tool = createRetrievalAnswerTool(deps);
    const r = await run(
      tool,
      { query: "cửa hàng B", targetThreadId: "group-B", targetThreadType: "group" },
      groupACtx,
      "basic_chat",
    );
    expect(r.status).toBe("permission_denied");
    expect(r.evidence).toEqual([]);
    expect(calls.attach.length).toBe(0);
    expect(calls.msg.length).toBe(0);
  });

  it("OCR unavailable → found-but-unreadable, no fabricated menu", async () => {
    const { deps } = recordingDeps([att({ extractionStatus: "unavailable", snippet: "" })]);
    const tool = createRetrievalAnswerTool(deps);
    const r = await run(tool, { query: "cửa hàng B" }, groupACtx, "basic_chat");
    expect(r.status).toBe("found");
    expect(r.answerText).toContain("chưa đọc được");
    expect(r.answerText).not.toContain("cơm gà");
  });

  it("redaction preserved: no raw secret in answer or snippet", async () => {
    const secret = "sk-proj-Ab3dEf6GhiJkLmNoPqRs012345_-6789 password=hunter2secretpw";
    const { deps } = recordingDeps([att({ snippet: `Menu ${secret}` })]);
    const tool = createRetrievalAnswerTool(deps);
    const r = await run(tool, { query: "menu" }, groupACtx, "basic_chat");
    expect(r.answerText).not.toContain("sk-proj-Ab3dEf6GhiJkLmNoPqRs012345_-6789");
    expect(r.answerText).not.toContain("hunter2secretpw");
    expect(String(r.evidence[0].snippetRedacted)).not.toContain("hunter2secretpw");
    expect(r.answerText).toContain("[REDACTED]");
  });

  it("result validates against the tool resultSchema", async () => {
    const { deps } = recordingDeps([att()]);
    const tool = createRetrievalAnswerTool(deps);
    const r = await run(tool, { query: "cửa hàng B" }, groupACtx, "basic_chat");
    // Parsing must not throw — the shape matches the declared schema.
    expect(() => tool.resultSchema.parse(r)).not.toThrow();
  });
});
