import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, it, vi } from "vitest";

import type { NormalizedMessage } from "../services/zalo-receive.js";

const THREAD_ID = "batch5-e2e-thread";
const SENDER_ID = "batch5-e2e-principal";
const ZALO_MESSAGE_ID = "batch5-e2e-inbound-zalo-id";
const FINAL_TEXT = "Mình đã đọc được tin nhắn gần đây trong luồng này.";
const RAW_MEMORY_SECRET = "sk-test-1234567890abcdef";
const RAW_PROVIDER_DETAIL = "provider-private-round-one-detail";

const harness = vi.hoisted(() => {
  const overrides: Record<string, string> = {
    HERMES_AGENT_BRIDGE_ENABLED: "false",
    MESSAGE_BATCHING_ENABLED: "false",
    RETRIEVAL_DISPATCHER_DRYRUN_ENABLED: "false",
    ZALO_AUTO_REPLY_ENABLED: "true",
    ZALO_AUTO_REPLY_DRY_RUN: "true",
    ZALO_AUTO_REPLY_ALLOWED_THREADS: "batch5-e2e-thread",
    ZALO_AUTO_REPLY_COOLDOWN_SECONDS: "0",
    ZALO_VISION_ENABLED: "false",
  };
  const originalEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    originalEnv[key] = process.env[key];
    process.env[key] = value;
  }
  return {
    originalEnv,
    providerAccessCalls: 0,
    providerSendCalls: 0,
    senderConstructCalls: 0,
    senderSendCalls: 0,
  };
});

vi.mock("../services/zalo-provider/zca-js-provider.js", () => ({
  getZaloProvider: () => {
    harness.providerAccessCalls += 1;
    return {
      sendMessage: async () => {
        harness.providerSendCalls += 1;
        return { success: false, error: "Zalo provider must be unreachable in this test" };
      },
    };
  },
}));

vi.mock("../services/zalo-message-sender.js", () => ({
  ZaloMessageSender: class {
    constructor() {
      harness.senderConstructCalls += 1;
    }

    async sendMessage() {
      harness.senderSendCalls += 1;
      return { success: false, error: "Zalo sender must be unreachable in this test" };
    }

    async sendImage() {
      harness.senderSendCalls += 1;
      return { success: false, error: "Zalo sender must be unreachable in this test" };
    }

    async sendFile() {
      harness.senderSendCalls += 1;
      return { success: false, error: "Zalo sender must be unreachable in this test" };
    }

    async sendVoice() {
      harness.senderSendCalls += 1;
      return { success: false, error: "Zalo sender must be unreachable in this test" };
    }
  },
}));

interface ProviderEnvelope {
  protocolVersion: string;
  request: {
    threadId: string;
    threadType: string;
    sender: { id: string | null; role: string };
    runtime: { dryRun: boolean; live: boolean };
    permissions: { canUseTools: boolean; allowedTools: string[] };
  };
  priorToolResults: Array<Record<string, unknown>>;
}

interface ProviderInteraction {
  method: string | undefined;
  url: string | undefined;
  request: ProviderEnvelope;
  response: Record<string, unknown>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function restoreHarnessEnv(): void {
  for (const [key, value] of Object.entries(harness.originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

it("runs the persisted structured read loop once, dry-runs outbound, and skips replay end to end", async () => {
  expect(process.env.NODE_ENV).toBe("test");
  expect(process.env.DATABASE_URL).toMatch(/^file:\.\/test-[A-Za-z0-9_-]+\.db$/);
  expect(process.env.ZALO_SESSION_DIR).toMatch(/[\\/]hermes-backend-tests-[^\\/]+[\\/]zalo-session$/);

  const interactions: ProviderInteraction[] = [];
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ProviderEnvelope;
    const providerResponse: Record<string, unknown> = body.priorToolResults.length === 0
      ? {
          text: RAW_PROVIDER_DETAIL,
          toolCalls: [{
            name: "memory.getRecentMessages",
            arguments: { threadId: THREAD_ID, limit: 10 },
          }],
        }
      : { text: FINAL_TEXT, confidence: 0.92, toolCalls: [] };

    interactions.push({
      method: request.method,
      url: request.url,
      request: body,
      response: providerResponse,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(providerResponse));
  });

  await new Promise<void>((resolve, reject) => {
    provider.once("error", reject);
    provider.listen(0, "127.0.0.1", () => {
      provider.off("error", reject);
      resolve();
    });
  });

  let resetBridge: (() => void) | undefined;
  let resetLegacyAdapter: (() => void) | undefined;
  let restoreBridgeFlag: (() => void) | undefined;

  try {
    const [
      { prisma },
      { cleanDatabase },
      { config },
      { AgentBridge },
      { HermesAdapter },
      { setAgentBridgeForTest },
      { ToolRegistry },
      { ToolGateway },
      { PrismaToolEvidenceSink },
      { registerMemoryTools },
      { saveIncomingMessage },
      { handleIncomingMessage },
      { setHermesChatAdapter, resetHermesChatAdapter },
    ] = await Promise.all([
      import("../db.js"),
      import("./shared-setup.js"),
      import("../config.js"),
      import("../services/agent-bridge/agent-bridge.js"),
      import("../services/agent-bridge/hermes-adapter.js"),
      import("../services/agent-bridge/index.js"),
      import("../services/tool-gateway/registry.js"),
      import("../services/tool-gateway/gateway.js"),
      import("../services/tool-gateway/evidence.js"),
      import("../services/tools/memory/index.js"),
      import("../services/zalo-receive.js"),
      import("../services/incoming-dispatcher.service.js"),
      import("../services/hermes-chat-adapter.js"),
    ]);

    await cleanDatabase();
    await Promise.all([
      prisma.toolCallRecord.deleteMany(),
      prisma.zaloActionRecord.deleteMany(),
      prisma.threadCooldown.deleteMany(),
      prisma.threadConversationState.deleteMany(),
      prisma.threadSetting.deleteMany(),
    ]);

    const mutableBridgeConfig = config.hermesAgentBridge as { enabled: boolean };
    expect(mutableBridgeConfig.enabled).toBe(false);
    mutableBridgeConfig.enabled = true;
    restoreBridgeFlag = () => {
      mutableBridgeConfig.enabled = false;
    };

    let legacyChatCalls = 0;
    setHermesChatAdapter({
      async generateReply() {
        legacyChatCalls += 1;
        throw new Error("HermesChat fallback must be unreachable");
      },
    });
    resetLegacyAdapter = resetHermesChatAdapter;

    const registry = new ToolRegistry();
    registerMemoryTools(registry);
    const gateway = new ToolGateway({
      registry,
      evidence: new PrismaToolEvidenceSink(),
    });
    const address = provider.address() as AddressInfo;
    const bridge = new AgentBridge({
      adapter: new HermesAdapter({
        endpoint: `http://127.0.0.1:${address.port}/structured-agent`,
        protocolVersion: "batch5-e2e-v1",
        timeoutMs: 2_000,
      }),
      registry,
      gateway,
      allowedToolNames: ["memory.getRecentMessages"],
      maxRounds: 2,
      maxCallsPerRound: 1,
      perRoundTimeoutMs: 2_000,
      totalTimeoutMs: 5_000,
      hasScheduleEvidence: async () => false,
    });
    setAgentBridgeForTest(bridge);
    resetBridge = () => setAgentBridgeForTest(null);

    await prisma.zaloPrincipal.create({
      data: {
        principalId: SENDER_ID,
        type: "user",
        role: "basic_chat",
        status: "active",
        threadId: THREAD_ID,
        displayName: "Batch 5 E2E Principal",
      },
    });
    await prisma.message.create({
      data: {
        zaloMessageId: "batch5-e2e-history-zalo-id",
        threadId: THREAD_ID,
        threadType: "user",
        senderId: SENDER_ID,
        senderName: "Batch 5 E2E Principal",
        role: "user",
        messageType: "text",
        content: `Memory contains ${RAW_MEMORY_SECRET} and phone +84 912 345 678`,
      },
    });

    const inbound: NormalizedMessage = {
      zaloMessageId: ZALO_MESSAGE_ID,
      threadId: THREAD_ID,
      threadType: "user",
      senderId: SENDER_ID,
      senderName: "Batch 5 E2E Principal",
      content: "Hãy đọc các tin nhắn gần đây của tôi.",
      messageType: "text",
      identityConfidence: "high",
      identitySource: ["synthetic-e2e"],
      rawMetadata: JSON.stringify({ source: "batch5-e2e" }),
    };
    const persisted = await saveIncomingMessage(inbound, null);
    expect(persisted).toMatchObject({ saved: true });
    expect(persisted.dbMessageId).toBeTruthy();
    inbound.dbMessageId = persisted.dbMessageId;

    const firstDispatch = await handleIncomingMessage(inbound, null);
    expect(firstDispatch).toEqual({ dispatched: true });

    const storedInbound = await prisma.message.findUniqueOrThrow({
      where: { zaloMessageId: ZALO_MESSAGE_ID },
    });
    expect(storedInbound.id).toBe(persisted.dbMessageId);
    expect(inbound.dbMessageId).toBe(storedInbound.id);

    expect(interactions).toHaveLength(2);
    expect(interactions[0]).toMatchObject({
      method: "POST",
      url: "/structured-agent",
      request: {
        protocolVersion: "batch5-e2e-v1",
        priorToolResults: [],
        request: {
          threadId: THREAD_ID,
          threadType: "user",
          sender: { id: SENDER_ID, role: "basic_chat" },
          runtime: { dryRun: true, live: false },
          permissions: {
            canUseTools: true,
            allowedTools: ["memory.getRecentMessages"],
          },
        },
      },
      response: {
        text: RAW_PROVIDER_DETAIL,
        toolCalls: [{
          name: "memory.getRecentMessages",
          arguments: { threadId: THREAD_ID, limit: 10 },
        }],
      },
    });
    expect(interactions[1]!.response).toEqual({
      text: FINAL_TEXT,
      confidence: 0.92,
      toolCalls: [],
    });
    expect(interactions[1]!.request.priorToolResults).toHaveLength(1);
    const priorResultsJson = JSON.stringify(interactions[1]!.request.priorToolResults);
    expect(priorResultsJson).toContain("[REDACTED]");
    expect(priorResultsJson).not.toContain(RAW_MEMORY_SECRET);
    expect(priorResultsJson).not.toContain("+84 912 345 678");
    expect(priorResultsJson).not.toContain(RAW_PROVIDER_DETAIL);
    expect(JSON.stringify(interactions[1]!.request)).not.toContain(RAW_PROVIDER_DETAIL);
    expect(JSON.stringify(interactions[1]!.request)).not.toContain(RAW_MEMORY_SECRET);
    expect(JSON.stringify(interactions[1]!.request)).not.toContain("+84 912 345 678");

    const toolCalls = await prisma.toolCallRecord.findMany();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      agentName: "hermes",
      toolName: "memory.getRecentMessages",
      kind: "read",
      threadId: THREAD_ID,
      threadType: "user",
      principalId: SENDER_ID,
      role: "basic_chat",
      executionStatus: "success",
      deliveryStatus: "not_applicable",
      relatedMessageId: storedInbound.id,
    });
    expect(toolCalls[0]!.agentTaskId).toBeTruthy();
    expect(toolCalls[0]!.resultRedacted).toContain("[REDACTED]");
    expect(toolCalls[0]!.resultRedacted).not.toContain(RAW_MEMORY_SECRET);
    expect(toolCalls[0]!.resultRedacted).not.toContain("+84 912 345 678");

    const tasks = await prisma.agentTask.findMany();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      agentName: "hermes",
      taskType: "zalo_auto_reply",
      status: "completed",
      messageId: storedInbound.id,
    });
    expect(toolCalls[0]!.agentTaskId).toBe(tasks[0]!.id);
    const taskResult = JSON.parse(tasks[0]!.result ?? "{}") as Record<string, unknown>;
    expect(taskResult).toMatchObject({
      confidence: 0.92,
      rounds: 1,
      toolEvidenceIds: [toolCalls[0]!.id],
      dryRun: true,
      sendSuccess: true,
    });

    const assistants = await prisma.message.findMany({ where: { role: "assistant" } });
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({
      threadId: THREAD_ID,
      threadType: "user",
      content: FINAL_TEXT,
      isFromBot: true,
      relatedMessageId: storedInbound.id,
    });

    const outbound = await prisma.outboundRecord.findMany();
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toMatchObject({
      threadId: THREAD_ID,
      threadType: "user",
      content: FINAL_TEXT,
      source: "agent_tool",
      dryRun: true,
      decision: "allow",
      reason: "dry_run",
      inboundMessageId: storedInbound.id,
    });
    expect(outbound[0]!.sentMessageId).toMatch(/^dry-run-/);
    expect(taskResult).toMatchObject({
      outboundRecordId: outbound[0]!.id,
      assistantMessageId: assistants[0]!.id,
      sentMessageId: outbound[0]!.sentMessageId,
    });
    expect(JSON.parse(assistants[0]!.metadata ?? "{}")).toMatchObject({
      taskId: tasks[0]!.id,
      status: "dryRun",
      outboundRecordId: outbound[0]!.id,
      sentMessageId: outbound[0]!.sentMessageId,
    });

    expect(legacyChatCalls).toBe(0);
    expect(harness.senderConstructCalls).toBe(0);
    expect(harness.senderSendCalls).toBe(0);
    expect(harness.providerAccessCalls).toBe(0);
    expect(harness.providerSendCalls).toBe(0);

    const replay: NormalizedMessage = { ...inbound, dbMessageId: undefined };
    const replayPersistence = await saveIncomingMessage(replay, null);
    expect(replayPersistence).toMatchObject({
      saved: false,
      reason: expect.stringContaining("dedup"),
      dbMessageId: storedInbound.id,
    });
    replay.dbMessageId = replayPersistence.dbMessageId;

    const rawLookupError = "raw outbound lookup secret sk-test-abcdef1234567890";
    const originalFindUnique = prisma.outboundRecord.findUnique.bind(prisma.outboundRecord);
    const lookupFailure = vi
      .spyOn(prisma.outboundRecord, "findUnique")
      .mockRejectedValueOnce(new Error(rawLookupError));
    let failedLookupDispatch: Awaited<ReturnType<typeof handleIncomingMessage>>;
    try {
      failedLookupDispatch = await handleIncomingMessage(replay, null);
    } finally {
      lookupFailure.mockRestore();
      Object.defineProperty(prisma.outboundRecord, "findUnique", {
        configurable: true,
        writable: true,
        value: originalFindUnique,
      });
    }
    expect(failedLookupDispatch).toEqual({
      dispatched: false,
      reason: "agent_bridge_idempotency_error",
    });
    expect(JSON.stringify(failedLookupDispatch)).not.toContain(rawLookupError);
    expect(interactions).toHaveLength(2);
    expect(await prisma.agentTask.count()).toBe(1);
    expect(await prisma.toolCallRecord.count()).toBe(1);
    expect(await prisma.message.count({ where: { role: "assistant" } })).toBe(1);
    expect(await prisma.outboundRecord.count()).toBe(1);

    const replayDispatch = await handleIncomingMessage(replay, null);
    expect(replayDispatch).toEqual({
      dispatched: false,
      reason: "duplicate_idempotency",
    });
    expect(interactions).toHaveLength(2);
    expect(await prisma.agentTask.count()).toBe(1);
    expect(await prisma.toolCallRecord.count()).toBe(1);
    expect(await prisma.message.count({ where: { role: "assistant" } })).toBe(1);
    expect(await prisma.outboundRecord.count()).toBe(1);
    expect(harness.senderConstructCalls).toBe(0);
    expect(harness.senderSendCalls).toBe(0);
    expect(harness.providerAccessCalls).toBe(0);
    expect(harness.providerSendCalls).toBe(0);
  } finally {
    resetBridge?.();
    resetLegacyAdapter?.();
    restoreBridgeFlag?.();
    provider.closeAllConnections();
    await closeServer(provider);
    restoreHarnessEnv();
  }
});
