// =============================================================================
// KI-H2 — listener/session auto-recovery (DB-free)
// =============================================================================
// Unit tests for the pure recovery decision + backoff helpers, plus the gateway
// recovery-status shape. No DB, no network, no timers fired against live Zalo.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  evaluateRecovery,
  computeBackoffDelay,
  shouldGiveUp,
  type RecoverySignals,
} from "../services/zalo-recovery.js";
import { config } from "../config.js";
import { ZaloGatewayService } from "../services/zalo-gateway.service.js";

function signals(overrides: Partial<RecoverySignals> = {}): RecoverySignals {
  return {
    connected: true,
    listenerActive: true,
    listenerHeartbeatAgeSeconds: 5,
    reconnectInProgress: false,
    recoveryState: "idle",
    staleThresholdSeconds: 0,
    ...overrides,
  };
}

describe("KI-H2 evaluateRecovery", () => {
  it("case 2: listenerActive=false while connected → reconnect scheduled", () => {
    const d = evaluateRecovery(signals({ listenerActive: false }));
    expect(d.action).toBe("reconnect");
    expect(d.reason).toBe("listener_inactive_while_connected");
  });

  it("case 1: heartbeat stale (with positive threshold) → reconnect", () => {
    const d = evaluateRecovery(
      signals({ listenerActive: true, listenerHeartbeatAgeSeconds: 200, staleThresholdSeconds: 90 }),
    );
    expect(d.action).toBe("reconnect");
    expect(d.reason).toContain("listener_heartbeat_stale");
  });

  it("stale trigger DISABLED by default (threshold 0) → no false reconnect on quiet thread", () => {
    const d = evaluateRecovery(
      signals({ listenerActive: true, listenerHeartbeatAgeSeconds: 999999, staleThresholdSeconds: 0 }),
    );
    expect(d.action).toBe("none");
    expect(d.reason).toBe("healthy");
  });

  it("case 6: disconnected → no action (no auto-QR; outbound stays blocked elsewhere)", () => {
    const d = evaluateRecovery(signals({ connected: false, listenerActive: false }));
    expect(d.action).toBe("none");
    expect(d.reason).toBe("not_connected");
  });

  it("does not pile on while a recovery is scheduled/reconnecting/in-progress", () => {
    expect(evaluateRecovery(signals({ listenerActive: false, recoveryState: "scheduled" })).action).toBe("none");
    expect(evaluateRecovery(signals({ listenerActive: false, recoveryState: "reconnecting" })).action).toBe("none");
    expect(evaluateRecovery(signals({ listenerActive: false, reconnectInProgress: true })).action).toBe("none");
  });

  it("case 3: exhausted recovery (error state) → no further reconnect", () => {
    const d = evaluateRecovery(signals({ listenerActive: false, recoveryState: "error" }));
    expect(d.action).toBe("none");
    expect(d.reason).toBe("recovery_exhausted");
  });

  it("healthy connected+active listener → no action", () => {
    expect(evaluateRecovery(signals()).action).toBe("none");
  });

  it("case 5: evaluating recovery never mutates safety flags", () => {
    const before = {
      autoReply: config.autoReply.enabled,
      bridge: config.hermesAgentBridge.enabled,
      dryRun: config.zalo.dryRun,
    };
    evaluateRecovery(signals({ listenerActive: false }));
    expect(config.autoReply.enabled).toBe(before.autoReply);
    expect(config.hermesAgentBridge.enabled).toBe(before.bridge);
    expect(config.zalo.dryRun).toBe(before.dryRun);
    // And the safe defaults hold for this task.
    expect(config.autoReply.enabled).toBe(false);
    expect(config.hermesAgentBridge.enabled).toBe(false);
  });
});

describe("KI-H2 backoff + give-up", () => {
  it("computeBackoffDelay grows exponentially and caps", () => {
    expect(computeBackoffDelay(0, 60_000)).toBe(1000);
    expect(computeBackoffDelay(1, 60_000)).toBe(2000);
    expect(computeBackoffDelay(2, 60_000)).toBe(4000);
    expect(computeBackoffDelay(3, 60_000)).toBe(8000);
    expect(computeBackoffDelay(10, 60_000)).toBe(60_000); // capped
    expect(computeBackoffDelay(-5, 60_000)).toBe(1000); // guarded
  });

  it("case 3: shouldGiveUp true once attempts reach the max", () => {
    expect(shouldGiveUp(9, 10)).toBe(false);
    expect(shouldGiveUp(10, 10)).toBe(true);
    expect(shouldGiveUp(11, 10)).toBe(true);
  });
});

describe("KI-H2 gateway recovery status (case 7: status includes recovery fields)", () => {
  it("getRecoveryStatus exposes all recovery fields on a fresh gateway", () => {
    const gw = new ZaloGatewayService();
    const r = gw.getRecoveryStatus();
    expect(r).toHaveProperty("recoveryState", "idle");
    expect(r).toHaveProperty("reconnectAttempts", 0);
    expect(r).toHaveProperty("maxReconnectAttempts");
    expect(r).toHaveProperty("lastReconnectAt", null);
    expect(r).toHaveProperty("lastReconnectError", null);
    expect(r).toHaveProperty("listenerActive", false);
    expect(r).toHaveProperty("listenerHeartbeatAgeSeconds", null);
    expect(r.maxReconnectAttempts).toBeGreaterThan(0);
  });

  it("a brand-new gateway is not connected and listener not active (outbound stays blocked)", () => {
    const gw = new ZaloGatewayService();
    expect(gw.isConnected()).toBe(false);
    expect(gw.isListenerActive()).toBe(false);
  });
});
