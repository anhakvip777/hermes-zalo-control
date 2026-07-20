// =============================================================================
// Batch 3 public-boundary regression tests
// Thread Settings read-only/validation + disabled-dashboard media contract
// =============================================================================

import { resolve } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db.js";

const { mockListMessages, mockSendOutbound } = vi.hoisted(() => ({
  mockListMessages: vi.fn(),
  mockSendOutbound: vi.fn(),
}));

vi.mock("../services/zalo-receive.js", () => ({
  listMessages: (...args: unknown[]) => mockListMessages(...args),
  listThreads: vi.fn().mockResolvedValue({
    data: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 0,
  }),
}));

vi.mock("../services/outbound-dispatcher.service.js", () => ({
  sendOutbound: (...args: unknown[]) => mockSendOutbound(...args),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const Fastify = (await import("fastify")).default;
  const { threadSettingsRoutes } = await import("../routes/thread-settings.js");
  const { zaloRoutes } = await import("../routes/zalo.js");
  const { agentRoutes } = await import("../routes/agent.js");

  app = Fastify({ logger: false });
  await app.register(threadSettingsRoutes, { prefix: "/api" });
  await app.register(zaloRoutes, { prefix: "/api" });
  await app.register(agentRoutes, { prefix: "/api" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  mockListMessages.mockReset().mockResolvedValue({
    data: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 0,
  });
  mockSendOutbound.mockReset().mockResolvedValue({
    success: true,
    dryRun: true,
    decision: "allow",
    reason: "dry_run",
    sentMessageId: "dry-run-image-test",
  });

  await prisma.message.deleteMany();
  await prisma.zaloThread.deleteMany();
  await prisma.threadSetting.deleteMany();
});

describe("Thread Settings HTTP boundary", () => {
  it("GET computes defaults without creating a ThreadSetting row", async () => {
    expect(await prisma.threadSetting.count()).toBe(0);

    const response = await app.inject({
      method: "GET",
      url: "/api/threads/thread-read-only/settings?threadType=user",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        threadId: "thread-read-only",
        threadType: "user",
        configured: false,
      },
    });
    expect(await prisma.threadSetting.count()).toBe(0);
  });

  it("GET list reports conflicting thread-type evidence as unknown", async () => {
    await prisma.threadSetting.create({ data: { threadId: "thread-conflict" } });
    await prisma.zaloThread.create({ data: { id: "thread-conflict", type: "user" } });
    await prisma.message.create({
      data: {
        threadId: "thread-conflict",
        threadType: "group",
        content: "conflicting type evidence",
        role: "user",
      },
    });

    const response = await app.inject({ method: "GET", url: "/api/threads/settings" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: [{ threadId: "thread-conflict", threadType: "unknown" }],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
  });

  it.each([
    ["page zero", "/api/threads/settings?page=0"],
    ["page malformed", "/api/threads/settings?page=1x"],
    ["page unsafe", "/api/threads/settings?page=999999999999999999999"],
    ["pageSize zero", "/api/threads/settings?pageSize=0"],
    ["pageSize decimal", "/api/threads/settings?pageSize=1.5"],
    ["pageSize too large", "/api/threads/settings?pageSize=101"],
  ])("rejects invalid list pagination: %s", async (_caseName, url) => {
    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("rejects a blank GET threadId without creating settings", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/threads/%20/settings",
    });

    expect(response.statusCode).toBe(400);
    expect(await prisma.threadSetting.count()).toBe(0);
  });

  it("rejects a blank PATCH threadId before writing", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/threads/%20/settings",
      payload: { autoReplyEnabled: false },
    });

    expect(response.statusCode).toBe(400);
    expect(await prisma.threadSetting.count()).toBe(0);
  });

  it.each([
    ["null body", "null"],
    ["array body", "[]"],
    ["empty object", "{}"],
    ["unknown field", JSON.stringify({ unsupported: true })],
    ["wrong autoReplyEnabled", JSON.stringify({ autoReplyEnabled: "false" })],
    ["wrong groupMentionRequired", JSON.stringify({ groupMentionRequired: "false" })],
    ["wrong allowCreateReminder", JSON.stringify({ allowCreateReminder: "false" })],
    ["wrong allowMedia", JSON.stringify({ allowMedia: "false" })],
    ["wrong allowImageUnderstanding", JSON.stringify({ allowImageUnderstanding: "false" })],
    ["wrong allowDocumentUnderstanding", JSON.stringify({ allowDocumentUnderstanding: "false" })],
    ["fractional window", JSON.stringify({ groupReplyWindowSeconds: 1.5 })],
    ["negative window", JSON.stringify({ groupReplyWindowSeconds: -1 })],
    ["wrong notes", JSON.stringify({ notes: 123 })],
  ])("rejects malformed PATCH payload: %s", async (_caseName, payload) => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/threads/thread-patch/settings",
      headers: { "content-type": "application/json" },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(await prisma.threadSetting.count()).toBe(0);
  });
});

describe("Media send HTTP boundary", () => {
  const safeServerPath = resolve(config.zalo.mediaAllowedBaseDir, "batch3-test.png");

  it("does not report a blocked dry-run as success", async () => {
    mockSendOutbound.mockResolvedValueOnce({
      success: false,
      dryRun: true,
      decision: "block",
      reason: "permission_denied",
      sentMessageId: null,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/zalo/send-media",
      payload: {
        type: "image",
        path: safeServerPath,
        threadId: "thread-media",
        threadType: "user",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: false, decision: "block", dryRun: true });
  });

  it.each([
    ["null", "null"],
    ["array", "[]"],
  ])("rejects a %s payload before the dispatcher", async (_caseName, payload) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/zalo/send-media",
      headers: { "content-type": "application/json" },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(mockSendOutbound).not.toHaveBeenCalled();
  });

  it("rejects the legacy blob/mediaUrl contract before the dispatcher", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/zalo/send-media",
      payload: {
        mediaType: "image",
        mediaUrl: "blob:http://127.0.0.1/legacy-object-url",
        blob: true,
        threadId: "thread-media",
        threadType: "user",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(mockSendOutbound).not.toHaveBeenCalled();
  });

  it.each([
    ["blank type", { type: "", path: safeServerPath, threadId: "thread-media", threadType: "user" }],
    ["blank path", { type: "image", path: " ", threadId: "thread-media", threadType: "user" }],
    ["blank threadId", { type: "image", path: safeServerPath, threadId: " ", threadType: "user" }],
    ["blank threadType", { type: "image", path: safeServerPath, threadId: "thread-media", threadType: "" }],
  ])("rejects %s before the dispatcher", async (_caseName, payload) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/zalo/send-media",
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(mockSendOutbound).not.toHaveBeenCalled();
  });
});

describe("Messages HTTP pagination boundary", () => {
  it.each([
    ["page zero", "/api/agent/messages?page=0"],
    ["page malformed", "/api/agent/messages?page=nope"],
    ["page unsafe", "/api/agent/messages?page=999999999999999999999"],
    ["pageSize zero", "/api/agent/messages?pageSize=0"],
    ["pageSize decimal", "/api/agent/messages?pageSize=1.5"],
    ["pageSize too large", "/api/agent/messages?pageSize=101"],
  ])("rejects invalid pagination: %s", async (_caseName, url) => {
    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(mockListMessages).not.toHaveBeenCalled();
  });

  it("passes validated pagination to listMessages", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/agent/messages?page=2&pageSize=25&threadId=thread-a&search=hello",
    });

    expect(response.statusCode).toBe(200);
    expect(mockListMessages).toHaveBeenCalledWith({
      threadId: "thread-a",
      search: "hello",
      page: 2,
      pageSize: 25,
    });
  });
});
