// =============================================================================
// Batch 1 backend safety — route boundary validation
// =============================================================================

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const mockTestDM = vi.hoisted(() => vi.fn().mockResolvedValue({ allowed: true }));
const mockSetRuntimeConfig = vi.hoisted(() => vi.fn());
const mockListThreadSettings = vi.hoisted(() => vi.fn());
const mockZaloThreadFindMany = vi.hoisted(() => vi.fn());
const mockMessageFindMany = vi.hoisted(() => vi.fn());
const mockMessageGroupBy = vi.hoisted(() => vi.fn());
const mockUpdateThreadSettings = vi.hoisted(() => vi.fn().mockResolvedValue({
  threadId: "thread-1",
  autoReplyEnabled: true,
  groupMentionRequired: true,
  groupReplyWindowSeconds: 600,
  allowCreateReminder: true,
  allowMedia: false,
  allowImageUnderstanding: false,
  allowDocumentUnderstanding: false,
  notes: null,
}));

vi.mock("../services/zalo-ops.service.js", () => ({
  testDM: mockTestDM,
}));

vi.mock("../services/thread-settings.service.js", () => ({
  peekThreadSettings: vi.fn(),
  updateThreadSettings: mockUpdateThreadSettings,
  listThreadSettings: mockListThreadSettings,
}));

vi.mock("../services/zalo-gateway.service.js", () => ({
  getZaloGateway: vi.fn(() => ({
    getStatus: vi.fn(() => ({ connected: false, selfUserId: null, lastError: null })),
  })),
}));

vi.mock("../services/zalo-receive.js", () => ({
  listThreads: vi.fn(),
  listMessages: vi.fn(),
}));

vi.mock("../services/outbound-dispatcher.service.js", () => ({
  sendOutbound: vi.fn(),
}));

vi.mock("../services/runtime-config.service.js", () => ({
  getCurrentEffectiveDryRun: vi.fn(() => true),
  setRuntimeConfig: mockSetRuntimeConfig,
  getAllRuntimeSettings: vi.fn(),
  setRuntimeSetting: vi.fn(),
  getSettingMeta: vi.fn(),
}));

vi.mock("../db.js", () => ({
  prisma: {
    zaloThread: { findMany: mockZaloThreadFindMany },
    message: { findMany: mockMessageFindMany, groupBy: mockMessageGroupBy },
  },
}));

describe("Batch 1 — /zalo/ops/test-dm boundary", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { zaloRoutes } = await import("../routes/zalo.js");
    app = Fastify({ logger: false });
    await app.register(zaloRoutes, { prefix: "/api" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockTestDM.mockClear();
  });

  it("rejects a missing threadId with a canonical 400 before calling the service", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/zalo/ops/test-dm",
      payload: { content: "hello" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "VALIDATION_ERROR", message: "threadId is required" },
    });
    expect(mockTestDM).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only threadId with a canonical 400 before calling the service", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/zalo/ops/test-dm",
      payload: { threadId: "  \t  ", content: "hello" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "VALIDATION_ERROR", message: "threadId is required" },
    });
    expect(mockTestDM).not.toHaveBeenCalled();
  });
});

describe("Batch 1 — PATCH /threads/:threadId/settings boundary", () => {
  let patchHandler: ((request: any, reply: any) => Promise<unknown>) | undefined;

  beforeAll(async () => {
    const handlers: Record<string, (request: any, reply: any) => Promise<unknown>> = {};
    const fakeApp = {
      get: vi.fn(),
      patch: (path: string, handler: (request: any, reply: any) => Promise<unknown>) => {
        handlers[path] = handler;
      },
      delete: vi.fn(),
    };
    const { threadSettingsRoutes } = await import("../routes/thread-settings.js");
    await threadSettingsRoutes(fakeApp as never);
    patchHandler = handlers["/threads/:threadId/settings"];
  });

  beforeEach(() => {
    mockUpdateThreadSettings.mockClear();
  });

  function replyStub() {
    const reply: any = {
      status: vi.fn(),
      send: vi.fn(),
    };
    reply.status.mockReturnValue(reply);
    return reply;
  }

  async function invoke(body: unknown, threadId = "thread-1") {
    if (!patchHandler) throw new Error("PATCH handler was not registered");
    const reply = replyStub();
    await patchHandler({ params: { threadId }, body }, reply);
    return reply;
  }

  it.each([
    ["autoReplyEnabled", { autoReplyEnabled: "true" }],
    ["groupMentionRequired", { groupMentionRequired: 1 }],
    ["allowCreateReminder", { allowCreateReminder: null }],
    ["allowMedia", { allowMedia: "false" }],
    ["allowImageUnderstanding", { allowImageUnderstanding: 1 }],
    ["allowDocumentUnderstanding", { allowDocumentUnderstanding: "false" }],
  ])("rejects a non-boolean %s field", async (_field, body) => {
    const reply = await invoke(body);
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
    }));
    expect(mockUpdateThreadSettings).not.toHaveBeenCalled();
  });

  it("rejects a non-string notes value", async () => {
    const reply = await invoke({ notes: 123 });
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
    }));
    expect(mockUpdateThreadSettings).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects a non-finite groupReplyWindowSeconds value (%s)",
    async (value) => {
      const reply = await invoke({ groupReplyWindowSeconds: value });
      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
      }));
      expect(mockUpdateThreadSettings).not.toHaveBeenCalled();
    },
  );

  it("rejects a negative groupReplyWindowSeconds value", async () => {
    const reply = await invoke({ groupReplyWindowSeconds: -1 });
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(mockUpdateThreadSettings).not.toHaveBeenCalled();
  });

  it("rejects a fractional groupReplyWindowSeconds value", async () => {
    const reply = await invoke({ groupReplyWindowSeconds: 0.5 });
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
    }));
    expect(mockUpdateThreadSettings).not.toHaveBeenCalled();
  });

  it("rejects an empty settings patch without creating defaults", async () => {
    const reply = await invoke({});

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
    }));
    expect(mockUpdateThreadSettings).not.toHaveBeenCalled();
  });

  it.each([2_147_483_648, Number.MAX_SAFE_INTEGER])(
    "rejects groupReplyWindowSeconds outside the Prisma Int range (%s)",
    async (value) => {
      const reply = await invoke({ groupReplyWindowSeconds: value });

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
      }));
      expect(mockUpdateThreadSettings).not.toHaveBeenCalled();
    },
  );

  it("accepts the maximum Prisma Int value", async () => {
    await invoke({ groupReplyWindowSeconds: 2_147_483_647 });

    expect(mockUpdateThreadSettings).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({ groupReplyWindowSeconds: 2_147_483_647 }),
    );
  });

  it.each(["", "   ", "\t"])("rejects an invalid threadId (%j)", async (threadId) => {
    const reply = await invoke({ autoReplyEnabled: true }, threadId);
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
    }));
    expect(mockUpdateThreadSettings).not.toHaveBeenCalled();
  });

  it("rejects a non-plain object body", async () => {
    const reply = await invoke(new Date());
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(mockUpdateThreadSettings).not.toHaveBeenCalled();
  });

  it("accepts allowDocumentUnderstanding as a declared boolean field", async () => {
    await invoke({ allowDocumentUnderstanding: true });
    expect(mockUpdateThreadSettings).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({ allowDocumentUnderstanding: true }),
    );
  });

  it("normalizes a valid threadId before updating settings", async () => {
    await invoke({ autoReplyEnabled: true }, "  thread-1  ");
    expect(mockUpdateThreadSettings).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({ autoReplyEnabled: true }),
    );
  });
});

describe("Batch 1 - GET /threads/settings boundary", () => {
  let getHandler: ((request: any, reply: any) => Promise<unknown>) | undefined;

  beforeAll(async () => {
    const handlers: Record<string, (request: any, reply: any) => Promise<unknown>> = {};
    const fakeApp = {
      get: (path: string, handler: (request: any, reply: any) => Promise<unknown>) => {
        handlers[path] = handler;
      },
      patch: vi.fn(),
      delete: vi.fn(),
    };
    const { threadSettingsRoutes } = await import("../routes/thread-settings.js");
    await threadSettingsRoutes(fakeApp as never);
    getHandler = handlers["/threads/settings"];
  });

  beforeEach(() => {
    mockListThreadSettings.mockReset();
    mockZaloThreadFindMany.mockReset();
    mockMessageFindMany.mockReset();
    mockMessageGroupBy.mockReset();
  });

  function replyStub() {
    const reply: any = { status: vi.fn(), send: vi.fn() };
    reply.status.mockReturnValue(reply);
    return reply;
  }

  async function invoke(query: Record<string, unknown>) {
    if (!getHandler) throw new Error("GET handler was not registered");
    const reply = replyStub();
    const result = await getHandler({ query }, reply);
    return { reply, result };
  }

  it.each([
    ["fractional page", { page: "1.5" }],
    ["trailing junk in pageSize", { pageSize: "100junk" }],
    ["unsafe page integer", { page: "9007199254740992" }],
  ])("rejects %s before listing or querying evidence", async (_case, query) => {
    const { reply } = await invoke(query);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: "VALIDATION_ERROR",
        message: "page must be >= 1 and pageSize must be 1-100",
      },
    });
    expect(mockListThreadSettings).not.toHaveBeenCalled();
    expect(mockZaloThreadFindMany).not.toHaveBeenCalled();
    expect(mockMessageFindMany).not.toHaveBeenCalled();
    expect(mockMessageGroupBy).not.toHaveBeenCalled();
  });

  it("uses grouped message evidence and preserves unknown inference semantics", async () => {
    const threadIds = [
      "consistent",
      "zalo-only",
      "conflict",
      "invalid-zalo",
      "invalid-message",
      "message-only",
      "no-evidence",
    ];
    const messageEvidence = [
      { threadId: "consistent", threadType: "user" },
      { threadId: "conflict", threadType: "user" },
      { threadId: "invalid-zalo", threadType: "user" },
      { threadId: "invalid-message", threadType: "invalid" },
      { threadId: "message-only", threadType: "group" },
    ];
    mockListThreadSettings.mockResolvedValue({
      data: threadIds.map((threadId) => ({ threadId })),
      total: threadIds.length,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
    mockZaloThreadFindMany.mockResolvedValue([
      { id: "consistent", type: "user" },
      { id: "zalo-only", type: "group" },
      { id: "conflict", type: "group" },
      { id: "invalid-zalo", type: "invalid" },
      { id: "invalid-message", type: "user" },
    ]);
    mockMessageFindMany.mockResolvedValue(messageEvidence);
    mockMessageGroupBy.mockResolvedValue(messageEvidence);

    const { reply, result } = await invoke({});

    expect(reply.status).not.toHaveBeenCalled();
    expect(mockListThreadSettings).toHaveBeenCalledWith(1, 50);
    expect(mockMessageGroupBy).toHaveBeenCalledWith({
      by: ["threadId", "threadType"],
      where: { threadId: { in: threadIds } },
    });
    expect(mockMessageFindMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      data: [
        { threadId: "consistent", threadType: "user" },
        { threadId: "zalo-only", threadType: "group" },
        { threadId: "conflict", threadType: "unknown" },
        { threadId: "invalid-zalo", threadType: "unknown" },
        { threadId: "invalid-message", threadType: "unknown" },
        { threadId: "message-only", threadType: "group" },
        { threadId: "no-evidence", threadType: "unknown" },
      ],
    });
  });
});

describe("Batch 1 - PATCH /system/runtime-config/auto-reply boundary", () => {
  let patchHandler: ((request: any, reply: any) => Promise<unknown>) | undefined;

  beforeAll(async () => {
    const handlers: Record<string, (request: any, reply: any) => Promise<unknown>> = {};
    const fakeApp = {
      get: vi.fn(),
      patch: (path: string, ...args: unknown[]) => {
        handlers[path] = args.at(-1) as (request: any, reply: any) => Promise<unknown>;
      },
      post: vi.fn(),
    };
    const { systemRoutes } = await import("../routes/system.js");
    await systemRoutes(fakeApp as never);
    patchHandler = handlers["/system/runtime-config/auto-reply"];
  });

  beforeEach(() => {
    mockSetRuntimeConfig.mockClear();
  });

  it.each([
    ["missing", {}],
    ["string", { dryRun: "true" }],
    ["null", { dryRun: null }],
  ])("rejects a %s dryRun with a canonical 400 before calling the service", async (_case, body) => {
    if (!patchHandler) throw new Error("PATCH handler was not registered");
    const reply: any = { status: vi.fn(), send: vi.fn() };
    reply.status.mockReturnValue(reply);

    await patchHandler({ body, headers: {}, ip: "127.0.0.1" }, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: "MISSING_DRYRUN",
        message: "dryRun (boolean) is required",
      },
    });
    expect(mockSetRuntimeConfig).not.toHaveBeenCalled();
  });
});
