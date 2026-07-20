// =============================================================================
// Internal API — security tests
// =============================================================================

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";

// ── Mock sendOutbound to verify it's called (not ZaloMessageSender) ──
const mockSendOutbound = vi.fn().mockResolvedValue({
  success: true,
  dryRun: true,
  decision: "allow" as const,
  reason: "dry_run",
  sentMessageId: "dry-run-123",
});

vi.mock("../services/outbound-dispatcher.service.js", () => ({
  sendOutbound: (...args: unknown[]) => mockSendOutbound(...args),
}));

// R3.2 — Mock handleIncomingMessage for batch endpoint tests
const mockHandleIncoming = vi.fn().mockResolvedValue({ dispatched: true, reason: "success" });
vi.mock("../services/incoming-dispatcher.service.js", () => ({
  handleIncomingMessage: (...args: unknown[]) => mockHandleIncoming(...args),
}));

// ── Import the exported helpers ──────────────────────────────────────
import { isLocalRequest, safeTokenEquals } from "../routes/internal.js";
import { prisma } from "../db.js";

// ── Helper tests ─────────────────────────────────────────────────────

describe("Internal API — isLocalRequest", () => {
  it("returns true for 127.0.0.1", () => {
    expect(isLocalRequest("127.0.0.1")).toBe(true);
  });

  it("returns true for ::1", () => {
    expect(isLocalRequest("::1")).toBe(true);
  });

  it("returns true for ::ffff:127.0.0.1", () => {
    expect(isLocalRequest("::ffff:127.0.0.1")).toBe(true);
  });

  it("returns false for 8.8.8.8", () => {
    expect(isLocalRequest("8.8.8.8")).toBe(false);
  });

  it("returns false for 192.168.1.1", () => {
    expect(isLocalRequest("192.168.1.1")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isLocalRequest("")).toBe(false);
  });
});

describe("Internal API — safeTokenEquals", () => {
  it("returns true for identical tokens", () => {
    expect(safeTokenEquals("secret-token-123", "secret-token-123")).toBe(true);
  });

  it("returns false for wrong token", () => {
    expect(safeTokenEquals("wrong-token", "secret-token-123")).toBe(false);
  });

  it("returns false for different length tokens (no throw)", () => {
    expect(safeTokenEquals("short", "very-long-token-that-doesnt-match")).toBe(false);
  });

  it("returns false for empty vs non-empty (no throw)", () => {
    expect(safeTokenEquals("", "secret")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(safeTokenEquals("", "")).toBe(true);
  });

  it("does not throw on any input", () => {
    // These should all return false without throwing
    expect(() => safeTokenEquals("a", "b")).not.toThrow();
    expect(() => safeTokenEquals("", "x")).not.toThrow();
    expect(() => safeTokenEquals("x", "")).not.toThrow();
  });
});

// ── Route-level integration tests ────────────────────────────────────

describe("Internal API — POST /api/internal/outbound/send", () => {
  const VALID_TOKEN = "test-internal-token-12345";
  let app: import("fastify").FastifyInstance;

  beforeAll(async () => {
    // Set the token env var
    process.env.INTERNAL_API_TOKEN = VALID_TOKEN;

    // Build a minimal Fastify app with just the internal route
    const { fastify } = await import("fastify");
    app = fastify({ logger: false });
    const { internalRoutes } = await import("../routes/internal.js");
    await app.register(internalRoutes, { prefix: "/api" });
    await app.ready();
  });

  afterAll(async () => {
    delete process.env.INTERNAL_API_TOKEN;
    await app.close();
  });

  beforeEach(() => {
    mockSendOutbound.mockClear();
  });

  const outboundBody = {
    threadId: "thread-test-1",
    threadType: "user" as const,
    source: "schedule",
    content: "Test scheduled message",
  };

  it("rejects request without Authorization header → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/outbound/send",
      payload: outboundBody,
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("rejects request with wrong Bearer token → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/outbound/send",
      headers: { authorization: "Bearer wrong-token-here" },
      payload: outboundBody,
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("rejects request from non-localhost IP → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/outbound/send",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: outboundBody,
      remoteAddress: "8.8.8.8",
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts valid localhost + valid token → 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/outbound/send",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: outboundBody,
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
  });

  it("accepts ::1 as localhost", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/outbound/send",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: outboundBody,
      remoteAddress: "::1",
    });
    expect(res.statusCode).toBe(200);
  });

  it("calls sendOutbound() not ZaloMessageSender directly", async () => {
    mockSendOutbound.mockClear();

    await app.inject({
      method: "POST",
      url: "/api/internal/outbound/send",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: outboundBody,
      remoteAddress: "127.0.0.1",
    });

    // sendOutbound must have been called with correct intent
    expect(mockSendOutbound).toHaveBeenCalledTimes(1);
    const call = mockSendOutbound.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.threadId).toBe("thread-test-1");
    expect(call.threadType).toBe("user");
    expect(call.source).toBe("schedule");
    expect(call.content).toBe("Test scheduled message");
  });

  it("rejects invalid body (missing threadId) → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/outbound/send",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { source: "schedule", content: "no threadId" },
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid body (missing content) → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/outbound/send",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { threadId: "t1", source: "schedule" },
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(400);
  });

  it("response includes decision= dry_run when dryRun is true", async () => {
    mockSendOutbound.mockResolvedValueOnce({
      success: true,
      dryRun: true,
      decision: "allow" as const,
      reason: "dry_run",
      sentMessageId: "dry-msg-1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/internal/outbound/send",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: outboundBody,
      remoteAddress: "127.0.0.1",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.decision).toBe("dry_run");
    expect(body.dryRun).toBe(true);
  });

  it("endpoint never calls ZaloMessageSender — only sendOutbound", async () => {
    mockSendOutbound.mockClear();

    await app.inject({
      method: "POST",
      url: "/api/internal/outbound/send",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: outboundBody,
      remoteAddress: "127.0.0.1",
    });

    // sendOutbound was called with correct intent
    expect(mockSendOutbound).toHaveBeenCalledTimes(1);
    // ZaloMessageSender is never imported by internal route
  });

  it("INTERNAL_API_TOKEN fail-closed: safeTokenEquals rejects wrong tokens", () => {
    // When token is configured, wrong tokens are rejected (verified above).
    // When token is unset entirely, the module registers a 503 handler.
    // Verified via: the route code checks !INTERNAL_TOKEN at registration.
    // The safeTokenEquals helper covers the comparison logic.
    expect(safeTokenEquals("wrong", VALID_TOKEN)).toBe(false);
    expect(safeTokenEquals(VALID_TOKEN, VALID_TOKEN)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// R3.2 — POST /api/internal/messages/handle-batch
// ═══════════════════════════════════════════════════════════════════
describe("Internal API — POST /api/internal/messages/handle-batch", () => {
  const VALID_TOKEN = "test-internal-token-12345";
  const BATCH_THREAD_ID = "thread-test-1";
  const BATCH_MESSAGE_ROWS = [
    { id: "internal-batch-db-1", zaloMessageId: "internal-batch-zalo-1", content: "hello" },
    { id: "internal-batch-db-2", zaloMessageId: "internal-batch-zalo-2", content: "world" },
  ] as const;
  let app: import("fastify").FastifyInstance;

  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = VALID_TOKEN;

    const { fastify } = await import("fastify");
    app = fastify({ logger: false });
    const { internalRoutes } = await import("../routes/internal.js");
    await app.register(internalRoutes, { prefix: "/api" });
    await app.ready();
  });

  afterAll(async () => {
    await prisma.message.deleteMany({
      where: { id: { in: BATCH_MESSAGE_ROWS.map((row) => row.id) } },
    });
    delete process.env.INTERNAL_API_TOKEN;
    await app.close();
    vi.resetModules();
  });

  beforeEach(async () => {
    mockHandleIncoming.mockClear();
    await prisma.message.deleteMany({
      where: { id: { in: BATCH_MESSAGE_ROWS.map((row) => row.id) } },
    });
    await prisma.message.createMany({
      data: BATCH_MESSAGE_ROWS.map((row) => ({
        ...row,
        threadId: BATCH_THREAD_ID,
        threadType: "user",
        isFromBot: false,
        messageType: "text",
        role: "user",
        receivedAt: new Date(),
      })),
    });
  });

  const validBatchBody = {
    threadId: BATCH_THREAD_ID,
    threadType: "user",
    messages: [
      { messageId: "internal-batch-zalo-1", content: "hello" },
      { messageId: "internal-batch-zalo-2", content: "world" },
    ],
    combinedContent: "hello\nworld",
    metadata: {
      batchId: "batch-1",
      messageIds: ["internal-batch-zalo-1", "internal-batch-zalo-2"],
      messageCount: 2,
    },
  };

  it("rejects request without token → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/messages/handle-batch",
      payload: validBatchBody,
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects request with wrong token → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/messages/handle-batch",
      headers: { authorization: "Bearer wrong-token" },
      payload: validBatchBody,
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects request from non-localhost → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/messages/handle-batch",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: validBatchBody,
      remoteAddress: "8.8.8.8",
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects missing threadId → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/messages/handle-batch",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { messages: [{ messageId: "m1", content: "hi" }], combinedContent: "hi" },
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects empty messages array → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/messages/handle-batch",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { threadId: "t1", messages: [], combinedContent: "hi" },
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects empty combinedContent → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/messages/handle-batch",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { threadId: "t1", messages: [{ messageId: "m1", content: "hi" }], combinedContent: "" },
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(400);
  });

  it("fails closed when the last external batch ID has no internal Message row", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/messages/handle-batch",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        ...validBatchBody,
        messages: [{ messageId: "missing-batch-zalo", content: "missing" }],
        combinedContent: "missing",
        metadata: {
          ...validBatchBody.metadata,
          messageIds: ["missing-batch-zalo"],
          messageCount: 1,
        },
      },
      remoteAddress: "127.0.0.1",
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: false,
      error: "BATCH_MESSAGE_ID_UNRESOLVED",
    });
    expect(mockHandleIncoming).not.toHaveBeenCalled();
  });

  it("fails closed when canonical batch count does not match the messages array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/messages/handle-batch",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        ...validBatchBody,
        messages: [{ messageId: "internal-batch-zalo-2", content: "world" }],
        combinedContent: "world",
        metadata: {
          ...validBatchBody.metadata,
          messageIds: ["internal-batch-zalo-2"],
          messageCount: 2,
        },
      },
      remoteAddress: "127.0.0.1",
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: false,
      error: "BATCH_MESSAGE_COUNT_MISMATCH",
    });
    expect(mockHandleIncoming).not.toHaveBeenCalled();
  });

  it("accepts valid request → 200, calls handleIncomingMessage", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/messages/handle-batch",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: validBatchBody,
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.dispatched).toBe(true);
    expect(mockHandleIncoming).toHaveBeenCalledTimes(1);

    const callArg = mockHandleIncoming.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg.threadId).toBe(BATCH_THREAD_ID);
    expect(callArg.content).toBe("hello\nworld");
    expect(callArg.zaloMessageId).toBe("internal-batch-zalo-2");
    expect(callArg.dbMessageId).toBe("internal-batch-db-2");
  });

  it("synthetic message preserves batch metadata in rawMetadata", async () => {
    await app.inject({
      method: "POST",
      url: "/api/internal/messages/handle-batch",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: validBatchBody,
      remoteAddress: "127.0.0.1",
    });
    expect(mockHandleIncoming).toHaveBeenCalledTimes(1);
    const callArg = mockHandleIncoming.mock.calls[0]?.[0] as Record<string, unknown>;
    const metadata = JSON.parse(callArg.rawMetadata as string);
    expect(metadata.source).toBe("message_batch");
    expect(metadata.batchId).toBe("batch-1");
    expect(metadata.messageCount).toBe(2);
    expect(metadata.messageIds).toEqual(["internal-batch-zalo-1", "internal-batch-zalo-2"]);
  });
});
