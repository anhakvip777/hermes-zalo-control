// =============================================================================
// Tool Gateway — Phase 1 unit tests (DB-free: in-memory evidence + stub tools)
// =============================================================================
// Verification is deferred (no node_modules yet). These tests are written to run
// under vitest once dependencies are installed. They inject an in-memory evidence
// sink, a stub registry, and stub dryRun/live/role resolvers so no DB/config is
// touched.
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";

import { ToolGateway } from "../services/tool-gateway/gateway.js";
import { ToolRegistry } from "../services/tool-gateway/registry.js";
import { InMemoryToolEvidenceSink } from "../services/tool-gateway/evidence.js";
import type {
  AgentToolCall,
  ToolContext,
  ToolDefinition,
  ToolExecuteInput,
  ToolExecuteResult,
} from "../services/tool-gateway/types.js";

// ── Helpers ────────────────────────────────────────────────────────────
function baseCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    agentName: "hermes",
    threadId: "thread-1",
    threadType: "user",
    senderId: "user-1",
    role: "advanced",
    principalId: "user-1",
    relatedMessageId: "msg-1",
    ...overrides,
  };
}

function makeGateway(registry: ToolRegistry, sink: InMemoryToolEvidenceSink, over: Partial<ConstructorParameters<typeof ToolGateway>[0]> = {}) {
  return new ToolGateway({
    registry,
    evidence: sink,
    getDryRun: () => true, // default dryRun ON (safe)
    getLiveAllowed: () => false,
    resolveRole: async () => ({ role: "form_only", principalId: null, blocked: false }),
    ...over,
  });
}

// A read tool that echoes its args.
function readEchoTool(spy?: { calls: number }): ToolDefinition {
  return {
    name: "test.readEcho",
    kind: "read",
    minRole: "basic_chat",
    dataScope: "own_thread",
    argsSchema: z.object({ q: z.string() }),
    resultSchema: z.object({ echoed: z.string() }),
    execute: (input: ToolExecuteInput): ToolExecuteResult => {
      if (spy) spy.calls += 1;
      const args = input.args as { q: string };
      return { result: { echoed: args.q } };
    },
  };
}

// A write tool that reports whether it sent "live".
function writeTool(spy: { calls: number; sawDryRun: boolean[] }): ToolDefinition {
  return {
    name: "test.write",
    kind: "write",
    minRole: "basic_chat",
    dataScope: "own_thread",
    requiresIdempotencyKey: true,
    argsSchema: z.object({ value: z.string() }),
    resultSchema: z.object({ ok: z.boolean(), live: z.boolean() }),
    execute: (input: ToolExecuteInput): ToolExecuteResult => {
      spy.calls += 1;
      spy.sawDryRun.push(input.dryRun);
      // Non-message write: when dryRun, do NOT perform the live side-effect.
      return { result: { ok: true, live: !input.dryRun }, deliveryStatus: input.dryRun ? "dry_run" : "live_sent" };
    },
  };
}

describe("ToolGateway — Phase 1", () => {
  let registry: ToolRegistry;
  let sink: InMemoryToolEvidenceSink;

  beforeEach(() => {
    registry = new ToolRegistry();
    sink = new InMemoryToolEvidenceSink();
  });

  it("unknown tool → unavailable + evidence", async () => {
    const gw = makeGateway(registry, sink);
    const call: AgentToolCall = { name: "does.not.exist" };
    const res = await gw.execute(call, baseCtx());

    expect(res.executionStatus).toBe("unavailable");
    expect(res.deliveryStatus).toBe("not_applicable");
    expect(res.error?.code).toBe("unavailable");
    expect(sink.toolCalls).toHaveLength(1);
    expect(sink.toolCalls[0]!.executionStatus).toBe("unavailable");
    expect(sink.toolCalls[0]!.toolName).toBe("does.not.exist");
  });

  it("role deny → blocked + evidence", async () => {
    const adminTool: ToolDefinition = {
      name: "test.adminOnly",
      kind: "read",
      minRole: "admin",
      dataScope: "own_thread",
      argsSchema: z.object({}).passthrough(),
      resultSchema: z.any(),
      execute: () => ({ result: { ok: true } }),
    };
    registry.register(adminTool);
    const gw = makeGateway(registry, sink);

    const res = await gw.execute({ name: "test.adminOnly", arguments: {} }, baseCtx({ role: "basic_chat" }));

    expect(res.executionStatus).toBe("blocked");
    expect(res.deliveryStatus).toBe("not_applicable");
    expect(res.error?.code).toBe("blocked");
    expect(sink.toolCalls).toHaveLength(1);
    expect(sink.toolCalls[0]!.executionStatus).toBe("blocked");
  });

  it("invalid args → blocked/invalid_args + NO execute + evidence", async () => {
    const spy = { calls: 0 };
    registry.register(readEchoTool(spy));
    const gw = makeGateway(registry, sink);

    // q must be a string; pass a number.
    const res = await gw.execute({ name: "test.readEcho", arguments: { q: 123 } }, baseCtx());

    expect(res.executionStatus).toBe("blocked");
    expect(res.error?.code).toBe("invalid_args");
    expect(spy.calls).toBe(0); // never executed
    expect(sink.toolCalls).toHaveLength(1);
    expect(sink.toolCalls[0]!.errorCode).toBe("invalid_args");
  });

  it("read success → success/not_applicable", async () => {
    registry.register(readEchoTool());
    const gw = makeGateway(registry, sink);

    const res = await gw.execute({ name: "test.readEcho", arguments: { q: "hello" } }, baseCtx());

    expect(res.executionStatus).toBe("success");
    expect(res.deliveryStatus).toBe("not_applicable");
    expect(res.result).toEqual({ echoed: "hello" });
    expect(sink.toolCalls).toHaveLength(1);
    expect(sink.toolCalls[0]!.deliveryStatus).toBe("not_applicable");
  });

  it("write dryRun stub → success/dry_run + evidence (no live side-effect)", async () => {
    const spy = { calls: 0, sawDryRun: [] as boolean[] };
    registry.register(writeTool(spy));
    const gw = makeGateway(registry, sink, { getDryRun: () => true, getLiveAllowed: () => false });

    const res = await gw.execute({ name: "test.write", arguments: { value: "x" } }, baseCtx());

    expect(res.executionStatus).toBe("success");
    expect(res.deliveryStatus).toBe("dry_run");
    expect(spy.sawDryRun).toEqual([true]); // tool saw dryRun=true
    expect(res.result).toEqual({ ok: true, live: false });
    expect(sink.toolCalls).toHaveLength(1);
    expect(sink.toolCalls[0]!.deliveryStatus).toBe("dry_run");
    expect(sink.toolCalls[0]!.idempotencyKeySource).toBe("derived");
  });

  it("idempotency replay → success/skipped + NO second execute", async () => {
    const spy = { calls: 0, sawDryRun: [] as boolean[] };
    registry.register(writeTool(spy));
    // Live so the first call actually executes (not a dryRun no-op).
    const gw = makeGateway(registry, sink, { getDryRun: () => false, getLiveAllowed: () => true });

    const call: AgentToolCall = { name: "test.write", arguments: { value: "same" } };
    const first = await gw.execute(call, baseCtx());
    const second = await gw.execute(call, baseCtx());

    expect(first.executionStatus).toBe("success");
    expect(first.deliveryStatus).toBe("live_sent");
    expect(second.executionStatus).toBe("success");
    expect(second.deliveryStatus).toBe("skipped"); // replay
    expect(spy.calls).toBe(1); // executed only once
    expect(sink.toolCalls).toHaveLength(2); // both attempts recorded
    expect(first.idempotencyKey).toBeTruthy();
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("redaction masks token/cookie/session/phone", async () => {
    const secretTool: ToolDefinition = {
      name: "test.secrets",
      kind: "read",
      minRole: "basic_chat",
      dataScope: "own_thread",
      argsSchema: z.object({}).passthrough(),
      resultSchema: z.any(),
      execute: () => ({
        result: {
          token: "super-secret-token",
          data: { sessionId: "sess-abc-123" },
          cookie: "auth=deadbeef",
          note: "call +84 912 345 678 now",
          jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.Sig",
        },
      }),
    };
    registry.register(secretTool);
    // Non-admin → phone must be masked.
    const gw = makeGateway(registry, sink);

    const res = await gw.execute({ name: "test.secrets", arguments: {} }, baseCtx({ role: "basic_chat" }));
    const result = res.result as Record<string, any>;

    expect(result.token).toBe("[REDACTED]");
    expect(result.cookie).toBe("[REDACTED]");
    expect(result.data.sessionId).toBe("[REDACTED]");
    expect(String(result.note)).not.toContain("912 345 678");
    expect(String(result.jwt)).toContain("[REDACTED]");

    // Persisted evidence is redacted too.
    const persisted = sink.toolCalls[0]!.resultRedacted ?? "";
    expect(persisted).not.toContain("super-secret-token");
    expect(persisted).not.toContain("sess-abc-123");
    expect(persisted).not.toContain("912 345 678");
  });

  it("ToolContext.agentName fallback works", async () => {
    registry.register(readEchoTool());
    const gw = makeGateway(registry, sink);

    // Omit agentName → falls back to "hermes".
    const res1 = await gw.execute(
      { name: "test.readEcho", arguments: { q: "a" } },
      baseCtx({ agentName: undefined }),
    );
    expect(res1.executionStatus).toBe("success");
    expect(sink.toolCalls[0]!.agentName).toBe("hermes");

    // Provide a non-Hermes adapter name → used as-is.
    const res2 = await gw.execute(
      { name: "test.readEcho", arguments: { q: "b" } },
      baseCtx({ agentName: "claude" }),
    );
    expect(res2.executionStatus).toBe("success");
    expect(sink.toolCalls[1]!.agentName).toBe("claude");
  });

  it("per-tool timeout → failed/timeout (no hang)", async () => {
    const slowTool: ToolDefinition = {
      name: "test.slow",
      kind: "read",
      minRole: "basic_chat",
      dataScope: "own_thread",
      timeoutMs: 20,
      argsSchema: z.object({}).passthrough(),
      resultSchema: z.any(),
      execute: () => new Promise((resolve) => setTimeout(() => resolve({ result: { ok: true } }), 200)),
    };
    registry.register(slowTool);
    const gw = makeGateway(registry, sink);

    const res = await gw.execute({ name: "test.slow", arguments: {} }, baseCtx());
    expect(res.executionStatus).toBe("failed");
    expect(res.error?.code).toBe("timeout");
  });
});
