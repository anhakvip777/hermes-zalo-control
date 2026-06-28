// =============================================================================
// HermesChatAdapter tests
// =============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// ── Config mock: default to mock mode ───────────────────────────────
// NOTE: vi.mock factory is hoisted — must inline values
const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock("../config.js", () => ({
  config: {
    hermesChat: {
      adapter: "mock",
      mode: "http",
      endpoint: "",
      cliBin: "",
      timeoutMs: 30000,
      cliTimeoutMs: 60000,
      minConfidence: 0.5,
    },
  },
}));

// ── Mock child_process spawn ───────────────────────────────────────
vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

import {
  MockHermesChatAdapter,
  RealHermesChatAdapter,
  getHermesChatAdapter,
  resetHermesChatAdapter,
  setHermesChatAdapter,
} from "../services/hermes-chat-adapter.js";
import type { ChatContext } from "../services/hermes-chat-adapter.js";
import { config } from "../config.js";

const baseCtx = (overrides: Partial<ChatContext> = {}): ChatContext => ({
  threadId: "thread-1",
  threadType: "user",
  senderId: "sender-1",
  senderName: "Test User",
  content: "Xin chào",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetHermesChatAdapter();
  (config.hermesChat as Record<string, unknown>).adapter = "mock";
  (config.hermesChat as Record<string, unknown>).mode = "http";
  (config.hermesChat as Record<string, unknown>).endpoint = "";
  (config.hermesChat as Record<string, unknown>).cliBin = "";
});

// ═════════════════════════════════════════════════════════════════════
// MockHermesChatAdapter
// ═════════════════════════════════════════════════════════════════════

describe("MockHermesChatAdapter", () => {
  it("returns echo reply with confidence=1.0", async () => {
    const adapter = new MockHermesChatAdapter();
    const result = await adapter.generateReply(baseCtx({ content: "Hello" }));
    expect(result.reply).toContain("Hello");
    expect(result.confidence).toBe(1.0);
  });

  it("echoes exact content in reply", async () => {
    const adapter = new MockHermesChatAdapter();
    const result = await adapter.generateReply(baseCtx({ content: "Test 123" }));
    expect(result.reply).toBe('Bạn vừa nói: "Test 123"');
  });
});

// ═════════════════════════════════════════════════════════════════════
// RealHermesChatAdapter — HTTP mode
// ═════════════════════════════════════════════════════════════════════

describe("RealHermesChatAdapter HTTP mode", () => {
  function makeAdapter(endpoint = "", timeoutMs = 30000) {
    return new RealHermesChatAdapter({ mode: "http", endpoint, timeoutMs });
  }

  it("throws HERMES_ENDPOINT_MISSING when endpoint is empty", async () => {
    const adapter = makeAdapter("");
    await expect(adapter.generateReply(baseCtx())).rejects.toThrow("HERMES_ENDPOINT_MISSING");
  });

  it("handles endpoint timeout", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal) {
            const signal = init.signal as AbortSignal;
            if (signal.aborted) {
              reject(new DOMException("The operation was aborted", "AbortError"));
              return;
            }
            signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted", "AbortError"));
            });
          }
        }),
    ) as unknown as typeof fetch;

    try {
      const adapter = makeAdapter("http://localhost:9999/timeout", 50);
      await expect(adapter.generateReply(baseCtx())).rejects.toThrow(/timeout/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 5000);

  it("returns reply + confidence on success", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reply: "Chào bạn! Tôi là Hermes.", confidence: 0.95 }),
    }) as unknown as typeof fetch;

    try {
      const adapter = makeAdapter("http://localhost:9999/api/chat", 5000);
      const result = await adapter.generateReply(baseCtx());
      expect(result.reply).toBe("Chào bạn! Tôi là Hermes.");
      expect(result.confidence).toBe(0.95);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns empty reply on missing reply field", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" }),
    }) as unknown as typeof fetch;

    try {
      const adapter = makeAdapter("http://localhost:9999/api/chat");
      const result = await adapter.generateReply(baseCtx());
      expect(result.reply).toBe("");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws on HTTP error response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;

    try {
      const adapter = makeAdapter("http://localhost:9999/api/chat");
      await expect(adapter.generateReply(baseCtx())).rejects.toThrow(/500/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws on endpoint returning error field", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: "Model overloaded" }),
    }) as unknown as typeof fetch;

    try {
      const adapter = makeAdapter("http://localhost:9999/api/chat");
      await expect(adapter.generateReply(baseCtx())).rejects.toThrow("Model overloaded");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles network error gracefully", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    try {
      const adapter = makeAdapter("http://localhost:9999/api/chat");
      await expect(adapter.generateReply(baseCtx())).rejects.toThrow("ECONNREFUSED");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
// RealHermesChatAdapter — CLI mode
// ═════════════════════════════════════════════════════════════════════

describe("RealHermesChatAdapter CLI mode", () => {
  function makeCLIAdapter(cliBin = "/usr/bin/hermes", cliTimeoutMs = 60000) {
    return new RealHermesChatAdapter({ mode: "cli", cliBin, cliTimeoutMs });
  }

  function mockSpawnSuccess(stdout: string, code = 0) {
    const stdoutEE = new EventEmitter() as EventEmitter & { read: () => null };
    const stderrEE = new EventEmitter() as EventEmitter & { read: () => null };
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number };
    child.stdout = stdoutEE;
    child.stderr = stderrEE;
    child.pid = 99999;

    mockSpawn.mockReturnValue(child);

    // Simulate async output
    setTimeout(() => {
      (child.stdout as EventEmitter).emit("data", Buffer.from(stdout));
      child.emit("close", code, null);
    }, 1);

    return child;
  }

  it("CLI success: parses reply from stdout (with session_id line)", async () => {
    mockSpawnSuccess("session_id: 20260625_test_abc\nChào bạn! Hermes đây.\n");

    const adapter = makeCLIAdapter();
    const result = await adapter.generateReply(baseCtx());

    expect(result.reply).toBe("Chào bạn! Hermes đây.");
    expect(result.confidence).toBe(0.9); // "Chào" has Vietnamese diacritics
    // Verify spawn called with shell=false
    expect(mockSpawn).toHaveBeenCalledWith(
      "/usr/bin/hermes",
      expect.arrayContaining(["chat", "-q", expect.any(String), "-Q"]),
      expect.objectContaining({ shell: false }),
    );
  });

  it("CLI success: detects Vietnamese for higher confidence", async () => {
    mockSpawnSuccess("session_id: xyz\nChào bạn, tôi là Hermes. Bạn cần gì ạ?\n");

    const adapter = makeCLIAdapter();
    const result = await adapter.generateReply(baseCtx());

    expect(result.reply).toContain("Hermes");
    expect(result.confidence).toBe(0.9); // Vietnamese chars detected
  });

  it("CLI empty stdout → empty reply", async () => {
    mockSpawnSuccess("");

    const adapter = makeCLIAdapter();
    const result = await adapter.generateReply(baseCtx());

    expect(result.reply).toBe("");
  });

  it("CLI non-zero exit → throws HERMES_CLI_FAILED", async () => {
    const stderrEE = new EventEmitter() as EventEmitter;
    const stdoutEE = new EventEmitter() as EventEmitter;
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number };
    child.stdout = stdoutEE;
    child.stderr = stderrEE;
    child.pid = 99999;
    mockSpawn.mockReturnValue(child);

    setTimeout(() => {
      (child.stderr as EventEmitter).emit("data", Buffer.from("command not found"));
      child.emit("close", 127, null);
    }, 1);

    const adapter = makeCLIAdapter();
    await expect(adapter.generateReply(baseCtx())).rejects.toThrow("HERMES_CLI_FAILED");
  });

  it("CLI bin missing → throws HERMES_CLI_MISSING", async () => {
    const adapter = makeCLIAdapter(""); // empty bin
    await expect(adapter.generateReply(baseCtx())).rejects.toThrow("HERMES_CLI_MISSING");
  });

  it("CLI spawn ENOENT → throws HERMES_CLI_MISSING", async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number };
    child.stdout = new EventEmitter() as EventEmitter;
    child.stderr = new EventEmitter() as EventEmitter;
    child.pid = 99999;
    mockSpawn.mockReturnValue(child);

    setTimeout(() => {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      child.emit("error", err);
    }, 1);

    const adapter = makeCLIAdapter();
    await expect(adapter.generateReply(baseCtx())).rejects.toThrow("HERMES_CLI_MISSING");
  });

  it("CLI timeout → throws HERMES_CLI_TIMEOUT", async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number };
    child.stdout = new EventEmitter() as EventEmitter;
    child.stderr = new EventEmitter() as EventEmitter;
    child.pid = 99999;
    mockSpawn.mockReturnValue(child);

    setTimeout(() => {
      child.emit("close", null, "SIGTERM");
    }, 1);

    const adapter = makeCLIAdapter("/usr/bin/hermes", 100);
    await expect(adapter.generateReply(baseCtx())).rejects.toThrow("HERMES_CLI_TIMEOUT");
  });

  it("CLI prompt uses spawn args, not shell string", async () => {
    mockSpawnSuccess("OK\n");

    const adapter = makeCLIAdapter();
    await adapter.generateReply(baseCtx({ senderName: "Anh Việt", content: "Chào" }));

    const callArgs = mockSpawn.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(callArgs[0]).toBe("/usr/bin/hermes"); // binary
    expect(callArgs[1]).toEqual(["chat", "-q", expect.any(String), "-Q"]); // args array
    expect(callArgs[2]).toEqual(expect.objectContaining({ shell: false }));

    // Prompt contains safety prefix + context
    const prompt = callArgs[1][2] as string;
    expect(prompt).toContain("Bạn là trợ lý Zalo");
    expect(prompt).toContain("Anh Việt");
    expect(prompt).toContain("Chào");
    // Safety instructions present
    expect(prompt).toContain("Không nhắc đến hệ thống nội bộ");
  });

  it("CLI confidence: error keywords → 0.3", async () => {
    mockSpawnSuccess("session_id: err\nError: API key is invalid\n");

    const adapter = makeCLIAdapter();
    const result = await adapter.generateReply(baseCtx());

    expect(result.confidence).toBe(0.3);
  });

  it("CLI confidence: very short → 0.5", async () => {
    mockSpawnSuccess("session_id: x\n...\n");

    const adapter = makeCLIAdapter();
    const result = await adapter.generateReply(baseCtx());

    expect(result.confidence).toBe(0.5);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Adapter Factory
// ═════════════════════════════════════════════════════════════════════

describe("getHermesChatAdapter (factory)", () => {
  it("returns MockHermesChatAdapter by default", () => {
    resetHermesChatAdapter();
    const adapter = getHermesChatAdapter();
    expect(adapter).toBeInstanceOf(MockHermesChatAdapter);
  });

  it("returns RealHermesChatAdapter when config.adapter=real (HTTP mode)", () => {
    (config.hermesChat as Record<string, unknown>).adapter = "real";
    (config.hermesChat as Record<string, unknown>).mode = "http";
    (config.hermesChat as Record<string, unknown>).endpoint = "http://localhost:9999/api/chat";
    resetHermesChatAdapter();
    const adapter = getHermesChatAdapter();
    expect(adapter).toBeInstanceOf(RealHermesChatAdapter);
  });

  it("returns RealHermesChatAdapter when config.adapter=real (CLI mode)", () => {
    (config.hermesChat as Record<string, unknown>).adapter = "real";
    (config.hermesChat as Record<string, unknown>).mode = "cli";
    (config.hermesChat as Record<string, unknown>).cliBin = "/usr/bin/hermes";
    resetHermesChatAdapter();
    const adapter = getHermesChatAdapter();
    expect(adapter).toBeInstanceOf(RealHermesChatAdapter);
  });

  it("returns singleton — same instance across calls", () => {
    resetHermesChatAdapter();
    const a1 = getHermesChatAdapter();
    const a2 = getHermesChatAdapter();
    expect(a1).toBe(a2);
  });

  it("setHermesChatAdapter overrides singleton", () => {
    const custom = new MockHermesChatAdapter();
    setHermesChatAdapter(custom);
    expect(getHermesChatAdapter()).toBe(custom);
  });
});
