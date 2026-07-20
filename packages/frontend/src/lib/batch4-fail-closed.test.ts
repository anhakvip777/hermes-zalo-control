import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  getConfigCheck,
  getErrorSummary,
  getHealthDetail,
  type ErrorSummaryResponse,
} from "./api-client";

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

function validHealthHeartbeats() {
  return Object.fromEntries(HEALTH_HEARTBEAT_NAMES.map((name) => [name, {
    name,
    status: "ok",
    lastBeatAt: "2026-01-01T00:00:00.000Z",
    lastSuccessAt: "2026-01-01T00:00:00.000Z",
    lastErrorAt: null,
    lastError: null,
    ageSeconds: 1,
    metadata: null,
  }]));
}

function validHealth() {
  return {
    status: "healthy",
    timestamp: "2026-01-01T00:00:00.000Z",
    uptimeSeconds: 10,
    version: "0.1.0",
    backend: { pid: 1, nodeEnv: "test", port: 3002 },
    db: { ok: true, path: null, sizeBytes: 1024, criticalTables: { Message: 0 } },
    zalo: { connected: false, listenerStarted: false, uid: null, lastConnectedAt: null, lastError: null },
    autoReply: { enabled: false, dryRun: true, allowedThreadsCount: 0, cooldownSeconds: 10, activeCooldowns: 0 },
    worker: { active: false, queuedJobs: 0, failedJobs24h: 0 },
    backup: { latestBackupAt: null, latestBackupName: null, backupCount: 0, latestBackupAgeHours: null },
    processLock: { locked: false, ownerPid: null, isOwner: false, startedAt: null },
    config: { status: "CONFIG_OK", pass: 1, warn: 0, error: 0 },
    messages: { inbound24h: 0, outbound24h: 0, lastInboundAt: null, lastOutboundAt: null },
    errors: { failedAgentTasks24h: 0, failedExecutions24h: 0 },
    heartbeats: validHealthHeartbeats(),
    allowedThreadsReview: { count: 0, highRiskCount: 0, groupCount: 0, unknownCount: 0 },
    errorsSummary: { status: "ok", errors24h: 0, warnings24h: 0, topErrorCode: null, lastErrorAt: null },
  };
}

function validErrorSummary(): ErrorSummaryResponse {
  return {
    windowHours: 24,
    status: "ok",
    totals: { errors: 0, warnings: 0, failedAgentTasks: 0, failedExecutions: 0, blockedOutbound: 0, staleHeartbeats: 0 },
    groups: [],
    recent: [],
  };
}

describe("Batch 4 remote contract validation", () => {
  it("rejects a health payload missing a required nested counter", async () => {
    const payload = validHealth();
    delete (payload.worker as { failedJobs24h?: number }).failedJobs24h;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(getHealthDetail()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects an incomplete config-check payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "CONFIG_OK", checks: [] })));

    await expect(getConfigCheck()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects contradictory error summary evidence", async () => {
    const payload = validErrorSummary();
    payload.status = "ok";
    payload.groups = [{
      source: "Heartbeat",
      errorCode: "stale",
      count: 1,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      severity: "medium",
    }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(getErrorSummary()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("Batch 4 page wiring contracts", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const errorsPage = readFileSync(resolve(here, "../app/errors/page.tsx"), "utf8");
  const healthPage = readFileSync(resolve(here, "../app/system-health/page.tsx"), "utf8");

  it("removes the errors-page Test Alert mutation and uses unknown state", () => {
    expect(errorsPage).not.toContain("triggerTestAlert");
    expect(errorsPage).not.toContain("Test Alert");
    expect(errorsPage).toContain("RemoteDataState");
    expect(errorsPage).toContain("unknownState");
    expect(errorsPage).toContain('status === "unknown"');
  });

  it("does not swallow system-health config/heartbeat failures", () => {
    expect(healthPage).not.toContain("getConfigCheck().catch(() => null)");
    expect(healthPage).not.toContain(".catch(() => {})");
    expect(healthPage).toContain("RemoteDataState");
    expect(healthPage).toContain("unknownState");
    expect(healthPage).toContain('status === "unknown"');
  });
});
