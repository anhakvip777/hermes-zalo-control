import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, readFileSync } from "node:fs";
import {
  acquireProcessLock,
  releaseProcessLock,
  isLockOwner,
  checkProcessLock,
  readLockFile,
} from "../process-lock.js";

const LOCK_FILE = "/tmp/hermes-zalo-control/backend.lock";
const LOCK_DIR = "/tmp/hermes-zalo-control";

function ensureLockDir() {
  mkdirSync(LOCK_DIR, { recursive: true });
}

function cleanupLock() {
  try {
    if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE);
  } catch { /* ok */ }
}

function writeFakeLock(pid: number) {
  ensureLockDir();
  writeFileSync(
    LOCK_FILE,
    JSON.stringify({
      pid,
      startedAt: new Date().toISOString(),
      port: 3002,
      cwd: "/tmp",
      cmd: "fake",
    }),
    "utf-8"
  );
}

describe("Process Lock — acquire", () => {
  afterEach(cleanupLock);
  beforeAll(ensureLockDir);

  it("acquires lock when no lock exists", () => {
    cleanupLock();
    const lock = acquireProcessLock();
    expect(lock.pid).toBe(process.pid);
    expect(existsSync(LOCK_FILE)).toBe(true);
    expect(isLockOwner()).toBe(true);
    releaseProcessLock();
  });

  it("lock file contains valid JSON with expected fields", () => {
    cleanupLock();
    acquireProcessLock();
    const raw = readFileSync(LOCK_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.pid).toBe(process.pid);
    expect(parsed.port).toBeGreaterThan(0);
    expect(parsed.startedAt).toBeTruthy();
    expect(parsed.cwd).toBeTruthy();
    releaseProcessLock();
  });

  it("blocks acquisition when another live lock exists (current PID)", () => {
    cleanupLock();
    writeFakeLock(process.pid); // current PID, always alive

    expect(() => acquireProcessLock()).toThrow(/PROCESS_LOCK_CONFLICT/);
  });

  it("cleans up stale lock (dead PID) and acquires", () => {
    cleanupLock();
    writeFakeLock(99999); // dead PID

    const lock = acquireProcessLock();
    expect(lock.pid).toBe(process.pid);
    expect(isLockOwner()).toBe(true);

    const raw = readFileSync(LOCK_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.pid).toBe(process.pid);
    releaseProcessLock();
  });
});

describe("Process Lock — release", () => {
  afterEach(cleanupLock);
  beforeAll(ensureLockDir);

  it("release removes the lock file", () => {
    cleanupLock();
    acquireProcessLock();
    expect(existsSync(LOCK_FILE)).toBe(true);
    releaseProcessLock();
    expect(existsSync(LOCK_FILE)).toBe(false);
  });

  it("release is idempotent (no crash if no lock)", () => {
    cleanupLock();
    expect(() => releaseProcessLock()).not.toThrow();
  });
});

describe("Process Lock — override env", () => {
  afterEach(() => {
    cleanupLock();
    delete process.env.ALLOW_MULTIPLE_BACKEND_INSTANCES;
  });
  beforeAll(ensureLockDir);

  it("allows multiple with ALLOW_MULTIPLE_BACKEND_INSTANCES=true (current PID)", () => {
    cleanupLock();
    writeFakeLock(process.pid); // current PID always alive

    process.env.ALLOW_MULTIPLE_BACKEND_INSTANCES = "true";
    expect(() => acquireProcessLock()).not.toThrow();
    releaseProcessLock();
  });
});

describe("Process Lock — isLockOwner", () => {
  afterEach(cleanupLock);
  beforeAll(ensureLockDir);

  it("returns true when current PID owns lock", () => {
    cleanupLock();
    acquireProcessLock();
    expect(isLockOwner()).toBe(true);
    releaseProcessLock();
  });

  it("returns false when no lock exists", () => {
    cleanupLock();
    expect(isLockOwner()).toBe(false);
  });

  it("returns false when another PID owns lock", () => {
    cleanupLock();
    writeFakeLock(process.pid + 1); // another PID (likely doesn't exist = stale, so isLockOwner returns false)
    expect(isLockOwner()).toBe(false);
  });
});

describe("Process Lock — checkProcessLock", () => {
  afterEach(cleanupLock);
  beforeAll(ensureLockDir);

  it("reports not locked when no lock file", () => {
    cleanupLock();
    const result = checkProcessLock();
    expect(result.locked).toBe(false);
    expect(result.info).toBeNull();
  });

  it("reports locked + not stale when current PID has lock", () => {
    cleanupLock();
    writeFakeLock(process.pid);
    const result = checkProcessLock();
    expect(result.locked).toBe(true);
    expect(result.stale).toBe(false);
    expect(result.info!.pid).toBe(process.pid);
  });

  it("reports locked + stale when dead PID has lock", () => {
    cleanupLock();
    writeFakeLock(99999);
    const result = checkProcessLock();
    expect(result.locked).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.info!.pid).toBe(99999);
  });
});

describe("Process Lock — module loads", () => {
  it("imports without error", async () => {
    const mod = await import("../process-lock.js");
    expect(mod.acquireProcessLock).toBeDefined();
    expect(mod.releaseProcessLock).toBeDefined();
    expect(mod.isLockOwner).toBeDefined();
    expect(mod.checkProcessLock).toBeDefined();
  });
});
