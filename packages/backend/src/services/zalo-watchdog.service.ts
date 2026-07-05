// =============================================================================
// Zalo Watchdog — periodic listener/session recovery (KI-H2)
// =============================================================================
// A listener can die WITHOUT emitting a WS close/error (the observed ~20-min
// silent drop in Step 5). The gateway's WS handlers cover the event-driven case;
// this watchdog covers the "connected but listener not active" case by polling.
//
// SAFETY: only asks the gateway to restore the session/listener. It NEVER enables
// autoReply, structured bridge, or flips dryRun/live. When disconnected it does
// nothing (no auto-QR). Decision logic lives in the pure `zalo-recovery` module.
// =============================================================================

import { getZaloGateway } from "./zalo-gateway.service.js";
import { evaluateRecovery } from "./zalo-recovery.js";

const WATCHDOG_INTERVAL_MS = parseInt(process.env.ZALO_WATCHDOG_INTERVAL_MS ?? "45000", 10);
// Stale-heartbeat trigger is DISABLED by default (0): message-arrival age is not a
// reliable liveness signal on quiet threads (would cause false reconnects). Set a
// positive value to opt in. The `connected && !listenerActive` trigger is always on.
const LISTENER_STALE_SECONDS = parseInt(process.env.ZALO_LISTENER_STALE_SECONDS ?? "0", 10);

let watchdogTimer: ReturnType<typeof setInterval> | null = null;

/** Run one watchdog evaluation tick. Exported for tests. Never throws. */
export function runWatchdogTick(): void {
  try {
    const gw = getZaloGateway();
    const rec = gw.getRecoveryStatus();
    const decision = evaluateRecovery({
      connected: gw.isConnected(),
      listenerActive: rec.listenerActive,
      listenerHeartbeatAgeSeconds: LISTENER_STALE_SECONDS > 0 ? rec.listenerHeartbeatAgeSeconds : null,
      reconnectInProgress: gw.isReconnectInProgress(),
      recoveryState: rec.recoveryState,
      staleThresholdSeconds: LISTENER_STALE_SECONDS,
    });
    if (decision.action === "reconnect") {
      gw.requestRecovery(`watchdog:${decision.reason}`);
    }
  } catch (err: unknown) {
    console.error(`[watchdog] tick error: ${(err as Error)?.message ?? "unknown"}`);
  }
}

/** Start the periodic watchdog. Idempotent. Timer is unref'd so it never blocks exit. */
export function startZaloWatchdog(): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(runWatchdogTick, WATCHDOG_INTERVAL_MS);
  if (typeof (watchdogTimer as { unref?: () => void }).unref === "function") {
    (watchdogTimer as { unref: () => void }).unref();
  }
  console.log(
    `[watchdog] Zalo listener watchdog started (interval=${WATCHDOG_INTERVAL_MS}ms, ` +
    `staleThreshold=${LISTENER_STALE_SECONDS}s${LISTENER_STALE_SECONDS === 0 ? " [disabled]" : ""})`,
  );
}

export function stopZaloWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}
