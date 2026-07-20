// =============================================================================
// Tool Gateway — Phase 1 unit tests (DB-free: in-memory evidence + stub tools)
// =============================================================================
// Verification is deferred (no node_modules yet). These tests are written to run
// under vitest once dependencies are installed. They inject an in-memory evidence
// sink, a stub registry, and stub dryRun/live/role resolvers so no DB/config is
// touched.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";

import { prisma } from "../db.js";
import { ToolGateway } from "../services/tool-gateway/gateway.js";
import { ToolRegistry } from "../services/tool-gateway/registry.js";
import { InMemoryToolEvidenceSink, PrismaToolEvidenceSink } from "../services/tool-gateway/evidence.js";
import { toolErrors } from "../services/tool-gateway/errors.js";
import type {
  AgentToolCall,
  ToolCallEvidence,
  ToolContext,
  ToolDefinition,
  ToolEvidenceSink,
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
    allowedTools: [
      "test.readEcho",
      "test.write",
      "test.secrets",
      "test.slow",
      "test.adminOnly",
    ],
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
    const res = await gw.execute(call, baseCtx({ allowedTools: [] }));

    expect(res.executionStatus).toBe("unavailable");
    expect(res.deliveryStatus).toBe("not_applicable");
    expect(res.error?.code).toBe("unavailable");
    expect(sink.toolCalls).toHaveLength(1);
    expect(sink.toolCalls[0]!.executionStatus).toBe("unavailable");
    expect(sink.toolCalls[0]!.toolName).toBe("does.not.exist");
  });

  it("registered tool omitted from the exact grant → blocked + evidence + NO execute", async () => {
    const spy = { calls: 0 };
    registry.register(readEchoTool(spy));
    const gw = makeGateway(registry, sink);

    const res = await gw.execute(
      { name: "test.readEcho", arguments: { q: "must not run" } },
      baseCtx({ allowedTools: [] }),
    );

    expect(res.executionStatus).toBe("blocked");
    expect(res.deliveryStatus).toBe("not_applicable");
    expect(res.error?.code).toBe("blocked");
    expect(spy.calls).toBe(0);
    expect(sink.toolCalls).toHaveLength(1);
    expect(sink.toolCalls[0]!.executionStatus).toBe("blocked");
    expect(sink.toolCalls[0]!.toolName).toBe("test.readEcho");
  });

  it("caller role still resolves blocked status and preserves caller role/principal", async () => {
    const spy = { calls: 0 };
    registry.register(readEchoTool(spy));
    const gw = makeGateway(registry, sink, {
      resolveRole: async () => ({ role: "form_only", principalId: "resolved-principal", blocked: true }),
    });

    const res = await gw.execute(
      { name: "test.readEcho", arguments: { q: "must not run" } },
      baseCtx({ role: "advanced", principalId: "caller-principal" }),
    );

    expect(res.executionStatus).toBe("blocked");
    expect(spy.calls).toBe(0);
    expect(sink.toolCalls).toHaveLength(1);
    expect(sink.toolCalls[0]!.executionStatus).toBe("blocked");
    expect(sink.toolCalls[0]!.role).toBe("advanced");
    expect(sink.toolCalls[0]!.principalId).toBe("caller-principal");
  });

  it("blocked-status resolver failure fails closed with caller role and no execute", async () => {
    const spy = { calls: 0 };
    registry.register(readEchoTool(spy));
    const gw = makeGateway(registry, sink, {
      resolveRole: async () => { throw new Error("resolver detail must stay closed"); },
    });

    const res = await gw.execute(
      { name: "test.readEcho", arguments: { q: "must not run" } },
      baseCtx({ role: "advanced", principalId: "caller-principal" }),
    );

    expect(res.executionStatus).toBe("blocked");
    expect(spy.calls).toBe(0);
    expect(sink.toolCalls).toHaveLength(1);
    expect(sink.toolCalls[0]!.executionStatus).toBe("blocked");
    expect(sink.toolCalls[0]!.role).toBe("advanced");
    expect(sink.toolCalls[0]!.principalId).toBe("caller-principal");
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

  it("fails closed before a write when idempotency evidence lookup throws", async () => {
    const spy = { calls: 0, sawDryRun: [] as boolean[] };
    registry.register(writeTool(spy));
    vi.spyOn(sink, "findByIdempotencyKey").mockRejectedValueOnce(
      new Error("raw idempotency database failure"),
    );
    const gw = makeGateway(registry, sink, {
      getDryRun: () => false,
      getLiveAllowed: () => true,
    });

    const res = await gw.execute(
      { name: "test.write", arguments: { value: "must-not-run" } },
      baseCtx(),
    );

    expect(res.executionStatus).toBe("failed");
    expect(res.deliveryStatus).toBe("not_applicable");
    expect(res.error).toMatchObject({ code: "provider_error", message: "Tool provider failed" });
    expect(spy.calls).toBe(0);
    expect(sink.toolCalls).toHaveLength(1);
    expect(JSON.stringify(res)).not.toContain("raw idempotency database failure");
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

  it("returns a stable failed result when ToolCall evidence persistence throws", async () => {
    registry.register(readEchoTool());
    const rawSinkError = "db token sk-test-1234567890abcdef phone +84 912 345 678";
    const failingEvidence: ToolEvidenceSink = {
      writeToolCall: async () => { throw new Error(rawSinkError); },
      writeZaloAction: async () => "unused",
      findByIdempotencyKey: async () => null,
    };
    const gw = new ToolGateway({
      registry,
      evidence: failingEvidence,
      getDryRun: () => true,
      getLiveAllowed: () => false,
      resolveRole: async () => ({ role: "form_only", principalId: null, blocked: false }),
    });

    const res = await gw.execute(
      { name: "test.readEcho", arguments: { q: "provider result must be discarded" } },
      baseCtx(),
    );

    expect(res.executionStatus).toBe("failed");
    expect(res.error).toMatchObject({
      code: "provider_error",
      message: "Tool evidence persistence failed",
      retryable: true,
    });
    expect(res.result).toBeUndefined();
    expect(res.toolCallRecordId).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain(rawSinkError);
    expect(JSON.stringify(res)).not.toContain("provider result must be discarded");
    expect(JSON.stringify(res)).not.toContain("unpersisted-");
  });

  it("PrismaToolEvidenceSink propagates ToolCall persistence failures", async () => {
    const createSpy = vi.spyOn(prisma.toolCallRecord, "create").mockRejectedValueOnce(new Error("raw prisma write failure"));
    const evidence: ToolCallEvidence = {
      agentName: "hermes", toolName: "test.readEcho", kind: "read",
      threadId: "thread-1", threadType: "user", role: "advanced",
      executionStatus: "success", deliveryStatus: "not_applicable",
    };
    try {
      await expect(new PrismaToolEvidenceSink().writeToolCall(evidence)).rejects.toThrow("raw prisma write failure");
    } finally {
      createSpy.mockRestore();
    }
  });

  it("PrismaToolEvidenceSink propagates idempotency lookup failures", async () => {
    const findSpy = vi.spyOn(prisma.toolCallRecord, "findUnique").mockRejectedValueOnce(
      new Error("raw prisma lookup failure"),
    );
    try {
      await expect(new PrismaToolEvidenceSink().findByIdempotencyKey("idem-key"))
        .rejects.toThrow("raw prisma lookup failure");
    } finally {
      findSpy.mockRestore();
    }
  });

  it("redacts expected ToolError message/detail before persistence and return", async () => {
    const rawToken = "sk-test-1234567890abcdef";
    const rawPhone = "+84 912 345 678";
    const rawProviderText = "RAW_PROVIDER_SENTINEL upstream body";
    registry.register({
      name: "test.expectedError", kind: "read", minRole: "basic_chat", dataScope: "own_thread",
      argsSchema: z.object({}).strip(), resultSchema: z.any(),
      execute: () => { throw toolErrors.providerError(`${rawProviderText}; token ${rawToken}; phone ${rawPhone}`, { providerBody: rawProviderText, token: rawToken, contact: rawPhone }); },
    });
    const res = await makeGateway(registry, sink).execute(
      { name: "test.expectedError", arguments: {} },
      baseCtx({ allowedTools: ["test.expectedError"], role: "admin" }),
    );
    const persisted = sink.toolCalls[0]!;
    expect(res.error?.code).toBe("provider_error");
    expect(res.error?.message).toBe("Tool provider failed");
    expect(res.error?.detail).toBeUndefined();
    expect(JSON.stringify(res.error)).not.toContain(rawProviderText);
    expect(JSON.stringify(res.error)).not.toContain(rawToken);
    expect(JSON.stringify(res.error)).not.toContain(rawPhone);
    expect(persisted.errorMessage).toBe(res.error?.message);
    expect(persisted.evidence).toBeNull();
    expect(JSON.stringify(persisted)).not.toContain(rawProviderText);
    expect(JSON.stringify(persisted)).not.toContain(rawToken);
    expect(JSON.stringify(persisted)).not.toContain(rawPhone);
  });

  it("uses a stable public message for unexpected tool exceptions", async () => {
    const rawProviderError = "provider secret sk-test-abcdef1234567890 phone +84 988 777 666";
    registry.register({
      name: "test.unexpectedError", kind: "read", minRole: "basic_chat", dataScope: "own_thread",
      argsSchema: z.object({}).strip(), resultSchema: z.any(),
      execute: () => { throw new Error(rawProviderError); },
    });
    const res = await makeGateway(registry, sink).execute(
      { name: "test.unexpectedError", arguments: {} },
      baseCtx({ allowedTools: ["test.unexpectedError"] }),
    );
    expect(res.error).toMatchObject({ code: "provider_error", message: "Tool execution failed" });
    expect(sink.toolCalls[0]!.errorMessage).toBe("Tool execution failed");
    expect(JSON.stringify(res)).not.toContain(rawProviderError);
    expect(JSON.stringify(sink.toolCalls[0])).not.toContain(rawProviderError);
  });

  it("persists exact context-owned evidence links and ignores tool-supplied replacements", async () => {
    registry.register({
      name: "test.links", kind: "read", minRole: "basic_chat", dataScope: "own_thread",
      argsSchema: z.object({}).strip(), resultSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ result: { ok: true }, links: {
        agentTaskId: "tool-supplied-task", relatedMessageId: "tool-supplied-message", outboundRecordId: "outbound-1",
      } }),
    });
    const res = await makeGateway(registry, sink).execute(
      { name: "test.links", arguments: {} },
      baseCtx({ allowedTools: ["test.links"], agentTaskId: "task-db-1", relatedMessageId: "message-db-1",
        principalId: "principal-db-1", role: "advanced", threadId: "thread-db-1", threadType: "group" }),
    );
    expect(sink.toolCalls[0]).toMatchObject({
      agentTaskId: "task-db-1", relatedMessageId: "message-db-1", principalId: "principal-db-1", role: "advanced",
      threadId: "thread-db-1", threadType: "group", outboundRecordId: "outbound-1",
    });
    expect(res.links).toMatchObject({ agentTaskId: "task-db-1", relatedMessageId: "message-db-1", outboundRecordId: "outbound-1" });
    expect(JSON.stringify(res.links)).not.toContain("tool-supplied-task");
    expect(JSON.stringify(res.links)).not.toContain("tool-supplied-message");
  });
});
