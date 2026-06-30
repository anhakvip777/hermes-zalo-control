// =============================================================================
// ZaloGatewayService — manages zca-js lifecycle, login, session, reconnect
// =============================================================================

import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { config } from "../config.js";
import { heartbeatOk } from "./heartbeat.service.js";

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
    const safeReason = /^(expired|invalid|session|SESSION|login)/i.test(reason)
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
  private readonly sessionDir: string;
  private loginInProgress = false;
  private listenerActive = false;
  private qrUpdatedAt: string | null = null;

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
      const st = require("fs").statSync(qrPath);
      qrAvailable = st.size > 500;
    } catch { /* file doesn't exist yet */ }
    return { ...this.status, qrAvailable, qrUpdatedAt: this.qrUpdatedAt };
  }

  isConnected(): boolean {
    return this.status.connected;
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

    // C1: Save full credentials for session restore
    await this.saveCredentials();

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

    const sessionPath = resolve(this.sessionDir, SESSION_FILE);
    if (!existsSync(sessionPath)) {
      this.setStatus({ connectionStatus: "error", lastError: "NO_SESSION_FILE" });
      console.log("Zalo auto-restore: NO_SESSION_FILE");
      return false;
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

        // Save refreshed credentials
        await this.saveCredentials();

        // Start listener only if requested (API needs it, worker doesn't)
        if (startListener) {
          await this.startListener();
        }

        this.emit("ready", this.api);
        console.log("Zalo auto-restore: success, connected=true" + (startListener ? " listener=started" : ""));
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
        quarantineSessionFile(sessionPath, msg);
      } else if (msg.includes("login") || msg.includes("Login")) {
        this.setStatus({ connectionStatus: "error", lastError: "ZALO_LOGIN_FAILED" });
      } else {
        this.setStatus({ connectionStatus: "error", lastError: "RESTORE_FAILED" });
      }
      return false;
    }
  }

  private async saveCredentials(): Promise<void> {
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
    } catch {
      // Non-fatal: session save failure
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Message listener
  // ═══════════════════════════════════════════════════════════════════

  private async startListener(): Promise<void> {
    if (!this.api?.listener) return;
    if (this.listenerActive) return; // prevent duplicate listeners

    const { normalizeMessage, saveIncomingMessage } = await import("./zalo-receive.js");

    this.api.listener.on("message", async (raw: Record<string, unknown>) => {
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
        console.log(`[listener] dispatching: threadId=${msg.threadId} content="${msg.content.slice(0, 50)}"`);
        const { handleIncomingMessage } = await import("./incoming-dispatcher.service.js");
        await handleIncomingMessage(msg, this.status.selfUserId);
      } catch (err: unknown) {
        console.error("[listener] dispatcher error (non-fatal): " + ((err as Error).message || "unknown"));
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

    console.log("[listener] Starting zca-js listener...");
    await this.api.listener.start();
    console.log("[listener] zca-js listener started successfully");
    this.listenerActive = true;
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

    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempt),
      this.maxReconnectDelayMs,
    );
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        const restored = await this.restoreSession();
        if (!restored) {
          await this.startLogin();
        }
      } catch {
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

    try {
      const sessionPath = resolve(this.sessionDir, SESSION_FILE);
      if (existsSync(sessionPath)) {
        unlinkSync(sessionPath);
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
