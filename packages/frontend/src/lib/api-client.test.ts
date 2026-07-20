import { afterEach, describe, expect, it, vi } from "vitest";
import { adminCredentials } from "./admin-auth";
import {
  getConfigCheck,
  getErrorSummary,
  getHealthDetail,
  getHeartbeats,
  getLiveTestStatus,
  getProductionReadiness,
  getRecentEvents,
  getRuntimeConfig,
  getThreadSettings,
  getZaloOpsStatus,
  listMessages,
  type HealthDetailResponse,
  type ReadinessResult,
} from "./api-client";

// Batch 1 strict contract fixtures.
afterEach(() => {
  adminCredentials.clear();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const HEALTH_HEARTBEAT_NAMES = [
  "backend",
  "zaloListener",
  "zaloConnection",
  "schedulerWorker",
  "messagePipeline",
] as const;

function heartbeatItem(name: (typeof HEALTH_HEARTBEAT_NAMES)[number]) {
  return {
    name,
    status: "ok",
    lastBeatAt: "2026-01-01T00:00:00.000Z",
    lastSuccessAt: "2026-01-01T00:00:00.000Z",
    lastErrorAt: null,
    lastError: null,
    ageSeconds: 1,
    metadata: null,
  };
}

function validHeartbeatItems() {
  return HEALTH_HEARTBEAT_NAMES.map(heartbeatItem);
}

function validHealthHeartbeatMap() {
  return Object.fromEntries(validHeartbeatItems().map((item) => [item.name, item]));
}

function healthDetailPayload(dbPath: unknown) {
  return {
    status: "unhealthy",
    timestamp: "2026-01-01T00:00:00.000Z",
    uptimeSeconds: 10,
    version: "0.1.0",
    backend: { pid: 1, nodeEnv: "test", port: 3000 },
    db: { ok: false, path: dbPath, sizeBytes: 0, criticalTables: {} },
    zalo: {
      connected: false,
      listenerStarted: false,
      uid: null,
      lastConnectedAt: null,
      lastError: null,
    },
    autoReply: {
      enabled: false,
      dryRun: true,
      allowedThreadsCount: 0,
      cooldownSeconds: 10,
      activeCooldowns: 0,
    },
    worker: { active: false, queuedJobs: 0, failedJobs24h: 0 },
    backup: {
      latestBackupAt: null,
      latestBackupName: null,
      backupCount: 0,
      latestBackupAgeHours: null,
    },
    processLock: { locked: false, ownerPid: null, isOwner: false, startedAt: null },
    config: { status: "CONFIG_OK", pass: 1, warn: 0, error: 0 },
    messages: { inbound24h: 0, outbound24h: 0, lastInboundAt: null, lastOutboundAt: null },
    errors: { failedAgentTasks24h: 0, failedExecutions24h: 0 },
    heartbeats: validHealthHeartbeatMap(),
    allowedThreadsReview: { count: 0, highRiskCount: 0, groupCount: 0, unknownCount: 0 },
    errorsSummary: {
      status: "ok",
      errors24h: 0,
      warnings24h: 0,
      topErrorCode: null,
      lastErrorAt: null,
    },
  };
}

function healthyHealthDetailPayload(): HealthDetailResponse {
  const payload = healthDetailPayload("C:/data/dev.db") as HealthDetailResponse;
  payload.status = "healthy";
  payload.db.ok = true;
  payload.db.criticalTables = {
    Message: 0,
    AgentTask: 0,
    Schedule: 0,
    ScheduleJob: 0,
    ThreadSetting: 0,
    OutboundRecord: 0,
  };
  payload.zalo.connected = true;
  payload.worker.active = true;
  return payload;
}

const REQUIRED_READINESS_CHECK_IDS = [
  "zalo.connected", "zalo.listener", "zalo.messagePipeline",
  "safety.dryRun", "safety.allowedThreads", "safety.groupRisk",
  "config.status", "config.strictErrors",
  "health.backend", "health.worker", "health.processLock", "health.db",
  "backup.recent", "backup.dbSize", "backup.session",
  "security.adminPassword", "rules.status", "docs.status",
  "errors.agentTasks", "errors.executions", "errors.heartbeats",
] as const;

function readinessPayload(): ReadinessResult {
  const checks = REQUIRED_READINESS_CHECK_IDS.map<ReadinessResult["checks"][number]>((id, index) => ({
    id,
    label: id,
    category: "Test",
    status: "pass",
    severity: index === 1 ? "high" : "critical",
    message: "Passed",
  }));
  return {
    verdict: "READY_FOR_LIVE",
    score: 100,
    dataQuality: "complete",
    timestamp: "2026-01-01T00:00:00.000Z",
    checks,
    summary: { pass: 21, warn: 0, fail: 0, unknown: 0, criticalFail: 0, highFail: 0 },
  };
}

function validHeartbeats() {
  return {
    status: "ok",
    staleThresholdSeconds: 90,
    items: validHeartbeatItems(),
  };
}

function validErrorSummary() {
  return {
    windowHours: 24,
    status: "warn",
    totals: {
      errors: 0,
      warnings: 1,
      failedAgentTasks: 0,
      failedExecutions: 0,
      blockedOutbound: 0,
      staleHeartbeats: 1,
    },
    groups: [{
      source: "Heartbeat",
      errorCode: "stale",
      count: 1,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      sampleMessage: "Heartbeat stale",
      severity: "medium",
    }],
    recent: [{
      source: "Heartbeat",
      errorCode: "stale",
      message: "Heartbeat stale",
      seenAt: "2026-01-01T00:00:00.000Z",
      severity: "medium",
    }],
  };
}

function validZaloOpsStatus() {
  return {
    connected: false,
    connectionStatus: "disconnected",
    connectionDetail: "qr_required",
    selfUserId: null,
    selfDisplayName: null,
    lastConnectedAt: null,
    lastError: null,
    lastMessageAt: null,
    listenerActive: false,
    dryRun: true,
    dryRunSource: "env",
    allowedThreads: [],
    cooldownSeconds: 30,
    session: {
      exists: false,
      age: null,
      ageSeconds: null,
      path: null,
      qrAvailable: false,
      qrUpdatedAt: null,
      fileSize: null,
      updatedAt: null,
      quarantinedFiles: [],
      warning: null,
      backupAvailable: false,
    },
    heartbeats: {
      zaloConnection: { status: "down", lastBeatAt: null, ageSeconds: null },
      zaloListener: { status: "down", lastBeatAt: null, ageSeconds: null },
      messagePipeline: { status: "down", lastBeatAt: null, ageSeconds: null },
    },
    recovery: {
      recoveryState: "idle",
      reconnectAttempts: 0,
      maxReconnectAttempts: 10,
      lastReconnectAt: null,
      lastReconnectError: null,
      listenerHeartbeatAgeSeconds: null,
    },
    inbound24h: 0,
    outbound24h: 0,
    failedTasks24h: 0,
  };
}

function validMessageItem() {
  return {
    id: "message-1",
    zaloMessageId: "zalo-message-1",
    threadId: "thread-1",
    threadType: "user",
    senderId: "bot-1",
    senderName: "Hermes",
    content: "Xin chao",
    isFromBot: true,
    messageType: "text",
    role: "assistant",
    relatedMessageId: null,
    metadata: null,
    receivedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    thread: {
      id: "thread-1",
      displayName: "Test thread",
      type: "user",
      avatarUrl: null,
    },
    outbound: {
      id: "outbound-1",
      decision: "allow",
      reason: "single_send",
      dryRun: false,
      sentMessageId: "zalo-provider-message-1",
      errorCode: null,
      source: "auto_reply",
      createdAt: "2026-01-01T00:00:01.000Z",
    },
  };
}

function validMessageList() {
  return {
    data: [validMessageItem()],
    total: 1,
    page: 1,
    pageSize: 30,
    totalPages: 1,
  };
}

describe("critical dashboard response validation", () => {
  it("rejects malformed operational status instead of inventing safe values", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ connected: false }))
      .mockResolvedValueOnce(jsonResponse({ active: false, session: null })));

    await expect(getZaloOpsStatus()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(getLiveTestStatus()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("accepts an explicit inactive dry-run live-test status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      active: false,
      session: null,
      dryRun: true,
    })));

    await expect(getLiveTestStatus()).resolves.toEqual({ active: false, session: null, dryRun: true });
  });

  it("rejects malformed message list envelopes and items", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [], total: 0, page: 0, pageSize: 0, totalPages: null }))
      .mockResolvedValueOnce(jsonResponse({ data: [{}], total: 1, page: 1, pageSize: 30, totalPages: 1 })));

    await expect(listMessages()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(listMessages()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("accepts a complete message DTO with explicit evidence", async () => {
    const payload = validMessageList();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(listMessages()).resolves.toEqual(payload);
  });

  it.each([
    { field: "receivedAt", value: "not-a-timestamp" },
    { field: "createdAt", value: "2026-02-30T00:00:00.000Z" },
  ] as const)("rejects message DTOs with an invalid $field", async ({ field, value }) => {
    const payload = validMessageList();
    payload.data[0]![field] = value;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(listMessages()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects unknown or contradictory message truth fields", async () => {
    const unknownDecision = validMessageList();
    unknownDecision.data[0]!.outbound.decision = "invented";
    const contradictoryRole = validMessageList();
    contradictoryRole.data[0]!.isFromBot = false;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(unknownDecision))
      .mockResolvedValueOnce(jsonResponse(contradictoryRole)));

    await expect(listMessages()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(listMessages()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects extra keys at message, thread, and outbound boundaries", async () => {
    const extraRoot = validMessageList();
    (extraRoot.data[0]! as typeof extraRoot.data[number] & { unexpected?: boolean }).unexpected = true;
    const extraThread = validMessageList();
    (extraThread.data[0]!.thread as typeof extraThread.data[number]["thread"] & { unexpected?: boolean }).unexpected = true;
    const extraOutbound = validMessageList();
    (extraOutbound.data[0]!.outbound as typeof extraOutbound.data[number]["outbound"] & { unexpected?: boolean }).unexpected = true;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(extraRoot))
      .mockResolvedValueOnce(jsonResponse(extraThread))
      .mockResolvedValueOnce(jsonResponse(extraOutbound)));

    await expect(listMessages()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(listMessages()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(listMessages()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects inconsistent message pagination", async () => {
    const payload = { ...validMessageList(), totalPages: 2 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(listMessages()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects health detail when db.path is neither a string nor null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(healthDetailPayload(123))));

    await expect(getHealthDetail()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects health detail root status that contradicts critical nested evidence", async () => {
    const databaseFailure = healthyHealthDetailPayload();
    databaseFailure.db.ok = false;

    const missingCriticalTables = healthyHealthDetailPayload();
    missingCriticalTables.db.criticalTables = {};

    const configFailure = healthyHealthDetailPayload();
    configFailure.config = { status: "CONFIG_ERROR", pass: 0, warn: 0, error: 1 };

    const criticalHeartbeatFailure = healthyHealthDetailPayload();
    criticalHeartbeatFailure.heartbeats.backend!.status = "down";

    for (const payload of [databaseFailure, missingCriticalTables, configFailure, criticalHeartbeatFailure]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
      await expect(getHealthDetail()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("rejects healthy health detail when the worker is inactive", async () => {
    const payload = healthyHealthDetailPayload();
    payload.status = "healthy";
    payload.worker.active = false;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(getHealthDetail()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each(["backend", "zaloConnection"] as const)(
    "rejects healthy health detail with a stale %s heartbeat",
    async (heartbeatName) => {
      const payload = healthyHealthDetailPayload();
      payload.status = "healthy";
      payload.heartbeats[heartbeatName]!.status = "stale";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

      await expect(getHealthDetail()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    },
  );

  it.each(["backend", "zaloConnection"] as const)(
    "accepts degraded health detail with a stale %s heartbeat",
    async (heartbeatName) => {
      const payload = healthyHealthDetailPayload();
      payload.status = "degraded";
      payload.heartbeats[heartbeatName]!.status = "stale";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

      await expect(getHealthDetail()).resolves.toEqual(payload);
    },
  );

  it("accepts health detail root statuses derived by the backend contract", async () => {
    const healthy = healthyHealthDetailPayload();
    const degraded = healthyHealthDetailPayload();
    degraded.status = "degraded";
    degraded.worker.active = false;

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(healthy))
      .mockResolvedValueOnce(jsonResponse(degraded)));

    await expect(getHealthDetail()).resolves.toEqual(healthy);
    await expect(getHealthDetail()).resolves.toEqual(degraded);
  });

  it("accepts health detail with a null db.path when the database is unavailable", async () => {
    const payload = healthDetailPayload(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(getHealthDetail()).resolves.toEqual(payload);
  });

  it.each([
    { status: "invented" },
    { timestamp: "2026-02-30T00:00:00.000Z" },
    { uptimeSeconds: -1 },
    { worker: { ...healthDetailPayload(null).worker, failedJobs24h: 0.5 } },
    { extra: true },
  ])("rejects malformed health detail evidence (%j)", async (change) => {
    const payload = { ...healthDetailPayload(null), ...change };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(getHealthDetail()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("forwards AbortSignal to config-check and validates its summary", async () => {
    const payload = {
      status: "CONFIG_OK",
      checks: [{ name: "safe", severity: "PASS", message: "safe", safe: true }],
      summary: { pass: 1, warn: 0, error: 0 },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(getConfigCheck(controller.signal)).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/system/config-check",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects config-check status/summary and safety contradictions", async () => {
    const payloads = [
      {
        status: "CONFIG_OK",
        checks: [{ name: "bad", severity: "ERROR", message: "bad", safe: true }],
        summary: { pass: 0, warn: 0, error: 1 },
      },
      {
        status: "CONFIG_WARN",
        checks: [],
        summary: { pass: 0, warn: 0, error: 0 },
      },
      { status: "CONFIG_OK", checks: [], summary: { pass: 0, warn: 0, error: 0 }, extra: true },
    ];
    for (const payload of payloads) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
      await expect(getConfigCheck()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("forwards AbortSignal to heartbeats and rejects unknown/duplicate evidence", async () => {
    const valid = validHeartbeats();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(valid));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(getHeartbeats(controller.signal)).resolves.toEqual(valid);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/system/heartbeats",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    const unknown = { ...valid, items: [{ ...valid.items[0], name: "invented" }] };
    const duplicate = { ...valid, items: [valid.items[0], { ...valid.items[0] }] };
    const degraded = { ...valid, status: "degraded" };
    for (const payload of [unknown, duplicate, degraded]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
      await expect(getHeartbeats()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("rejects malformed readiness, runtime, heartbeat and event payloads", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ verdict: "READY_FOR_LIVE", checks: [] }))
      .mockResolvedValueOnce(jsonResponse({ effective: { dryRun: true }, overrides: [], recentAudit: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: "ok", staleThresholdSeconds: 90, items: [{ name: "backend", status: "invalid" }] }))
      .mockResolvedValueOnce(jsonResponse({ inbound: [{}], outbound: [], errors: [] })));

    await expect(getProductionReadiness()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(getRuntimeConfig()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(getHeartbeats()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(getRecentEvents()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("accepts semantically consistent production readiness evidence", async () => {
    const payload = readinessPayload();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(getProductionReadiness()).resolves.toEqual(payload);
  });

  it("rejects readiness with missing, extra, or invented check IDs", async () => {
    const missing = readinessPayload();
    missing.checks.pop();
    missing.summary.pass = 20;

    const extra = readinessPayload();
    extra.checks.push({
      id: "invented.extra",
      label: "Invented extra",
      category: "Test",
      status: "pass",
      severity: "low",
      message: "Invented",
    });
    extra.summary.pass = 22;

    const invented = readinessPayload();
    invented.checks[0]!.id = "invented.replacement";

    for (const payload of [missing, extra, invented]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
      await expect(getProductionReadiness()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("rejects invalid readiness timestamps and out-of-range scores", async () => {
    const invalidTimestamp = readinessPayload();
    invalidTimestamp.timestamp = "2026-02-30T00:00:00.000Z";
    const negativeScore = readinessPayload();
    negativeScore.score = -1;
    const excessiveScore = readinessPayload();
    excessiveScore.score = 101;

    for (const payload of [invalidTimestamp, negativeScore, excessiveScore]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
      await expect(getProductionReadiness()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("rejects readiness data-quality and score contradictions", async () => {
    const completeWithoutScore = readinessPayload();
    completeWithoutScore.score = null;
    const incompleteWithScore = readinessPayload();
    incompleteWithScore.dataQuality = "incomplete";
    incompleteWithScore.verdict = "NOT_READY";

    for (const payload of [completeWithoutScore, incompleteWithScore]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
      await expect(getProductionReadiness()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("rejects complete readiness data quality when checks contain unknown evidence", async () => {
    const completeWithUnknown = readinessPayload();
    completeWithUnknown.checks[0]!.status = "unknown";
    completeWithUnknown.summary = { pass: 20, warn: 0, fail: 0, unknown: 1, criticalFail: 1, highFail: 0 };
    completeWithUnknown.verdict = "NOT_READY";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(completeWithUnknown)));

    await expect(getProductionReadiness()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects incomplete readiness data quality when checks contain no unknown evidence", async () => {
    const incompleteWithoutUnknown = readinessPayload();
    incompleteWithoutUnknown.dataQuality = "incomplete";
    incompleteWithoutUnknown.score = null;
    incompleteWithoutUnknown.verdict = "NOT_READY";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(incompleteWithoutUnknown)));

    await expect(getProductionReadiness()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects empty or duplicate readiness check IDs and extra keys", async () => {
    const emptyId = readinessPayload();
    emptyId.checks[0]!.id = "   ";
    const duplicateId = readinessPayload();
    duplicateId.checks[1]!.id = duplicateId.checks[0]!.id;
    const extraRoot = { ...readinessPayload(), extra: true };
    const extraCheck = readinessPayload();
    (extraCheck.checks[0] as typeof extraCheck.checks[number] & { extra?: boolean }).extra = true;

    for (const payload of [emptyId, duplicateId, extraRoot, extraCheck]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
      await expect(getProductionReadiness()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("rejects readiness summaries and verdicts that contradict checks", async () => {
    const inconsistentSummary = readinessPayload();
    inconsistentSummary.summary.pass = 0;

    const readyWithFailure = readinessPayload();
    readyWithFailure.checks[0]!.status = "fail";
    readyWithFailure.summary = { pass: 20, warn: 0, fail: 1, unknown: 0, criticalFail: 1, highFail: 0 };
    readyWithFailure.verdict = "READY_FOR_LIVE";

    const readyWithUnknown = readinessPayload();
    readyWithUnknown.checks[0]!.status = "unknown";
    readyWithUnknown.summary = { pass: 20, warn: 0, fail: 0, unknown: 1, criticalFail: 1, highFail: 0 };
    readyWithUnknown.dataQuality = "incomplete";
    readyWithUnknown.score = null;
    readyWithUnknown.verdict = "READY_FOR_LIVE";

    const readyWithIncompleteData = readinessPayload();
    readyWithIncompleteData.dataQuality = "incomplete";
    readyWithIncompleteData.score = null;
    readyWithIncompleteData.verdict = "READY_FOR_LIVE";

    const notReadyWithOnlyWarning = readinessPayload();
    notReadyWithOnlyWarning.checks[0]!.status = "warn";
    notReadyWithOnlyWarning.summary = { pass: 20, warn: 1, fail: 0, unknown: 0, criticalFail: 0, highFail: 0 };
    notReadyWithOnlyWarning.score = 95;
    notReadyWithOnlyWarning.verdict = "NOT_READY";

    for (const payload of [
      inconsistentSummary,
      readyWithFailure,
      readyWithUnknown,
      readyWithIncompleteData,
      notReadyWithOnlyWarning,
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
      await expect(getProductionReadiness()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("counts unknown critical/high readiness checks in failure severity totals", async () => {
    const payload = readinessPayload();
    payload.checks[0]!.status = "fail";
    payload.checks[1]!.status = "unknown";
    payload.verdict = "NOT_READY";
    payload.score = null;
    payload.dataQuality = "incomplete";
    payload.summary = { pass: 19, warn: 0, fail: 1, unknown: 1, criticalFail: 1, highFail: 1 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(getProductionReadiness()).resolves.toEqual(payload);
  });

  it("rejects malformed error summary payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      windowHours: 24,
      status: "ok",
      totals: {
        errors: 0,
        warnings: 0,
        failedAgentTasks: 0,
        failedExecutions: 0,
        blockedOutbound: 0,
        staleHeartbeats: 0,
      },
      groups: [{ source: "Heartbeat", errorCode: "stale", count: "1", lastSeenAt: "2026-01-01T00:00:00.000Z", severity: "medium" }],
      recent: [],
    })));

    await expect(getErrorSummary()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects malformed thread settings payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      data: [{ threadId: "thread-123", threadType: "user", autoReplyEnabled: "yes" }],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })));

    await expect(getThreadSettings()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("accepts valid thread settings payloads", async () => {
    const payload = {
      data: [{
        id: "setting-1",
        threadId: "thread-123",
        threadType: "user",
        autoReplyEnabled: true,
        groupMentionRequired: false,
        groupReplyWindowSeconds: 0,
        allowCreateReminder: true,
        allowMedia: false,
        allowImageUnderstanding: false,
        allowDocumentUnderstanding: false,
        notes: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(getThreadSettings()).resolves.toEqual(payload);
  });

  it("requests the selected thread-settings page instead of silently fixing page one", async () => {
    const item = {
      id: "setting-51",
      threadId: "thread-51",
      threadType: "group",
      autoReplyEnabled: true,
      groupMentionRequired: true,
      groupReplyWindowSeconds: 600,
      allowCreateReminder: true,
      allowMedia: false,
      allowImageUnderstanding: false,
      allowDocumentUnderstanding: false,
      notes: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [item],
      total: 51,
      page: 2,
      pageSize: 50,
      totalPages: 2,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getThreadSettings({ page: 2, pageSize: 50 })).resolves.toMatchObject({ page: 2, data: [item] });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/threads/settings?page=2&pageSize=50",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects thread settings when a page omits expected items", async () => {
    const item = {
      id: "setting-1",
      threadId: "thread-123",
      threadType: "user",
      autoReplyEnabled: true,
      groupMentionRequired: false,
      groupReplyWindowSeconds: 0,
      allowCreateReminder: true,
      allowMedia: false,
      allowImageUnderstanding: false,
      allowDocumentUnderstanding: false,
      notes: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: [],
        total: 51,
        page: 2,
        pageSize: 50,
        totalPages: 2,
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [item],
        total: 51,
        page: 2,
        pageSize: 50,
        totalPages: 2,
      })));

    await expect(getThreadSettings()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(getThreadSettings()).resolves.toMatchObject({ data: [item], total: 51, page: 2 });
  });

  it("rejects thread settings when the page exceeds the available range", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      data: [],
      total: 51,
      page: 3,
      pageSize: 50,
      totalPages: 2,
    })));

    await expect(getThreadSettings()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([
    "not-a-timestamp",
    "2026-02-30T00:00:00.000Z",
  ])("rejects thread settings with an invalid timestamp (%s)", async (createdAt) => {
    const payload = {
      data: [{
        id: "setting-1",
        threadId: "thread-123",
        threadType: "user",
        autoReplyEnabled: true,
        groupMentionRequired: false,
        groupReplyWindowSeconds: 0,
        allowCreateReminder: true,
        allowMedia: false,
        allowImageUnderstanding: false,
        allowDocumentUnderstanding: false,
        notes: null,
        createdAt,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
    await expect(getThreadSettings()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects thread settings with an extra key", async () => {
    const item = {
      id: "setting-1",
      threadId: "thread-123",
      threadType: "user",
      autoReplyEnabled: true,
      groupMentionRequired: false,
      groupReplyWindowSeconds: 0,
      allowCreateReminder: true,
      allowMedia: false,
      allowImageUnderstanding: false,
      allowDocumentUnderstanding: false,
      notes: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      data: [{ ...item, extra: true }],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })));
    await expect(getThreadSettings()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects thread settings with inconsistent pagination", async () => {
    const item = {
      id: "setting-1",
      threadId: "thread-123",
      threadType: "user",
      autoReplyEnabled: true,
      groupMentionRequired: false,
      groupReplyWindowSeconds: 0,
      allowCreateReminder: true,
      allowMedia: false,
      allowImageUnderstanding: false,
      allowDocumentUnderstanding: false,
      notes: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      data: [item],
      total: 101,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })));
    await expect(getThreadSettings()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([
    { windowHours: 0 },
    { windowHours: 169 },
    { windowHours: Number.NaN },
    { windowHours: 1.5 },
  ])("rejects error summaries with an invalid window (%j)", async (change) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...validErrorSummary(), ...change })));
    await expect(getErrorSummary()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects error summaries with an empty required source", async () => {
    const payload = validErrorSummary();
    payload.groups[0]!.source = "";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
    await expect(getErrorSummary()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects error summaries with an invalid timestamp", async () => {
    const payload = validErrorSummary();
    payload.groups[0]!.lastSeenAt = "not-a-timestamp";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
    await expect(getErrorSummary()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects error summaries with an extra root key", async () => {
    const payload = validErrorSummary();
    (payload as typeof payload & { extra?: boolean }).extra = true;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
    await expect(getErrorSummary()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("accepts a semantically consistent error summary", async () => {
    const payload = validErrorSummary();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(getErrorSummary()).resolves.toEqual(payload);
  });

  it("rejects error summaries with an unknown group source or zero count", async () => {
    const unknownSource = validErrorSummary();
    unknownSource.groups[0]!.source = "Invented";
    const zeroCount = validErrorSummary();
    zeroCount.groups[0]!.count = 0;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(unknownSource))
      .mockResolvedValueOnce(jsonResponse(zeroCount)));

    await expect(getErrorSummary()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(getErrorSummary()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects error summaries whose source totals contradict their groups", async () => {
    const payload = validErrorSummary();
    payload.totals.failedAgentTasks = 1;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(getErrorSummary()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects Zalo status with an unknown connection detail", async () => {
    const base = validZaloOpsStatus();
    const payload = {
      ...base,
      connectionDetail: "invented",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
    await expect(getZaloOpsStatus()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects Zalo status with an unknown session warning", async () => {
    const base = validZaloOpsStatus();
    const payload = {
      ...base,
      session: { ...base.session, warning: "invented" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
    await expect(getZaloOpsStatus()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("accepts a fully valid Zalo status payload", async () => {
    const payload = validZaloOpsStatus();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(getZaloOpsStatus()).resolves.toEqual(payload);
  });

  it("rejects extra keys at every Zalo status object layer", async () => {
    const base = validZaloOpsStatus();
    const payloads = [
      { ...base, extra: true },
      { ...base, session: { ...base.session, extra: true } },
      { ...base, heartbeats: { ...base.heartbeats, extra: true } },
      {
        ...base,
        heartbeats: {
          ...base.heartbeats,
          zaloConnection: { ...base.heartbeats.zaloConnection, extra: true },
        },
      },
      { ...base, recovery: { ...base.recovery, extra: true } },
    ];

    for (const payload of payloads) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
      await expect(getZaloOpsStatus()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("rejects invalid timestamps in Zalo status payloads", async () => {
    const base = validZaloOpsStatus();
    const payloads = [
      { ...base, lastConnectedAt: "not-a-timestamp" },
      { ...base, session: { ...base.session, updatedAt: "2026-02-30T00:00:00.000Z" } },
      {
        ...base,
        heartbeats: {
          ...base.heartbeats,
          zaloConnection: { ...base.heartbeats.zaloConnection, lastBeatAt: "yesterday" },
        },
      },
      { ...base, recovery: { ...base.recovery, lastReconnectAt: "invalid" } },
    ];

    for (const payload of payloads) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
      await expect(getZaloOpsStatus()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("rejects negative or fractional Zalo counters and ages", async () => {
    const base = validZaloOpsStatus();
    const payloads = [
      { ...base, cooldownSeconds: -1 },
      { ...base, inbound24h: -1 },
      { ...base, outbound24h: 0.5 },
      { ...base, session: { ...base.session, ageSeconds: -1 } },
      { ...base, session: { ...base.session, fileSize: 0.5 } },
      {
        ...base,
        heartbeats: {
          ...base.heartbeats,
          zaloListener: { ...base.heartbeats.zaloListener, ageSeconds: -1 },
        },
      },
      { ...base, recovery: { ...base.recovery, reconnectAttempts: 0.5 } },
      { ...base, recovery: { ...base.recovery, listenerHeartbeatAgeSeconds: -1 } },
    ];

    for (const payload of payloads) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
      await expect(getZaloOpsStatus()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("rejects blank allowed thread identifiers", async () => {
    const base = validZaloOpsStatus();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      ...base,
      allowedThreads: ["thread-1", "   "],
    })));

    await expect(getZaloOpsStatus()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
