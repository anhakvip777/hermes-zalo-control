// =============================================================================
// IncomingDispatcher tests
// =============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockHeartbeatOk = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/heartbeat.service.js", () => ({
  heartbeatOk: (...args: unknown[]) => mockHeartbeatOk(...args),
}));

const mockAnswerRetrieval = vi.fn();
vi.mock("../services/retrieval-answer.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/retrieval-answer.service.js")>();
  return {
    ...actual,
    answerRetrieval: (...args: unknown[]) => mockAnswerRetrieval(...args),
  };
});

const mockShouldSendLiveForThread = vi.fn().mockResolvedValue({ live: false });
vi.mock("../services/live-test.service.js", () => ({
  shouldSendLiveForThread: (...args: unknown[]) => mockShouldSendLiveForThread(...args),
}));

vi.mock("../config.js", () => ({
  config: {
    autoReply: {
      enabled: true,
      dryRun: true,
      allowedThreads: ["thread-allowed", "group-allowed"],
      cooldownSeconds: 10,
      groupReplyWindowSeconds: 600,
    },
    hermesChat: {
      adapter: "mock",
      mode: "http",
      endpoint: "",
      cliBin: "",
      timeoutMs: 30000,
      cliTimeoutMs: 60000,
      minConfidence: 0.5,
    },
    zalo: { dryRun: false },
    hermesAgentBridge: { enabled: false },
    messageBatching: { enabled: false, windowMs: 4000, maxMessages: 5, maxChars: 3000, threadTypes: ["user"] },
    document: { enabled: false, allowedBaseDir: "/tmp/test", processedDir: "/tmp/test/processed", maxSizeMB: 50, allowedExtensions: ["pdf", "txt"], doclingBin: "/bin/true", doclingTimeoutMs: 60000, doclingKillGraceMs: 5000, doclingMaxOutputBytes: 1048576, chunkSize: 1200, chunkOverlap: 150 },
    vision: { enabled: false },
    retrieval: { dispatcherDryRunEnabled: false },
  },
}));

// Mock prisma for DB evidence checks (system claim guard + schedule pre-fetch)
const mockPrismaFindFirst = vi.fn().mockResolvedValue(null);
const mockPrismaFindMany = vi.fn().mockResolvedValue([]);
const mockScheduleFindMany = vi.fn().mockResolvedValue([]);
const mockMessageCreate = vi.fn().mockResolvedValue({ id: "assistant-1" });
const mockMessageFindUnique = vi.fn().mockResolvedValue({ metadata: "{}" });
const mockMessageFindMany = vi.fn().mockResolvedValue([]);
const mockMessageUpdate = vi.fn().mockResolvedValue({});
const mockDbTransaction = vi.fn();
vi.mock("../db.js", () => {
  // Inline to avoid hoisting issues with vitest
  const tcd = {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    findMany: vi.fn().mockResolvedValue([]),
  };
  return {
    prisma: {
      scheduleExecution: {
        findFirst: (...args: unknown[]) => mockPrismaFindFirst(...args),
        findMany: (...args: unknown[]) => mockPrismaFindMany(...args),
      },
      schedule: {
        findMany: (...args: unknown[]) => mockScheduleFindMany(...args),
      },
      message: {
        create: (...args: unknown[]) => mockMessageCreate(...args),
        findUnique: (...args: unknown[]) => mockMessageFindUnique(...args),
        findMany: (...args: unknown[]) => mockMessageFindMany(...args),
        update: (...args: unknown[]) => mockMessageUpdate(...args),
      },
      threadCooldown: tcd,
      $transaction: (...args: unknown[]) => mockDbTransaction(tcd, ...args),
    },
  };
});

const mockResolvePrincipal = vi.fn();
vi.mock("../services/principal.service.js", () => ({
  resolvePrincipal: (...args: unknown[]) => mockResolvePrincipal(...args),
  isBlocked: (status: string) => status === "blocked",
  checkPermission: vi.fn().mockReturnValue({ allowed: true, currentRole: "advanced" }),
  logPermissionDecision: vi.fn(),
}));

const mockBridgeRun = vi.fn();
const mockGetAgentBridge = vi.fn(() => ({
  run: (...args: unknown[]) => mockBridgeRun(...args),
}));
vi.mock("../services/agent-bridge/index.js", () => ({
  getAgentBridge: () => mockGetAgentBridge(),
}));

const mockSendMessage = vi.fn();
vi.mock("../services/zalo-message-sender.js", () => ({
  ZaloMessageSender: vi.fn().mockImplementation(() => ({
    sendMessage: mockSendMessage,
  })),
}));

const mockCreateTask = vi.fn();
const mockComplete = vi.fn();
const mockFail = vi.fn();
vi.mock("../services/agent-task.service.js", () => ({
  createAgentTask: (...args: unknown[]) => mockCreateTask(...args),
  markAgentTaskCompleted: (...args: unknown[]) => mockComplete(...args),
  markAgentTaskFailed: (...args: unknown[]) => mockFail(...args),
}));

const mockGenerateReply = vi.fn().mockResolvedValue({ reply: "Mock reply", confidence: 0.9 });

vi.mock("../services/hermes-chat-adapter.js", () => ({
  getHermesChatAdapter: () => ({
    generateReply: mockGenerateReply,
  }),
}));

// ── Mock thread settings service ──────────────────────────────────
vi.mock("../services/thread-settings.service.js", () => ({
  getThreadSettings: vi.fn().mockImplementation(
    (threadId: string, threadType: string) =>
      Promise.resolve({
        threadId,
        autoReplyEnabled: true,
        groupMentionRequired: threadType === "group",
        groupReplyWindowSeconds: 600,
        allowCreateReminder: true,
        allowMedia: false,
      }),
  ),
  updateThreadSettings: vi.fn(),
  listThreadSettings: vi.fn(),
}));

// ── Mock group safety service ─────────────────────────────────────
vi.mock("../services/group-safety.service.js", () => ({
  getGroupReplyWindow: vi.fn().mockReturnValue(Date.now() + 600_000),
  touchGroupReplyWindow: vi.fn(),
  closeGroupReplyWindow: vi.fn(),
  resetGroupReplyWindows: vi.fn(),
  getActiveReplyWindows: vi.fn().mockReturnValue([]),
  logGroupGateAudit: vi.fn(),
}));

vi.mock("../services/conversation-context.service.js", () => ({
  buildConversationContext: vi.fn().mockResolvedValue({
    threadId: "thread-allowed",
    threadType: "user",
    recentMessages: [],
    messageCount: 0,
    hasMore: false,
  }),
  buildContextString: vi.fn().mockReturnValue(""),
  saveOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

const mockSaveOutboundRecord = vi.fn().mockResolvedValue(undefined);
const mockFindOutboundByIdempotencyKey = vi.fn().mockResolvedValue(null);
const mockReserveOutboundRecord = vi.fn().mockResolvedValue("reserved-record-001");
const mockUpdateOutboundRecordById = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/outbound-guardrails.service.js", () => ({
  saveOutboundRecord: (...args: unknown[]) => mockSaveOutboundRecord(...args),
  getRecentSentContext: vi.fn().mockResolvedValue([]),
  splitLongMessage: vi.fn().mockImplementation((s: string) => [s]),
  sanitizeOutbound: vi.fn().mockImplementation((s: string) => s),
  findOutboundByIdempotencyKey: (...args: unknown[]) => mockFindOutboundByIdempotencyKey(...args),
  reserveOutboundRecord: (...args: unknown[]) => mockReserveOutboundRecord(...args),
  updateOutboundRecordById: (...args: unknown[]) => mockUpdateOutboundRecordById(...args),
  isUniqueViolation: vi.fn().mockReturnValue(false),
}));

vi.mock("../services/thread-conversation-state.service.js", () => ({
  getConversationState: vi.fn().mockResolvedValue(null),
  setConversationState: vi.fn().mockResolvedValue({}),
  clearConversationState: vi.fn().mockResolvedValue(undefined),
  tryFillSlot: vi.fn().mockReturnValue(null),
  isIntentComplete: vi.fn().mockReturnValue(false),
  buildStateContextString: vi.fn().mockReturnValue(""),
}));

// ...existing imports...

import {
  handleIncomingMessage,
  getAutoReplyStatus,
  resetAutoReplyCooldowns,
} from "../services/incoming-dispatcher.service.js";
import { config } from "../config.js";
import type { NormalizedMessage } from "../services/zalo-receive.js";

const baseMsg = (overrides: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  zaloMessageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
  dbMessageId: `db-msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
  threadId: "thread-allowed",
  threadType: "user",
  senderId: "sender-1",
  senderName: "Test User",
  content: "Xin chào",
  messageType: "text",
  rawMetadata: "{}",
  ...overrides,
});

async function flushAsyncImports(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetAutoReplyCooldowns();
  mockCreateTask.mockResolvedValue({ id: "task-1" });
  mockComplete.mockResolvedValue(undefined);
  mockFail.mockResolvedValue(undefined);
  mockSendMessage.mockResolvedValue({ success: true, messageId: "sent-1" });
  mockPrismaFindFirst.mockResolvedValue(null);
  mockPrismaFindMany.mockResolvedValue([]);
  mockScheduleFindMany.mockResolvedValue([]);
  mockMessageCreate.mockResolvedValue({ id: "assistant-1" });
  mockMessageFindUnique.mockResolvedValue({ metadata: "{}" });
  mockMessageFindMany.mockResolvedValue([]);
  mockMessageUpdate.mockResolvedValue({});
  mockDbTransaction.mockImplementation((threadCooldown, fn) => fn({ threadCooldown }));
  mockSaveOutboundRecord.mockResolvedValue(undefined);
  mockFindOutboundByIdempotencyKey.mockResolvedValue(null);
  mockReserveOutboundRecord.mockResolvedValue("reserved-record-001");
  mockUpdateOutboundRecordById.mockResolvedValue(undefined);
  mockResolvePrincipal.mockResolvedValue({
    principal: { principalId: "principal-db-default" },
    role: "advanced",
    status: "active",
    fromDb: true,
  });
  mockBridgeRun.mockResolvedValue({
    text: "Structured reply",
    confidence: 0.9,
    usedFallback: false,
    rounds: 1,
    toolResults: [],
  });
  mockAnswerRetrieval.mockResolvedValue({
    status: "found",
    answerText: "Legacy retrieval result",
    evidence: [{ messageId: "retrieval-evidence-1" }],
    confidence: "high",
  });
  mockShouldSendLiveForThread.mockResolvedValue({ live: false });
  config.hermesAgentBridge.enabled = false;
  config.retrieval.dispatcherDryRunEnabled = false;
});

describe("IncomingDispatcher", () => {
  it("skips when thread not in allowlist", async () => {
    const r = await handleIncomingMessage(baseMsg({ threadId: "thread-other" }));
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("thread_not_allowed");
  });

  it("skips empty content", async () => {
    const r = await handleIncomingMessage(baseMsg({ content: "   " }));
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("empty_content");
  });

  it("skips non-text messages", async () => {
    const r = await handleIncomingMessage(baseMsg({ messageType: "sticker" }));
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("non_text_message");
  });

  it("skips when threadId is empty", async () => {
    const r = await handleIncomingMessage(baseMsg({ threadId: "" }));
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("no_threadId");
  });

  it("dryRun=true creates completed AgentTask without sending", async () => {
    const r = await handleIncomingMessage(baseMsg({ zaloMessageId: "dry-1" }));
    expect(r.dispatched).toBe(true);
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).not.toHaveBeenCalled();
    const ca = mockComplete.mock.calls[0]?.[1];
    expect(ca).toHaveProperty("dryRun", true);
    expect(ca).toHaveProperty("replyPreview");
  });

  it("creates AgentTask with taskType=zalo_auto_reply", async () => {
    await handleIncomingMessage(baseMsg({ zaloMessageId: "type-1" }));
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: "zalo_auto_reply" }),
    );
  });

  it("includes message metadata in AgentTask input", async () => {
    await handleIncomingMessage(baseMsg({ zaloMessageId: "meta-1", content: "Hello" }));
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          threadId: "thread-allowed",
          contentPreview: "Hello",
        }),
      }),
    );
  });

  it("uses exact internal message/task/principal IDs for structured evidence and outbound linkage", async () => {
    config.hermesAgentBridge.enabled = true;
    mockResolvePrincipal.mockResolvedValueOnce({
      principal: { principalId: "principal-db-42" },
      role: "advanced",
      status: "active",
      fromDb: true,
    });

    await handleIncomingMessage(baseMsg({
      zaloMessageId: "zalo-external-42",
      dbMessageId: "message-db-42",
      senderId: "sender-external-42",
    }));

    expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "message-db-42",
    }));
    expect(mockBridgeRun).toHaveBeenCalledWith(expect.objectContaining({
      agentTaskId: "task-1",
      relatedMessageId: "message-db-42",
      principalId: "principal-db-42",
      role: "advanced",
      principalBlocked: false,
    }));
    expect(mockReserveOutboundRecord).toHaveBeenCalledWith(expect.objectContaining({
      inboundMessageId: "message-db-42",
    }));
    expect(mockCreateTask.mock.calls[0]?.[0]?.messageId).not.toBe("zalo-external-42");
    expect(mockBridgeRun.mock.calls[0]?.[0]?.relatedMessageId).not.toBe("zalo-external-42");
  });

  it("fails closed before principal/task/provider work when structured input lacks internal Message.id", async () => {
    config.hermesAgentBridge.enabled = true;
    config.retrieval.dispatcherDryRunEnabled = true;

    const result = await handleIncomingMessage(baseMsg({
      dbMessageId: undefined,
      content: "gửi tôi xyz-khong-ton-tai-999",
    }));
    await flushAsyncImports();

    expect(result).toEqual({
      dispatched: false,
      reason: "agent_bridge_internal_message_id_missing",
    });
    expect(mockHeartbeatOk).not.toHaveBeenCalled();
    expect(mockResolvePrincipal).not.toHaveBeenCalled();
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockBridgeRun).not.toHaveBeenCalled();
    expect(mockAnswerRetrieval).not.toHaveBeenCalled();
    expect(mockShouldSendLiveForThread).not.toHaveBeenCalled();
    expect(mockReserveOutboundRecord).not.toHaveBeenCalled();
  });

  it("fails closed before provider work for an incomplete structured reservation", async () => {
    config.hermesAgentBridge.enabled = true;
    mockFindOutboundByIdempotencyKey.mockResolvedValueOnce({
      id: "reserved-incomplete",
      decision: "allow",
      dryRun: true,
      sentMessageId: null,
      reason: "reserved",
    });

    const result = await handleIncomingMessage(baseMsg({ dbMessageId: "structured-reserved" }));
    await flushAsyncImports();

    expect(result).toEqual({
      dispatched: false,
      reason: "outbound_idempotency_incomplete",
    });
    expect(mockHeartbeatOk).not.toHaveBeenCalled();
    expect(mockResolvePrincipal).not.toHaveBeenCalled();
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockBridgeRun).not.toHaveBeenCalled();
    expect(mockReserveOutboundRecord).not.toHaveBeenCalled();
  });

  it("fails closed before provider work when finalized outbound lacks assistant evidence", async () => {
    config.hermesAgentBridge.enabled = true;
    mockFindOutboundByIdempotencyKey.mockResolvedValueOnce({
      id: "outbound-without-assistant",
      decision: "allow",
      dryRun: true,
      sentMessageId: "dry-run-finalized",
      reason: "dry_run",
    });
    mockMessageFindMany.mockResolvedValueOnce([]);

    const result = await handleIncomingMessage(baseMsg({ dbMessageId: "structured-no-assistant" }));
    await flushAsyncImports();

    expect(result).toEqual({
      dispatched: false,
      reason: "outbound_idempotency_incomplete",
    });
    expect(mockHeartbeatOk).not.toHaveBeenCalled();
    expect(mockResolvePrincipal).not.toHaveBeenCalled();
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockBridgeRun).not.toHaveBeenCalled();
  });

  it("skips a finalized structured replay only when linked assistant evidence exists", async () => {
    config.hermesAgentBridge.enabled = true;
    mockFindOutboundByIdempotencyKey.mockResolvedValueOnce({
      id: "outbound-finalized",
      decision: "allow",
      dryRun: true,
      sentMessageId: "dry-run-finalized",
      reason: "dry_run",
    });
    mockMessageFindMany.mockResolvedValueOnce([{
      id: "assistant-finalized",
      metadata: JSON.stringify({
        outboundRecordId: "outbound-finalized",
        sentMessageId: "dry-run-finalized",
        status: "dryRun",
      }),
    }]);

    const result = await handleIncomingMessage(baseMsg({ dbMessageId: "structured-finalized" }));
    await flushAsyncImports();

    expect(result).toEqual({ dispatched: false, reason: "duplicate_idempotency" });
    expect(mockHeartbeatOk).not.toHaveBeenCalled();
    expect(mockResolvePrincipal).not.toHaveBeenCalled();
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockBridgeRun).not.toHaveBeenCalled();
  });

  it("lets structured AgentBridge exclusively own a retrieval-shaped turn when both flags are on", async () => {
    config.hermesAgentBridge.enabled = true;
    config.retrieval.dispatcherDryRunEnabled = true;

    const result = await handleIncomingMessage(baseMsg({
      zaloMessageId: "structured-retrieval-zalo",
      dbMessageId: "structured-retrieval-db",
      content: "gửi tôi xyz-khong-ton-tai-999",
    }));

    expect(result).toEqual({ dispatched: true });
    expect(mockAnswerRetrieval).not.toHaveBeenCalled();
    expect(mockBridgeRun).toHaveBeenCalledTimes(1);
    expect(mockBridgeRun).toHaveBeenCalledWith(expect.objectContaining({
      content: "gửi tôi xyz-khong-ton-tai-999",
      relatedMessageId: "structured-retrieval-db",
      agentTaskId: "task-1",
    }));
    expect(mockReserveOutboundRecord).toHaveBeenCalledWith(expect.objectContaining({
      inboundMessageId: "structured-retrieval-db",
      source: "agent_tool",
      dryRun: true,
    }));
    expect(mockUpdateOutboundRecordById).toHaveBeenCalledWith(
      "reserved-record-001",
      expect.objectContaining({ reason: "dry_run" }),
      { throwOnError: true },
    );
    expect(mockShouldSendLiveForThread).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("keeps the legacy retrieval owner when structured AgentBridge is off", async () => {
    config.hermesAgentBridge.enabled = false;
    config.retrieval.dispatcherDryRunEnabled = true;

    const result = await handleIncomingMessage(baseMsg({
      zaloMessageId: "legacy-retrieval-zalo",
      dbMessageId: "legacy-retrieval-db",
      content: "gửi tôi xyz-khong-ton-tai-999",
    }));

    expect(result).toEqual({ dispatched: true, reason: "retrieval_found" });
    expect(mockAnswerRetrieval).toHaveBeenCalledTimes(1);
    expect(mockGetAgentBridge).not.toHaveBeenCalled();
    expect(mockBridgeRun).not.toHaveBeenCalled();
    expect(mockMessageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        content: "Legacy retrieval result",
        metadata: expect.stringContaining("outbound_retrieval"),
      }),
    }));
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("keeps the text-only path and never constructs AgentBridge when the flag is off", async () => {
    const result = await handleIncomingMessage(baseMsg({ zaloMessageId: "flag-off-zalo", dbMessageId: "flag-off-db" }));
    expect(result).toEqual({ dispatched: true });
    expect(mockGetAgentBridge).not.toHaveBeenCalled();
    expect(mockBridgeRun).not.toHaveBeenCalled();
    expect(mockGenerateReply).toHaveBeenCalledTimes(1);
    expect(mockReserveOutboundRecord).toHaveBeenCalledWith(expect.objectContaining({ inboundMessageId: "flag-off-db", source: "auto_reply" }));
  });

  it("uses only structured AgentBridge success and preserves round/tool evidence metadata", async () => {
    config.hermesAgentBridge.enabled = true;
    mockBridgeRun.mockResolvedValueOnce({
      text: "Structured evidence reply", confidence: 0.82, usedFallback: false, rounds: 2,
      toolResults: [{
        toolName: "memory.getRecentMessages", kind: "read", executionStatus: "success",
        deliveryStatus: "not_applicable", result: { messages: [] }, toolCallRecordId: "tool-call-42",
        links: { agentTaskId: "task-1", relatedMessageId: "structured-db-42" },
      }],
    });
    const result = await handleIncomingMessage(baseMsg({ zaloMessageId: "structured-zalo-42", dbMessageId: "structured-db-42" }));
    expect(result).toEqual({ dispatched: true });
    expect(mockGetAgentBridge).toHaveBeenCalledTimes(1);
    expect(mockBridgeRun).toHaveBeenCalledTimes(1);
    expect(mockGenerateReply).not.toHaveBeenCalled();
    expect(mockReserveOutboundRecord).toHaveBeenCalledWith(expect.objectContaining({ inboundMessageId: "structured-db-42", source: "agent_tool", dryRun: true }));
    expect(mockComplete).toHaveBeenCalledWith("task-1", expect.objectContaining({ confidence: 0.82, rounds: 2, toolEvidenceIds: ["tool-call-42"], dryRun: true }));
    expect(mockComplete).toHaveBeenCalledWith("task-1", expect.objectContaining({
      outboundRecordId: "reserved-record-001",
      assistantMessageId: "assistant-1",
    }));
  });

  it("fails closed when structured outbound evidence persistence fails", async () => {
    config.hermesAgentBridge.enabled = true;
    mockBridgeRun.mockResolvedValueOnce({
      text: "Structured evidence reply",
      confidence: 0.82,
      usedFallback: false,
      rounds: 2,
      toolResults: [{
        toolName: "memory.getRecentMessages",
        kind: "read",
        executionStatus: "success",
        deliveryStatus: "not_applicable",
        result: { messages: [] },
        toolCallRecordId: "tool-call-persist-failure",
        links: { agentTaskId: "task-1", relatedMessageId: "structured-persist-failure" },
      }],
    });
    mockUpdateOutboundRecordById.mockRejectedValueOnce(new Error("raw outbound persistence failure"));

    const result = await handleIncomingMessage(
      baseMsg({ dbMessageId: "structured-persist-failure" }),
    );

    expect(result).toEqual({
      dispatched: false,
      reason: "outbound_evidence_persistence_failed",
    });
    expect(mockFail).toHaveBeenCalledWith("task-1", "outbound_evidence_persistence_failed");
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("rejects a structured tool result without successful linked evidence", async () => {
    config.hermesAgentBridge.enabled = true;
    mockBridgeRun.mockResolvedValueOnce({
      text: "Untrusted structured reply",
      confidence: 0.82,
      usedFallback: false,
      rounds: 1,
      toolResults: [{
        toolName: "memory.getRecentMessages",
        kind: "read",
        executionStatus: "failed",
        deliveryStatus: "not_applicable",
        result: { messages: [] },
      }],
    });

    const result = await handleIncomingMessage(
      baseMsg({ dbMessageId: "structured-invalid-tool-result" }),
    );

    expect(result).toEqual({
      dispatched: false,
      reason: "agent_bridge_malformed_response",
    });
    expect(mockFail).toHaveBeenCalledWith("task-1", "agent_bridge_malformed_response");
    expect(mockReserveOutboundRecord).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("rejects structured tool evidence linked to a different task or inbound message", async () => {
    config.hermesAgentBridge.enabled = true;
    mockBridgeRun.mockResolvedValueOnce({
      text: "Untrusted structured linkage",
      confidence: 0.82,
      usedFallback: false,
      rounds: 1,
      toolResults: [{
        toolName: "memory.getRecentMessages",
        kind: "read",
        executionStatus: "success",
        deliveryStatus: "not_applicable",
        result: { messages: [] },
        toolCallRecordId: "tool-call-wrong-link",
        links: {
          agentTaskId: "different-task",
          relatedMessageId: "different-message",
        },
      }],
    });

    const result = await handleIncomingMessage(
      baseMsg({ dbMessageId: "structured-linkage-input" }),
    );

    expect(result).toEqual({
      dispatched: false,
      reason: "agent_bridge_malformed_response",
    });
    expect(mockFail).toHaveBeenCalledWith("task-1", "agent_bridge_malformed_response");
    expect(mockReserveOutboundRecord).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed", { text: "unsafe partial response" }, undefined, "agent_bridge_malformed_response", "unsafe partial response"],
    ["timeout", { text: "fallback", confidence: 0, usedFallback: true, rounds: 1, toolResults: [], reason: "total_timeout" }, undefined, "agent_bridge_total_timeout", "fallback"],
    ["blocked", { text: "fallback", confidence: 0, usedFallback: true, rounds: 1, toolResults: [], reason: "adapter_safety" }, undefined, "agent_bridge_adapter_safety", "fallback"],
    ["usedFallback", { text: "provider secret", confidence: 0, usedFallback: true, rounds: 1, toolResults: [], reason: "raw-provider-secret" }, undefined, "agent_bridge_fallback", "raw-provider-secret"],
    ["throw", undefined, new Error("raw-provider-token"), "agent_bridge_error", "raw-provider-token"],
  ])("fails closed for structured %s without text fallback or outbound", async (_caseName, bridgeResult, bridgeError, expectedReason, rawDetail) => {
    config.hermesAgentBridge.enabled = true;
    if (bridgeError) mockBridgeRun.mockRejectedValueOnce(bridgeError);
    else mockBridgeRun.mockResolvedValueOnce(bridgeResult);
    const result = await handleIncomingMessage(baseMsg());
    expect(result).toEqual({ dispatched: false, reason: expectedReason });
    expect(mockGenerateReply).not.toHaveBeenCalled();
    expect(mockReserveOutboundRecord).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockFail).toHaveBeenCalledWith("task-1", expectedReason);
    expect(JSON.stringify(mockFail.mock.calls)).not.toContain(rawDetail);
  });

  it("redacts an unexpected post-bridge structured failure before persisting task state", async () => {
    config.hermesAgentBridge.enabled = true;
    const rawDetail = "raw-structured-evidence-secret-sk-test-1234567890";
    mockBridgeRun.mockResolvedValueOnce({
      text: "Structured reply",
      confidence: 0.9,
      usedFallback: false,
      rounds: 0,
      toolResults: [],
    });
    mockDbTransaction.mockRejectedValueOnce(new Error(rawDetail));

    const result = await handleIncomingMessage(baseMsg());

    expect(result).toEqual({ dispatched: false, reason: "agent_bridge_error" });
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockFail).toHaveBeenCalledWith("task-1", "agent_bridge_error");
    expect(JSON.stringify([mockComplete.mock.calls, mockFail.mock.calls])).not.toContain(rawDetail);
    expect(mockReserveOutboundRecord).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("fails closed when principal resolution throws", async () => {
    mockResolvePrincipal.mockRejectedValueOnce(new Error("raw principal DB failure"));

    const result = await handleIncomingMessage(baseMsg());

    expect(result).toEqual({ dispatched: false, reason: "principal_resolution_failed" });
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockBridgeRun).not.toHaveBeenCalled();
    expect(mockReserveOutboundRecord).not.toHaveBeenCalled();
  });

  it("marks AgentTask failed if adapter throws", async () => {
    mockGenerateReply.mockRejectedValueOnce(new Error("DOWN"));
    const r = await handleIncomingMessage(baseMsg({ zaloMessageId: "err-1" }));
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("hermes_error");
    expect(mockFail).toHaveBeenCalledTimes(1);
  });

  it("getAutoReplyStatus returns config", async () => {
    const s = await getAutoReplyStatus();
    expect(s.enabled).toBe(true);
    expect(s.dryRun).toBe(true);
    expect(s.allowedThreads).toEqual(["thread-allowed", "group-allowed"]);
    expect(s.cooldownSeconds).toBe(10);
    expect(Array.isArray(s.activeCooldowns)).toBe(true);
  });

  it("dispatches valid message successfully", async () => {
    const r = await handleIncomingMessage(baseMsg({ zaloMessageId: "ok-1" }));
    expect(r.dispatched).toBe(true);
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  // ── P0 Batch 1: isSelf guard ──────────────────────────────────

  it("skips when isSelf=true (defense-in-depth)", async () => {
    const r = await handleIncomingMessage(
      baseMsg({ isSelf: true, zaloMessageId: "self-1" }),
    );
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("self_message");
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("skips when isFromBot=true", async () => {
    const r = await handleIncomingMessage(
      baseMsg({ isFromBot: true, zaloMessageId: "bot-1" }),
    );
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("self_message");
  });

  it("skips when senderId matches selfUserId", async () => {
    const r = await handleIncomingMessage(
      baseMsg({ senderId: "621835795753666607", zaloMessageId: "uid-1" }),
      "621835795753666607",
    );
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("self_message");
  });

  // ── P0 Batch 1: Unsupported system claim guard ───────────────

  it("blocks reply with fabricated system claim (no DB evidence)", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Tôi đã gửi tin nhắn nhắc nhở rồi bạn nhé",
      confidence: 0.9,
    });
    mockPrismaFindFirst.mockResolvedValueOnce(null); // no evidence

    const r = await handleIncomingMessage(
      baseMsg({ content: "Hi sao bạn chưa nhắc", zaloMessageId: "claim-1" }),
    );
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("unsupported_system_claim");
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const ca = mockComplete.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(ca).toHaveProperty("needsReview", true);
    expect(ca).toHaveProperty("reason", "unsupported_system_claim");
  });

  it("allows system claim reply when DB evidence exists", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Đã nhắc bạn rồi nhé, kiểm tra lại xem",
      confidence: 0.9,
    });
    mockPrismaFindFirst.mockResolvedValueOnce({ id: "exec-1" }); // evidence exists

    const r = await handleIncomingMessage(
      baseMsg({ content: "Nhắc chưa vậy", zaloMessageId: "claim-2" }),
    );
    // Should NOT be blocked — evidence exists
    expect(r.dispatched).toBe(true);
  });

  it("normal reply without system claims passes through", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Chào bạn, mình có thể giúp gì cho bạn?",
      confidence: 0.9,
    });

    const r = await handleIncomingMessage(
      baseMsg({ zaloMessageId: "normal-1" }),
    );
    expect(r.dispatched).toBe(true);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  // ── Schedule context pre-fetch ─────────────────────────────

  it("pre-fetches schedule context for reminder queries (no data)", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Mình chưa thấy lịch nhắc nào trong hệ thống cho cuộc trò chuyện này.",
      confidence: 0.9,
    });

    const r = await handleIncomingMessage(
      baseMsg({ content: "Hi sao bạn chưa nhắc", zaloMessageId: "pre-1" }),
    );
    expect(r.dispatched).toBe(true);
    // Should NOT timeout — adapter was called with scheduleContext
    expect(mockGenerateReply).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleContext: expect.any(String) }),
    );
  });

  it("pre-fetches schedule context with success execution", async () => {
    mockPrismaFindMany.mockResolvedValueOnce([
      { messageContent: "Nhắc tụng kinh 22h", actualRunAt: new Date().toISOString() },
    ]);
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Lịch nhắc tụng kinh đã được gửi lúc 22h rồi bạn nhé.",
      confidence: 0.9,
    });

    const r = await handleIncomingMessage(
      baseMsg({ content: "sao chưa nhắc", zaloMessageId: "pre-2" }),
    );
    expect(r.dispatched).toBe(true);
    // scheduleContext should contain the success data
    expect(mockGenerateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleContext: expect.stringContaining("ĐÃ GỬI THÀNH CÔNG"),
      }),
    );
  });

  it("pre-fetches schedule context with failed execution", async () => {
    mockPrismaFindMany.mockResolvedValueOnce([]); // no success
    mockPrismaFindMany.mockResolvedValueOnce([
      { messageContent: "Nhắc họp", errorMessage: "SEND_FAILED", plannedRunAt: new Date().toISOString() },
    ]);
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Lịch nhắc họp đã được lên nhưng gửi thất bại do lỗi hệ thống.",
      confidence: 0.9,
    });

    const r = await handleIncomingMessage(
      baseMsg({ content: "sao không gửi", zaloMessageId: "pre-3" }),
    );
    expect(r.dispatched).toBe(true);
    // scheduleContext should contain failed data
    expect(mockGenerateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleContext: expect.stringContaining("GỬI THẤT BẠI"),
      }),
    );
  });

  it("does NOT pre-fetch schedule context for non-reminder queries", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Chào bạn!",
      confidence: 0.9,
    });

    const r = await handleIncomingMessage(
      baseMsg({ content: "xin chào", zaloMessageId: "pre-4" }),
    );
    expect(r.dispatched).toBe(true);
    // scheduleContext should be undefined for non-reminder queries
    expect(mockGenerateReply).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleContext: undefined }),
    );
  });

  it("reminder query with fabricated claim still blocked by guard", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      reply: "Hệ thống đã gửi nhắc rồi nhưng bị lỗi gửi tin nhé bạn.",
      confidence: 0.9,
    });
    // No DB evidence
    mockPrismaFindFirst.mockResolvedValueOnce(null);

    const r = await handleIncomingMessage(
      baseMsg({ content: "Hi sao bạn chưa nhắc", zaloMessageId: "pre-5" }),
    );
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe("unsupported_system_claim");
  });

  // ── Batch 1: Group Safety Foundation ─────────────────────────

  describe("Group safety gates", () => {
    it("skips group not in allowlist", async () => {
      const r = await handleIncomingMessage(
        baseMsg({ threadId: "group-other", threadType: "group", zaloMessageId: "g-1" }),
      );
      expect(r.dispatched).toBe(false);
      expect(r.reason).toBe("thread_not_allowed");
    });

    it("skips group with autoReply disabled", async () => {
      // Override getThreadSettings mock for this test
      const { getThreadSettings } = await import("../services/thread-settings.service.js");
      (getThreadSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        threadId: "group-allowed",
        autoReplyEnabled: false,
        groupMentionRequired: true,
        groupReplyWindowSeconds: 600,
        allowCreateReminder: true,
        allowMedia: false,
      });

      const r = await handleIncomingMessage(
        baseMsg({ threadId: "group-allowed", threadType: "group", zaloMessageId: "g-2" }),
      );
      expect(r.dispatched).toBe(false);
      expect(r.reason).toBe("group_disabled");
      expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it("skips group without @mention (mentionRequired=true)", async () => {
      const { getThreadSettings } = await import("../services/thread-settings.service.js");
      (getThreadSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        threadId: "group-allowed",
        autoReplyEnabled: true,
        groupMentionRequired: true,
        groupReplyWindowSeconds: 600,
        allowCreateReminder: true,
        allowMedia: false,
      });

      const r = await handleIncomingMessage(
        baseMsg({
          threadId: "group-allowed",
          threadType: "group",
          content: "Hello just chatting",
          mentions: ["other-user-1"],
          zaloMessageId: "g-3",
        }),
        "bot-uid-1",
      );
      expect(r.dispatched).toBe(false);
      expect(r.reason).toBe("bot_not_mentioned");
      expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it("allows group with @mention and opens reply window", async () => {
      const { getThreadSettings } = await import("../services/thread-settings.service.js");
      (getThreadSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        threadId: "group-allowed",
        autoReplyEnabled: true,
        groupMentionRequired: true,
        groupReplyWindowSeconds: 600,
        allowCreateReminder: true,
        allowMedia: false,
      });

      const r = await handleIncomingMessage(
        baseMsg({
          threadId: "group-allowed",
          threadType: "group",
          content: "Hello",
          mentions: ["bot-uid-1", "other-user-1"],
          zaloMessageId: "g-4",
        }),
        "bot-uid-1",
      );
      expect(r.dispatched).toBe(true);
      expect(mockCreateTask).toHaveBeenCalledTimes(1);
    });

    it("DM threads pass through group gate without mention check", async () => {
      const r = await handleIncomingMessage(
        baseMsg({ zaloMessageId: "dm-1", threadType: "user" }),
      );
      expect(r.dispatched).toBe(true);
      expect(mockCreateTask).toHaveBeenCalledTimes(1);
    });

    it("create-reminder in DM still works after group gate", async () => {
      const r = await handleIncomingMessage(
        baseMsg({
          threadId: "thread-allowed",
          threadType: "user",
          content: "Nhắc mình 5 phút nữa học bài",
          zaloMessageId: "dm-reminder-1",
        }),
      );
      expect(r.dispatched).toBe(true);
    });
  });

  // ── Cooldown (R5): moved to sendOutbound() ─────────────────────
  // safetyCheck no longer blocks on cooldown. Cooldown enforcement
  // now lives in the unified outbound dispatcher via acquireCooldown().
  // These tests verify that safetyCheck passes both messages through
  // (AgentTask IS created), and cooldown audit is handled by the
  // outbound dispatcher — tested in batch-r5-cooldown.test.ts.

  describe("Cooldown behavior (R5 — dispatcher sole authority)", () => {
    it("safetyCheck does NOT block on cooldown — both messages dispatched", async () => {
      // First message: dispatched normally
      await handleIncomingMessage(baseMsg({ zaloMessageId: "r5-cool-1" }));
      
      // Second message within cooldown window: STILL dispatched
      // (cooldown enforcement moved to sendOutbound)
      const r = await handleIncomingMessage(baseMsg({ zaloMessageId: "r5-cool-2" }));
      expect(r.dispatched).toBe(true);
    });

    it("AgentTask IS created for cooldown-window messages (R5)", async () => {
      // First message
      await handleIncomingMessage(baseMsg({ zaloMessageId: "r5-task-1" }));
      
      mockCreateTask.mockClear();
      
      // Second message within cooldown window: still creates AgentTask
      // (Hermes processes it, but sendOutbound will block the response)
      await handleIncomingMessage(baseMsg({ zaloMessageId: "r5-task-2" }));
      expect(mockCreateTask).toHaveBeenCalledTimes(1);
    });

    it("no cooldown OutboundRecord from safetyCheck (dispatcher handles it)", async () => {
      mockSaveOutboundRecord.mockClear();
      
      // First message
      await handleIncomingMessage(baseMsg({ zaloMessageId: "r5-rec-1" }));
      
      // Second message within cooldown window
      await handleIncomingMessage(baseMsg({ zaloMessageId: "r5-rec-2" }));
      
      // OutboundRecords are created by sendOutbound (via dispatcher),
      // NOT by safetyCheck cooldown gate. The count depends on the
      // mocked dispatcher path. Verify no "block/cooldown" records
      // from safetyCheck.
      const blockCalls = mockSaveOutboundRecord.mock.calls.filter(
        (call: any) => call[0]?.reason === "cooldown" && call[0]?.decision === "block"
      );
      expect(blockCalls).toHaveLength(0);
    });
  });

  it("resets cooldown and allows fresh message", async () => {
      await handleIncomingMessage(baseMsg({ zaloMessageId: "multi-1" }));
      await handleIncomingMessage(baseMsg({ zaloMessageId: "multi-2" }));

      await resetAutoReplyCooldowns();
      mockSaveOutboundRecord.mockClear();
      mockReserveOutboundRecord.mockClear();
      mockUpdateOutboundRecordById.mockClear();

      // Fresh message after reset: should dispatch. Phase 4A: a hermes text reply
      // WITH relatedMessageId (baseMsg always sets dbMessageId) takes the
      // write-ahead reservation path — one reserved row, updated with reason
      // "dry_run" — not saveOutboundRecord.
      await handleIncomingMessage(baseMsg({ zaloMessageId: "multi-3" }));
      expect(mockSaveOutboundRecord).not.toHaveBeenCalled();
      expect(mockReserveOutboundRecord).toHaveBeenCalledTimes(1);
      const reserved = mockReserveOutboundRecord.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(reserved.dryRun).toBe(true);
      expect(mockUpdateOutboundRecordById).toHaveBeenCalledTimes(1);
      const update = mockUpdateOutboundRecordById.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(update.reason).toBe("dry_run");
    });
  });

// ── R1.2 Smoke: Image/File paths via unified dispatcher ───────────

describe("R1.2 — Image/File outbound source types", () => {
  // Import sendOutbound for direct testing
  let sendOutboundFn: typeof import("../services/outbound-dispatcher.service.js").sendOutbound;

  beforeAll(async () => {
    const mod = await import("../services/outbound-dispatcher.service.js");
    sendOutboundFn = mod.sendOutbound;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetAutoReplyCooldowns();
    mockSaveOutboundRecord.mockResolvedValue(undefined);
    mockReserveOutboundRecord.mockResolvedValue("reserved-record-001");
    mockUpdateOutboundRecordById.mockResolvedValue(undefined);
  });

  it("sendOutbound with source=image creates OutboundRecord with source=auto_reply", async () => {
    await sendOutboundFn({
      threadId: "thread-allowed",
      threadType: "user",
      source: "image",
      content: "Image analysis reply",
      relatedMessageId: "msg-img-1",
      taskId: "task-img-1",
    });

    // Phase 4A: a text reply WITH relatedMessageId takes the write-ahead
    // reservation path (reserveOutboundRecord + updateOutboundRecordById),
    // NOT saveOutboundRecord. Exactly one outbound evidence row is created.
    expect(mockSaveOutboundRecord).not.toHaveBeenCalled();
    expect(mockReserveOutboundRecord).toHaveBeenCalledTimes(1);
    const reserved = mockReserveOutboundRecord.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(reserved.source).toBe("auto_reply"); // mapSource("image") → "auto_reply"
    expect(reserved.dryRun).toBe(true);
    expect(reserved.inboundMessageId).toBe("msg-img-1");
    expect(mockUpdateOutboundRecordById).toHaveBeenCalledTimes(1);
    const update = mockUpdateOutboundRecordById.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(update.reason).toBe("dry_run");
  });

  it("sendOutbound with source=file creates OutboundRecord with source=auto_reply", async () => {
    await sendOutboundFn({
      threadId: "thread-allowed",
      threadType: "user",
      source: "file",
      content: "File confirmation reply",
      relatedMessageId: "msg-file-1",
      taskId: "task-file-1",
    });

    // Phase 4A: reservation path (relatedMessageId present), not saveOutboundRecord.
    expect(mockSaveOutboundRecord).not.toHaveBeenCalled();
    expect(mockReserveOutboundRecord).toHaveBeenCalledTimes(1);
    const reserved = mockReserveOutboundRecord.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(reserved.source).toBe("auto_reply"); // mapSource("file") → "auto_reply"
    expect(reserved.dryRun).toBe(true);
    expect(reserved.inboundMessageId).toBe("msg-file-1");
    expect(mockUpdateOutboundRecordById).toHaveBeenCalledTimes(1);
    const update = mockUpdateOutboundRecordById.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(update.reason).toBe("dry_run");
  });

  it("sendOutbound with source=error_fallback creates OutboundRecord", async () => {
    await sendOutboundFn({
      threadId: "thread-allowed",
      threadType: "user",
      source: "error_fallback",
      content: "Error fallback message",
      relatedMessageId: "msg-err-1",
      taskId: "task-err-1",
    });

    // Phase 4A: reservation path (relatedMessageId present), not saveOutboundRecord.
    expect(mockSaveOutboundRecord).not.toHaveBeenCalled();
    expect(mockReserveOutboundRecord).toHaveBeenCalledTimes(1);
    const reserved = mockReserveOutboundRecord.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(reserved.source).toBe("auto_reply");
    expect(reserved.dryRun).toBe(true);
    expect(reserved.inboundMessageId).toBe("msg-err-1");
    expect(mockUpdateOutboundRecordById).toHaveBeenCalledTimes(1);
    const update = mockUpdateOutboundRecordById.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(update.reason).toBe("dry_run");
  });

  it("sendOutbound with source=catch_all creates OutboundRecord", async () => {
    await sendOutboundFn({
      threadId: "thread-allowed",
      threadType: "user",
      source: "catch_all",
      content: "Catch-all default reply",
      relatedMessageId: "msg-catch-1",
      taskId: "task-catch-1",
    });

    // Phase 4A: reservation path (relatedMessageId present), not saveOutboundRecord.
    expect(mockSaveOutboundRecord).not.toHaveBeenCalled();
    expect(mockReserveOutboundRecord).toHaveBeenCalledTimes(1);
    const reserved = mockReserveOutboundRecord.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(reserved.source).toBe("auto_reply");
    expect(reserved.dryRun).toBe(true);
    expect(reserved.inboundMessageId).toBe("msg-catch-1");
    expect(mockUpdateOutboundRecordById).toHaveBeenCalledTimes(1);
    const update = mockUpdateOutboundRecordById.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(update.reason).toBe("dry_run");
  });
});
