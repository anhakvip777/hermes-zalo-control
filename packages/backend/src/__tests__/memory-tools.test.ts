// =============================================================================
// Phase 4 — memory tools tests (DB-free: injected MemoryDeps + in-memory sink)
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";

import { ToolGateway } from "../services/tool-gateway/gateway.js";
import { ToolRegistry } from "../services/tool-gateway/registry.js";
import { InMemoryToolEvidenceSink } from "../services/tool-gateway/evidence.js";
import { registerMemoryTools } from "../services/tools/memory/index.js";
import type { MemoryDeps, MessageQuery } from "../services/tools/memory/deps.js";
import type { ToolContext } from "../services/tool-gateway/types.js";

function ctx(o: Partial<ToolContext> = {}): ToolContext {
  return { agentName: "hermes", threadId: "t1", threadType: "user", role: "basic_chat", principalId: "p1", senderId: "p1", ...o };
}
function gw(registry: ToolRegistry, sink: InMemoryToolEvidenceSink) {
  return new ToolGateway({
    registry,
    evidence: sink,
    getDryRun: () => true,
    getLiveAllowed: () => false,
    resolveRole: async () => ({ role: "form_only", principalId: null, blocked: false }),
  });
}

describe("Phase 4 — memory tools", () => {
  let registry: ToolRegistry;
  let sink: InMemoryToolEvidenceSink;
  let messageQueries: MessageQuery[];

  const deps = (): MemoryDeps => ({
    getMessages: async (q) => {
      messageQueries.push(q);
      // Return a row tagged with the queried thread (or 'global' when undefined).
      return [
        {
          id: "m1",
          threadId: q.threadId ?? "some-other-thread",
          role: "user",
          senderId: "p1",
          content: "hello +84 912 345 678 Bearer abcdef123456",
          messageType: "text",
          createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
        },
      ];
    },
    getOutboundRecords: async (q) => [
      { threadId: q.threadId ?? "g", content: "sent", source: "agent_tool", dryRun: true, decision: "allow", reason: "dry_run", sentMessageId: "s1", createdAt: "2026-01-01T00:00:00Z" },
    ],
    getAgentTasks: async () => [
      { id: "task1", agentName: "hermes", taskType: "create_schedule", status: "completed", messageId: "m1", scheduleId: null, createdAt: "2026-01-01T00:00:00Z" },
    ],
    getRuleExecutions: async () => [
      { ruleId: "r1", matched: true, actionTaken: "fixed_reply", result: "sent", errorCode: null, createdAt: "2026-01-01T00:00:00Z" },
    ],
    getUserRole: async (principalId) => ({ principalId, role: "basic_chat", status: "active", fromDb: true }),
    getRuntimeStatus: async () => ({ dryRun: true, cooldownSeconds: 10, batchingEnabled: false, zalo: { connected: true, listenerActive: true } }),
  });

  beforeEach(() => {
    registry = new ToolRegistry();
    sink = new InMemoryToolEvidenceSink();
    messageQueries = [];
    registerMemoryTools(registry, deps());
  });

  it("form_only cannot call memory tools (blocked)", async () => {
    const res = await gw(registry, sink).execute({ name: "memory.getRecentMessages", arguments: {} }, ctx({ role: "form_only" }));
    expect(res.executionStatus).toBe("blocked");
  });

  it("basic_chat: own thread OK; cross-thread blocked", async () => {
    const g = gw(registry, sink);
    const ok = await g.execute({ name: "memory.getRecentMessages", arguments: {} }, ctx());
    expect(ok.executionStatus).toBe("success");
    expect((ok.result as any).scope).toBe("thread");
    expect(messageQueries[0]!.threadId).toBe("t1");

    const cross = await g.execute({ name: "memory.getRecentMessages", arguments: { threadId: "t2" } }, ctx());
    expect(cross.executionStatus).toBe("blocked"); // cross-thread denied
  });

  it("searchMessages: non-admin scoped to own thread; admin global", async () => {
    const g = gw(registry, sink);
    const nonAdmin = await g.execute({ name: "memory.searchMessages", arguments: { query: "hi" } }, ctx());
    expect(nonAdmin.executionStatus).toBe("success");
    expect((nonAdmin.result as any).scope).toBe("thread");
    expect(messageQueries.at(-1)!.threadId).toBe("t1");

    const adminGlobal = await g.execute({ name: "memory.searchMessages", arguments: { query: "hi" } }, ctx({ role: "admin" }));
    expect(adminGlobal.executionStatus).toBe("success");
    expect((adminGlobal.result as any).scope).toBe("global");
    expect(messageQueries.at(-1)!.threadId).toBeUndefined(); // global
  });

  it("non-admin cannot global-search (blocked when targeting another thread)", async () => {
    const denied = await gw(registry, sink).execute(
      { name: "memory.searchMessages", arguments: { query: "x", threadId: "other" } },
      ctx({ role: "advanced" }),
    );
    expect(denied.executionStatus).toBe("blocked");
  });

  it("getThreadHistory bounded by limit (clamp to MAX_LIMIT)", async () => {
    await gw(registry, sink).execute({ name: "memory.getThreadHistory", arguments: { limit: 9999 } }, ctx());
    expect(messageQueries.at(-1)!.limit).toBe(100);
  });

  it("getOutboundRecords advanced ok; basic_chat blocked", async () => {
    const g = gw(registry, sink);
    const blocked = await g.execute({ name: "memory.getOutboundRecords", arguments: {} }, ctx({ role: "basic_chat" }));
    expect(blocked.executionStatus).toBe("blocked");
    const ok = await g.execute({ name: "memory.getOutboundRecords", arguments: {} }, ctx({ role: "advanced" }));
    expect(ok.executionStatus).toBe("success");
    expect((ok.result as any).records).toHaveLength(1);
  });

  it("getAgentTasks returns whitelisted fields only (no input/result)", async () => {
    const res = await gw(registry, sink).execute({ name: "memory.getAgentTasks", arguments: {} }, ctx({ role: "advanced" }));
    expect(res.executionStatus).toBe("success");
    const t = (res.result as any).tasks[0];
    expect(t).toHaveProperty("taskType");
    expect(t).not.toHaveProperty("input");
    expect(t).not.toHaveProperty("result");
  });

  it("rules.explainForMessage advanced own-thread; basic_chat blocked; cross-thread blocked", async () => {
    const g = gw(registry, sink);
    const denied = await g.execute({ name: "rules.explainForMessage", arguments: {} }, ctx({ role: "basic_chat" }));
    expect(denied.executionStatus).toBe("blocked"); // minRole advanced

    const ok = await g.execute({ name: "rules.explainForMessage", arguments: { messageId: "m1" } }, ctx({ role: "advanced" }));
    expect(ok.executionStatus).toBe("success");
    expect((ok.result as any).executions).toHaveLength(1);

    const cross = await g.execute({ name: "rules.explainForMessage", arguments: { threadId: "other" } }, ctx({ role: "advanced" }));
    expect(cross.executionStatus).toBe("blocked");
  });

  it("access.getUserRole: self ok (non-admin); other blocked; admin any", async () => {
    const g = gw(registry, sink);
    const self = await g.execute({ name: "access.getUserRole", arguments: { principalId: "p1" } }, ctx({ role: "basic_chat", principalId: "p1" }));
    expect(self.executionStatus).toBe("success");
    expect((self.result as any).role).toBe("basic_chat");

    const other = await g.execute({ name: "access.getUserRole", arguments: { principalId: "p2" } }, ctx({ role: "basic_chat", principalId: "p1" }));
    expect(other.executionStatus).toBe("blocked");

    const admin = await g.execute({ name: "access.getUserRole", arguments: { principalId: "p2" } }, ctx({ role: "admin", principalId: "adminP" }));
    expect(admin.executionStatus).toBe("success");
  });

  it("system.getRuntimeStatus admin-only; no secrets", async () => {
    const g = gw(registry, sink);
    const blocked = await g.execute({ name: "system.getRuntimeStatus", arguments: {} }, ctx({ role: "advanced" }));
    expect(blocked.executionStatus).toBe("blocked");

    const ok = await g.execute({ name: "system.getRuntimeStatus", arguments: {} }, ctx({ role: "admin" }));
    expect(ok.executionStatus).toBe("success");
    const json = JSON.stringify(ok.result);
    expect(json).not.toMatch(/cookie|token|session|imei|password/i);
    expect((ok.result as any).dryRun).toBe(true);
  });

  it("central redaction masks phone/token in message content", async () => {
    const res = await gw(registry, sink).execute({ name: "memory.getRecentMessages", arguments: {} }, ctx());
    const content = String((res.result as any).messages[0].content);
    expect(content).not.toContain("912 345 678");
    expect(content).toContain("[REDACTED]"); // Bearer token masked
  });
});
