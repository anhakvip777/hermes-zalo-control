# Quick Start Guide

> ⚠️ All commands assume project root: `~/hermes-zalo-control`

## Prerequisites

- Node.js >= 22.0.0
- npm >= 10.0.0
- PM2 (`npm i -g pm2`)

## 1. Install Dependencies

```bash
cd ~/hermes-zalo-control
npm install
```

## 2. Environment Setup

Copy the example env file and fill in required values:

```bash
cp .env.example .env
```

Required env vars:
- `DATABASE_URL` — SQLite path (default: `file:./dev.db`)
- `JWT_SECRET` — random 32-char string
- `COOKIE_SECRET` — random 32-char string
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — dashboard credentials
- `ZALO_AUTO_REPLY_DRY_RUN=true` — start in safe mode

## 3. Database Setup

```bash
npm run db:generate
npm run db:push:safe
```

## 4. Build

```bash
npm run build
```

## 5. Start Services (PM2)

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

Services:
- `hermes-backend` — API + Zalo listener (port 3002)
- `hermes-worker` — schedule executor + batch worker
- `hermes-document-worker` — document ingestion

## 6. Verify Health

```bash
# Backend API
curl http://localhost:3002/api/health

# Zalo connection
curl http://localhost:3002/api/zalo/status

# Worker status
curl http://localhost:3002/api/worker/status
```

## 7. Open Admin UI

Open `http://localhost:3001` in browser. Log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

## 8. First Steps

1. Go to `/production-readiness` — verify all gates green
2. Check `/zalo-ops` — confirm Zalo connected
3. Review `/safety-mode` — dryRun should be `true`
4. Send a test message — verify dryRun reply
5. Run `npm run secret:audit` — no secrets leaked

## Safe Defaults

- **dryRun=true** — no real Zalo sends
- **Cooldown=10s** — prevents message spam
- **Only allowed threads** — set `ZALO_AUTO_REPLY_ALLOWED_THREADS`
- **Single backend process** — process lock enforced
