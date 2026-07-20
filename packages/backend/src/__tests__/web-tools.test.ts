// =============================================================================
// Phase 6 — web tools tests (DB-free, NO real network/DNS)
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";

import { ToolGateway } from "../services/tool-gateway/gateway.js";
import { ToolRegistry } from "../services/tool-gateway/registry.js";
import { InMemoryToolEvidenceSink } from "../services/tool-gateway/evidence.js";
import { registerWebTools } from "../services/tools/web/index.js";
import type { WebConfig, WebToolDeps } from "../services/tools/web/deps.js";
import { assertUrlAllowed, isBlockedIp } from "../services/tools/web/ssrf-guard.js";
import { NoneProvider, TavilyProvider, type WebSearchProvider, type WebSearchProviderResult } from "../services/tools/web/providers.js";
import type { ToolContext } from "../services/tool-gateway/types.js";

function cfg(over: Partial<WebConfig> = {}): WebConfig {
  return {
    searchEnabled: true,
    searchMaxResults: 5,
    fetchEnabled: true,
    fetchTimeoutMs: 5000,
    fetchMaxBytes: 524288,
    fetchMaxRedirects: 3,
    fetchMaxContentChars: 8192,
    ...over,
  };
}
function ctx(o: Partial<ToolContext> = {}): ToolContext {
  return {
    agentName: "hermes",
    allowedTools: ["web.search", "web.fetchPage"],
    threadId: "t1",
    threadType: "user",
    role: "admin",
    principalId: "p1",
    senderId: "p1",
    ...o,
  };
}
function makeGateway(registry: ToolRegistry, sink: InMemoryToolEvidenceSink) {
  return new ToolGateway({
    registry, evidence: sink,
    getDryRun: () => true, getLiveAllowed: () => false,
    resolveRole: async () => ({ role: "form_only", principalId: null, blocked: false }),
  });
}

class StubProvider implements WebSearchProvider {
  readonly name = "stub";
  lastLimit = 0;
  configured = true;
  result: WebSearchProviderResult = { ok: true, results: [{ title: "T", url: "https://ex.com", snippet: "s" }] };
  isConfigured() { return this.configured; }
  async search(_q: string, opts: { limit: number }) { this.lastLimit = opts.limit; return this.result; }
}

describe("Phase 6 — web.search", () => {
  let registry: ToolRegistry;
  let sink: InMemoryToolEvidenceSink;
  let provider: StubProvider;

  beforeEach(() => {
    registry = new ToolRegistry();
    sink = new InMemoryToolEvidenceSink();
    provider = new StubProvider();
  });

  it("disabled / no provider → unavailable + evidence, no results", async () => {
    registerWebTools(registry, { getConfig: () => cfg({ searchEnabled: false }), getSearchProvider: () => new NoneProvider() });
    const res = await makeGateway(registry, sink).execute({ name: "web.search", arguments: { query: "x" } }, ctx());
    expect(res.executionStatus).toBe("unavailable");
    expect((res.result as any)?.results).toBeUndefined();
    expect(sink.toolCalls.find((t) => t.toolName === "web.search")?.executionStatus).toBe("unavailable");
  });

  it("enabled + provider → results; role gate (basic_chat blocked, advanced ok)", async () => {
    registerWebTools(registry, { getConfig: () => cfg(), getSearchProvider: () => provider });
    const g = makeGateway(registry, sink);
    const denied = await g.execute({ name: "web.search", arguments: { query: "x" } }, ctx({ role: "basic_chat" }));
    expect(denied.executionStatus).toBe("blocked");
    const ok = await g.execute({ name: "web.search", arguments: { query: "x" } }, ctx({ role: "advanced" }));
    expect(ok.executionStatus).toBe("success");
    expect((ok.result as any).results).toHaveLength(1);
    expect((ok.result as any).provider).toBe("stub");
  });

  it("limit clamp to searchMaxResults", async () => {
    registerWebTools(registry, { getConfig: () => cfg({ searchMaxResults: 5 }), getSearchProvider: () => provider });
    await makeGateway(registry, sink).execute({ name: "web.search", arguments: { query: "x", limit: 999 } }, ctx({ role: "advanced" }));
    expect(provider.lastLimit).toBe(5);
  });

  it("provider missing → unavailable, no fabrication", async () => {
    provider.configured = false;
    registerWebTools(registry, { getConfig: () => cfg(), getSearchProvider: () => provider });
    const res = await makeGateway(registry, sink).execute({ name: "web.search", arguments: { query: "x" } }, ctx({ role: "advanced" }));
    expect(res.executionStatus).toBe("unavailable");
  });

  it("API key never appears in result/evidence (Tavily via stub fetch)", async () => {
    const KEY = "SECRET_TAVILY_KEY_123";
    const stubFetch = async () => ({ ok: true, status: 200, json: async () => ({ results: [{ title: "A", url: "https://a.com", content: "c" }] }) });
    const tavily = new TavilyProvider(KEY, stubFetch as any, 1000);
    registerWebTools(registry, { getConfig: () => cfg(), getSearchProvider: () => tavily });
    const res = await makeGateway(registry, sink).execute({ name: "web.search", arguments: { query: "x" } }, ctx({ role: "advanced" }));
    expect(res.executionStatus).toBe("success");
    const blob = JSON.stringify(res.result) + JSON.stringify(sink.toolCalls);
    expect(blob).not.toContain(KEY);
  });
});

describe("Phase 6 — SSRF guard", () => {
  const pub: WebToolDeps["resolveDns"] = async () => ["93.184.216.34"]; // public
  const priv: WebToolDeps["resolveDns"] = async () => ["10.0.0.5"]; // private

  it("isBlockedIp ranges", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("10.1.2.3")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true); // metadata
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fd00::1")).toBe(true);
    expect(isBlockedIp("93.184.216.34")).toBe(false); // public
  });

  it("blocks non-http, file, localhost, private, metadata", async () => {
    await expect(assertUrlAllowed("file:///etc/passwd", pub!)).rejects.toBeTruthy();
    await expect(assertUrlAllowed("ftp://example.com", pub!)).rejects.toBeTruthy();
    await expect(assertUrlAllowed("http://localhost/x", pub!)).rejects.toBeTruthy();
    await expect(assertUrlAllowed("http://127.0.0.1/x", pub!)).rejects.toBeTruthy();
    await expect(assertUrlAllowed("http://169.254.169.254/latest/meta-data", pub!)).rejects.toBeTruthy();
    await expect(assertUrlAllowed("http://user:pass@example.com", pub!)).rejects.toBeTruthy();
    await expect(assertUrlAllowed("http://evil.com", priv!)).rejects.toBeTruthy(); // resolves private
  });

  it("allows a public host", async () => {
    const u = await assertUrlAllowed("https://example.com/page", pub!);
    expect(u.hostname).toBe("example.com");
  });
});

describe("Phase 6 — web.fetchPage", () => {
  let registry: ToolRegistry;
  let sink: InMemoryToolEvidenceSink;

  beforeEach(() => { registry = new ToolRegistry(); sink = new InMemoryToolEvidenceSink(); });

  const pubResolve = async () => ["93.184.216.34"];
  const privResolve = async () => ["10.0.0.5"];

  it("admin-only (advanced blocked)", async () => {
    registerWebTools(registry, { getConfig: () => cfg(), resolveDns: pubResolve, fetchImpl: (async () => ({ status: 200, headers: { get: () => "text/html" }, text: async () => "hi" })) as any });
    const res = await makeGateway(registry, sink).execute({ name: "web.fetchPage", arguments: { url: "https://example.com" } }, ctx({ role: "advanced" }));
    expect(res.executionStatus).toBe("blocked");
  });

  it("disabled → unavailable", async () => {
    registerWebTools(registry, { getConfig: () => cfg({ fetchEnabled: false }), resolveDns: pubResolve });
    const res = await makeGateway(registry, sink).execute({ name: "web.fetchPage", arguments: { url: "https://example.com" } }, ctx({ role: "admin" }));
    expect(res.executionStatus).toBe("unavailable");
  });

  it("happy path: bounded text, script/style stripped, no headers/cookies", async () => {
    const fetchImpl = (async () => ({
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : "secret=cookievalue") },
      text: async () => "<html><head><style>.a{}</style></head><body>Hello <script>steal()</script><b>World</b></body></html>",
    })) as any;
    registerWebTools(registry, { getConfig: () => cfg(), resolveDns: pubResolve, fetchImpl });
    const res = await makeGateway(registry, sink).execute({ name: "web.fetchPage", arguments: { url: "https://example.com" } }, ctx({ role: "admin" }));
    expect(res.executionStatus).toBe("success");
    const r = res.result as any;
    expect(r.content).toContain("Hello");
    expect(r.content).toContain("World");
    expect(r.content).not.toContain("steal()"); // script stripped
    expect(r.content).not.toContain(".a{}"); // style stripped
    expect(JSON.stringify(r)).not.toContain("cookievalue"); // no headers/cookies returned
    expect(r).not.toHaveProperty("headers");
  });

  it("SSRF via redirect (rebinding) → blocked", async () => {
    // First request 302 → evil host that resolves to a private IP.
    const fetchImpl = (async (url: string) => {
      if (url.includes("example.com")) {
        return { status: 302, headers: { get: (k: string) => (k.toLowerCase() === "location" ? "http://evil.internal-rebind.com/" : null) }, text: async () => "" };
      }
      return { status: 200, headers: { get: () => "text/html" }, text: async () => "should-not-reach" };
    }) as any;
    // example.com public; the redirect target resolves private.
    const resolveDns = (async (host: string) => (host.includes("example.com") ? ["93.184.216.34"] : ["10.0.0.9"])) as any;
    registerWebTools(registry, { getConfig: () => cfg(), resolveDns, fetchImpl });
    const res = await makeGateway(registry, sink).execute({ name: "web.fetchPage", arguments: { url: "https://example.com" } }, ctx({ role: "admin" }));
    expect(res.executionStatus).toBe("blocked");
  });
});
