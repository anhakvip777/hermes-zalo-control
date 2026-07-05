// =============================================================================
// Phase 5 — AgentBridge tests (DB-free: stub adapter + stub registry +
// in-memory sink + injected gateway deciders + injected evidence check)
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";

import { AgentBridge, type AgentBridgeInput } from "../services/agent-bridge/agent-bridge.js";
import { HermesAdapter } from "../services/agent-bridge/hermes-adapter.js";
import { ToolGateway } from "../services/tool-gateway/gateway.js";
import { ToolRegistry } from "../services/tool-gateway/registry.js";
import { InMemoryToolEvidenceSink } from "../services/tool-gateway/evidence.js";
import type { ToolDefinition } from "../services/tool-gateway/types.js";
import type { AgentAdapter, AgentRequest, AgentResponse } from "../services/agent-bridge/types.js";
import type { AgentToolResult } from "../services/tool-gateway/types.js";

// ── Stub adapter: scripted responses per round ───────────────────────
class ScriptedAdapter implements AgentAdapter {
  readonly name = "scripted";
  calls = 0;
  lastAllowedTools: string[] = [];
  constructor(private readonly script: (round: number, req: AgentRequest) => AgentResponse | Promise<AgentResponse>) {}
  async run(req: AgentRequest, _prior: AgentToolResult[]): Promise<AgentResponse> {
    this.lastAllowedTools = req.permissions.allowedTools;
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

  it("happy path: tool round then final text", async () => {
    const spy = { calls: 0 };
    registry.register(readTool(spy));
    const adapter = new ScriptedAdapter((round) =>
      round === 0 ? { toolCalls: [{ name: "test.read", arguments: {} }] } : { text: "Đây là câu trả lời.", confidence: 0.9 },
    );
    const bridge = new AgentBridge({ adapter, registry, gateway, hasScheduleEvidence: async () => false });
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
    const bridge = new AgentBridge({ adapter, registry, gateway, maxRounds: 2, hasScheduleEvidence: async () => false });
    const res = await bridge.run(input());

    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("max_rounds");
    expect(res.rounds).toBe(2);
  });

  it("adapter throws → safe fallback", async () => {
    const adapter = new ScriptedAdapter(() => { throw new Error("boom"); });
    const bridge = new AgentBridge({ adapter, registry, gateway, hasScheduleEvidence: async () => false });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("adapter_error");
  });

  it("adapter timeout → safe fallback", async () => {
    const adapter = new ScriptedAdapter(() => new Promise<AgentResponse>((resolve) => setTimeout(() => resolve({ text: "late" }), 200)));
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
    const bridge = new AgentBridge({ adapter, registry, gateway, hasScheduleEvidence: async () => false });
    const res = await bridge.run(input({ role: "basic_chat" }));

    // allowedTools built by bridge excludes admin.only for basic_chat.
    expect(adapter.lastAllowedTools).not.toContain("admin.only");
    expect(adapter.lastAllowedTools).toContain("test.read");
    // Gateway blocked the disallowed call; underlying tool never executed.
    expect(res.toolResults[0]!.executionStatus).toBe("blocked");
    expect(adminSpy.calls).toBe(0);
    expect(res.text).toBe("xong");
  });

  it("unsupported claim without write/outbound evidence → neutralized", async () => {
    const adapter = new ScriptedAdapter(() => ({ text: "Mình đã gửi tin nhắn cho bạn rồi." })); // claim, 0 tools
    const bridge = new AgentBridge({ adapter, registry, gateway, hasScheduleEvidence: async () => false });
    const res = await bridge.run(input());
    expect(res.usedFallback).toBe(true);
    expect(res.reason).toBe("unsupported_system_claim");
  });

  it("HermesAdapter maps text reply → AgentResponse{text, toolCalls:[]}", async () => {
    const adapter = new HermesAdapter();
    const req: AgentRequest = {
      threadId: "t1", threadType: "user", sender: { id: "p1", role: "basic_chat" },
      content: "hello", recentMessages: [], runtime: { dryRun: true, live: false },
      permissions: { canUseTools: false, allowedTools: [] },
    };
    const resp = await adapter.run(req, []);
    // Mock chat adapter (default) echoes text; no tool calls.
    expect(Array.isArray(resp.toolCalls)).toBe(true);
    expect(resp.toolCalls).toHaveLength(0);
    expect(typeof resp.text).toBe("string");
    expect(resp.text!.length).toBeGreaterThan(0);
  });
});
