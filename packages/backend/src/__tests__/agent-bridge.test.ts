// =============================================================================
// Phase 5 — AgentBridge tests (DB-free: stub adapter + stub registry +
// in-memory sink + injected gateway deciders + injected evidence check)
// =============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";

import { AgentBridge, type AgentBridgeInput } from "../services/agent-bridge/agent-bridge.js";
import { getAgentBridge, setAgentBridgeForTest } from "../services/agent-bridge/index.js";
import { HermesAdapter } from "../services/agent-bridge/hermes-adapter.js";
import { ToolGateway } from "../services/tool-gateway/gateway.js";
import { ToolRegistry } from "../services/tool-gateway/registry.js";
import { InMemoryToolEvidenceSink } from "../services/tool-gateway/evidence.js";
import type { ToolDefinition, ToolEvidenceSink } from "../services/tool-gateway/types.js";
import type { AgentAdapter, AgentRequest } from "../services/agent-bridge/types.js";
import type { AgentToolResult } from "../services/tool-gateway/types.js";

// ── Stub adapter: scripted responses per round ───────────────────────
class ScriptedAdapter implements AgentAdapter {
  readonly name = "scripted";
  calls = 0;
  lastAllowedTools: readonly string[] = [];
  lastRequest: AgentRequest | undefined;
  priorResultsByRound: AgentToolResult[][] = [];
  constructor(private readonly script: (round: number, req: AgentRequest) => unknown | Promise<unknown>) {}
  async run(req: AgentRequest, prior: AgentToolResult[]): Promise<unknown> {
    this.lastRequest = req;
    this.lastAllowedTools = req.permissions.allowedTools;
    this.priorResultsByRound.push([...prior]);
    const r = this.calls;
    this.calls += 1;
    return this.script(r, req);
  }
}

function readTool(spy: { calls: number }): ToolDefinition {
  return {
    name: "test.read",
    kind: "read",
    minRole: "basic_chat",
    dataScope: "own_thread",
    argsSchema: z.object({}).strip(),
    resultSchema: z.any(),
    execute: () => { spy.calls += 1; return { result: { ok: true } }; },
  };
}
function adminOnlyTool(spy: { calls: number }): ToolDefinition {
  return {
    name: "admin.only",
    kind: "read",
    minRole: "admin",
    dataScope: "none",
    argsSchema: z.object({}).strip(),
    resultSchema: z.any(),
    execute: () => { spy.calls += 1; return { result: { ok: true } }; },
  };
}

function makeGateway(registry: ToolRegistry, sink: InMemoryToolEvidenceSink) {
  return new ToolGateway({
    registry,
    evidence: sink,
    getDryRun: () => true,
    getLiveAllowed: () => false,
    resolveRole: async () => ({ role: "form_only", principalId: null, blocked: false }),
  });
}

function input(o: Partial<AgentBridgeInput> = {}): AgentBridgeInput {
  return {
    threadId: "t1", threadType: "user", senderId: "p1", role: "advanced",
    principalId: "p1", content: "hi", recentMessages: [], agentName: "hermes", ...o,
  };
}

describe("Phase 5 — AgentBridge", () => {
  let registry: ToolRegistry;
  let sink: InMemoryToolEvidenceSink;
  let gateway: ToolGateway;

  beforeEach(() => {
    registry = new ToolRegistry();
    sink = new InMemoryToolEvidenceSink();
    gateway = makeGateway(registry, sink);
  });

  it("redacts untrusted provider text fields while preserving internal identity", async () => {
    const rawSecret = "sk-test-1234567890abcdef";
    const rawPhone = "+84 912 345 678";
    const adapter = new ScriptedAdapter(() => ({ text: "done" }));
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      hasScheduleEvidence: async () => false,
    });

    const result = await bridge.run(input({
      senderName: `Sender ${rawSecret} ${rawPhone}`,
      content: `Current ${rawSecret} ${rawPhone}`,
      recentMessages: [`History ${rawSecret} ${rawPhone}`],
      scheduleContext: `Schedule ${rawSecret} ${rawPhone}`,
    }));

    expect(result.usedFallback).toBe(false);
    expect(adapter.lastRequest).toMatchObject({
      threadId: "t1",
      sender: {
        id: "p1",
        role: "advanced",
        name: "Sender [REDACTED] [REDACTED]78",
      },
      content: "Current [REDACTED] [REDACTED]78",
      recentMessages: ["History [REDACTED] [REDACTED]78"],
      scheduleContext: "Schedule [REDACTED] [REDACTED]78",
    });
    expect(JSON.stringify(adapter.lastRequest)).not.toContain(rawSecret);
    expect(JSON.stringify(adapter.lastRequest)).not.toContain(rawPhone);
  });

  it("advertises exactly configured ∩ registered ∩ read ∩ role/dataScope and freezes one shared grant", async () => {
    const readSpy = { calls: 0 };
    const adminSpy = { calls: 0 };
    const writeSpy = { calls: 0 };
    const globalSpy = { calls: 0 };
    let grantSeenByTool: readonly string[] | undefined;
    const exactRead: ToolDefinition = {
      ...readTool(readSpy),
      execute: ({ ctx }) => {
        readSpy.calls += 1;
        grantSeenByTool = ctx.allowedTools;
        return { result: { ok: true } };
      },
    };
    const write: ToolDefinition = {
      name: "test.write",
      kind: "write",
      minRole: "basic_chat",
      dataScope: "own_thread",
      argsSchema: z.object({}).strip(),
      resultSchema: z.any(),
      execute: () => {
        writeSpy.calls += 1;
        return { result: { ok: true } };
      },
    };
    const globalRead: ToolDefinition = {
      name: "test.globalRead",
      kind: "read",
      minRole: "basic_chat",
      dataScope: "global",
      argsSchema: z.object({}).strip(),
      resultSchema: z.any(),
      execute: () => {
        globalSpy.calls += 1;
        return { result: { ok: true } };
      },
    };
    registry.register(exactRead);
    registry.register(adminOnlyTool(adminSpy));
    registry.register(write);
    registry.register(globalRead);

    const configured = [
      "test.read",
      "test.read",
      "admin.only",
      "test.write",
      "test.globalRead",
      "not.registered",
    ];
    const adapter = new ScriptedAdapter((round) =>
      round === 0 ? { toolCalls: [{ name: "test.read", arguments: {} }] } : { text: "done" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: configured,
      hasScheduleEvidence: async () => false,
    });
    configured.length = 0;

    const res = await bridge.run(input({ role: "basic_chat" }));

    expect(res.usedFallback).toBe(false);
    expect(adapter.lastAllowedTools).toEqual(["test.read"]);
    expect(Object.isFrozen(adapter.lastAllowedTools)).toBe(true);
    expect(grantSeenByTool).toBe(adapter.lastAllowedTools);
    expect(readSpy.calls).toBe(1);
    expect(adminSpy.calls).toBe(0);
    expect(writeSpy.calls).toBe(0);
    expect(globalSpy.calls).toBe(0);
  });

  it("missing configured grant fails closed even when a read tool is registered", async () => {
    const spy = { calls: 0 };
    registry.register(readTool(spy));
    const adapter = new ScriptedAdapter(() => ({ text: "done" }));
    const bridge = new AgentBridge({ adapter, registry, gateway, hasScheduleEvidence: async () => false });

    const res = await bridge.run(input());

    expect(res.usedFallback).toBe(false);
    expect(adapter.lastAllowedTools).toEqual([]);
    expect(Object.isFrozen(adapter.lastAllowedTools)).toBe(true);
    expect(spy.calls).toBe(0);
  });

  it("runtime getAgentBridge advertises only memory.getRecentMessages", async () => {
    let capturedRequest: AgentRequest | undefined;
    const runSpy = vi.spyOn(HermesAdapter.prototype, "run").mockImplementation(async (request) => {
      capturedRequest = request;
      return { text: "runtime bridge ok" };
    });
    setAgentBridgeForTest(null);

    try {
      const res = await getAgentBridge().run(input({ role: "admin" }));
      expect(res.usedFallback).toBe(false);
      expect(capturedRequest?.permissions.allowedTools).toEqual(["memory.getRecentMessages"]);
    } finally {
      setAgentBridgeForTest(null);
      runSpy.mockRestore();
    }
  });

  it("happy path: tool round then final text", async () => {
    const spy = { calls: 0 };
    registry.register(readTool(spy));
    const adapter = new ScriptedAdapter((round) =>
      round === 0 ? { toolCalls: [{ name: "test.read", arguments: {} }] } : { text: "Đây là câu trả lời.", confidence: 0.9 },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.read"],
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input());

    expect(res.usedFallback).toBe(false);
    expect(res.rounds).toBe(1);
    expect(res.toolResults).toHaveLength(1);
    expect(res.toolResults[0]!.executionStatus).toBe("success");
    expect(res.text).toBe("Đây là câu trả lời.");
    expect(spy.calls).toBe(1);
  });

  it("max rounds → safe fallback (no infinite loop)", async () => {
    const spy = { calls: 0 };
    registry.register(readTool(spy));
    // Adapter ALWAYS asks for a tool.
    const adapter = new ScriptedAdapter(() => ({ toolCalls: [{ name: "test.read", arguments: {} }], text: "partial" }));
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.read"],
      maxRounds: 2,
      fallbackText: "safe fallback",
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input());

    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("max_rounds");
    expect(res.rounds).toBe(2);
    expect(res.text).toBe("safe fallback");
    expect(res.text).not.toBe("partial");
  });

  it("adapter throws → safe fallback", async () => {
    const adapter = new ScriptedAdapter(() => { throw new Error("boom"); });
    const bridge = new AgentBridge({ adapter, registry, gateway, hasScheduleEvidence: async () => false });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("adapter_error");
  });

  it("adapter timeout → safe fallback", async () => {
    const adapter = new ScriptedAdapter(() => new Promise<unknown>((resolve) => setTimeout(() => resolve({ text: "late" }), 200)));
    const bridge = new AgentBridge({ adapter, registry, gateway, perRoundTimeoutMs: 20, hasScheduleEvidence: async () => false });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("adapter_timeout");
  });

  it("disallowed tool: bridge omits it from allowedTools AND gateway blocks it", async () => {
    const readSpy = { calls: 0 };
    const adminSpy = { calls: 0 };
    registry.register(readTool(readSpy));
    registry.register(adminOnlyTool(adminSpy));
    // basic_chat role → admin.only not in allowedTools; adapter calls it anyway round 0.
    const adapter = new ScriptedAdapter((round) =>
      round === 0 ? { toolCalls: [{ name: "admin.only", arguments: {} }] } : { text: "xong" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.read", "admin.only"],
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input({ role: "basic_chat" }));

    // allowedTools built by bridge excludes admin.only for basic_chat.
    expect(adapter.lastAllowedTools).not.toContain("admin.only");
    expect(adapter.lastAllowedTools).toContain("test.read");
    // Gateway blocked the disallowed call; underlying tool never executed.
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("tool_blocked");
    expect(adapter.calls).toBe(1);
    expect(res.toolResults[0]!.executionStatus).toBe("blocked");
    expect(adminSpy.calls).toBe(0);
  });

  it("passes explicit principalBlocked=true to the gateway and never executes the tool", async () => {
    const spy = { calls: 0 };
    registry.register(readTool(spy));
    const adapter = new ScriptedAdapter((round) =>
      round === 0 ? { toolCalls: [{ name: "test.read", arguments: {} }] } : { text: "must not run" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.read"],
      hasScheduleEvidence: async () => false,
    });

    const res = await bridge.run(input({ principalBlocked: true }));

    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("tool_blocked");
    expect(adapter.calls).toBe(1);
    expect(spy.calls).toBe(0);
    expect(res.toolResults[0]!.executionStatus).toBe("blocked");
  });

  it("unknown tool result is terminal and provider text is not accepted", async () => {
    const adapter = new ScriptedAdapter((round) =>
      round === 0
        ? { text: "untrusted partial", toolCalls: [{ name: "not.registered", arguments: {} }] }
        : { text: "must not be accepted" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["not.registered"],
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("tool_unavailable");
    expect(res.text).not.toBe("untrusted partial");
    expect(adapter.calls).toBe(1);
    expect(res.toolResults[0]!.executionStatus).toBe("unavailable");
  });

  it("invalid tool arguments are terminal and execute never runs", async () => {
    const spy = { calls: 0 };
    const requiresQ: ToolDefinition = {
      name: "test.requiresQ",
      kind: "read",
      minRole: "basic_chat",
      dataScope: "own_thread",
      argsSchema: z.object({ q: z.string() }),
      resultSchema: z.any(),
      execute: () => {
        spy.calls += 1;
        return { result: { ok: true } };
      },
    };
    registry.register(requiresQ);
    const adapter = new ScriptedAdapter((round) =>
      round === 0
        ? { text: "untrusted partial", toolCalls: [{ name: "test.requiresQ", arguments: { q: 123 } }] }
        : { text: "must not be accepted" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.requiresQ"],
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("tool_invalid_args");
    expect(adapter.calls).toBe(1);
    expect(spy.calls).toBe(0);
    expect(res.toolResults[0]!.error?.code).toBe("invalid_args");
  });

  it("failed tool result is terminal and no second adapter call occurs", async () => {
    const spy = { calls: 0 };
    const failing: ToolDefinition = {
      name: "test.failing",
      kind: "read",
      minRole: "basic_chat",
      dataScope: "own_thread",
      argsSchema: z.object({}).strip(),
      resultSchema: z.any(),
      execute: () => {
        spy.calls += 1;
        throw new Error("provider detail must not become a fallback reason");
      },
    };
    registry.register(failing);
    const adapter = new ScriptedAdapter((round) =>
      round === 0
        ? { text: "untrusted partial", toolCalls: [{ name: "test.failing", arguments: {} }] }
        : { text: "must not be accepted" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.failing"],
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("tool_failed");
    expect(res.reason).not.toContain("provider detail");
    expect(adapter.calls).toBe(1);
    expect(spy.calls).toBe(1);
  });

  it("tool timeout result is terminal and no second adapter call occurs", async () => {
    const spy = { calls: 0 };
    const slow: ToolDefinition = {
      name: "test.slow",
      kind: "read",
      minRole: "basic_chat",
      dataScope: "own_thread",
      timeoutMs: 10,
      argsSchema: z.object({}).strip(),
      resultSchema: z.any(),
      execute: () => {
        spy.calls += 1;
        return new Promise((resolve) => setTimeout(() => resolve({ result: { ok: true } }), 50));
      },
    };
    registry.register(slow);
    const adapter = new ScriptedAdapter((round) =>
      round === 0
        ? { text: "untrusted partial", toolCalls: [{ name: "test.slow", arguments: {} }] }
        : { text: "must not be accepted" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.slow"],
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("tool_timeout");
    expect(adapter.calls).toBe(1);
    expect(spy.calls).toBe(1);
  });

  it("unexpected gateway rejection fails closed without adapter round two or raw detail", async () => {
    const spy = { calls: 0 };
    registry.register(readTool(spy));
    vi.spyOn(gateway, "execute").mockRejectedValue(new Error("raw gateway detail"));
    const adapter = new ScriptedAdapter((round) =>
      round === 0 ? { toolCalls: [{ name: "test.read", arguments: {} }] } : { text: "must not run" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.read"],
      hasScheduleEvidence: async () => false,
    });

    const res = await bridge.run(input());

    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("tool_gateway_error");
    expect(res.reason).not.toContain("raw gateway detail");
    expect(res.toolResults).toEqual([]);
    expect(adapter.calls).toBe(1);
    expect(spy.calls).toBe(0);
  });

  it("evidence persistence failure is terminal before adapter round two", async () => {
    const spy = { calls: 0 };
    registry.register(readTool(spy));
    const rawSinkError = "sink secret sk-test-1234567890abcdef phone +84 912 345 678";
    const failingEvidence: ToolEvidenceSink = {
      writeToolCall: async () => { throw new Error(rawSinkError); },
      writeZaloAction: async () => "unused",
      findByIdempotencyKey: async () => null,
    };
    const failedGateway = new ToolGateway({
      registry,
      evidence: failingEvidence,
      getDryRun: () => true,
      getLiveAllowed: () => false,
      resolveRole: async () => ({ role: "form_only", principalId: null, blocked: false }),
    });
    const adapter = new ScriptedAdapter((round) =>
      round === 0
        ? { text: "untrusted provider text", toolCalls: [{ name: "test.read", arguments: {} }] }
        : { text: "must not run" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway: failedGateway,
      allowedToolNames: ["test.read"],
      fallbackText: "safe fallback",
      hasScheduleEvidence: async () => false,
    });

    const res = await bridge.run(input({ agentTaskId: "task-db-1", relatedMessageId: "message-db-1" }));

    expect(res.usedFallback).toBe(true);
    expect(res.text).toBe("safe fallback");
    expect(res.reason).toBe("tool_failed");
    expect(adapter.calls).toBe(1);
    expect(res.toolResults).toHaveLength(1);
    expect(res.toolResults[0]).toMatchObject({
      executionStatus: "failed",
      error: { code: "provider_error", message: "Tool evidence persistence failed" },
    });
    expect(res.toolResults[0]!.toolCallRecordId).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain(rawSinkError);
    expect(JSON.stringify(res)).not.toContain("untrusted provider text");
  });

  it("hard-fails calls above maxCallsPerRound before any gateway execution", async () => {
    const spy = { calls: 0 };
    registry.register(readTool(spy));
    const calls = Array.from({ length: 3 }, () => ({ name: "test.read", arguments: {} }));
    const adapter = new ScriptedAdapter((round) =>
      round === 0 ? { text: "untrusted partial", toolCalls: calls } : { text: "must not run" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.read"],
      maxCallsPerRound: 2,
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("max_calls_per_round");
    expect(res.toolResults).toEqual([]);
    expect(adapter.calls).toBe(1);
    expect(spy.calls).toBe(0);
  });

  it("passes only a redacted successful result to the next adapter round", async () => {
    const secret = "raw-provider-token";
    const secretRead: ToolDefinition = {
      name: "test.secretRead",
      kind: "read",
      minRole: "basic_chat",
      dataScope: "own_thread",
      argsSchema: z.object({}).strip(),
      resultSchema: z.any(),
      execute: () => ({ result: { token: secret, ok: true } }),
    };
    registry.register(secretRead);
    const adapter = new ScriptedAdapter((round) =>
      round === 0 ? { toolCalls: [{ name: "test.secretRead", arguments: {} }] } : { text: "done" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.secretRead"],
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(false);
    expect(adapter.priorResultsByRound[1]).toHaveLength(1);
    expect(adapter.priorResultsByRound[1]![0]!.executionStatus).toBe("success");
    expect(adapter.priorResultsByRound[1]![0]!.result).toEqual({ token: "[REDACTED]", ok: true });
    expect(JSON.stringify(adapter.priorResultsByRound[1])).not.toContain(secret);
  });

  it("remaining total budget caps the adapter wait", async () => {
    const adapter = new ScriptedAdapter(
      () => new Promise((resolve) => setTimeout(() => resolve({ text: "late" }), 100)),
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      perRoundTimeoutMs: 1_000,
      totalTimeoutMs: 15,
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("total_timeout");
    expect(adapter.calls).toBe(1);
  });

  it("checks the total deadline after the adapter before executing a tool", async () => {
    let now = 0;
    const spy = { calls: 0 };
    registry.register(readTool(spy));
    const adapter = new ScriptedAdapter(() => {
      now = 20;
      return { toolCalls: [{ name: "test.read", arguments: {} }] };
    });
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.read"],
      totalTimeoutMs: 20,
      now: () => now,
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("total_timeout");
    expect(res.rounds).toBe(0);
    expect(spy.calls).toBe(0);
  });

  it("caps sequential tool work by the remaining total budget and never calls adapter round two", async () => {
    let now = 0;
    const firstSpy = { calls: 0 };
    const slowSpy = { calls: 0 };
    const first: ToolDefinition = {
      name: "test.first",
      kind: "read",
      minRole: "basic_chat",
      dataScope: "own_thread",
      argsSchema: z.object({}).strip(),
      resultSchema: z.any(),
      execute: () => {
        firstSpy.calls += 1;
        now = 15;
        return { result: { ok: true } };
      },
    };
    const slow: ToolDefinition = {
      name: "test.remainingSlow",
      kind: "read",
      minRole: "basic_chat",
      dataScope: "own_thread",
      timeoutMs: 100,
      argsSchema: z.object({}).strip(),
      resultSchema: z.any(),
      execute: () => {
        slowSpy.calls += 1;
        return new Promise((resolve) => setTimeout(() => resolve({ result: { ok: true } }), 50));
      },
    };
    registry.register(first);
    registry.register(slow);
    const adapter = new ScriptedAdapter((round) =>
      round === 0
        ? {
            toolCalls: [
              { name: "test.first", arguments: {} },
              { name: "test.remainingSlow", arguments: {} },
            ],
          }
        : { text: "must not run" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.first", "test.remainingSlow"],
      totalTimeoutMs: 20,
      now: () => now,
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("total_timeout");
    expect(res.rounds).toBe(0);
    expect(res.toolResults).toHaveLength(1);
    expect(res.toolResults[0]!.executionStatus).toBe("success");
    expect(adapter.calls).toBe(1);
    expect(firstSpy.calls).toBe(1);
    expect(slowSpy.calls).toBe(1);
  });

  it("unsupported-claim evidence rejection fails closed with a stable reason", async () => {
    const adapter = new ScriptedAdapter(() => ({ text: "đã gửi" }));
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      hasScheduleEvidence: async () => { throw new Error("raw evidence detail"); },
    });

    const res = await bridge.run(input());

    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("evidence_check_error");
    expect(res.reason).not.toContain("raw evidence detail");
  });

  it("unsupported-claim evidence wait is bounded by the remaining total deadline", async () => {
    const adapter = new ScriptedAdapter(() => ({ text: "đã gửi" }));
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      totalTimeoutMs: 15,
      hasScheduleEvidence: () =>
        new Promise((resolve) => setTimeout(() => resolve(false), 50)),
    });

    const res = await bridge.run(input());

    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("total_timeout");
  });

  it("dry_run tool success cannot validate an unsupported completion claim", async () => {
    const spy = { calls: 0 };
    registry.register(readTool(spy));
    vi.spyOn(gateway, "execute").mockResolvedValue({
      toolName: "test.read",
      kind: "outbound",
      executionStatus: "success",
      deliveryStatus: "dry_run",
      result: { ok: true },
    });
    const adapter = new ScriptedAdapter((round) =>
      round === 0 ? { toolCalls: [{ name: "test.read", arguments: {} }] } : { text: "đã gửi" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.read"],
      hasScheduleEvidence: async () => false,
    });

    const res = await bridge.run(input());

    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("unsupported_system_claim");
    expect(adapter.calls).toBe(2);
    expect(spy.calls).toBe(0);
  });

  it("unsupported claim without write/outbound evidence → neutralized", async () => {
    const adapter = new ScriptedAdapter(() => ({ text: "Mình đã gửi tin nhắn cho bạn rồi." })); // claim, 0 tools
    const bridge = new AgentBridge({ adapter, registry, gateway, hasScheduleEvidence: async () => false });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("unsupported_system_claim");
  });

  it("whitespace-only terminal text is trimmed before validation", async () => {
    const adapter = new ScriptedAdapter(() => ({ text: " ".repeat(2_001) }));
    const bridge = new AgentBridge({ adapter, registry, gateway, hasScheduleEvidence: async () => false });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("empty_final_text");
  });

  it("accepts and trims a short terminal text padded beyond the raw text limit", async () => {
    const adapter = new ScriptedAdapter(() => ({
      text: `${" ".repeat(1_001)}short answer${" ".repeat(1_001)}`,
    }));
    const bridge = new AgentBridge({ adapter, registry, gateway, hasScheduleEvidence: async () => false });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(false);
    expect(res.text).toBe("short answer");
  });

  it("accepts exactly 2000 trimmed terminal characters", async () => {
    const terminalText = "x".repeat(2_000);
    const adapter = new ScriptedAdapter(() => ({ text: ` ${terminalText} ` }));
    const bridge = new AgentBridge({ adapter, registry, gateway, hasScheduleEvidence: async () => false });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(false);
    expect(res.text).toBe(terminalText);
  });

  it("rejects more than 2000 trimmed terminal characters", async () => {
    const adapter = new ScriptedAdapter(() => ({ text: ` ${"x".repeat(2_001)} ` }));
    const bridge = new AgentBridge({ adapter, registry, gateway, hasScheduleEvidence: async () => false });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("malformed_response");
  });

  it("accepts the protocol hard cap of five tool calls", async () => {
    const spy = { calls: 0 };
    registry.register(readTool(spy));
    const calls = Array.from({ length: 5 }, () => ({ name: "test.read", arguments: {} }));
    const adapter = new ScriptedAdapter((round) => round === 0 ? { toolCalls: calls } : { text: "done" });
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.read"],
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(false);
    expect(res.text).toBe("done");
    expect(res.toolResults).toHaveLength(5);
    expect(spy.calls).toBe(5);
  });

  it("rejects six tool calls before any gateway execution", async () => {
    const spy = { calls: 0 };
    registry.register(readTool(spy));
    const calls = Array.from({ length: 6 }, () => ({ name: "test.read", arguments: {} }));
    const adapter = new ScriptedAdapter((round) => round === 0 ? { toolCalls: calls } : { text: "done" });
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.read"],
      hasScheduleEvidence: async () => false,
    });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("malformed_response");
    expect(res.toolResults).toEqual([]);
    expect(spy.calls).toBe(0);
  });

  it("rejects duplicate tool-call idempotency keys before any gateway execution", async () => {
    const spy = { calls: 0 };
    registry.register(readTool(spy));
    const adapter = new ScriptedAdapter((round) =>
      round === 0
        ? {
            toolCalls: [
              { name: "test.read", arguments: {}, idempotencyKey: "duplicate-call-id" },
              { name: "test.read", arguments: {}, idempotencyKey: "duplicate-call-id" },
            ],
          }
        : { text: "done" },
    );
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      allowedToolNames: ["test.read"],
      hasScheduleEvidence: async () => false,
    });

    const res = await bridge.run(input());

    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("malformed_response");
    expect(res.toolResults).toEqual([]);
    expect(spy.calls).toBe(0);
  });

  it("uses a stable fallback reason for adapter safety blocks", async () => {
    const adapter = new ScriptedAdapter(() => ({
      safety: { blocked: true, reason: "  policy_violation  " },
    }));
    const bridge = new AgentBridge({ adapter, registry, gateway, hasScheduleEvidence: async () => false });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("adapter_safety");
  });

  it("rejects a safety reason over 256 trimmed characters", async () => {
    const adapter = new ScriptedAdapter(() => ({
      safety: { blocked: true, reason: ` ${"x".repeat(257)} ` },
    }));
    const bridge = new AgentBridge({ adapter, registry, gateway, hasScheduleEvidence: async () => false });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("malformed_response");
  });

  it.each([
    ["null root", null],
    ["array root", []],
    ["non-plain root", new (class { text = "ok"; })()],
    ["extra root key", { text: "ok", providerSecret: "must-not-pass" }],
    ["text over 2000 characters", { text: "x".repeat(2001) }],
    ["confidence below zero", { text: "ok", confidence: -0.01 }],
    ["confidence above one", { text: "ok", confidence: 1.01 }],
    ["non-finite confidence NaN", { text: "ok", confidence: Number.NaN }],
    ["non-finite confidence Infinity", { text: "ok", confidence: Number.POSITIVE_INFINITY }],
    ["non-array toolCalls", { toolCalls: { name: "test.read" } }],
    ["extra tool-call key", { toolCalls: [{ name: "test.read", debug: true }] }],
    ["blank tool name", { toolCalls: [{ name: "   " }] }],
    ["tool name over 128 characters", { toolCalls: [{ name: "x".repeat(129) }] }],
    ["array tool arguments", { toolCalls: [{ name: "test.read", arguments: [] }] }],
    ["null tool arguments", { toolCalls: [{ name: "test.read", arguments: null }] }],
    ["non-JSON tool arguments", { toolCalls: [{ name: "test.read", arguments: { value: new Date(0) } }] }],
    ["blank idempotency key", { toolCalls: [{ name: "test.read", idempotencyKey: "   " }] }],
    ["idempotency key over 256 characters", { toolCalls: [{ name: "test.read", idempotencyKey: "x".repeat(257) }] }],
    ["extra safety key", { safety: { blocked: false, providerCode: "unsafe" } }],
  ])("malformed adapter response (%s) → safe fallback", async (_caseName, response) => {
    const adapter = new ScriptedAdapter(() => response);
    const bridge = new AgentBridge({
      adapter,
      registry,
      gateway,
      hasScheduleEvidence: async () => false,
    });

    const res = await bridge.run(input());

    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("malformed_response");
    expect(res.rounds).toBe(0);
    expect(res.toolResults).toEqual([]);
  });
});
