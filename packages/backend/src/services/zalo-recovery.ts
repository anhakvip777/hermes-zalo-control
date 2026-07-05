// =============================================================================
// Zalo Recovery — pure decision helpers (KI-H2)
// =============================================================================
// Dependency-free so both the gateway (backoff) and the watchdog (decision) can
// import it without a cycle, and so the logic is unit-testable in isolation.
//
// SAFETY: nothing here sends messages, touches sessions, or toggles
// autoReply/bridge/dryRun. It only decides WHETHER a recovery should be requested
// and HOW LONG to wait between attempts.
// =============================================================================

/** Exponential backoff: 1s, 2s, 4s, 8s … capped at capMs. */
export function computeBackoffDelay(attempt: number, capMs: number): number {
  const a = attempt < 0 ? 0 : attempt;
  return Math.min(1000 * Math.pow(2, a), capMs);
}

/** True once attempts reach the max (stop scheduling → terminal error state). */
export function shouldGiveUp(attempt: number, maxAttempts: number): boolean {
  return attempt >= maxAttempts;
}

export type RecoveryState = "idle" | "scheduled" | "reconnecting" | "error";

export interface RecoverySignals {
  connected: boolean;
  listenerActive: boolean;
  /** Age (seconds) since last confirmed listener liveness, or null if unknown/disabled. */
  listenerHeartbeatAgeSeconds: number | null;
  reconnectInProgress: boolean;
  recoveryState: RecoveryState;
  /** Age beyond which the listener heartbeat is considered stale. */
  staleThresholdSeconds: number;
}

export interface RecoveryDecision {
  action: "none" | "reconnect";
  reason: string;
}

/**
 * Decide whether the watchdog should request a recovery.
 *
 * Rules (safe-by-default):
 *  - Not connected → not this watchdog's job (needs restore/QR via ops); outbound
 *    stays blocked elsewhere. No auto-QR.
 *  - Already recovering / scheduled / exhausted → do not pile on.
 *  - Connected but listener inactive → recover (the documented WS-drop case).
 *  - Connected + active but listener heartbeat stale (only when a positive
 *    threshold + a known age are provided) → recover.
 */
export function evaluateRecovery(s: RecoverySignals): RecoveryDecision {
  if (!s.connected) return { action: "none", reason: "not_connected" };
  if (s.reconnectInProgress) return { action: "none", reason: "reconnect_in_progress" };
  if (s.recoveryState === "scheduled" || s.recoveryState === "reconnecting") {
    return { action: "none", reason: "recovery_in_progress" };
  }
  if (s.recoveryState === "error") return { action: "none", reason: "recovery_exhausted" };

  if (!s.listenerActive) {
    return { action: "reconnect", reason: "listener_inactive_while_connected" };
  }

  if (
    s.staleThresholdSeconds > 0 &&
    s.listenerHeartbeatAgeSeconds != null &&
    s.listenerHeartbeatAgeSeconds > s.staleThresholdSeconds
  ) {
    return { action: "reconnect", reason: `listener_heartbeat_stale:${s.listenerHeartbeatAgeSeconds}s` };
  }

  return { action: "none", reason: "healthy" };
}
