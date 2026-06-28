import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

function requireEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined || value === "") {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(
      `Missing required environment variable: ${key}. ` + `Set it in .env or your environment.`,
    );
  }
  return value;
}

function requireSecret(key: string): string {
  const value = process.env[key];
  const isProd = process.env.NODE_ENV === "production";
  if (!value || value === `change-me${key === "JWT_SECRET" ? "" : ""}`) {
    if (isProd) {
      throw new Error(`SECURITY: ${key} must be set to a non-default value in production.`);
    }
    // In dev, return a safe default
    if (key === "JWT_SECRET" || key === "COOKIE_SECRET") {
      return `dev-${key.toLowerCase()}-not-secure`;
    }
  }
  return value ?? "";
}

export const config = {
  nodeEnv: (process.env.NODE_ENV ?? "development") as string,
  isDev: (process.env.NODE_ENV ?? "development") !== "production",
  port: parseInt(process.env.PORT ?? "3000", 10),
  host: process.env.HOST ?? "0.0.0.0",
  timezone: process.env.APP_TIMEZONE ?? "Asia/Ho_Chi_Minh",

  cors: {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3001",
    frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3001",
  },

  database: {
    url: requireEnv("DATABASE_URL", "file:./dev.db"),
  },

  redis: {
    url: process.env.REDIS_URL || null,
  },

  zalo: {
    sessionDir: process.env.ZALO_SESSION_DIR
      ? resolve(process.env.ZALO_SESSION_DIR)
      : resolve(process.cwd(), "packages", "backend", "zalo-session"),
    dryRun: process.env.ZALO_DRY_RUN === "true",
    rateLimitPerMinute: parseInt(process.env.ZALO_RATE_LIMIT_PER_MINUTE ?? "10", 10),
    rateLimitGlobalPerMinute: parseInt(process.env.ZALO_RATE_LIMIT_GLOBAL_PER_MINUTE ?? "60", 10),
    /** Base directory where media files must reside (path traversal blocked). */
    mediaAllowedBaseDir: process.env.MEDIA_ALLOWED_BASE_DIR
      ? resolve(process.env.MEDIA_ALLOWED_BASE_DIR)
      : resolve(process.cwd(), "tmp", "hermes-media"),
    /** Voice/TTS feature — disabled by default (native Zalo voice playback unreliable). */
    voiceEnabled: process.env.ZALO_VOICE_ENABLED === "true",
  },

  autoReply: {
    enabled: process.env.ZALO_AUTO_REPLY_ENABLED === "true",
    dryRun: process.env.ZALO_AUTO_REPLY_DRY_RUN !== "false", // safe default: true
    allowedThreads: (process.env.ZALO_AUTO_REPLY_ALLOWED_THREADS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    cooldownSeconds: parseInt(process.env.ZALO_AUTO_REPLY_COOLDOWN_SECONDS ?? "10", 10),
    groupReplyWindowSeconds: parseInt(
      process.env.ZALO_GROUP_REPLY_WINDOW_SECONDS ?? "600",
      10,
    ),
  },

  vision: {
    enabled: process.env.ZALO_VISION_ENABLED === "true",
    maxSizeBytes: parseInt(process.env.ZALO_VISION_MAX_SIZE_BYTES ?? `${10 * 1024 * 1024}`, 10), // 10 MB
    allowedMimeTypes: (process.env.ZALO_VISION_ALLOWED_MIMES ?? "image/jpeg,image/jpg,image/png,image/webp").split(",").map(s => s.trim()),
    safeDir: process.env.ZALO_VISION_SAFE_DIR
      ? resolve(process.env.ZALO_VISION_SAFE_DIR)
      : resolve(process.cwd(), "tmp", "hermes-media", "inbound-images"),
    downloadTimeoutMs: parseInt(process.env.ZALO_VISION_DOWNLOAD_TIMEOUT_MS ?? "30000", 10),
    provider: process.env.ZALO_VISION_PROVIDER ?? "hermes",
    model: process.env.ZALO_VISION_MODEL ?? "",
  },

  hermesChat: {
    adapter: (process.env.HERMES_CHAT_ADAPTER ?? "mock") as "mock" | "real",
    mode: (process.env.HERMES_CHAT_MODE ?? "http") as "http" | "cli",
    endpoint: (process.env.HERMES_CHAT_ENDPOINT || "") as string,
    cliBin: (process.env.HERMES_CHAT_CLI_BIN || "") as string,
    timeoutMs: Math.max(1, parseInt(process.env.HERMES_CHAT_TIMEOUT_MS ?? "30000", 10)),
    cliTimeoutMs: Math.max(1, parseInt(process.env.HERMES_CHAT_CLI_TIMEOUT_MS ?? "60000", 10)),
    minConfidence: Math.min(1, Math.max(0, parseFloat(process.env.HERMES_CHAT_MIN_CONFIDENCE ?? "0.5"))),
  } as const,

  security: {
    jwtSecret: requireSecret("JWT_SECRET"),
    cookieSecret: requireSecret("COOKIE_SECRET"),
    adminUsername: process.env.ADMIN_USERNAME ?? "admin",
    adminPassword: requireSecret("ADMIN_PASSWORD"),
  },

  retry: {
    maxAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS ?? "3", 10),
    baseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS ?? "1000", 10),
  },

  errorAlert: {
    enabled: process.env.ERROR_ALERT_ENABLED === "true",
    dryRun: process.env.ERROR_ALERT_DRY_RUN !== "false", // safe default: true
    channel: (process.env.ERROR_ALERT_CHANNEL ?? "log") as "log" | "telegram",
    minSeverity: (process.env.ERROR_ALERT_MIN_SEVERITY ?? "high") as "low" | "medium" | "high",
    windowHours: parseInt(process.env.ERROR_ALERT_WINDOW_HOURS ?? "24", 10),
    dedupWindowMinutes: parseInt(process.env.ERROR_ALERT_DEDUP_MINUTES ?? "60", 10),
    telegramBotToken: process.env.ERROR_ALERT_TELEGRAM_BOT_TOKEN ?? "",
    telegramChatId: process.env.ERROR_ALERT_TELEGRAM_CHAT_ID ?? "",
  },

  document: {
    enabled: process.env.DOCUMENT_INGEST_ENABLED === "true",
    allowedBaseDir: process.env.DOCUMENT_ALLOWED_BASE_DIR ?? "/tmp/hermes-media/documents",
    processedDir: process.env.DOCUMENT_PROCESSED_DIR ?? "/tmp/hermes-media/documents/processed",
    maxSizeMB: parseInt(process.env.DOCUMENT_MAX_SIZE_MB ?? "50", 10),
    allowedExtensions: (process.env.DOCUMENT_ALLOWED_EXTENSIONS ?? "pdf,docx,pptx,xlsx,txt,md,html,csv,png,jpg,jpeg,webp").split(",").map(s => s.trim()),
    doclingBin: process.env.DOCUMENT_DOCLING_BIN ?? "docling",
    doclingTimeoutMs: parseInt(process.env.DOCUMENT_DOCLING_TIMEOUT_MS ?? "60000", 10),
    doclingKillGraceMs: parseInt(process.env.DOCUMENT_DOCLING_KILL_GRACE_MS ?? "5000", 10),
    doclingMaxOutputBytes: parseInt(process.env.DOCUMENT_DOCLING_MAX_OUTPUT_BYTES ?? "1048576", 10),
    chunkSize: parseInt(process.env.DOCUMENT_CHUNK_SIZE ?? "1200", 10),
    chunkOverlap: parseInt(process.env.DOCUMENT_CHUNK_OVERLAP ?? "150", 10),
  },

  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;

export type Config = typeof config;
