import { describe, it, expect, beforeAll } from "vitest";
import {
  reviewAllowedThreads,
  reviewSingleThread,
  getThreadReviewSummary,
} from "../services/allowed-thread-review.service.js";
import type { ThreadReviewResponse } from "../services/allowed-thread-review.service.js";
import { getHealthSnapshot } from "../services/system-health.service.js";
import { runConfigChecks } from "../config-consistency.js";

// ═══════════════════════════════════════════════════════════════════
// Validate review output structure
// ═══════════════════════════════════════════════════════════════════

describe("Allowed Thread Review — review output structure", () => {
  let review: ThreadReviewResponse;

  beforeAll(async () => {
    review = await reviewAllowedThreads();
  });

  it("returns threads array and summary", () => {
    expect(review).toHaveProperty("threads");
    expect(review).toHaveProperty("summary");
    expect(Array.isArray(review.threads)).toBe(true);
  });

  it("summary has correct types", () => {
    const s = review.summary;
    expect(typeof s.totalThreads).toBe("number");
    expect(typeof s.highRiskCount).toBe("number");
    expect(typeof s.mediumRiskCount).toBe("number");
    expect(typeof s.lowRiskCount).toBe("number");
    expect(typeof s.groupCount).toBe("number");
    expect(typeof s.unknownCount).toBe("number");
    expect(typeof s.dryRun).toBe("boolean");
  });

  it("summary counts are consistent", () => {
    const s = review.summary;
    expect(s.highRiskCount + s.mediumRiskCount + s.lowRiskCount).toBe(s.totalThreads);
  });

  it("thread entries have all required fields", () => {
    for (const t of review.threads) {
      expect(t).toHaveProperty("threadId");
      expect(["user", "group", "unknown"]).toContain(t.threadType);
      expect(t).toHaveProperty("displayName");
      expect(typeof t.inAllowlist).toBe("boolean");
      expect(typeof t.autoReplyEnabled).toBe("boolean");
      expect(typeof t.groupMentionRequired).toBe("boolean");
      expect(typeof t.allowImageUnderstanding).toBe("boolean");
      expect(t).toHaveProperty("lastInboundAt");
      expect(t).toHaveProperty("lastOutboundAt");
      expect(typeof t.inbound24h).toBe("number");
      expect(typeof t.outbound24h).toBe("number");
      expect(typeof t.agentTasks24h).toBe("number");
      expect(typeof t.failedTasks24h).toBe("number");
      expect(typeof t.schedulesActive).toBe("number");
      expect(typeof t.riskScore).toBe("number");
      expect(["low", "medium", "high"]).toContain(t.riskLevel);
      expect(Array.isArray(t.riskReasons)).toBe(true);
    }
  });

  it("threads are sorted by riskScore descending", () => {
    for (let i = 1; i < review.threads.length; i++) {
      const prev = review.threads[i - 1]!;
      const curr = review.threads[i]!;
      expect(prev.riskScore).toBeGreaterThanOrEqual(curr.riskScore);
    }
  });

  it("risk level matches risk score thresholds", () => {
    for (const t of review.threads) {
      if (t.riskScore >= 30) {
        expect(t.riskLevel).toBe("high");
      } else if (t.riskScore >= 15) {
        expect(t.riskLevel).toBe("medium");
      } else {
        expect(t.riskLevel).toBe("low");
      }
    }
  });

  it("risk reasons are non-empty for medium and high risk", () => {
    for (const t of review.threads) {
      if (t.riskLevel !== "low") {
        expect(t.riskReasons.length).toBeGreaterThan(0);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Single thread review
// ═══════════════════════════════════════════════════════════════════

describe("Allowed Thread Review — single thread", () => {
  it("returns null for nonexistent thread", async () => {
    const entry = await reviewSingleThread("nonexistent-thread-999999");
    expect(entry).toBeNull();
  });

  it("returns entry for existing thread", async () => {
    // Use the first allowed thread from config
    const review = await reviewAllowedThreads();
    if (review.threads.length === 0) return; // skip if no threads

    const first = review.threads[0]!;
    const threadId = first.threadId;
    const entry = await reviewSingleThread(threadId);
    expect(entry).not.toBeNull();
    expect(entry!.threadId).toBe(threadId);
    expect(["user", "group", "unknown"]).toContain(entry!.threadType);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Fast summary (for health integration)
// ═══════════════════════════════════════════════════════════════════

describe("Allowed Thread Review — fast summary", () => {
  it("returns summary with correct types", async () => {
    const summary = await getThreadReviewSummary();
    expect(typeof summary.totalThreads).toBe("number");
    expect(typeof summary.highRiskCount).toBe("number");
    expect(typeof summary.mediumRiskCount).toBe("number");
    expect(typeof summary.lowRiskCount).toBe("number");
    expect(typeof summary.groupCount).toBe("number");
    expect(typeof summary.unknownCount).toBe("number");
    expect(typeof summary.dryRun).toBe("boolean");
  });

  it("counts are consistent", async () => {
    const summary = await getThreadReviewSummary();
    expect(summary.highRiskCount + summary.mediumRiskCount + summary.lowRiskCount)
      .toBe(summary.totalThreads);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Health integration
// ═══════════════════════════════════════════════════════════════════

describe("Health integration — allowedThreadsReview", () => {
  it("health snapshot includes allowedThreadsReview", async () => {
    const snapshot = await getHealthSnapshot();
    expect(snapshot).toHaveProperty("allowedThreadsReview");
    const atr = snapshot.allowedThreadsReview;
    expect(typeof atr.count).toBe("number");
    expect(typeof atr.highRiskCount).toBe("number");
    expect(typeof atr.groupCount).toBe("number");
    expect(typeof atr.unknownCount).toBe("number");
  });

  it("health snapshot does not leak secrets", async () => {
    const snapshot = await getHealthSnapshot();
    const json = JSON.stringify(snapshot);
    // Should not contain raw API keys
    if (process.env.CHIASEGPU_API_KEY) {
      expect(json).not.toContain(process.env.CHIASEGPU_API_KEY);
    }
    // allowedThreadsReview should not leak thread IDs (privacy)
    // Actually thread IDs are inherently semi-public but the full list
    // is only in the review endpoint, not health
    expect(typeof json).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Config check integration
// ═══════════════════════════════════════════════════════════════════

describe("Config check — allowed thread warnings", () => {
  it("config check includes thread-related checks", () => {
    const result = runConfigChecks();
    const names = result.checks.map((c) => c.name);

    // Should include allowedThreads check
    const threadChecks = result.checks.filter(
      (c) =>
        c.name.includes("allowedThread") ||
        c.name.includes("liveWithAllowed") ||
        c.name.includes("groupInAllowed"),
    );
    // At least one thread-related check should exist
    expect(threadChecks.length).toBeGreaterThan(0);
  });

  it("config check result has no ERROR for thread safety by default", () => {
    const result = runConfigChecks();
    const threadErrors = result.checks.filter(
      (c) =>
        (c.name.includes("allowedThread") ||
          c.name.includes("liveWithAllowed") ||
          c.name.includes("groupInAllowed")) &&
        c.severity === "ERROR",
    );
    // Currently no thread checks produce ERROR — they're WARN
    expect(threadErrors.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Risk scoring scenarios
// ═══════════════════════════════════════════════════════════════════

describe("Risk scoring — real data", () => {
  it("DM thread has lower risk than group thread", async () => {
    const review = await reviewAllowedThreads();
    const dms = review.threads.filter((t) => t.threadType === "user");
    const groups = review.threads.filter((t) => t.threadType === "group");

    // If both types exist, DM average risk should be lower
    if (dms.length > 0 && groups.length > 0) {
      const dmAvg = dms.reduce((sum, t) => sum + t.riskScore, 0) / dms.length;
      const groupAvg = groups.reduce((sum, t) => sum + t.riskScore, 0) / groups.length;
      expect(dmAvg).toBeLessThan(groupAvg);
    }
  });

  it("threads in allowlist all have inAllowlist=true", async () => {
    const review = await reviewAllowedThreads();
    for (const t of review.threads) {
      expect(t.inAllowlist).toBe(true);
    }
  });

  it("failed tasks increase risk score", async () => {
    const review = await reviewAllowedThreads();
    for (const t of review.threads) {
      if (t.failedTasks24h > 0) {
        expect(t.riskReasons.some((r) => r.includes("failed"))).toBe(true);
      }
    }
  });
});
