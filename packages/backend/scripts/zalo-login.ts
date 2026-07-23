// =============================================================================
// Manual Zalo Login Script
// Run from repo root: npx tsx packages/backend/scripts/zalo-login.ts
// The gateway owns QR/session files; this wrapper reports status only.
// NEVER prints cookie/token/session VALUES.
// =============================================================================

import path from "node:path";
import { config } from "../src/config.js";
import {
  getZaloGateway,
  type ZaloGatewayStatus,
} from "../src/services/zalo-gateway.service.js";

const QR_PATH = path.resolve(config.zalo.sessionDir, "qr-current.png");
const LOGIN_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;
const TERMINAL_STATUSES = new Set<ZaloGatewayStatus["connectionStatus"]>([
  "connected",
  "blocked",
  "expired",
  "error",
]);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reportStatus(gateway: ReturnType<typeof getZaloGateway>): ZaloGatewayStatus & {
  qrAvailable: boolean;
  qrUpdatedAt: string | null;
} {
  const status = gateway.getStatus();
  console.log(
    `LOGIN_STATUS:${status.connectionStatus} qrAvailable=${status.qrAvailable} qrUpdatedAt=${status.qrUpdatedAt ?? "none"}`,
  );
  return status;
}

function blockedReason(status: ZaloGatewayStatus, fallback?: string): string {
  const rawReason = fallback ?? status.lastError ?? "UNKNOWN";
  return rawReason.startsWith("LOGIN_SAFETY_BLOCKED:")
    ? rawReason.slice("LOGIN_SAFETY_BLOCKED:".length)
    : rawReason;
}

async function waitForTerminalStatus(
  gateway: ReturnType<typeof getZaloGateway>,
  status: ReturnType<typeof reportStatus>,
): Promise<ReturnType<typeof reportStatus>> {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (!TERMINAL_STATUSES.has(status.connectionStatus) && Date.now() < deadline) {
    await wait(POLL_INTERVAL_MS);
    status = reportStatus(gateway);
  }
  return status;
}

async function main(): Promise<void> {
  const gateway = getZaloGateway();
  console.log("Hermes Zalo Control — Manual QR Login");
  console.log(`QR_PATH:${QR_PATH}`);

  let login: Awaited<ReturnType<typeof gateway.startLogin>>;
  try {
    login = await gateway.startLogin();
  } catch (error: unknown) {
    try {
      await gateway.cancelLogin();
    } catch {
      // Cleanup is best effort; preserve the original start error.
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`LOGIN_FAILED:${message}`);
    process.exitCode = 1;
    return;
  }

  if (login.status === "blocked") {
    const status = reportStatus(gateway);
    console.error(`LOGIN_SAFETY_BLOCKED:${blockedReason(status, login.reason)}`);
    process.exitCode = 1;
    return;
  }

  console.log(`LOGIN_START_STATUS:${login.status}`);
  let status = reportStatus(gateway);
  status = await waitForTerminalStatus(gateway, status);

  if (!TERMINAL_STATUSES.has(status.connectionStatus)) {
    try {
      await gateway.cancelLogin();
    } catch {
      // Cleanup is best effort; preserve the timeout outcome.
    }
  }

  if (status.connectionStatus === "connected") {
    console.log("LOGIN_SUCCESS");
    process.exit(0);
  }

  if (status.connectionStatus === "blocked") {
    console.error(`LOGIN_SAFETY_BLOCKED:${blockedReason(status, login.reason)}`);
  } else if (status.connectionStatus === "expired") {
    console.error("LOGIN_FAILED:QR_EXPIRED");
  } else if (status.connectionStatus === "error") {
    console.error(`LOGIN_FAILED:${status.lastError ?? "UNKNOWN"}`);
  } else {
    console.error("LOGIN_FAILED:QR_LOGIN_TIMEOUT");
  }
  process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LOGIN_FAILED:${message}`);
  process.exitCode = 1;
});
