// =============================================================================
// ZaloGatewayService — manages zca-js lifecycle, login, session, reconnect
// =============================================================================

import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, statSync, readdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { config } from "../config.js";
import { heartbeatOk } from "./heartbeat.service.js";
import { computeBackoffDelay } from "./zalo-recovery.js";
import { redact } from "./tool-gateway/redaction.js";

// Resolve zca-js from the project root node_modules.
// We resolve from process.cwd() which is always the project root when running via npm/tsx.
const projectRequire = createRequire(resolve(process.cwd(), "node_modules", "zca-js", "package.json"));

export type ConnectionStatus = "disconnected" | "connecting" | "waiting_qr_scan" | "connected" | "error";

export interface ZaloGatewayStatus {
  connected: boolean;
  connectionStatus: ConnectionStatus;
  lastConnectedAt: string | null;
  lastError: string | null;
  selfUserId: string | null;
  selfDisplayName: string | null;
  dryRun: boolean;
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
function sessionBackupRoot(): string {
  return resolve(config.zalo.sessionDir, "..", "backups", "db");
}

export function findLatestSessionBackup(): string | null {
  try {
    const backupRoot = sessionBackupRoot();
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
  private listenerActive = false;
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

  // ═══════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════

  getStatus(): ZaloGatewayStatus & { qrAvailable: boolean; qrUpdatedAt: string | null } {
    const qrPath = resolve(this.sessionDir, "qr-current.png");
    let qrAvailable = false;
    try {
      // Use imported statSync — require("fs") fails silently in ESM modules
      const st = statSync(qrPath);
      qrAvailable = st.size > 500;
    } catch { /* file doesn't exist yet */ }
    return { ...this.status, qrAvailable, qrUpdatedAt: this.qrUpdatedAt };
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
    if (!this.loginInProgress) {
      return { cancelled: false, message: "No login in progress" };
    }
    // Mark as no longer in progress — the background promise will resolve/reject on its own
    this.loginInProgress = false;
    this.qrUpdatedAt = null;
    // Remove stale QR file
    try {
      const qrPath = resolve(this.sessionDir, "qr-current.png");
      if (existsSync(qrPath)) unlinkSync(qrPath);
    } catch { /* non-critical */ }
    this.setStatus({ connectionStatus: "disconnected", lastError: null });
    return { cancelled: true, message: "Login cancelled" };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Login — QR flow (non-blocking)
  // ═══════════════════════════════════════════════════════════════════

  async startLogin(): Promise<{ qrImage?: string; status: string }> {
    if (config.zalo.dryRun) {
      this.setConnected({ selfUserId: "dry-run-user", selfDisplayName: "Dry Run Bot" });
      return { status: "connected" };
    }

    // Prevent duplicate login jobs (H6)
    if (this.loginInProgress) {
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

      // No saved session — need QR login
      this.loginInProgress = true;
      this.setStatus({ connectionStatus: "connecting", lastError: null });

      // Start background login (fire-and-forget, but we track it)
      this.runLoginInBackground().catch(() => {
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

  private async runLoginInBackground(): Promise<void> {
    try {
      const zca = projectRequire("zca-js");
      this.zalo = new zca.Zalo({ imageMetadataGetter });

      let capturedCredentials: Record<string, unknown> | null = null;

      // C1 FIX: Ensure session dir exists BEFORE loginQR
      mkdirSync(this.sessionDir, { recursive: true });
      const loginQRPath = resolve(this.sessionDir, "qr-current.png");

      const loginPromise = this.zalo.loginQR(
        {
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
          language: "vi",
          qrPath: loginQRPath,
        },
        (event: { type: number; data: { image?: string; cookie?: unknown; imei?: string; userAgent?: string } }) => {
          // C1 FIX: Capture QR image from QRCodeGenerated callback (type=0)
          // zca-js v2 LoginQRCallbackEventType: QRCodeGenerated=0, QRCodeExpired=1, QRCodeScanned=2, QRCodeDeclined=3
          if ((event.type === 0 || String(event.type) === "QRCodeGenerated") && event.data?.image) {
            try {
              writeFileSync(loginQRPath, event.data.image, "base64");
              this.qrUpdatedAt = new Date().toISOString();
            } catch { /* non-critical */ }
          }

          // Mark QR as expired
          if ((event.type === 1 || String(event.type) === "QRCodeExpired")) {
            this.qrUpdatedAt = null;
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
      this.setStatus({ connectionStatus: "waiting_qr_scan" });

      const timeoutPromise = new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error("LOGIN_TIMEOUT: QR code was not scanned within 2 minutes")), LOGIN_TIMEOUT_MS),
      );

      this.api = await Promise.race([loginPromise, timeoutPromise]);

      // Store captured credentials for session persistence
      this.savedCredentials = capturedCredentials;

      await this.onLoginSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.loginInProgress = false;
      this.setStatus({ connectionStatus: "error", lastError: msg });
      this.scheduleReconnect();
    }
  }

  private async onLoginSuccess(): Promise<void> {
    const selfId = this.api.getOwnId?.() ?? null;
    const selfName = this.api.getOwnName?.() ?? null;

    this.setConnected({ selfUserId: selfId, selfDisplayName: selfName });

    // C1: Save full credentials for session restore (S4: bypass dryRun)
    await this.persistSession();

    // Start message listener
    await this.startListener();

    this.loginInProgress = false;
    this.emit("ready", this.api);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Session persistence (C1)
  // ═══════════════════════════════════════════════════════════════════

  async restoreSession(options?: { startListener?: boolean }): Promise<boolean> {
    const startListener = options?.startListener ?? true; // default true for API

    if (config.zalo.dryRun) {
      this.setConnected({ selfUserId: "dry-run-user", selfDisplayName: "Dry Run Bot" });
      return true;
    }

    this.lastRestoreSource = null;
    const sessionPath = resolve(this.sessionDir, SESSION_FILE);
    let restoredFromBackup = false;

    if (!existsSync(sessionPath)) {
      // ZR2: primary session file missing — before requiring QR, try the most
      // recent backup under backups/db/zalo-session-*/zalo-session.json.
      // We only COPY (never move/delete) the backup — the original stays intact
      // in case this restore attempt fails and a human needs to inspect it.
      const backupPath = findLatestSessionBackup();
      if (backupPath) {
        try {
          mkdirSync(this.sessionDir, { recursive: true });
          copyFileSync(backupPath, sessionPath);
          restoredFromBackup = true;
          console.log(`[zalo-gateway] ZR2: primary session missing, restored copy from backup: ${backupPath}`);
        } catch (err: unknown) {
          console.error(`[zalo-gateway] ZR2: backup copy failed: ${(err as Error).message}`);
        }
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

    try {
      const raw = readFileSync(sessionPath, "utf-8");
      const sessionData = JSON.parse(raw);

      // If we have full credentials, use login() to restore
      if (sessionData.credentials) {
        const zca = projectRequire("zca-js");
        this.zalo = new zca.Zalo({ imageMetadataGetter });
        this.api = await this.zalo.login(sessionData.credentials);

        // Store credentials for future saves
        this.savedCredentials = sessionData.credentials as Record<string, unknown>;

        // Extract selfUserId if not already set
        const selfId = this.api.getOwnId?.() ?? sessionData.selfUserId ?? null;
        const selfName = this.api.getOwnName?.() ?? sessionData.selfDisplayName ?? null;

        this.setConnected({ selfUserId: selfId, selfDisplayName: selfName });

        // Save refreshed credentials to BOTH primary + backup (S4 + ZR2)
        await this.persistSession();

        // Start listener only if requested (API needs it, worker doesn't)
        if (startListener) {
          await this.startListener();
        }

        this.lastRestoreSource = restoredFromBackup ? "backup" : "primary";
        this.emit("ready", this.api);
        console.log("Zalo auto-restore: success, connected=true" + (startListener ? " listener=started" : "") + (restoredFromBackup ? " source=backup" : ""));
        return true;
      }

      // Fallback: only had userId/name, need QR re-login
      this.setStatus({ connectionStatus: "error", lastError: "CREDENTIALS_EXPIRED" });
      return false;
    } catch (err: unknown) {
      const msg = (err as Error).message || "";
      console.error("Zalo auto-restore failed: " + msg);

      // Classify error
      if (msg.includes("expired") || msg.includes("invalid") || msg.includes("SESSION")) {
        this.setStatus({ connectionStatus: "error", lastError: "SESSION_QUARANTINED" });
        // Only quarantine the primary file — if this attempt used a copied backup,
        // quarantining it just discards the copy; the original backup dir is untouched.
        quarantineSessionFile(sessionPath, msg);
      } else if (msg.includes("login") || msg.includes("Login")) {
        this.setStatus({ connectionStatus: "error", lastError: "ZALO_LOGIN_FAILED" });
      } else {
        this.setStatus({ connectionStatus: "error", lastError: "RESTORE_FAILED" });
      }
      return false;
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
      const backupDir = resolve(sessionBackupRoot(), `zalo-session-${ts}`);
      mkdirSync(backupDir, { recursive: true });
      copyFileSync(sessionPath, resolve(backupDir, SESSION_FILE));
      console.log(`[zalo-gateway] ZR2: session backup copy written: ${backupDir}/${SESSION_FILE}`);
    } catch (err: unknown) {
      console.error(`[zalo-gateway] ZR2: session backup copy failed (non-fatal): ${(err as Error).message}`);
    }
  }

  async persistSession(): Promise<{ ok: boolean; message: string; fileSize?: number }> {
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

  private async startListener(): Promise<void> {
    if (!this.api?.listener) return;
    if (this.listenerActive) return; // prevent duplicate listeners

    const { normalizeMessage, saveIncomingMessage } = await import("./zalo-receive.js");

    this.api.listener.on("message", async (raw: Record<string, unknown>) => {
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

        const saved = await saveIncomingMessage(msg, this.status.selfUserId);
        if (!saved.saved) return; // dedup or anti-loop

        // Dispatch to Hermes for auto-reply (safe: catches all errors)
        try {
          // KI-B4: redact secrets from raw inbound BEFORE slicing (slicing first
          // could split a secret and leave a fragment un-masked in the log).
          const contentPreview = (redact(msg.content) as string).slice(0, 50);
          console.log(`[listener] dispatching: threadId=${msg.threadId} content="${contentPreview}"`);
          const { handleIncomingMessage } = await import("./incoming-dispatcher.service.js");
          await handleIncomingMessage(msg, this.status.selfUserId);
        } catch (err: unknown) {
          console.error("[listener] dispatcher error (non-fatal): " + ((err as Error).message || "unknown"));
        }
      } catch (err: unknown) {
        // W5: normalize/save can throw (e.g. DB error). Previously this rejected
        // the listener callback and the message was silently dropped. Log instead.
        console.error("[listener] inbound save failed (non-fatal): " + ((err as Error).message || "unknown"));
      }
    });

    // ── Reaction event listener ─────────────────────────────────
    this.api.listener.on("reaction", async (reaction: Record<string, unknown>) => {
      try {
        const { normalizeReaction } = await import("./zalo-reaction-utils.js");
        const normalized = normalizeReaction(reaction);
        if (!normalized) return;
        if (normalized.isSelf) return;

        console.log(`[listener] reaction: threadId=${normalized.threadId} icon=${normalized.rIcon} from=${normalized.uidFrom}`);

        // Fire-and-forget: handle reaction async without blocking listener
        const { handleIncomingReaction } = await import("./zalo-reaction.service.js");
        handleIncomingReaction(normalized, this.status.selfUserId).catch((e: Error) =>
          console.error("[listener] reaction handler error: " + (e?.message ?? "unknown"))
        );
      } catch (err: unknown) {
        console.error("[listener] reaction normalize error: " + ((err as Error).message || "unknown"));
      }
    });

    // ── ZR1: Bắt disconnect/closed/error từ zca-js WebSocket ────────
    // zca-js listener emit "disconnected", "closed", "error" khi WS chết.
    // Không bắt → listenerActive=true bị stuck (stale flag), không trigger reconnect.
    const onWsDisconnected = (code: number, _reason: unknown) => {
      if (!this.listenerActive) return;
      console.warn(`[listener] WS disconnected (code=${code}) — scheduling reconnect`);
      this.listenerActive = false;
      this.setStatus({ connectionStatus: "error", lastError: `WS_DISCONNECTED:${code}` });
      this.scheduleReconnect();
    };
    const onWsClosed = (code: number, _reason: unknown) => {
      if (!this.listenerActive) return;
      console.warn(`[listener] WS closed (code=${code}) — scheduling reconnect`);
      this.listenerActive = false;
      this.setStatus({ connectionStatus: "error", lastError: `WS_CLOSED:${code}` });
      this.scheduleReconnect();
    };
    const onWsError = (err: unknown) => {
      const msg = (err as Error)?.message ?? String(err);
      if (!this.listenerActive) return;
      console.error(`[listener] WS error: ${msg} — scheduling reconnect`);
      this.listenerActive = false;
      this.setStatus({ connectionStatus: "error", lastError: `WS_ERROR:${msg.slice(0, 60)}` });
      this.scheduleReconnect();
    };
    this.api.listener.on("disconnected", onWsDisconnected);
    this.api.listener.on("closed", onWsClosed);
    this.api.listener.on("error", onWsError);

    console.log("[listener] Starting zca-js listener...");
    await this.api.listener.start();
    console.log("[listener] zca-js listener started successfully");
    this.listenerActive = true;
    this.lastListenerBeatAt = new Date().toISOString();
    // KI-H2: a fresh listener start clears any prior recovery error state.
    this.recoveryState = "idle";
    this.lastReconnectError = null;
    // ── Heartbeat: listener active ───────────────────────────────
    heartbeatOk("zaloListener", { listenerStarted: true, selfUserId: this.status.selfUserId }).catch(() => {});
  }

  private async stopListener(): Promise<void> {
    // M9: Clean up listener on logout
    if (this.api?.listener) {
      try {
        await this.api.listener.stop?.();
      } catch { /* ignore */ }
      try {
        this.api.listener.removeAllListeners?.("message");
      } catch { /* ignore */ }
    }
    this.listenerActive = false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Reconnect
  // ═══════════════════════════════════════════════════════════════════

  private scheduleReconnect(): void {
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
      this.recoveryState = "reconnecting";
      try {
        const restored = await this.restoreSession();
        if (restored) {
          // Success: setConnected() resets recoveryState=idle + attempt=0.
          return;
        }
        // Restore failed → attempt a (QR) login once.
        await this.startLogin();
        // Still not connected (e.g. awaiting QR scan) → retry with backoff (bounded).
        if (!this.status.connected) {
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

    this.loginInProgress = false;

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
    this.emit("status", this.getStatus());
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
