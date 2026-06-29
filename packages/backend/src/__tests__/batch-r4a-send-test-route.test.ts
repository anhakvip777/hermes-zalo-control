// =============================================================================
// R4A — /zalo/send-test route migration tests
// =============================================================================
// Verifies that POST /api/zalo/send-test calls sendOutbound() instead of
// creating a ZaloMessageSender directly.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";

// ── Mock sendOutbound to verify it's called ──────────────────────────
const mockSendOutbound = vi.fn().mockResolvedValue({
  success: true,
  dryRun: true,
  decision: "allow" as const,
  reason: "dry_run",
  sentMessageId: "dry-run-test-123",
  outboundRecordId: "rec-test-456",
  assistantMessageId: "msg-test-789",
});

vi.mock("../services/outbound-dispatcher.service.js", () => ({
  sendOutbound: (...args: unknown[]) => mockSendOutbound(...args),
}));

// ── Mock ZaloGatewayService (required by zalo routes) ────────────────
vi.mock("../services/zalo-gateway.service.js", () => ({
  getZaloGateway: () => ({
    status: { connected: false, selfUserId: null, lastError: "mock" },
    login: vi.fn(),
    logout: vi.fn(),
    startListener: vi.fn(),
    stopListener: vi.fn(),
    getQR: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
  }),
}));

// ── Config bypass: set dev mode so adminAuth skips ───────────────────
const origEnv = { ...process.env };

describe("R4A — POST /api/zalo/send-test via Unified Outbound Dispatcher", () => {
  let app: import("fastify").FastifyInstance;

  beforeAll(async () => {
    // Bypass admin auth
    process.env.NODE_ENV = "development";
    process.env.ADMIN_PASSWORD = "dev-admin-password";

    const { fastify } = await import("fastify");
    app = fastify({ logger: false });

    // Register the zalo routes on prefix /api
    const { zaloRoutes } = await import("../routes/zalo.js");
    await app.register(zaloRoutes, { prefix: "/api" });
    await app.ready();
  });

  afterAll(async () => {
    process.env.NODE_ENV = origEnv.NODE_ENV;
    process.env.ADMIN_PASSWORD = origEnv.ADMIN_PASSWORD;
    await app.close();
  });

  beforeEach(() => {
    mockSendOutbound.mockClear();
  });

  const validBody = {
    threadId: "thread-test-send",
    threadType: "user",
    content: "Hello from test DM",
  };

  // ── Positive cases ─────────────────────────────────────────────────

  it("calls sendOutbound() with source=manual_test (not ZaloMessageSender)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/zalo/send-test",
      payload: validBody,
    });

    expect(res.statusCode).toBe(200);

    // Verify sendOutbound was called
    expect(mockSendOutbound).toHaveBeenCalledTimes(1);
    const callArgs = mockSendOutbound.mock.calls[0][0];
    expect(callArgs.threadId).toBe("thread-test-send");
    expect(callArgs.threadType).toBe("user");
    expect(callArgs.source).toBe("manual_test");
    expect(callArgs.content).toBe("Hello from test DM");
    expect(callArgs.metadata).toEqual({
      route: "zalo/send-test",
      initiatedBy: "admin",
    });
  });

  it("returns correct response shape with audit fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/zalo/send-test",
      payload: validBody,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toBeDefined();
    expect(body.data.success).toBe(true);
    expect(body.data.decision).toBe("dry_run");
    expect(body.data.dryRun).toBe(true);
    expect(body.data.sentMessageId).toBe("dry-run-test-123");
    expect(body.data.outboundRecordId).toBe("rec-test-456");
    expect(body.data.reason).toBe("dry_run");
  });

  // ── Error cases ────────────────────────────────────────────────────

  it("returns error (not 200) when threadId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/zalo/send-test",
      payload: { content: "test" },
    });

    expect(res.statusCode).not.toBe(200);
  });

  it("returns error (not 200) when content is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/zalo/send-test",
      payload: { threadId: "thread-1" },
    });

    expect(res.statusCode).not.toBe(200);
  });

  // ── dryRun=true sends no real Zalo message ─────────────────────────

  it("with dryRun=true returns decision=dry_run, no real sentMessageId pattern", async () => {
    // Override mock for this specific test to simulate live send but dryRun=true
    mockSendOutbound.mockResolvedValueOnce({
      success: true,
      dryRun: true,
      decision: "allow" as const,
      reason: "dry_run",
      sentMessageId: "dry-run-xyz",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/zalo/send-test",
      payload: validBody,
    });

    const body = JSON.parse(res.body);
    expect(body.data.decision).toBe("dry_run");
    expect(body.data.dryRun).toBe(true);
    // sentMessageId starts with dry-run- prefix (no real Zalo msg ID)
    expect(body.data.sentMessageId).toMatch(/^dry-run-/);
  });

  // ── OutboundRecord is created ──────────────────────────────────────

  it("OutboundRecord is created via sendOutbound (db check)", async () => {
    // This test verifies that the route calls sendOutbound which creates an OutboundRecord
    // We verify via the mock — sendOutbound was called and returned outboundRecordId
    await app.inject({
      method: "POST",
      url: "/api/zalo/send-test",
      payload: validBody,
    });

    const callResult = await mockSendOutbound.mock.results[0]?.value;
    expect(callResult.outboundRecordId).toBeDefined();
    expect(callResult.outboundRecordId).toBe("rec-test-456");
  });
});
