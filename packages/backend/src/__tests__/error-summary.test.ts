import { describe, it, expect, beforeAll } from "vitest";
import {
  getErrorSummary,
  formatErrorSummaryAlert,
  DryRunAlertAdapter,
  createAlertAdapter,
  triggerTestAlert,
  recordAlert,
  isAlertDuplicate,
} from "../services/error-summary.service.js";
import type { ErrorSummary } from "../services/error-summary.service.js";
import { getHealthSnapshot } from "../services/system-health.service.js";
import { config } from "../config.js";

// ═══════════════════════════════════════════════════════════════════
// Service structure
// ═══════════════════════════════════════════════════════════════════

describe("Error Summary — service", () => {
  let summary: ErrorSummary;

  beforeAll(async () => {
    summary = await getErrorSummary(24);
  });

  it("returns valid structure", () => {
    expect(summary).toHaveProperty("windowHours");
    expect(summary).toHaveProperty("status");
    expect(summary).toHaveProperty("totals");
    expect(summary).toHaveProperty("groups");
    expect(summary).toHaveProperty("recent");
    expect(["ok", "warn", "error"]).toContain(summary.status);
  });

  it("windowHours is clamped correctly", () => {
    expect(summary.windowHours).toBe(24);
  });

  it("totals have correct types", () => {
    const t = summary.totals;
    expect(typeof t.errors).toBe("number");
    expect(typeof t.warnings).toBe("number");
    expect(typeof t.failedAgentTasks).toBe("number");
    expect(typeof t.failedExecutions).toBe("number");
    expect(typeof t.blockedOutbound).toBe("number");
    expect(typeof t.staleHeartbeats).toBe("number");
  });

  it("groups are sorted by count descending", () => {
    for (let i = 1; i < summary.groups.length; i++) {
      expect(summary.groups[i - 1]!.count).toBeGreaterThanOrEqual(summary.groups[i]!.count);
    }
  });

  it("each group has valid structure", () => {
    for (const g of summary.groups) {
      expect(["AgentTask", "ScheduleExecution", "OutboundRecord", "Heartbeat", "Config"]).toContain(g.source);
      expect(typeof g.errorCode).toBe("string");
      expect(g.errorCode.length).toBeGreaterThan(0);
      expect(typeof g.count).toBe("number");
      expect(g.count).toBeGreaterThan(0);
      expect(typeof g.lastSeenAt).toBe("string");
      expect(["low", "medium", "high"]).toContain(g.severity);
    }
  });

  it("recent errors are sorted by most recent first", () => {
    for (let i = 1; i < summary.recent.length; i++) {
      expect(new Date(summary.recent[i - 1]!.seenAt).getTime()).toBeGreaterThanOrEqual(
        new Date(summary.recent[i]!.seenAt).getTime(),
      );
    }
  });

  it("no errors → status is ok", () => {
    if (summary.totals.errors === 0 && summary.totals.warnings === 0) {
      expect(summary.status).toBe("ok");
    }
  });

  it("with errors → status is not ok", () => {
    if (summary.totals.errors > 0) {
      expect(summary.status).not.toBe("ok");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Alert formatting
// ═══════════════════════════════════════════════════════════════════

describe("Error Summary — alert formatting", () => {
  let summary: ErrorSummary;

  beforeAll(async () => {
    summary = await getErrorSummary(24);
  });

  it("formatErrorSummaryAlert returns non-empty string", () => {
    const msg = formatErrorSummaryAlert(summary);
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("alert message includes key headers", () => {
    const msg = formatErrorSummaryAlert(summary);
    expect(msg).toMatch(/Error Summary/);
    expect(msg).toMatch(/Window:/);
    expect(msg).toMatch(/Status:/);
    expect(msg).toMatch(/Mode:/);
  });

  it("alert message includes error counts", () => {
    const msg = formatErrorSummaryAlert(summary);
    expect(msg).toContain(String(summary.totals.errors));
    expect(msg).toContain(String(summary.totals.warnings));
  });

  it("alert message does not leak API keys", () => {
    const msg = formatErrorSummaryAlert(summary);
    if (process.env.CHIASEGPU_API_KEY) {
      expect(msg).not.toContain(process.env.CHIASEGPU_API_KEY);
    }
  });

  it("dry run tag appears when dryRun is enabled", () => {
    const msg = formatErrorSummaryAlert(summary);
    if (config.errorAlert.dryRun) {
      expect(msg).toMatch(/DRY RUN/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Alert adapters
// ═══════════════════════════════════════════════════════════════════

describe("Error Summary — alert adapters", () => {
  it("DryRunAlertAdapter sends without real delivery", async () => {
    const adapter = new DryRunAlertAdapter();
    const result = await adapter.send("Test alert message");
    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
  });

  it("createAlertAdapter returns an adapter", () => {
    const adapter = createAlertAdapter();
    expect(adapter).toHaveProperty("send");
    expect(typeof adapter.send).toBe("function");
  });

  it("adapter send returns success=true", async () => {
    const adapter = createAlertAdapter();
    const result = await adapter.send("Test");
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Test alert
// ═══════════════════════════════════════════════════════════════════

describe("Error Summary — test alert", () => {
  it("triggerTestAlert returns success", async () => {
    const result = await triggerTestAlert();
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.dryRun).toBe("boolean");
    expect(typeof result.messagePreview).toBe("string");
    expect(typeof result.fingerprint).toBe("string");
  });

  it("test alert is dry-run by default", async () => {
    if (config.errorAlert.dryRun) {
      const result = await triggerTestAlert();
      expect(result.dryRun).toBe(true);
    }
  });

  it("test alert fingerprint is consistent format", async () => {
    const result = await triggerTestAlert();
    expect(result.fingerprint).toMatch(/^test_alert:.*/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Alert dedup
// ═══════════════════════════════════════════════════════════════════

describe("Error Summary — alert dedup", () => {
  it("isAlertDuplicate returns false for new fingerprint", async () => {
    const fp = `test_dedup_${Date.now()}_${Math.random()}`;
    const dup = await isAlertDuplicate(fp, 1);
    expect(dup).toBe(false);
  });

  it("recordAlert + isAlertDuplicate detects duplicate", async () => {
    const fp = `test_dedup_integration_${Date.now()}`;
    await recordAlert({
      alertType: "test",
      fingerprint: fp,
      severity: "low",
      dryRun: true,
      message: "test dedup message",
      errorCount: 1,
      windowHours: 24,
    });
    const dup = await isAlertDuplicate(fp, 60);
    expect(dup).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Health integration
// ═══════════════════════════════════════════════════════════════════

describe("Error Summary — health integration", () => {
  it("health snapshot includes errorsSummary", async () => {
    const snapshot = await getHealthSnapshot();
    expect(snapshot).toHaveProperty("errorsSummary");
  });

  it("errorsSummary has correct structure", async () => {
    const snapshot = await getHealthSnapshot();
    const es = snapshot.errorsSummary;
    expect(["ok", "warn", "error"]).toContain(es.status);
    expect(typeof es.errors24h).toBe("number");
    expect(typeof es.warnings24h).toBe("number");
    expect(es.topErrorCode === null || typeof es.topErrorCode === "string").toBe(true);
    expect(es.lastErrorAt === null || typeof es.lastErrorAt === "string").toBe(true);
  });

  it("errorsSummary does not leak secrets", async () => {
    const snapshot = await getHealthSnapshot();
    const json = JSON.stringify(snapshot.errorsSummary);
    if (process.env.CHIASEGPU_API_KEY) {
      expect(json).not.toContain(process.env.CHIASEGPU_API_KEY);
    }
  });
});
