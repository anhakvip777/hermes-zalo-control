// =============================================================================
// Decision Trace service — Phase 7 unit tests (DB-free)
// =============================================================================
// Uses an in-memory TraceDataSource stub — no Prisma, no DB. Verifies:
//   - full chain assembly (rules + agentTask + toolCalls + zaloActions + reply)
//   - reactions and polls surface via ZaloActionRecord
//   - raw AgentTask.input/result and Message.metadata never appear in output
//   - Message content is redacted (phone + secret masked)
//   - cross-thread isolation (only the anchor message's rows are included)
//   - honest outbound linkConfidence (exact / best_effort / none)
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  buildTrace,
  listTraces,
  type TraceDataSource,
  type MessageRow,
  type PrincipalRow,
  type ThreadSettingRow,
  type RuleExecutionRow,
  type RuleRow,
  type AgentTaskRow,
  type ToolCallRow,
  type ZaloActionRow,
  type OutboundRecordRow,
  type TraceListParams,
} from "../services/trace.service.js";

// ── In-memory stub ──────────────────────────────────────────────────
interface Store {
  messages: MessageRow[];
  principals: PrincipalRow[];
  settings: ThreadSettingRow[];
  ruleExecs: RuleExecutionRow[];
  rules: RuleRow[];
  agentTasks: AgentTaskRow[];
  toolCalls: ToolCallRow[];
  zaloActions: ZaloActionRow[];
  outbound: OutboundRecordRow[];
}

class StubSource implements TraceDataSource {
  constructor(private s: Store) {}

  async getMessageById(id: string) {
    return this.s.messages.find((m) => m.id === id) ?? null;
  }
  async getPrincipal(principalId: string, threadId: string) {
    return (
      this.s.principals.find((p) => p.principalId === principalId && p.threadId === threadId) ??
      this.s.principals.find((p) => p.principalId === principalId && p.threadId === null) ??
      null
    );
  }
  async getThreadSetting(threadId: string) {
    return this.s.settings.find((x) => x.threadId === threadId) ?? null;
  }
  async getRuleExecutions(messageId: string) {
    return this.s.ruleExecs.filter((r) => r.messageId === messageId);
  }
  async getRulesByIds(ruleIds: string[]) {
    return this.s.rules.filter((r) => ruleIds.includes(r.id));
  }
  async getAgentTasks(messageId: string) {
    return this.s.agentTasks.filter((t) => t.messageId === messageId);
  }
  async getToolCalls(messageId: string, agentTaskIds: string[]) {
    return this.s.toolCalls.filter(
      (t) => t.relatedMessageId === messageId || (t.agentTaskId && agentTaskIds.includes(t.agentTaskId)),
    );
  }
  async getZaloActions(toolCallIds: string[], threadId: string) {
    return this.s.zaloActions.filter(
      (a) =>
        (a.toolCallRecordId && toolCallIds.includes(a.toolCallRecordId)) ||
        (a.threadId === threadId && a.trigger === "agent_tool"),
    );
  }
  async getAssistantReply(messageId: string) {
    return this.s.messages.find((m) => m.relatedMessageId === messageId && m.isFromBot) ?? null;
  }
  async getOutboundRecords(threadId: string, sinceCreatedAt: Date) {
    return this.s.outbound
      .filter((o) => o.threadId === threadId && o.createdAt.getTime() >= sinceCreatedAt.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async listInboundMessages(params: TraceListParams) {
    let rows = this.s.messages.filter((m) => m.role === "user");
    if (params.threadId) rows = rows.filter((m) => m.threadId === params.threadId);
    const total = rows.length;
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 30;
    rows = rows.slice((page - 1) * pageSize, page * pageSize);
    return { rows, total };
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────
const t0 = new Date("2026-07-01T10:00:00.000Z");
const t1 = new Date("2026-07-01T10:00:05.000Z");

function baseStore(): Store {
  return {
    messages: [
      {
        id: "msg-in",
        zaloMessageId: "z-in",
        threadId: "thread-A",
        threadType: "group",
        senderId: "user-1",
        senderName: "Alice",
        content: "gọi tôi ở 0912345678 nhé, jwt eyJhbGciOi.eyJzdWIiOj.SflKxwRJSM",
        isFromBot: false,
        messageType: "text",
        role: "user",
        relatedMessageId: null,
        receivedAt: t0,
        createdAt: t0,
      },
      {
        id: "msg-reply",
        zaloMessageId: "z-sent-1",
        threadId: "thread-A",
        threadType: "group",
        senderId: "bot",
        senderName: "Bot",
        content: "Đã gửi trả lời",
        isFromBot: true,
        messageType: "text",
        role: "assistant",
        relatedMessageId: "msg-in",
        receivedAt: t1,
        createdAt: t1,
      },
      // Cross-thread noise — must never leak into msg-in trace.
      {
        id: "msg-other",
        zaloMessageId: "z-other",
        threadId: "thread-B",
        threadType: "user",
        senderId: "user-9",
        senderName: "Other",
        content: "unrelated",
        isFromBot: false,
        messageType: "text",
        role: "user",
        relatedMessageId: null,
        receivedAt: t0,
        createdAt: t0,
      },
    ],
    principals: [{ principalId: "user-1", role: "advanced", status: "active", threadId: null }],
    settings: [
      {
        threadId: "thread-A",
        autoReplyEnabled: true,
        groupMentionRequired: true,
        groupReplyWindowSeconds: 600,
        allowCreateReminder: true,
        allowMedia: false,
        allowImageUnderstanding: false,
        allowDocumentUnderstanding: false,
      },
    ],
    ruleExecs: [
      {
        id: "re-1",
        ruleId: "rule-1",
        messageId: "msg-in",
        threadId: "thread-A",
        matched: true,
        actionTaken: "route_to_hermes",
        result: null,
        errorCode: null,
        errorMessage: null,
        metadata: null,
        createdAt: t0,
      },
      // Cross-message noise.
      {
        id: "re-x",
        ruleId: "rule-1",
        messageId: "msg-other",
        threadId: "thread-B",
        matched: true,
        actionTaken: "ignore",
        result: null,
        errorCode: null,
        errorMessage: null,
        metadata: null,
        createdAt: t0,
      },
    ],
    rules: [{ id: "rule-1", name: "Route group mentions" }],
    agentTasks: [
      {
        id: "task-1",
        agentName: "hermes",
        taskType: "chat_reply",
        status: "completed",
        scheduleId: null,
        messageId: "msg-in",
        errorMessage: null,
        createdAt: t0,
      },
    ],
    toolCalls: [
      {
        id: "tcr-1",
        agentName: "hermes",
        toolName: "zalo.sendText",
        kind: "outbound",
        threadId: "thread-A",
        executionStatus: "success",
        deliveryStatus: "dry_run",
        idempotencyKey: "k1",
        argsRedacted: JSON.stringify({ text: "hi" }),
        resultRedacted: JSON.stringify({ ok: true }),
        errorCode: null,
        errorMessage: null,
        evidence: JSON.stringify({ decision: "dry_run" }),
        outboundRecordId: null,
        zaloActionRecordId: "zar-poll",
        agentTaskId: "task-1",
        relatedMessageId: "msg-in",
        durationMs: 12,
        createdAt: t0,
      },
    ],
    zaloActions: [
      {
        id: "zar-react",
        actionType: "reaction",
        threadId: "thread-A",
        trigger: "agent_tool",
        targetMsgId: "z-in",
        payloadRedacted: JSON.stringify({ icon: "👍" }),
        dryRun: true,
        decision: "allow",
        reason: "agent requested reaction",
        executionStatus: "success",
        deliveryStatus: "dry_run",
        providerResultId: null,
        errorCode: null,
        errorMessage: null,
        toolCallRecordId: null,
        createdAt: t0,
      },
      {
        id: "zar-poll",
        actionType: "poll",
        threadId: "thread-A",
        trigger: "agent_tool",
        targetMsgId: null,
        payloadRedacted: JSON.stringify({ question: "Đi ăn?", options: ["Có", "Không"] }),
        dryRun: true,
        decision: "allow",
        reason: "agent created poll",
        executionStatus: "success",
        deliveryStatus: "dry_run",
        providerResultId: null,
        errorCode: null,
        errorMessage: null,
        toolCallRecordId: "tcr-1",
        createdAt: t0,
      },
    ],
    outbound: [
      {
        id: "ob-1",
        threadId: "thread-A",
        content: "Đã gửi trả lời",
        sentMessageId: "z-sent-1",
        source: "auto_reply",
        dryRun: false,
        errorCode: null,
        decision: "allow",
        reason: "sent",
        createdAt: t1,
      },
    ],
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe("trace.service — buildTrace", () => {
  it("assembles the full decision chain for the anchor message", async () => {
    const trace = await buildTrace("msg-in", new StubSource(baseStore()));
    expect(trace).not.toBeNull();
    expect(trace!.message.id).toBe("msg-in");
    expect(trace!.identity).toEqual({ principalId: "user-1", role: "advanced", status: "active", scope: "global" });
    expect(trace!.gate?.groupMentionRequired).toBe(true);
    expect(trace!.rules).toHaveLength(1);
    expect(trace!.rules[0]).toMatchObject({ ruleName: "Route group mentions", matched: true });
    expect(trace!.agentTasks).toHaveLength(1);
    expect(trace!.toolCalls).toHaveLength(1);
    expect(trace!.toolCalls[0].toolName).toBe("zalo.sendText");
  });

  it("surfaces reactions and polls via ZaloActionRecord", async () => {
    const trace = await buildTrace("msg-in", new StubSource(baseStore()));
    const types = trace!.zaloActions.map((a) => a.actionType).sort();
    expect(types).toEqual(["poll", "reaction"]);
    const poll = trace!.zaloActions.find((a) => a.actionType === "poll")!;
    expect(poll.payloadRedacted).toMatchObject({ question: "Đi ăn?" });
  });

  it("redacts message content (phone + secret masked, never raw)", async () => {
    const trace = await buildTrace("msg-in", new StubSource(baseStore()));
    const content = trace!.message.contentRedacted;
    expect(content).not.toContain("0912345678");
    expect(content).not.toContain("eyJhbGciOi.eyJzdWIiOj.SflKxwRJSM");
    expect(content).toContain("[REDACTED]");
  });

  it("never exposes raw AgentTask input/result or Message.metadata", async () => {
    const trace = await buildTrace("msg-in", new StubSource(baseStore()));
    const json = JSON.stringify(trace);
    // AgentTask DTO must not carry input/result keys.
    for (const t of trace!.agentTasks) {
      expect(Object.keys(t)).not.toContain("input");
      expect(Object.keys(t)).not.toContain("result");
    }
    // No metadata field leaked from the message.
    expect(Object.keys(trace!.message)).not.toContain("metadata");
    expect(json).not.toContain("metadata");
  });

  it("isolates cross-thread / cross-message rows", async () => {
    const trace = await buildTrace("msg-in", new StubSource(baseStore()));
    // Only rule exec re-1 (msg-in), not re-x (msg-other).
    expect(trace!.rules.map((r) => r.id)).toEqual(["re-1"]);
    // No thread-B action leaked.
    expect(trace!.zaloActions.every((a) => a.actionType === "poll" || a.actionType === "reaction")).toBe(true);
  });

  it("links outbound with exact confidence via sentMessageId === reply.zaloMessageId", async () => {
    const trace = await buildTrace("msg-in", new StubSource(baseStore()));
    expect(trace!.outbound.linkConfidence).toBe("exact");
    expect(trace!.outbound.record?.sentMessageId).toBe("z-sent-1");
    expect(trace!.outbound.reply?.id).toBe("msg-reply");
  });

  it("falls back to best_effort when no sentMessageId match", async () => {
    const store = baseStore();
    // Break the exact link: reply has no zaloMessageId.
    store.messages.find((m) => m.id === "msg-reply")!.zaloMessageId = null;
    const trace = await buildTrace("msg-in", new StubSource(store));
    expect(trace!.outbound.linkConfidence).toBe("best_effort");
  });

  it("reports none when there is no outbound record", async () => {
    const store = baseStore();
    store.outbound = [];
    const trace = await buildTrace("msg-in", new StubSource(store));
    expect(trace!.outbound.linkConfidence).toBe("none");
    expect(trace!.outbound.record).toBeNull();
  });

  it("returns null for a missing message", async () => {
    const trace = await buildTrace("nope", new StubSource(baseStore()));
    expect(trace).toBeNull();
  });
});

describe("trace.service — listTraces", () => {
  it("summarizes only inbound (user) messages with redacted preview", async () => {
    const res = await listTraces({}, new StubSource(baseStore()));
    expect(res.total).toBe(2); // msg-in + msg-other
    const inbound = res.data.find((d) => d.messageId === "msg-in")!;
    expect(inbound.ruleMatched).toBe(true);
    expect(inbound.agentTaskCount).toBe(1);
    expect(inbound.toolCallCount).toBe(1);
    expect(inbound.zaloActionCount).toBe(2);
    expect(inbound.outboundDecision).toBe("allow");
    expect(inbound.contentPreviewRedacted).not.toContain("0912345678");
  });

  it("filters by threadId", async () => {
    const res = await listTraces({ threadId: "thread-B" }, new StubSource(baseStore()));
    expect(res.total).toBe(1);
    expect(res.data[0].messageId).toBe("msg-other");
  });
});
