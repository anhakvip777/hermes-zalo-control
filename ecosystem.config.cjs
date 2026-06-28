// =============================================================================
// PM2 Ecosystem Config — Hermes Zalo Admin Center
// =============================================================================
// Usage:
//   pm2 start ecosystem.config.cjs
//   pm2 restart hermes-backend hermes-worker
//   pm2 logs
//   pm2 save   (save process list for auto-restart on reboot)
//
// Safe defaults: dryRun=true, auto-restart with backoff
// =============================================================================

module.exports = {
  apps: [
    {
      name: "hermes-backend",
      script: "packages/backend/dist/index.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: "3002",
        ZALO_AUTO_REPLY_DRY_RUN: "true",
        ZALO_AUTO_REPLY_ENABLED: "true",
        ZALO_DRY_RUN: "true",
        ERROR_ALERT_ENABLED: "false",
        ERROR_ALERT_DRY_RUN: "true",
        LOG_LEVEL: "info",
      },
      autorestart: true,
      max_restarts: 5,
      min_uptime: "30s",
      restart_delay: 5000,
      kill_timeout: 10000,
      error_file: "logs/backend-error.log",
      out_file: "logs/backend-out.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "hermes-worker",
      script: "packages/backend/dist/workers/index.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        ZALO_AUTO_REPLY_DRY_RUN: "true",
        ZALO_DRY_RUN: "true",
        LOG_LEVEL: "info",
      },
      autorestart: true,
      max_restarts: 5,
      min_uptime: "30s",
      restart_delay: 5000,
      kill_timeout: 5000,
      error_file: "logs/worker-error.log",
      out_file: "logs/worker-out.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "hermes-document-worker",
      script: "./node_modules/.bin/tsx",
      args: "packages/backend/src/workers/document-worker.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        DOCUMENT_INGEST_ENABLED: "true",
        DOCUMENT_DOCLING_TIMEOUT_MS: "60000",
        LOG_LEVEL: "info",
        NODE_OPTIONS: "--max-old-space-size=2048",
      },
      autorestart: true,
      max_restarts: 5,
      min_uptime: "30s",
      restart_delay: 5000,
      kill_timeout: 30000,
      error_file: "logs/doc-worker-error.log",
      out_file: "logs/doc-worker-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
