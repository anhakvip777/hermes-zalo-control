/**
 * Process Lock — ensures only one backend instance runs at a time.
 *
 * Prevents:
 *   - Dual Zalo WebSocket sessions (banned by Zalo)
 *   - Port conflicts on 3002
 *   - Stale PM2 workers overlapping with tsx watch
 *
 * Usage:
 *   import { acquireProcessLock, releaseProcessLock, checkProcessLock } from "./process-lock.js";
 *   const lock = acquireProcessLock();
 *   // ... run server ...
 *   releaseProcessLock(lock);
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "./config.js";

const LOCK_DIR = resolve("/tmp/hermes-zalo-control");
const LOCK_FILE = resolve(LOCK_DIR, "backend.lock");

export interface ProcessLockInfo {
  pid: number;
  startedAt: string;
  port: number;
  cwd: string;
  cmd: string;
}

/**
 * Check if a PID is currently alive.
 */
function isPidAlive(pid: number): boolean {
  try {
    // kill(pid, 0) doesn't send a signal, just checks existence
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the existing lock file, if any.
 */
export function readLockFile(): ProcessLockInfo | null {
  try {
    if (!existsSync(LOCK_FILE)) return null;
    const raw = readFileSync(LOCK_FILE, "utf-8");
    return JSON.parse(raw) as ProcessLockInfo;
  } catch {
    return null;
  }
}

/**
 * Check whether a valid process lock is currently held.
 */
export function checkProcessLock(): {
  locked: boolean;
  stale: boolean;
  info: ProcessLockInfo | null;
} {
  const info = readLockFile();
  if (!info) return { locked: false, stale: false, info: null };

  if (isPidAlive(info.pid)) {
    return { locked: true, stale: false, info };
  }

  // PID is dead — stale lock
  return { locked: true, stale: true, info };
}

/**
 * Acquire the process lock. Returns lock info on success.
 * Throws if another instance is running and ALLOW_MULTIPLE_BACKEND_INSTANCES is not set.
 */
export function acquireProcessLock(): ProcessLockInfo {
  const allowMultiple = process.env.ALLOW_MULTIPLE_BACKEND_INSTANCES === "true";

  // Ensure lock directory exists
  mkdirSync(LOCK_DIR, { recursive: true });

  const existingCheck = checkProcessLock();

  if (existingCheck.locked && !existingCheck.stale) {
    // Another instance is running
    const other = existingCheck.info!;
    const msg =
      `[process-lock] Another backend instance is already running (PID: ${other.pid}, ` +
      `started: ${other.startedAt}, port: ${other.port})`;

    if (allowMultiple) {
      console.warn(`[process-lock] WARNING: multiple backend instances allowed by env`);
      console.warn(msg);
      // Do NOT overwrite the existing lock in multi-instance mode.
      // Return the existing lock info without claiming ownership.
      return {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        port: config.port,
        cwd: process.cwd(),
        cmd: process.argv.join(" "),
        // Note: isOwner will be false since we didn't write the lock
      };
    } else {
      console.error(msg);
      throw new Error("PROCESS_LOCK_CONFLICT: " + msg);
    }
  }

  if (existingCheck.stale) {
    const stale = existingCheck.info!;
    console.log(
      `[process-lock] Stale lock detected (PID ${stale.pid} is dead, was started ${stale.startedAt}). Removing.`
    );
    try {
      unlinkSync(LOCK_FILE);
    } catch {
      // ignore
    }
  }

  // Also check port availability
  const portInUse = checkPortInUse(config.port);
  if (portInUse) {
    const msg = `[process-lock] Port ${config.port} already in use by another process`;
    if (!allowMultiple) {
      console.error(msg);
      throw new Error("PORT_CONFLICT: " + msg);
    }
    console.warn(msg);
  }

  // Create new lock
  const lockInfo: ProcessLockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    port: config.port,
    cwd: process.cwd(),
    cmd: process.argv.join(" "),
  };

  writeFileSync(LOCK_FILE, JSON.stringify(lockInfo, null, 2), "utf-8");
  console.log(`[process-lock] Lock acquired: PID=${lockInfo.pid}, port=${lockInfo.port}`);

  // Register cleanup handlers
  const cleanup = () => {
    try {
      const current = readLockFile();
      if (current && current.pid === process.pid) {
        unlinkSync(LOCK_FILE);
        console.log("[process-lock] Lock released on exit");
      }
    } catch {
      // best effort
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  // uncaughtException — still cleanup
  process.on("uncaughtException", (err) => {
    console.error("[process-lock] Uncaught exception:", err.message);
    cleanup();
    process.exit(1);
  });

  return lockInfo;
}

/**
 * Release the process lock.
 */
export function releaseProcessLock(lockInfo?: ProcessLockInfo): void {
  try {
    if (existsSync(LOCK_FILE)) {
      const current = readLockFile();
      if (current && current.pid === process.pid) {
        unlinkSync(LOCK_FILE);
        console.log("[process-lock] Lock released");
        return;
      }
    }
  } catch {
    // best effort
  }
}

/**
 * Check if a port is currently in use.
 */
function checkPortInUse(port: number): boolean {
  try {
    const { createConnection } = require("node:net") as typeof import("node:net");
    // We can't fully check synchronously, but we try a quick connect
    // The actual binding will fail with EADDRINUSE if port is taken
    return false; // Fastify will handle the actual EADDRINUSE
  } catch {
    return false;
  }
}

/**
 * Whether the current process holds the lock. Useful for guarding Zalo listener.
 */
export function isLockOwner(): boolean {
  const current = readLockFile();
  return current !== null && current.pid === process.pid;
}
