// =============================================================================
// ZaloGatewayService — manages zca-js lifecycle, login, session, reconnect
// =============================================================================

import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, statSync, readdirSync, copyFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { config } from "../config.js";
import { heartbeatOk } from "./heartbeat.service.js";
import { getCurrentEffectiveDryRun } from "./runtime-config.service.js";
import {
  evaluateZaloLoginSafety,
  type ZaloLoginSafetyDecision,
  type ZaloLoginSafetyReason,
} from "./zalo-login-safety.service.js";
import { computeBackoffDelay } from "./zalo-recovery.js";
import { redact } from "./tool-gateway/redaction.js";

// Resolve zca-js from the project root node_modules.
// We resolve from process.cwd() which is always the project root when running via npm/tsx.
const projectRequire = createRequire(resolve(process.cwd(), "node_modules", "zca-js", "package.json"));

export type ConnectionStatus = "disconnected" | "connecting" | "waiting_qr_scan" | "expired" | "connected" | "error" | "blocked";

export interface ZaloGatewayStatus {
  connected: boolean;
  connectionStatus: ConnectionStatus;
  lastConnectedAt: string | null;
  lastError: string | null;
  selfUserId: string | null;
  selfDisplayName: string | null;
  dryRun: boolean;
}

export type ZaloQrReadResult =
  | { status: "ok"; data: Buffer; updatedAt: string }
  | { status: "not_found" }
  | { status: "blocked"; reason: ZaloLoginSafetyReason };

type ListenerHandler = (...args: any[]) => void;
type ListenerOperationGuard = () => boolean;

interface ListenerBindings {
  listener: any;
  message: ListenerHandler;
  reaction: ListenerHandler;
  disconnected: ListenerHandler;
  closed: ListenerHandler;
  error: ListenerHandler;
}

interface ActiveLoginOperation {
  generation: number;
  status: ZaloGatewayStatus;
  api: any;
  zalo: any;
  savedCredentials: Record<string, unknown> | null;
  listenerActive: boolean;
  listenerBindings: ListenerBindings | null;
  lastListenerBeatAt: string | null;
  stagedSessionPath: string | null;
}

interface ActiveRestoreOperation {
  generation: number;
  status: ZaloGatewayStatus;
  api: any;
  zalo: any;
  savedCredentials: Record<string, unknown> | null;
  listenerActive: boolean;
  listenerBindings: ListenerBindings | null;
  lastListenerBeatAt: string | null;
  stagedSessionPath: string | null;
}

interface SessionIdentity {
  selfUserId: string | null;
  selfDisplayName: string | null;
}

interface QrLoginArtifacts {
  zalo: any;
  api: any;
  credentials: Record<string, unknown> | null;
}

const SESSION_FILE = "zalo-session.json";
const LOGIN_TIMEOUT_MS = 120_000; // 2 minutes for QR scan

// ── Session quarantine (S1.1 — non-destructive error handling) ────────

/**
 * Rename a session file to a quarantined copy instead of deleting it.
 *
 * Reasons are sanitized to a short safe token:
 *   "expired" | "invalid" | "session-error" | "unknown"
 *
 * Example: zalo-session.json → zalo-session.json.expired-20260629-165300
 *
 * Returns the quarantine path on success, null if the source file doesn't exist.
 * Errors during rename are logged but never thrown — the caller continues gracefully.
 */
export function quarantineSessionFile(sessionPath: string, reason: string): string | null {
  try {
    if (!existsSync(sessionPath)) return null;

    // Sanitize reason to a safe filename token
    const safeReason = /^(expired|invalid|session|SESSION|login|logout)/i.test(reason)
      ? reason.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 20) || "session-error"
      : "unknown";

    // Timestamp: YYYYMMDD-HHMMSS
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const quarantinePath = `${sessionPath}.${safeReason}-${ts}`;
    renameSync(sessionPath, quarantinePath);

    console.log(`[zalo-gateway] Session quarantined: ${sessionPath} → ${quarantinePath} (reason: ${safeReason})`);
    return quarantinePath;
  } catch (err: unknown) {
    console.error(`[zalo-gateway] Session quarantine failed: ${(err as Error).message}`);
    return null;
  }
}


// ═══════════════════════════════════════════════════════════════════
// Minimal image dimension reader (no external deps)
// ═══════════════════════════════════════════════════════════════════

// ── Backup restore (ZR2 — restore session from backup before requiring QR) ──

/**
 * Locate the most recent session backup under backups/db/zalo-session-<timestamp>/ dir
 * (each holding a zalo-session.json copy). Directory names embed a sortable timestamp
 * (zalo-session-YYYYMMDDTHHMMSS...), so a reverse lexical sort gives the newest backup
 * first. Returns null if no backup dir or no session file inside it exists.
 */
/**
 * ZR2: Resolve the session-backup root regardless of process cwd.
 * Backups live at packages/backend/backups/db/, i.e. a sibling of the
 * zalo-session dir. PM2 runs with cwd=project-root, so anchoring on
 * process.cwd() would point at the wrong (near-empty) root dir. Anchor
 * on config.zalo.sessionDir instead, which is always packages/backend/zalo-session.
 */
function sessionBackupRoot(sessionDir = config.zalo.sessionDir): string {
  return resolve(sessionDir, "..", "backups", "db");
}

export function findLatestSessionBackup(sessionDir = config.zalo.sessionDir): string | null {
  try {
    const backupRoot = sessionBackupRoot(sessionDir);
    if (!existsSync(backupRoot)) return null;

    const candidates = readdirSync(backupRoot)
      .filter((name) => name.startsWith("zalo-session-"))
      .sort()
      .reverse(); // newest timestamp first

    for (const dirName of candidates) {
      const candidatePath = resolve(backupRoot, dirName, "zalo-session.json");
      if (existsSync(candidatePath)) return candidatePath;
    }
    return null;
  } catch (err: unknown) {
    console.error(`[zalo-gateway] findLatestSessionBackup failed: ${(err as Error).message}`);
    return null;
  }
}

function getImageDimensions(filePath: string): { width: number; height: number } | null {
  try {
    const buf = readFileSync(filePath);
    if (buf[0] === 0xFF && buf[1] === 0xD8) return readJPEG(buf);
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return readPNG(buf);
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return readGIF(buf);
    return null;
  } catch { return null; }
}

function readJPEG(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) return null;
    const marker = buf[i + 1];
    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function readPNG(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readGIF(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 10) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

async function imageMetadataGetter(filePath: string) {
  const dims = getImageDimensions(filePath);
  if (!dims) return { width: 0, height: 0 }; // fallback
  return dims;
}

export class ZaloGatewayService extends EventEmitter {
  private status: ZaloGatewayStatus;
  private statusEmissionInProgress = false;
  private api: any = null;
  private zalo: any = null;
  private savedCredentials: Record<string, unknown> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private readonly maxReconnectDelayMs = 60_000;
  // ── KI-H2: recovery state (surfaced to status; never toggles autoReply/live) ──
  private readonly maxReconnectAttempts = parseInt(process.env.ZALO_MAX_RECONNECT_ATTEMPTS ?? "10", 10);
  private recoveryState: "idle" | "scheduled" | "reconnecting" | "error" = "idle";
  private lastReconnectAt: string | null = null;
  private lastReconnectError: string | null = null;
  /** Last time we CONFIRMED listener liveness (start or inbound message). */
  private lastListenerBeatAt: string | null = null;
  private readonly sessionDir: string;
  private loginInProgress = false;
  private loginGeneration = 0;
  private activeLoginGeneration: number | null = null;
  private activeLoginOperation: ActiveLoginOperation | null = null;
  private loginCompletionGeneration: number | null = null;
  private restoreGeneration = 0;
  private activeRestoreGeneration: number | null = null;
  private activeRestoreOperation: ActiveRestoreOperation | null = null;
  private listenerActive = false;
  private listenerBindings: ListenerBindings | null = null;
  private qrUpdatedAt: string | null = null;
  /** ZR2: guards against concurrent reconnect attempts (race condition safety) */
  private reconnectInProgress = false;
  /** ZR2: records whether the last successful restoreSession() used the primary
   *  session file or a backup copy — read by reconnectZalo() for accurate messaging. */
  private lastRestoreSource: "primary" | "backup" | null = null;

  constructor() {
    super();
    this.sessionDir = config.zalo.sessionDir;
    this.status = {
      connected: false,
      connectionStatus: "disconnected",
      lastConnectedAt: null,
      lastError: null,
      selfUserId: null,
      selfDisplayName: null,
      dryRun: config.zalo.dryRun,
    };
  }

  getLoginSafetyDecision(): ZaloLoginSafetyDecision {
    return evaluateZaloLoginSafety({
      staticDryRun: config.zalo.dryRun,
      effectiveDryRun: getCurrentEffectiveDryRun(),
    });
  }

  /** Evaluate and apply the login gate to any operation currently in flight. */
  enforceLoginSafety(): ZaloLoginSafetyDecision {
    const decision = this.getLoginSafetyDecision();
    if (!decision.allowed) this.applyLoginSafetyBlock(decision.reason);
    return decision;
  }

  private invalidateActiveLogin(): void {
    const hasActiveLogin = this.loginInProgress || this.activeLoginGeneration !== null
      || this.activeLoginOperation !== null || this.loginCompletionGeneration !== null;
    const operation = this.activeLoginOperation;
    if (hasActiveLogin) {
      const cleanupSucceeded = !operation || this.removeStagedSession(operation);
      this.loginGeneration += 1;
      this.activeLoginGeneration = null;
      this.activeLoginOperation = cleanupSucceeded ? null : operation;
      this.loginCompletionGeneration = null;
      this.loginInProgress = false;
    }
    this.qrUpdatedAt = null;
    try {
      const qrPath = resolve(this.sessionDir, "qr-current.png");
      if (existsSync(qrPath)) unlinkSync(qrPath);
    } catch { /* non-critical */ }
  }

  /** Invalidate a restore that is waiting on zca-js or listener startup. */
  private invalidateActiveRestore(): void {
    if (this.activeRestoreGeneration === null && this.activeRestoreOperation === null) return;
    const operation = this.activeRestoreOperation;
    const cleanupSucceeded = !operation || this.removeStagedSession(operation);
    this.restoreGeneration += 1;
    this.activeRestoreGeneration = null;
    this.activeRestoreOperation = cleanupSucceeded ? null : operation;
  }

  private beginRestoreOperation(): ActiveRestoreOperation {
    const operation: ActiveRestoreOperation = {
      generation: ++this.restoreGeneration,
      status: { ...this.status },
      api: this.api,
      zalo: this.zalo,
      savedCredentials: this.savedCredentials,
      listenerActive: this.listenerActive,
      listenerBindings: this.listenerBindings,
      lastListenerBeatAt: this.lastListenerBeatAt,
      stagedSessionPath: null,
    };
    this.activeRestoreGeneration = operation.generation;
    this.activeRestoreOperation = operation;
    return operation;
  }

  private isCurrentRestoreOperation(generation: number): boolean {
    return this.activeRestoreGeneration === generation
      && this.activeRestoreOperation?.generation === generation;
  }

  private clearActiveRestoreOperation(generation: number): void {
    if (!this.isCurrentRestoreOperation(generation)) return;
    const operation = this.activeRestoreOperation;
    const cleanupSucceeded = !operation || this.removeStagedSession(operation);
    this.restoreGeneration += 1;
    this.activeRestoreGeneration = null;
    this.activeRestoreOperation = cleanupSucceeded ? null : operation;
  }

  private restoreOperationSnapshot(operation: ActiveRestoreOperation): void {
    this.removeStagedSession(operation);
    const currentBindings = this.listenerBindings;
    const ownsCurrentListener = currentBindings !== operation.listenerBindings
      || (!operation.listenerActive && this.listenerActive);
    if (ownsCurrentListener) {
      const currentListener = currentBindings?.listener
        ?? (this.api !== operation.api ? this.api?.listener : undefined);
      void this.stopListenerBindings(currentBindings, currentListener).catch(() => {});
    }

    const preserveExistingConnection = operation.status.connected || operation.listenerActive;
    this.api = preserveExistingConnection ? operation.api : null;
    this.zalo = preserveExistingConnection ? operation.zalo : null;
    this.savedCredentials = preserveExistingConnection ? operation.savedCredentials : null;
    this.listenerActive = operation.listenerActive;
    this.listenerBindings = operation.listenerBindings;
    this.lastListenerBeatAt = operation.lastListenerBeatAt;
    this.status = { ...operation.status };
  }

  private restoreAfterSafetyBlock(operation: ActiveRestoreOperation, lastError: string): void {
    this.restoreOperationSnapshot(operation);
    if (!operation.status.connected) {
      this.setStatus({ connected: false, connectionStatus: "blocked", lastError });
    } else {
      this.setStatus({});
    }
  }

  private restoreLoginOperationSnapshot(operation: ActiveLoginOperation): void {
    this.api = operation.api;
    this.zalo = operation.zalo;
    this.savedCredentials = operation.savedCredentials;
    this.listenerActive = operation.listenerActive;
    this.listenerBindings = operation.listenerBindings;
    this.lastListenerBeatAt = operation.lastListenerBeatAt;
    this.status = { ...operation.status };
  }

  private rollbackLoginOperation(operation: ActiveLoginOperation): void {
    const ownedBindings = this.listenerBindings !== operation.listenerBindings
      ? this.listenerBindings
      : null;
    this.restoreLoginOperationSnapshot(operation);
    this.invalidateActiveLogin();
    if (ownedBindings) {
      void this.stopListenerBindings(ownedBindings, ownedBindings.listener).catch(() => {});
    }
  }

  private async stopOperationStartedListener(
    operation: ActiveLoginOperation | ActiveRestoreOperation,
    bindings: ListenerBindings | null,
  ): Promise<void> {
    if (!bindings || bindings === operation.listenerBindings) return;
    await this.stopListenerBindings(bindings, bindings.listener);
    if (this.listenerBindings === bindings || this.listenerBindings === operation.listenerBindings) {
      this.listenerActive = operation.listenerActive;
      this.listenerBindings = operation.listenerBindings;
      this.lastListenerBeatAt = operation.lastListenerBeatAt;
    }
  }

  private applyLoginSafetyBlock(reason: ZaloLoginSafetyReason): void {
    // A safety block is terminal for automatic recovery. Attempts that were
    // scheduled but never executed must not count toward reconnect exhaustion.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.recoveryState = "idle";
    this.lastReconnectError = `LOGIN_SAFETY_BLOCKED:${reason}`;
    const loginOperation = this.activeLoginOperation;
    const ownsCurrentLogin = loginOperation !== null
      && loginOperation.generation === this.activeLoginGeneration
      && this.loginInProgress;
    const restoreOperation = this.activeRestoreOperation;
    const ownsCurrentRestore = restoreOperation !== null
      && restoreOperation.generation === this.activeRestoreGeneration;
    if (ownsCurrentLogin && loginOperation) {
      this.rollbackLoginOperation(loginOperation);
    } else {
      this.invalidateActiveLogin();
    }
    const lastError = this.lastReconnectError;
    if (ownsCurrentRestore && restoreOperation) {
      this.clearActiveRestoreOperation(restoreOperation.generation);
      this.restoreAfterSafetyBlock(restoreOperation, lastError);
      return;
    }
    this.invalidateActiveRestore();
    if (ownsCurrentLogin && loginOperation) {
      if (!loginOperation.status.connected) {
        this.setStatus({ connectionStatus: "blocked", lastError });
      } else {
        this.setStatus({});
      }
      return;
    }
    if (!this.status.connected && (this.status.connectionStatus !== "blocked" || this.status.lastError !== lastError)) {
      this.setStatus({
        connectionStatus: "blocked",
        lastError,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════

  getStatus(): ZaloGatewayStatus & { qrAvailable: boolean; qrUpdatedAt: string | null } {
    const decision = this.getLoginSafetyDecision();
    if (!decision.allowed && (
      this.loginInProgress
      || this.activeLoginGeneration !== null
      || this.activeLoginOperation !== null
      || this.activeRestoreGeneration !== null
      || this.activeRestoreOperation !== null
    )) {
      this.applyLoginSafetyBlock(decision.reason);
    }
    const hasCurrentQr = decision.allowed
      && this.loginInProgress
      && this.activeLoginGeneration !== null
      && this.activeLoginGeneration === this.loginGeneration
      && this.loginCompletionGeneration !== this.activeLoginGeneration
      && this.qrUpdatedAt !== null;
    const qrPath = resolve(this.sessionDir, "qr-current.png");
    let qrAvailable = false;
    if (hasCurrentQr) {
      try {
        // Use imported statSync — require("fs") fails silently in ESM modules
        const st = statSync(qrPath);
        qrAvailable = st.size > 500;
      } catch { /* file doesn't exist yet */ }
    }
    return { ...this.status, qrAvailable, qrUpdatedAt: this.qrUpdatedAt };
  }

  /**
   * Read only the QR artifact owned by the generation that was current when
   * the read started. Revalidate safety and ownership after the async file read
   * so a cancelled, refreshed, or replaced generation cannot leak stale bytes.
   */
  async readCurrentQr(): Promise<ZaloQrReadResult> {
    const initialDecision = this.enforceLoginSafety();
    if (!initialDecision.allowed) {
      return { status: "blocked", reason: initialDecision.reason };
    }

    const generation = this.activeLoginGeneration;
    const updatedAt = this.qrUpdatedAt;
    const ownsQrAtStart = this.loginInProgress
      && generation !== null
      && generation === this.loginGeneration
      && this.loginCompletionGeneration !== generation
      && updatedAt !== null;
    if (!ownsQrAtStart) return { status: "not_found" };

    let data: Buffer;
    try {
      data = await readFile(resolve(this.sessionDir, "qr-current.png"));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { status: "not_found" };
      }
      throw err;
    }

    const finalDecision = this.enforceLoginSafety();
    if (!finalDecision.allowed) {
      return { status: "blocked", reason: finalDecision.reason };
    }

    const stillOwnsQr = this.loginInProgress
      && this.activeLoginGeneration === generation
      && this.loginGeneration === generation
      && this.loginCompletionGeneration !== generation
      && this.qrUpdatedAt === updatedAt;
    if (!stillOwnsQr || data.length <= 500) return { status: "not_found" };

    return { status: "ok", data, updatedAt };
  }

  isConnected(): boolean {
    return this.status.connected;
  }

  isListenerActive(): boolean {
    return this.listenerActive;
  }

  /**
   * KI-H2: recovery/health snapshot for the watchdog + dashboard.
   * `listenerHeartbeatAgeSeconds` is derived from the last confirmed liveness
   * (listener start or inbound message) — it is informational; the watchdog's
   * safe trigger is `connected && !listenerActive`.
   */
  getRecoveryStatus(): {
    recoveryState: "idle" | "scheduled" | "reconnecting" | "error";
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    lastReconnectAt: string | null;
    lastReconnectError: string | null;
    listenerActive: boolean;
    lastListenerBeatAt: string | null;
    listenerHeartbeatAgeSeconds: number | null;
  } {
    const age = this.lastListenerBeatAt
      ? Math.round((Date.now() - new Date(this.lastListenerBeatAt).getTime()) / 1000)
      : null;
    return {
      recoveryState: this.recoveryState,
      reconnectAttempts: this.reconnectAttempt,
      maxReconnectAttempts: this.maxReconnectAttempts,
      lastReconnectAt: this.lastReconnectAt,
      lastReconnectError: this.lastReconnectError,
      listenerActive: this.listenerActive,
      lastListenerBeatAt: this.lastListenerBeatAt,
      listenerHeartbeatAgeSeconds: age,
    };
  }

  /**
   * KI-H2: watchdog entry point. Trigger recovery for a listener that dropped
   * while still "connected". Safe: only restores session/listener, NEVER enables
   * autoReply/bridge or flips dryRun/live. No-op if already recovering or exhausted.
   */
  requestRecovery(reason: string): boolean {
    const decision = this.getLoginSafetyDecision();
    if (!decision.allowed) {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.applyLoginSafetyBlock(decision.reason);
      this.recoveryState = "idle";
      this.lastReconnectError = `LOGIN_SAFETY_BLOCKED:${decision.reason}`;
      return false;
    }
    if (this.reconnectTimer || this.reconnectInProgress) return false;
    if (this.recoveryState === "error") return false; // exhausted → needs manual /ops/reconnect
    console.warn(`[watchdog] recovery requested: ${reason} (attempt=${this.reconnectAttempt})`);
    this.lastReconnectError = null;
    this.listenerActive = false; // reflect the dead listener in status immediately
    this.setStatus({ connectionStatus: "error", lastError: `RECOVERY:${reason}`.slice(0, 60) });
    this.scheduleReconnect();
    return true;
  }

  getApi(): any | null {
    return this.api;
  }

  getSelfUserId(): string | null {
    return this.status.selfUserId;
  }

  isLoginInProgress(): boolean {
    return this.loginInProgress;
  }

  /** ZR2: true while a reconnect (restore-from-backup or session-restore) is in flight. */
  isReconnectInProgress(): boolean {
    return this.reconnectInProgress;
  }

  /**
   * ZR2: atomically claim the reconnect lock. Returns false (does NOT set the flag)
   * if a reconnect is already running — caller must treat that as "reconnect_in_progress"
   * and must NOT start a second concurrent restore/login attempt.
   */
  beginReconnect(): boolean {
    if (this.reconnectInProgress) return false;
    this.reconnectInProgress = true;
    return true;
  }

  /** ZR2: release the reconnect lock. Always call in a finally block after beginReconnect(). */
  endReconnect(): void {
    this.reconnectInProgress = false;
  }

  /** Cancel a pending QR login (no-op if not in progress or already connected). */
  cancelLogin(): { cancelled: boolean; message: string } {
    if (!this.loginInProgress && this.activeLoginOperation === null) {
      return { cancelled: false, message: "No login in progress" };
    }
    // Roll back the exact QR operation before invalidating its generation. A
    // pending listener may already own API/credentials/bindings even though it
    // has not reached the final session commit.
    const operation = this.activeLoginOperation;
    if (operation && operation.generation === this.activeLoginGeneration) {
      this.rollbackLoginOperation(operation);
    } else {
      this.invalidateActiveLogin();
    }
    if (!this.status.connected) {
      this.setStatus({ connectionStatus: "disconnected", lastError: null });
    } else {
      this.setStatus({});
    }
    return { cancelled: true, message: "Login cancelled" };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Login — QR flow (non-blocking)
  // ═══════════════════════════════════════════════════════════════════

  async startLogin(): Promise<{ qrImage?: string; status: string; reason?: ZaloLoginSafetyReason }> {
    if (this.status.connected) {
      return { status: "already_connected", qrImage: "Zalo is already connected." };
    }

    const decision = this.getLoginSafetyDecision();
    if (!decision.allowed) {
      this.applyLoginSafetyBlock(decision.reason);
      return { status: "blocked", reason: decision.reason };
    }

    if (config.zalo.dryRun) {
      this.setConnected({ selfUserId: "dry-run-user", selfDisplayName: "Dry Run Bot" });
      return { status: "connected" };
    }

    // Prevent duplicate login jobs (H6)
    if (this.loginInProgress || this.activeLoginOperation !== null
      || this.activeRestoreGeneration !== null || this.activeRestoreOperation !== null) {
      return { status: "already_in_progress", qrImage: "Login already in progress. If QR expired, call POST /api/zalo/logout then try again." };
    }

    if (this.status.connected) {
      return { status: "already_connected", qrImage: "Zalo is already connected." };
    }

    try {
      // Try to restore existing session first (no QR needed)
      const restored = await this.restoreSession();
      if (restored) {
        return { status: "connected", qrImage: "Session restored from saved credentials." };
      }
      if (this.loginInProgress || this.activeLoginOperation !== null
        || this.activeRestoreGeneration !== null || this.activeRestoreOperation !== null) {
        return { status: "already_in_progress", qrImage: "Login already in progress. If QR expired, call POST /api/zalo/logout then try again." };
      }
      if (this.status.connected) {
        return { status: "already_connected", qrImage: "Zalo is already connected." };
      }
      const decisionAfterRestore = this.getLoginSafetyDecision();
      if (!decisionAfterRestore.allowed) {
        this.applyLoginSafetyBlock(decisionAfterRestore.reason);
        return { status: "blocked", reason: decisionAfterRestore.reason };
      }

      // No saved session — need QR login
      this.loginInProgress = true;
      const generation = ++this.loginGeneration;
      this.activeLoginGeneration = generation;
      this.activeLoginOperation = {
        generation,
        status: { ...this.status },
        api: this.api,
        zalo: this.zalo,
        savedCredentials: this.savedCredentials,
        listenerActive: this.listenerActive,
        listenerBindings: this.listenerBindings,
        lastListenerBeatAt: this.lastListenerBeatAt,
        stagedSessionPath: null,
      };
      this.setStatus({ connectionStatus: "connecting", lastError: null });

      // Start background login (fire-and-forget, but we track it)
      this.runLoginInBackground(generation).catch(() => {
        // Error already handled in runLoginInBackground
      });

      return { status: "connecting", qrImage: "Login started. QR code will appear at qr.png shortly." };
    } catch (err: unknown) {
      this.loginInProgress = false;
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus({ connectionStatus: "error", lastError: msg });
      this.scheduleReconnect();
      throw err;
    }
  }

  private isCurrentLogin(generation: number): boolean {
    if (!this.loginInProgress || this.activeLoginGeneration !== generation || this.loginGeneration !== generation) {
      return false;
    }
    const decision = this.getLoginSafetyDecision();
    if (!decision.allowed) {
      this.applyLoginSafetyBlock(decision.reason);
      return false;
    }
    return true;
  }

  private expireQrLogin(generation: number, _qrPath: string): void {
    if (!this.isCurrentLogin(generation)) return;
    const operation = this.activeLoginOperation;
    if (operation && operation.generation === generation) {
      this.rollbackLoginOperation(operation);
    } else {
      this.invalidateActiveLogin();
    }
    if (!this.status.connected) {
      this.setStatus({ connectionStatus: "expired", lastError: null });
    }
  }

  private async runLoginInBackground(generation: number): Promise<void> {
    try {
      if (!this.isCurrentLogin(generation)) return;
      const zca = projectRequire("zca-js");
      const zalo = new zca.Zalo({ imageMetadataGetter });

      let capturedCredentials: Record<string, unknown> | null = null;

      // C1 FIX: Ensure session dir exists BEFORE loginQR
      mkdirSync(this.sessionDir, { recursive: true });
      const loginQRPath = resolve(this.sessionDir, "qr-current.png");

      const loginPromise = zalo.loginQR(
        {
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
          language: "vi",
          qrPath: loginQRPath,
        },
        (event: { type: number; data: { image?: string; cookie?: unknown; imei?: string; userAgent?: string } }) => {
          if (!this.isCurrentLogin(generation) || this.loginCompletionGeneration === generation) return;
          // C1 FIX: Capture QR image from QRCodeGenerated callback (type=0)
          // zca-js v2 LoginQRCallbackEventType: QRCodeGenerated=0, QRCodeExpired=1, QRCodeScanned=2, QRCodeDeclined=3
          if ((event.type === 0 || String(event.type) === "QRCodeGenerated") && event.data?.image) {
            try {
              writeFileSync(loginQRPath, event.data.image, "base64");
              this.qrUpdatedAt = new Date().toISOString();
              this.setStatus({ connectionStatus: "waiting_qr_scan", lastError: null });
            } catch { /* non-critical */ }
          }

          // Mark QR as expired
          if ((event.type === 1 || String(event.type) === "QRCodeExpired")) {
            this.expireQrLogin(generation, loginQRPath);
          }

          // C1: Capture credentials from GotLoginInfo (this fires after QR is scanned)
          // The data includes cookie, imei, userAgent from zca-js v2
          if (event.data && (event.data.imei || (event.data as any).cookie)) {
            capturedCredentials = {
              imei: event.data.imei ?? null,
              cookie: event.data.cookie ?? (event.data as any).cookie ?? null,
              userAgent: event.data.userAgent ?? null,
              language: "vi",
            };
          }
        },
      );

      // QR is ready now — update status
      if (!this.isCurrentLogin(generation)) return;
      this.setStatus({ connectionStatus: "waiting_qr_scan" });

      const timeoutPromise = new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error("LOGIN_TIMEOUT: QR code was not scanned within 2 minutes")), LOGIN_TIMEOUT_MS),
      );

      const api = await Promise.race([loginPromise, timeoutPromise]);

      if (!this.isCurrentLogin(generation)) return;
      await this.onLoginSuccess(generation, {
        zalo,
        api,
        credentials: capturedCredentials,
      });
    } catch (err: unknown) {
      if (!this.isCurrentLogin(generation)) return;
      const msg = err instanceof Error ? err.message : String(err);
      const operation = this.activeLoginOperation;
      if (operation && operation.generation === generation) {
        this.rollbackLoginOperation(operation);
      } else {
        this.invalidateActiveLogin();
      }
      this.setStatus({ connectionStatus: "error", lastError: msg });
      this.scheduleReconnect();
    }
  }

  private async onLoginSuccess(generation: number, artifacts: QrLoginArtifacts): Promise<void> {
    if (!this.isCurrentLogin(generation)) return;
    const loginOperation = this.activeLoginOperation;
    if (!loginOperation) throw new Error("LOGIN_OPERATION_MISSING");
    const { zalo, api, credentials } = artifacts;
    const selfId = api.getOwnId?.() ?? null;
    const selfName = api.getOwnName?.() ?? null;

    // QR scan ownership has transferred to the returned API. Keep the
    // generation alive for cancellation/rollback guards, but immediately hide
    // the QR while persistence and listener startup are still pending.
    this.loginCompletionGeneration = generation;
    this.qrUpdatedAt = null;
    try {
      const qrPath = resolve(this.sessionDir, "qr-current.png");
      if (existsSync(qrPath)) unlinkSync(qrPath);
    } catch { /* non-critical */ }

    // Persist the identity without advertising a newly connected session.
    // A genuinely pre-existing connected snapshot remains truthful until the
    // new operation either commits or rolls back.
    if (!loginOperation?.status.connected) {
      if (!this.isCurrentLogin(generation)) return;
      this.setStatus({ selfUserId: selfId, selfDisplayName: selfName });
    }

    let startedBindings: ListenerBindings | null = null;
    try {
      // A QR connection is not ready unless its credentials are durably saved.
      if (!this.isCurrentLogin(generation)) return;
      await this.stageSessionOrThrow("login", loginOperation, {
        selfUserId: selfId,
        selfDisplayName: selfName,
      }, credentials);

      // Start message listener only after persistence succeeds.
      if (!this.isCurrentLogin(generation)) return;
      startedBindings = await this.startListener(() => this.isCurrentLogin(generation), api);
      if (!this.isCurrentLogin(generation)) {
        await this.stopOperationStartedListener(loginOperation, startedBindings);
        return;
      }
      if (!startedBindings) {
        throw new Error("LISTENER_START_FAILED:Listener did not start");
      }
    } catch (err: unknown) {
      if (this.activeLoginOperation === loginOperation && this.activeLoginGeneration === generation) {
        await this.stopOperationStartedListener(loginOperation, startedBindings);
        if (this.activeLoginOperation === loginOperation && this.activeLoginGeneration === generation) {
          this.rollbackLoginOperation(loginOperation);
          if (!loginOperation.status.connected) {
            const msg = err instanceof Error ? err.message : String(err);
            this.setStatus({ connected: false, connectionStatus: "error", lastError: msg });
          }
        }
      }
      throw err;
    }

    if (!this.isCurrentLogin(generation)) {
      await this.stopOperationStartedListener(loginOperation, startedBindings);
      return;
    }

    try {
      this.commitStagedSessionOrThrow(loginOperation);
    } catch (err: unknown) {
      if (this.activeLoginOperation === loginOperation && this.activeLoginGeneration === generation) {
        await this.stopOperationStartedListener(loginOperation, startedBindings);
        if (this.activeLoginOperation === loginOperation && this.activeLoginGeneration === generation) {
          this.rollbackLoginOperation(loginOperation);
          if (!loginOperation.status.connected) {
            const msg = err instanceof Error ? err.message : String(err);
            this.setStatus({ connected: false, connectionStatus: "error", lastError: msg });
          }
        }
      }
      throw err;
    }

    if (!this.isCurrentLogin(generation)) {
      await this.stopOperationStartedListener(loginOperation, startedBindings);
      return;
    }

    this.zalo = zalo;
    this.api = api;
    this.savedCredentials = credentials;
    this.publishStartedListener(startedBindings, api);

    if (!this.isCurrentLogin(generation)) return;
    this.setConnected({ selfUserId: selfId, selfDisplayName: selfName });
    if (!this.isCurrentLogin(generation)) return;
    this.invalidateActiveLogin();
    this.emit("ready", api);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Session persistence (C1)
  // ═══════════════════════════════════════════════════════════════════

  async restoreSession(options?: { startListener?: boolean }): Promise<boolean> {
    const startListener = options?.startListener ?? true; // default true for API

    const decision = this.getLoginSafetyDecision();
    if (!decision.allowed) {
      this.applyLoginSafetyBlock(decision.reason);
      return false;
    }

    // Login and restore share API, credentials, listener, and session commit
    // ownership. Never let a restore begin while any QR generation is active.
    if (this.loginInProgress || this.activeLoginGeneration !== null || this.activeLoginOperation !== null) {
      return false;
    }

    // A second restore must never replace the API/listener ownership of the
    // restore that is already waiting on zca-js or persistence.
    if (this.activeRestoreGeneration !== null || this.activeRestoreOperation !== null) return false;

    if (config.zalo.dryRun) {
      this.setConnected({ selfUserId: "dry-run-user", selfDisplayName: "Dry Run Bot" });
      return true;
    }

    this.lastRestoreSource = null;
    const sessionPath = resolve(this.sessionDir, SESSION_FILE);
    let restoreSourcePath = sessionPath;
    let restoredFromBackup = false;

    if (!existsSync(sessionPath)) {
      // ZR2: primary session file missing — before requiring QR, try the most
      // recent backup under backups/db/zalo-session-*/zalo-session.json.
      // Treat the backup as read-only restore input. The primary file is only
      // published by commitStagedSessionOrThrow after login, persistence, the
      // listener, and all safety rechecks have succeeded.
      const backupPath = findLatestSessionBackup(this.sessionDir);
      if (backupPath) {
        restoreSourcePath = backupPath;
        restoredFromBackup = true;
        console.log(`[zalo-gateway] ZR2: primary session missing, restoring from backup input: ${backupPath}`);
      }

      if (!restoredFromBackup) {
        this.setStatus({ connectionStatus: "error", lastError: "NO_SESSION_FILE" });
        // H1: Health degraded — session missing but dir exists (pre-created at startup)
        // Guidance: restore from backup (backups/db/zalo-session-*/) or login via QR
        console.log("Zalo auto-restore: NO_SESSION_FILE");
        console.log("  → No backup found either. Login fresh: POST /api/zalo/login (QR code)");
        heartbeatOk("zaloSession", { file: "missing", path: sessionPath }).catch(() => {});
        return false;
      }
    }

    const restoreOperation = this.beginRestoreOperation();
    const restoreGeneration = restoreOperation.generation;
    let startedBindings: ListenerBindings | null = null;
    try {
      const raw = readFileSync(restoreSourcePath, "utf-8");
      const sessionData = JSON.parse(raw);

      // If we have full credentials, use login() to restore
      if (sessionData.credentials) {
        const zca = projectRequire("zca-js");
        const restoredZalo = new zca.Zalo({ imageMetadataGetter });
        const restoredApi = await restoredZalo.login(sessionData.credentials);

        if (!this.isCurrentRestoreOperation(restoreGeneration)) return false;
        const decisionAfterLogin = this.getLoginSafetyDecision();
        if (!decisionAfterLogin.allowed) {
          this.applyLoginSafetyBlock(decisionAfterLogin.reason);
          return false;
        }

        // Keep the restored client and credentials operation-local until the
        // session file, listener and safety gates have all committed. This is
        // important when an existing listener is still serving the active
        // session: a failed/blocked restore must not replace or stop it.
        const restoredCredentials = sessionData.credentials as Record<string, unknown>;

        // Extract selfUserId if not already set
        const selfId = restoredApi.getOwnId?.() ?? sessionData.selfUserId ?? null;
        const selfName = restoredApi.getOwnName?.() ?? sessionData.selfDisplayName ?? null;

        if (!restoreOperation.status.connected) {
          this.setStatus({ selfUserId: selfId, selfDisplayName: selfName });
        }

        // Save refreshed credentials to BOTH primary + backup (S4 + ZR2)
        if (!this.isCurrentRestoreOperation(restoreGeneration)) return false;
        const decisionBeforePersist = this.getLoginSafetyDecision();
        if (!decisionBeforePersist.allowed) {
          this.applyLoginSafetyBlock(decisionBeforePersist.reason);
          return false;
        }
        await this.stageSessionOrThrow("restore", restoreOperation, {
          selfUserId: selfId,
          selfDisplayName: selfName,
        }, restoredCredentials);

        if (!this.isCurrentRestoreOperation(restoreGeneration)) return false;
        const decisionAfterPersist = this.getLoginSafetyDecision();
        if (!decisionAfterPersist.allowed) {
          this.applyLoginSafetyBlock(decisionAfterPersist.reason);
          return false;
        }

        // Start the listener as a staged, locally-owned resource. It must not
        // publish `this.listenerBindings` or stop the currently active
        // listener until the restore commit succeeds.
        if (startListener) {
          startedBindings = await this.startListener(() => {
            if (!this.isCurrentRestoreOperation(restoreGeneration)) return false;
            const currentDecision = this.getLoginSafetyDecision();
            if (!currentDecision.allowed) {
              this.applyLoginSafetyBlock(currentDecision.reason);
              return false;
            }
            return true;
          }, restoredApi, { staged: true });

          if (!this.isCurrentRestoreOperation(restoreGeneration)) {
            await this.stopOperationStartedListener(restoreOperation, startedBindings);
            startedBindings = null;
            return false;
          }
          if (!startedBindings) {
            throw new Error("LISTENER_START_FAILED:Listener did not start");
          }
          const decisionAfterListener = this.getLoginSafetyDecision();
          if (!decisionAfterListener.allowed) {
            this.applyLoginSafetyBlock(decisionAfterListener.reason);
            await this.stopOperationStartedListener(restoreOperation, startedBindings);
            startedBindings = null;
            return false;
          }
        }

        if (!this.isCurrentRestoreOperation(restoreGeneration)) return false;
        const decisionBeforeReady = this.getLoginSafetyDecision();
        if (!decisionBeforeReady.allowed) {
          this.applyLoginSafetyBlock(decisionBeforeReady.reason);
          await this.stopOperationStartedListener(restoreOperation, startedBindings);
          startedBindings = null;
          return false;
        }

        this.commitStagedSessionOrThrow(restoreOperation);

        // Transfer ownership only after the durable session commit. Publish
        // the new API/listener first so callbacks from the old listener become
        // stale immediately; then stop only the exact old bindings. Clearing
        // the operation before awaiting old-listener shutdown prevents a late
        // policy read from rolling back an already-committed session.
        const previousBindings = this.listenerBindings;
        const previousListener = previousBindings?.listener;
        this.zalo = restoredZalo;
        this.api = restoredApi;
        this.savedCredentials = restoredCredentials;
        if (startedBindings) {
          this.publishStartedListener(startedBindings, restoredApi);
          startedBindings = null;
        }
        this.clearActiveRestoreOperation(restoreGeneration);
        this.setConnected({ selfUserId: selfId, selfDisplayName: selfName });
        this.lastRestoreSource = restoredFromBackup ? "backup" : "primary";
        this.emit("ready", this.api);
        if (previousBindings && previousBindings !== this.listenerBindings) {
          await this.stopListenerBindings(previousBindings, previousListener);
        }
        console.log("Zalo auto-restore: success, connected=true" + (startListener ? " listener=started" : "") + (restoredFromBackup ? " source=backup" : ""));
        return true;
      }

      // Fallback: only had userId/name, need QR re-login
      this.setStatus({ connectionStatus: "error", lastError: "CREDENTIALS_EXPIRED" });
      return false;
    } catch (err: unknown) {
      if (!this.isCurrentRestoreOperation(restoreGeneration)) return false;
      const decisionAfterError = this.getLoginSafetyDecision();
      if (!decisionAfterError.allowed) {
        this.applyLoginSafetyBlock(decisionAfterError.reason);
        await this.stopOperationStartedListener(restoreOperation, startedBindings);
        startedBindings = null;
        return false;
      }

      await this.stopOperationStartedListener(restoreOperation, startedBindings);
      startedBindings = null;
      this.restoreOperationSnapshot(restoreOperation);
      const msg = (err as Error).message || "";
      console.error("Zalo auto-restore failed: " + msg);

      // Classify error
      if (msg.includes("expired") || msg.includes("invalid") || msg.includes("SESSION")) {
        this.setStatus({ connectionStatus: "error", lastError: "SESSION_QUARANTINED" });
        // The backup is read-only restore input and must remain available for
        // operator inspection. Only a real primary session can be quarantined.
        if (!restoredFromBackup) quarantineSessionFile(sessionPath, msg);
      } else if (msg.includes("login") || msg.includes("Login")) {
        this.setStatus({ connectionStatus: "error", lastError: "ZALO_LOGIN_FAILED" });
      } else {
        this.setStatus({ connectionStatus: "error", lastError: "RESTORE_FAILED" });
      }
      return false;
    } finally {
      this.clearActiveRestoreOperation(restoreGeneration);
    }
  }

  /** ZR2: which source the last successful restoreSession() used ("primary" | "backup" | null). */
  getLastRestoreSource(): "primary" | "backup" | null {
    return this.lastRestoreSource;
  }

  /** S4: Persist current session credentials to disk (callable from admin endpoint). */
  /**
   * ZR2: Write a same-content backup copy to backups/db/zalo-session-<timestamp>/zalo-session.json
   * right after a successful primary session save. Best-effort — failures are logged,
   * never thrown, so a backup-write hiccup never blocks the primary session save path.
   */
  private writeSessionBackupCopy(sessionPath: string): void {
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const backupDir = resolve(sessionBackupRoot(this.sessionDir), `zalo-session-${ts}`);
      mkdirSync(backupDir, { recursive: true });
      copyFileSync(sessionPath, resolve(backupDir, SESSION_FILE));
      console.log(`[zalo-gateway] ZR2: session backup copy written: ${backupDir}/${SESSION_FILE}`);
    } catch (err: unknown) {
      console.error(`[zalo-gateway] ZR2: session backup copy failed (non-fatal): ${(err as Error).message}`);
    }
  }

  private removeStagedSession(operation: ActiveLoginOperation | ActiveRestoreOperation): boolean {
    const stagedPath = operation.stagedSessionPath;
    if (!stagedPath) return true;
    try {
      if (existsSync(stagedPath)) unlinkSync(stagedPath);
      operation.stagedSessionPath = null;
      return true;
    } catch (unlinkError: unknown) {
      const quarantinePath = `${stagedPath}.cleanup-failed-${Date.now()}`;
      try {
        renameSync(stagedPath, quarantinePath);
        operation.stagedSessionPath = null;
        console.error(`[zalo-gateway] staged session cleanup quarantined: ${quarantinePath}`);
        return true;
      } catch (renameError: unknown) {
        console.error(
          `[zalo-gateway] staged session cleanup failed: unlink=${(unlinkError as Error).message}; quarantine=${(renameError as Error).message}`,
        );
        return false;
      }
    }
  }

  private async stageSessionOrThrow(
    kind: "login" | "restore",
    operation: ActiveLoginOperation | ActiveRestoreOperation,
    identity: SessionIdentity,
    credentials: Record<string, unknown> | null = this.savedCredentials,
  ): Promise<void> {
    if (!credentials) {
      throw new Error("PERSIST_FAILED:No credentials to save — QR login may be needed");
    }

    const stagedPath = resolve(this.sessionDir, `.zalo-session-${kind}-${operation.generation}.staged`);
    operation.stagedSessionPath = stagedPath;
    try {
      mkdirSync(this.sessionDir, { recursive: true });
      const serializedSession = JSON.stringify({
        selfUserId: identity.selfUserId,
        selfDisplayName: identity.selfDisplayName,
        credentials,
        savedAt: new Date().toISOString(),
      });
      writeFileSync(stagedPath, serializedSession, "utf-8");
      if (!existsSync(stagedPath) || statSync(stagedPath).size === 0
        || readFileSync(stagedPath, "utf-8") !== serializedSession) {
        throw new Error("Write verification failed");
      }
    } catch (err: unknown) {
      this.removeStagedSession(operation);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`PERSIST_FAILED:${message}`);
    }
  }

  private commitStagedSessionOrThrow(operation: ActiveLoginOperation | ActiveRestoreOperation): void {
    const stagedPath = operation.stagedSessionPath;
    if (!stagedPath || !existsSync(stagedPath) || statSync(stagedPath).size === 0) {
      throw new Error("PERSIST_FAILED:Staged session is missing");
    }

    const sessionPath = resolve(this.sessionDir, SESSION_FILE);
    try {
      // The staged file was fully written and verified before this atomic
      // publish. Do not add a fallible verification gate after rename: once
      // rename succeeds there is no safe filesystem operation that can always
      // retract the publication if the disk starts failing.
      renameSync(stagedPath, sessionPath);
      operation.stagedSessionPath = null;
      this.writeSessionBackupCopy(sessionPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`PERSIST_FAILED:${message}`);
    }
  }

  async persistSession(): Promise<{ ok: boolean; message: string; fileSize?: number }> {
    if (this.activeLoginGeneration !== null || this.activeLoginOperation !== null
      || this.activeRestoreGeneration !== null || this.activeRestoreOperation !== null) {
      return { ok: false, message: "Zalo session operation pending — active session was not changed" };
    }
    if (!this.status.connected) {
      return { ok: false, message: "Zalo not connected — cannot save session" };
    }
    if (!this.savedCredentials) {
      return { ok: false, message: "No credentials to save — QR login may be needed" };
    }
    try {
      mkdirSync(this.sessionDir, { recursive: true });
      const sessionPath = resolve(this.sessionDir, SESSION_FILE);
      writeFileSync(sessionPath, JSON.stringify({
        selfUserId: this.status.selfUserId,
        selfDisplayName: this.status.selfDisplayName,
        credentials: this.savedCredentials,
        savedAt: new Date().toISOString(),
      }), "utf-8");
      if (!existsSync(sessionPath) || statSync(sessionPath).size === 0) {
        return { ok: false, message: "Write verification failed" };
      }
      const st = statSync(sessionPath);
      console.log(`[zalo-gateway] Session persisted via admin: ${sessionPath} (${st.size} bytes)`);
      this.writeSessionBackupCopy(sessionPath);
      return { ok: true, message: "Session saved", fileSize: st.size };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Save failed: ${msg}` };
    }
  }

  private async saveCredentials(): Promise<void> {
    // S4: dryRun no longer blocks session persistence — call persistSession() instead
    if (config.zalo.dryRun) return;

    try {
      mkdirSync(this.sessionDir, { recursive: true });
      const sessionPath = resolve(this.sessionDir, SESSION_FILE);

      // Use credentials captured from loginQR callback (zca-js v2)
      // this.savedCredentials is set by runLoginInBackground's QR callback
      const credentials = this.savedCredentials ?? null;

      writeFileSync(
        sessionPath,
        JSON.stringify({
          selfUserId: this.status.selfUserId,
          selfDisplayName: this.status.selfDisplayName,
          credentials,
          savedAt: new Date().toISOString(),
        }),
        "utf-8",
      );

      // S3: Verify the file was actually persisted
      if (!existsSync(sessionPath)) {
        console.error(`[zalo-gateway] Session save verification FAILED: file missing after write: ${sessionPath}`);
        return;
      }
      const st = statSync(sessionPath);
      if (st.size === 0) {
        console.error(`[zalo-gateway] Session save verification FAILED: empty file (0 bytes): ${sessionPath}`);
        return;
      }
      console.log(`[zalo-gateway] Session saved: ${sessionPath} (${st.size} bytes, selfUserId=${this.status.selfUserId})`);
      // ZR2: mirror to backups/db/ so a future logout/quarantine has a recent fallback
      this.writeSessionBackupCopy(sessionPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[zalo-gateway] Session save FAILED: ${msg}`);
    }
  }

  /** S3: Check if session file is persisted on disk (non-destructive). */
  isSessionFilePersisted(): boolean {
    if (config.zalo.dryRun) return true;
    try {
      const sessionPath = resolve(this.sessionDir, SESSION_FILE);
      if (!existsSync(sessionPath)) return false;
      return statSync(sessionPath).size > 0;
    } catch {
      return false;
    }
  }

  /** S3: Get session file info for ops status (does NOT expose content). */
  getSessionFileInfo(): { exists: boolean; size: number | null; updatedAt: string | null } {
    try {
      const sessionPath = resolve(this.sessionDir, SESSION_FILE);
      if (!existsSync(sessionPath)) return { exists: false, size: null, updatedAt: null };
      const st = statSync(sessionPath);
      return {
        exists: true,
        size: st.size,
        updatedAt: st.mtime.toISOString(),
      };
    } catch {
      return { exists: false, size: null, updatedAt: null };
    }
  }

  /** S3: Get session directory (for quarantine file listing). */
  getSessionDir(): string {
    return this.sessionDir;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Message listener
  // ═══════════════════════════════════════════════════════════════════

  private async startListener(
    operationGuard?: ListenerOperationGuard,
    ownerApi = this.api,
    options: { staged?: boolean } = {},
  ): Promise<ListenerBindings | null> {
    const operationIsCurrent = () => operationGuard?.() ?? true;
    if (!operationIsCurrent()) return null;
    const stagedOwnership = options.staged === true;
    const publishOwnershipImmediately = !stagedOwnership && ownerApi === this.api;
    const listener = ownerApi?.listener;
    if (!listener) return null;
    const ownerSelfUserId = ownerApi.getOwnId?.() ?? this.status.selfUserId;
    if (!stagedOwnership && this.listenerActive) return null; // prevent duplicate listeners
    if (!stagedOwnership && this.listenerBindings) {
      await this.stopListener();
      if (!operationIsCurrent() || ownerApi.listener !== listener
        || (publishOwnershipImmediately && this.api !== ownerApi)) return null;
    }

    const { normalizeMessage, saveIncomingMessage } = await import("./zalo-receive.js");
    if (!operationIsCurrent() || ownerApi.listener !== listener
      || (publishOwnershipImmediately && this.api !== ownerApi)) return null;

    let bindings: ListenerBindings | null = null;
    const ownsListenerSetup = () => bindings !== null
      && operationIsCurrent()
      && ownerApi.listener === listener
      && (!publishOwnershipImmediately
        || (this.listenerBindings === bindings && this.api === ownerApi));
    const ownsActiveListener = () => bindings !== null
      && this.listenerBindings === bindings
      && this.api === ownerApi
      && ownerApi.listener === listener
      && this.listenerActive;
    const onMessage = async (raw: Record<string, unknown>) => {
      if (!ownsActiveListener()) return;
      // KI-H2: confirm listener liveness on every received event.
      this.lastListenerBeatAt = new Date().toISOString();
      try {
        const msg = normalizeMessage(raw);
        if (!msg) {
          console.log("[listener] normalizeMessage returned null → dropped");
          return;
        }

        // Anti-loop: skip self
        if (raw.isSelf === true || raw.isSelf === "true") return;

        const saved = await saveIncomingMessage(msg, ownerSelfUserId);
        if (!ownsActiveListener()) return;
        if (!saved.saved) return; // dedup or anti-loop
        if (!saved.dbMessageId) {
          console.error("[listener] inbound save returned no internal message id — dropped");
          return;
        }
        msg.dbMessageId = saved.dbMessageId;

        // Dispatch to Hermes for auto-reply (safe: catches all errors)
        try {
          // KI-B4: redact secrets from raw inbound BEFORE slicing (slicing first
          // could split a secret and leave a fragment un-masked in the log).
          const { handleIncomingMessage } = await import("./incoming-dispatcher.service.js");
          if (!ownsActiveListener()) return;
          const contentPreview = (redact(msg.content) as string).slice(0, 50);
          console.log(`[listener] dispatching: threadId=${msg.threadId} content="${contentPreview}"`);
          await handleIncomingMessage(msg, ownerSelfUserId);
        } catch (err: unknown) {
          console.error("[listener] dispatcher error (non-fatal): " + ((err as Error).message || "unknown"));
        }
      } catch (err: unknown) {
        // W5: normalize/save can throw (e.g. DB error). Previously this rejected
        // the listener callback and the message was silently dropped. Log instead.
        console.error("[listener] inbound save failed (non-fatal): " + ((err as Error).message || "unknown"));
      }
    };
    listener.on("message", onMessage);

    // ── Reaction event listener ─────────────────────────────────
    const onReaction = async (reaction: Record<string, unknown>) => {
      if (!ownsActiveListener()) return;
      try {
        const { normalizeReaction } = await import("./zalo-reaction-utils.js");
        if (!ownsActiveListener()) return;
        const normalized = normalizeReaction(reaction);
        if (!normalized) return;
        if (normalized.isSelf) return;

        console.log(`[listener] reaction: threadId=${normalized.threadId} icon=${normalized.rIcon} from=${normalized.uidFrom}`);

        // Fire-and-forget: handle reaction async without blocking listener
        const { handleIncomingReaction } = await import("./zalo-reaction.service.js");
        if (!ownsActiveListener()) return;
        handleIncomingReaction(normalized, ownerSelfUserId).catch((e: Error) =>
          console.error("[listener] reaction handler error: " + (e?.message ?? "unknown"))
        );
      } catch (err: unknown) {
        console.error("[listener] reaction normalize error: " + ((err as Error).message || "unknown"));
      }
    };
    listener.on("reaction", onReaction);

    // ── ZR1: Bắt disconnect/closed/error từ zca-js WebSocket ────────
    // zca-js listener emit "disconnected", "closed", "error" khi WS chết.
    // Không bắt → listenerActive=true bị stuck (stale flag), không trigger reconnect.
    const onWsDisconnected = (code: number, _reason: unknown) => {
      if (!ownsActiveListener()) return;
      console.warn(`[listener] WS disconnected (code=${code}) — scheduling reconnect`);
      this.listenerActive = false;
      this.setStatus({ connectionStatus: "error", lastError: `WS_DISCONNECTED:${code}` });
      this.scheduleReconnect();
    };
    const onWsClosed = (code: number, _reason: unknown) => {
      if (!ownsActiveListener()) return;
      console.warn(`[listener] WS closed (code=${code}) — scheduling reconnect`);
      this.listenerActive = false;
      this.setStatus({ connectionStatus: "error", lastError: `WS_CLOSED:${code}` });
      this.scheduleReconnect();
    };
    const onWsError = (err: unknown) => {
      const msg = (err as Error)?.message ?? String(err);
      if (!ownsActiveListener()) return;
      console.error(`[listener] WS error: ${msg} — scheduling reconnect`);
      this.listenerActive = false;
      this.setStatus({ connectionStatus: "error", lastError: `WS_ERROR:${msg.slice(0, 60)}` });
      this.scheduleReconnect();
    };
    listener.on("disconnected", onWsDisconnected);
    listener.on("closed", onWsClosed);
    listener.on("error", onWsError);
    bindings = {
      listener,
      message: onMessage,
      reaction: onReaction,
      disconnected: onWsDisconnected,
      closed: onWsClosed,
      error: onWsError,
    };
    if (publishOwnershipImmediately) this.listenerBindings = bindings;

    if (!ownsListenerSetup()) {
      if (publishOwnershipImmediately && this.listenerBindings === bindings) this.listenerBindings = null;
      await this.stopListenerBindings(bindings, listener);
      return null;
    }

    console.log("[listener] Starting zca-js listener...");
    try {
      await listener.start();
    } catch (err: unknown) {
      await this.stopListenerBindings(bindings, listener);
      if (publishOwnershipImmediately && this.listenerBindings === bindings) {
        this.listenerActive = false;
        this.listenerBindings = null;
      }
      throw err;
    }
    if (!ownsListenerSetup()) {
      // stopListener/logout (or a newer listener) won ownership while
      // start() was pending. Stop this exact stale listener after it settles
      // so it cannot resurrect liveness or heartbeat state.
      if (publishOwnershipImmediately && this.listenerBindings === bindings) {
        this.listenerActive = false;
        this.listenerBindings = null;
      }
      await this.stopListenerBindings(bindings, listener);
      return null;
    }
    console.log("[listener] zca-js listener started successfully");
    if (publishOwnershipImmediately) {
      this.listenerActive = true;
      this.lastListenerBeatAt = new Date().toISOString();
    // KI-H2: a fresh listener start clears any prior recovery error state.
    this.recoveryState = "idle";
    this.lastReconnectError = null;
    // ── Heartbeat: listener active ───────────────────────────────
      heartbeatOk("zaloListener", { listenerStarted: true, selfUserId: ownerSelfUserId }).catch(() => {});
    }
    return bindings;
  }

  private publishStartedListener(bindings: ListenerBindings, ownerApi: any): void {
    this.listenerBindings = bindings;
    this.listenerActive = true;
    this.lastListenerBeatAt = new Date().toISOString();
    this.recoveryState = "idle";
    this.lastReconnectError = null;
    const ownerSelfUserId = ownerApi.getOwnId?.() ?? this.status.selfUserId;
    heartbeatOk("zaloListener", { listenerStarted: true, selfUserId: ownerSelfUserId }).catch(() => {});
  }

  private async stopListenerBindings(bindings: ListenerBindings | null, fallbackListener?: any): Promise<void> {
    const listener = bindings?.listener ?? fallbackListener;
    if (bindings && listener) {
      const owned: Array<[string, ListenerHandler]> = [
        ["message", bindings.message],
        ["reaction", bindings.reaction],
        ["disconnected", bindings.disconnected],
        ["closed", bindings.closed],
        ["error", bindings.error],
      ];
      for (const [event, handler] of owned) {
        try {
          if (typeof listener.off === "function") listener.off(event, handler);
          else listener.removeListener?.(event, handler);
        } catch { /* ignore */ }
      }
    }
    try {
      await listener?.stop?.();
    } catch { /* ignore */ }
  }

  private async stopListener(): Promise<void> {
    const bindings = this.listenerBindings;
    const listener = bindings?.listener ?? this.api?.listener;
    this.listenerActive = false;
    this.listenerBindings = null;
    await this.stopListenerBindings(bindings, listener);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Reconnect
  // ═══════════════════════════════════════════════════════════════════

  private scheduleReconnect(): void {
    const decision = this.getLoginSafetyDecision();
    if (!decision.allowed) {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.applyLoginSafetyBlock(decision.reason);
      this.recoveryState = "idle";
      this.lastReconnectError = `LOGIN_SAFETY_BLOCKED:${decision.reason}`;
      return;
    }
    if (this.reconnectTimer) return;

    // KI-H2: bounded retries. On exhaustion → terminal error state + alert log,
    // stop scheduling (operator must use /ops/reconnect). Never spams forever.
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.recoveryState = "error";
      this.lastReconnectError = `max_attempts_exceeded:${this.reconnectAttempt}`;
      console.error(
        `[listener] ALERT: reconnect exhausted after ${this.reconnectAttempt} attempts — ` +
        `recoveryState=error. Manual /ops/reconnect required. autoReply/live left OFF.`,
      );
      this.setStatus({ connectionStatus: "error", lastError: "RECONNECT_EXHAUSTED" });
      return;
    }

    const delay = computeBackoffDelay(this.reconnectAttempt, this.maxReconnectDelayMs);
    this.reconnectAttempt++;
    this.recoveryState = "scheduled";
    this.lastReconnectAt = new Date().toISOString();
    console.warn(
      `[listener] reconnect scheduled in ${delay}ms (attempt ${this.reconnectAttempt}/${this.maxReconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const decisionAtExecution = this.getLoginSafetyDecision();
      if (!decisionAtExecution.allowed) {
        this.applyLoginSafetyBlock(decisionAtExecution.reason);
        this.recoveryState = "idle";
        this.lastReconnectError = `LOGIN_SAFETY_BLOCKED:${decisionAtExecution.reason}`;
        return;
      }
      this.recoveryState = "reconnecting";
      try {
        const restored = await this.restoreSession();
        if (restored) {
          // Success: setConnected() resets recoveryState=idle + attempt=0.
          return;
        }
        // Restore failed → attempt a (QR) login once.
        const login = await this.startLogin();
        if (login.status === "blocked") {
          this.recoveryState = "idle";
          this.lastReconnectError = `LOGIN_SAFETY_BLOCKED:${login.reason}`;
          return;
        }
        // Still not connected (e.g. awaiting QR scan) → retry with backoff (bounded).
        if (!this.status.connected) {
          const decisionBeforeReschedule = this.getLoginSafetyDecision();
          if (!decisionBeforeReschedule.allowed) {
            this.applyLoginSafetyBlock(decisionBeforeReschedule.reason);
            this.recoveryState = "idle";
            this.lastReconnectError = `LOGIN_SAFETY_BLOCKED:${decisionBeforeReschedule.reason}`;
            return;
          }
          this.scheduleReconnect();
        }
      } catch (err: unknown) {
        this.lastReconnectError = (err instanceof Error ? err.message : String(err)).slice(0, 120);
        this.scheduleReconnect();
      }
    }, delay);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Cleanup (M9: stop listener on logout)
  // ═══════════════════════════════════════════════════════════════════

  async logout(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.invalidateActiveLogin();
    this.invalidateActiveRestore();

    // Stop listener before nulling api (M9)
    await this.stopListener();

    // H1: Quarantine session on explicit logout instead of deleting.
    // Preserves session file for forensic/debug — S1.1 principle extended to logout.
    try {
      const sessionPath = resolve(this.sessionDir, SESSION_FILE);
      if (existsSync(sessionPath)) {
        const quarantined = quarantineSessionFile(sessionPath, "logout");
        if (quarantined) {
          console.log(`[zalo-gateway] Session quarantined by explicit logout: ${quarantined}`);
        }
      }
    } catch {
      // ignore
    }

    this.api = null;
    this.zalo = null;
    this.savedCredentials = null;
    this.setStatus({
      connected: false,
      connectionStatus: "disconnected",
      selfUserId: null,
      selfDisplayName: null,
    });
    this.emit("disconnected");
  }

  // ═══════════════════════════════════════════════════════════════════
  // Internal helpers
  // ═══════════════════════════════════════════════════════════════════

  private setConnected(opts: {
    selfUserId?: string | null;
    selfDisplayName?: string | null;
  }): void {
    this.setStatus({
      connected: true,
      connectionStatus: "connected",
      lastConnectedAt: new Date().toISOString(),
      lastError: null,
      selfUserId: opts.selfUserId ?? this.status.selfUserId,
      selfDisplayName: opts.selfDisplayName ?? this.status.selfDisplayName,
    });
    this.reconnectAttempt = 0;
    // KI-H2: recovery succeeded → clear recovery state.
    this.recoveryState = "idle";
    this.lastReconnectError = null;
    // ── Heartbeat: Zalo connected ────────────────────────────────
    heartbeatOk("zaloConnection", { connected: true, selfUserId: this.status.selfUserId }).catch(() => {});
  }

  private setStatus(partial: Partial<ZaloGatewayStatus>): void {
    this.status = { ...this.status, ...partial };
    if (this.statusEmissionInProgress) return;

    this.statusEmissionInProgress = true;
    try {
      this.emit("status", this.getStatus());
    } finally {
      this.statusEmissionInProgress = false;
    }
  }
}

// Singleton
let instance: ZaloGatewayService | null = null;

export function getZaloGateway(): ZaloGatewayService {
  if (!instance) {
    instance = new ZaloGatewayService();
  }
  return instance;
}
