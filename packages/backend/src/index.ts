import { buildApp } from "./app.js";
import { config } from "./config.js";
import { checkDbOnStartup } from "./db-guard-startup.js";
import { acquireProcessLock, isLockOwner } from "./process-lock.js";
import { checkConfigOnStartup } from "./config-consistency.js";
import { initRuntimeConfig, initHotCache } from "./services/runtime-config.service.js";
import { heartbeatOk } from "./services/heartbeat.service.js";

async function main() {
  // ── DB Guard startup check ─────────────────────────────────────────
  await checkDbOnStartup();

  // ── Config consistency check ─────────────────────────────────────
  await checkConfigOnStartup();

  // ── Init runtime config from DB ───────────────────────────────────
  await initRuntimeConfig();
  await initHotCache();
  // ── Init AllowThreads allowlist cache from DB ─────────────────────
  const { initAllowlist } = await import("./services/allowlist.service.js");
  await initAllowlist();

  // ── Record backend heartbeat ──────────────────────────────────────
  const heartbeatInterval = setInterval(() => {
    heartbeatOk("backend", {
      pid: process.pid,
      nodeVersion: process.version,
      nodeEnv: config.nodeEnv,
      port: config.port,
    }).catch(() => {});
  }, 30_000);

  // Fire immediately on startup (don't wait 30s for first heartbeat)
  heartbeatOk("backend", {
    pid: process.pid,
    nodeVersion: process.version,
    nodeEnv: config.nodeEnv,
    port: config.port,
  }).catch(() => {});

  // Clean up interval on shutdown
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      clearInterval(heartbeatInterval);
      process.exit(0);
    });
  }

  // ── Process Lock ───────────────────────────────────────────────────
  const lock = acquireProcessLock();

  const app = await buildApp();

  // ── Auto-restore Zalo session on startup ──────────────────────────
  // Always attempt Zalo auto-restore — listener needs to receive messages
  // even when auto-reply is in dry-run mode. Only skip when explicitly disabled.
  if (config.autoReply.enabled) {
    try {
      // Only start Zalo listener if we hold the process lock
      if (!isLockOwner()) {
        console.warn("[process-lock] Lock not held — skipping Zalo listener start");
      } else {
        // H1: Pre-create canonical session directory on startup
        // Ensures dir exists even on fresh deploy — no manual mkdir needed.
        // Does NOT create a dummy session file — missing file → health degraded.
        const { mkdirSync } = await import("node:fs");
        const canonicalDir = config.zalo.sessionDir;
        mkdirSync(canonicalDir, { recursive: true });
        console.log(`[startup] Session dir ensured: ${canonicalDir}`);

        const { getZaloGateway } = await import("./services/zalo-gateway.service.js");
        const gw = getZaloGateway();
        console.log("Zalo auto-restore attempted");
        const restored = await gw.restoreSession({ startListener: true });
        console.log(`Zalo auto-restore: restored=${restored} connected=${gw.isConnected()}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Zalo auto-restore error: ${msg}`);
    }
  }

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`🚀 Hermes Zalo Control backend running on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();

// ── Global unhandled error handlers ──────────────────────────────────
process.on("unhandledRejection", (reason, promise) => {
  console.error("[UNHANDLED_REJECTION]", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT_EXCEPTION]", err);
  setTimeout(() => process.exit(1), 1000);
});
