import { afterEach, describe, expect, it, vi } from "vitest";

import { HermesAdapter } from "../services/agent-bridge/hermes-adapter.js";
import type { AgentRequest } from "../services/agent-bridge/types.js";
import type { AgentToolResult } from "../services/tool-gateway/types.js";

function request(): AgentRequest {
  return {
    threadId: "thread-1",
    threadType: "user",
    sender: { id: "sender-1", name: "An", role: "advanced" },
    content: "continue after the tool result",
    recentMessages: ["earlier message"],
    scheduleContext: "No active schedule.",
    runtime: { dryRun: true, live: false },
    permissions: { canUseTools: true, allowedTools: ["memory.searchMessages"] },
    metadata: { agentName: "hermes" },
  };
}

const priorToolResults: AgentToolResult[] = [
  {
    toolName: "memory.searchMessages",
    kind: "read",
    executionStatus: "success",
    deliveryStatus: "not_applicable",
    result: { phone: "[REDACTED]", matches: [{ text: "safe result" }] },
    toolCallRecordId: "record-1",
    durationMs: 4,
  },
];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HermesAdapter structured HTTP protocol", () => {
  it("posts one exact structured envelope including prior redacted tool results", async () => {
    const calls: Array<{ input: Parameters<typeof fetch>[0]; init?: RequestInit }> = [];
    const providerResponse = { text: "done", toolCalls: [], confidence: 0.85 };
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify(providerResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const adapter = new HermesAdapter({
      endpoint: "https://hermes.example/agent",
      protocolVersion: "test-v2",
      timeoutMs: 1_000,
      maxResponseBytes: 16_384,
      fetchImpl,
    });

    const result = await adapter.run(request(), priorToolResults);

    expect(result).toEqual(providerResponse);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input).toBe("https://hermes.example/agent");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(new Headers(calls[0]!.init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      protocolVersion: "test-v2",
      request: request(),
      priorToolResults,
    });
  });

  it("rejects a missing endpoint without attempting transport", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{}");
    };
    const adapter = new HermesAdapter({ endpoint: "   ", fetchImpl });

    await expect(adapter.run(request(), [])).rejects.toThrow("HERMES_ENDPOINT_MISSING");
    expect(calls).toBe(0);
  });

  it("reports non-2xx status without exposing the provider body or retrying", async () => {
    const providerSecret = "provider-secret-do-not-leak";
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(providerSecret, { status: 503 });
    };
    const adapter = new HermesAdapter({ endpoint: "https://hermes.example/agent", fetchImpl });

    let thrown: unknown;
    try {
      await adapter.run(request(), []);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("HERMES_HTTP_ERROR:503");
    expect((thrown as Error).message).not.toContain(providerSecret);
    expect(calls).toBe(1);
  });

  it("cancels a non-2xx response body while preserving the stable HTTP error", async () => {
    let cancellations = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("provider-secret"));
      },
      cancel() {
        cancellations += 1;
        throw new Error("cancel-secret");
      },
    });
    const fetchImpl: typeof fetch = async () => new Response(body, { status: 502 });
    const adapter = new HermesAdapter({ endpoint: "https://hermes.example/agent", fetchImpl });

    await expect(adapter.run(request(), [])).rejects.toThrow(/^HERMES_HTTP_ERROR:502$/);
    expect(cancellations).toBe(1);
  });

  it("rejects invalid JSON without retrying", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{not-json", { status: 200 });
    };
    const adapter = new HermesAdapter({ endpoint: "https://hermes.example/agent", fetchImpl });

    await expect(adapter.run(request(), [])).rejects.toThrow("HERMES_INVALID_JSON");
    expect(calls).toBe(1);
  });

  it("enforces the response limit in UTF-8 bytes for multi-byte content", async () => {
    const body = '"éé"';
    expect(body.length).toBe(4);
    expect(new TextEncoder().encode(body).byteLength).toBe(6);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(body, { status: 200 });
    };
    const adapter = new HermesAdapter({
      endpoint: "https://hermes.example/agent",
      maxResponseBytes: 4,
      fetchImpl,
    });

    await expect(adapter.run(request(), [])).rejects.toThrow("HERMES_RESPONSE_TOO_LARGE");
    expect(calls).toBe(1);
  });

  it("cancels a declared oversized response body while preserving the stable size error", async () => {
    let cancellations = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("provider-secret"));
      },
      cancel() {
        cancellations += 1;
        throw new Error("cancel-secret");
      },
    });
    const fetchImpl: typeof fetch = async () => new Response(body, {
      status: 200,
      headers: { "Content-Length": "999" },
    });
    const adapter = new HermesAdapter({
      endpoint: "https://hermes.example/agent",
      maxResponseBytes: 4,
      fetchImpl,
    });

    await expect(adapter.run(request(), [])).rejects.toThrow(/^HERMES_RESPONSE_TOO_LARGE$/);
    expect(cancellations).toBe(1);
  });

  it("aborts a timed-out request without retrying", async () => {
    vi.useFakeTimers();
    let calls = 0;
    let observedSignal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    };
    const adapter = new HermesAdapter({
      endpoint: "https://hermes.example/agent",
      timeoutMs: 25,
      fetchImpl,
    });

    const outcome = adapter.run(request(), []).then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    );
    await vi.advanceTimersByTimeAsync(25);
    const settled = await outcome;

    expect(settled.error).toBeInstanceOf(Error);
    expect((settled.error as Error).message).toBe("HERMES_TIMEOUT");
    expect(settled.value).toBeUndefined();
    expect(observedSignal?.aborted).toBe(true);
    expect(calls).toBe(1);
  });

  it("maps transport failures to a stable secret-free error without retrying", async () => {
    const transportSecret = "socket-secret-do-not-leak";
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new Error(transportSecret);
    };
    const adapter = new HermesAdapter({ endpoint: "https://hermes.example/agent", fetchImpl });

    let thrown: unknown;
    try {
      await adapter.run(request(), []);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("HERMES_TRANSPORT_ERROR");
    expect((thrown as Error).message).not.toContain(transportSecret);
    expect(calls).toBe(1);
  });

  it("does not log request or response bodies", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ text: "private response" }));
    const adapter = new HermesAdapter({ endpoint: "https://hermes.example/agent", fetchImpl });

    await adapter.run({ ...request(), content: "private request" }, []);

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
