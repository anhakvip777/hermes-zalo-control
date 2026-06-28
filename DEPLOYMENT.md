# Deployment Guide — Hermes Zalo Control Center

## Prerequisites

- **Node.js** >= 22.0.0
- **npm** >= 10.9.0
- **Redis** (optional for dev, recommended for production)
- **PostgreSQL** (recommended for production, SQLite works for light use)
- **nginx** (for reverse proxy)

## Quick Deploy on VPS

### 1. Clone and install

```bash
git clone <repo-url> /opt/hermes-zalo-control
cd /opt/hermes-zalo-control
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with production values:

```ini
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
APP_TIMEZONE=Asia/Ho_Chi_Minh

# Database (PostgreSQL recommended for production)
DATABASE_URL="postgresql://user:password@localhost:5432/hermes_zalo_control"

# Redis (required for production scheduling)
REDIS_URL=redis://localhost:6379

# Zalo
ZALO_DRY_RUN=false
ZALO_SESSION_DIR=./zalo-session

# Security — GENERATE REAL SECRETS
JWT_SECRET=<openssl rand -hex 32>
COOKIE_SECRET=<openssl rand -hex 32>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong unique password>

# Frontend
FRONTEND_URL=https://your-domain.com
CORS_ORIGIN=https://your-domain.com
NEXT_PUBLIC_API_URL=https://your-domain.com

# Rate limiting
ZALO_RATE_LIMIT_PER_MINUTE=10
ZALO_RATE_LIMIT_GLOBAL_PER_MINUTE=60
MAX_RETRY_ATTEMPTS=3
```

> **⚠️ CRITICAL**: In production, `JWT_SECRET`, `COOKIE_SECRET`, and `ADMIN_PASSWORD` must NOT be their default values. The server will fail fast if they are.

### 3. Set up database

```bash
npm run db:migrate
npm run db:generate
```

### 4. Build

```bash
npm run build
```

### 5. Start services

#### Option A: pm2 (recommended)

```bash
# Install pm2
npm install -g pm2

# Start backend
pm2 start npm --name "hermes-api" -- run dev:backend

# Start worker
pm2 start npm --name "hermes-worker" -- run dev:worker

# Start frontend
pm2 start npm --name "hermes-web" -- run dev:frontend

# Save and auto-start
pm2 save
pm2 startup
```

#### Option B: systemd

```ini
# /etc/systemd/system/hermes-api.service
[Unit]
Description=Hermes Zalo Control API
After=network.target

[Service]
Type=simple
User=hermes
WorkingDirectory=/opt/hermes-zalo-control
ExecStart=/usr/bin/npm run dev:backend
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Repeat for `hermes-worker` and `hermes-web`.

### 6. nginx reverse proxy

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Frontend
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

### 7. Zalo Login

After starting the backend:

```bash
# Start Zalo login (QR code will appear in console or via API)
curl -X POST http://127.0.0.1:3000/api/zalo/login/start
```

The Zalo session will be saved to `ZALO_SESSION_DIR` and restored automatically on restart.

> **📌 Auto-restore (2026-06-24):** Backend now calls `restoreSession({ startListener: true })` on startup.
> Worker calls `restoreSession({ startListener: false })` for send-only access.
> If `zalo-session.json` exists with valid credentials, Zalo reconnects without QR re-scan.

## Backup

### Database

```bash
# PostgreSQL
pg_dump -U user hermes_zalo_control > backup-$(date +%Y%m%d).sql

# SQLite
cp packages/backend/prisma/dev.db backup-$(date +%Y%m%d).db
```

### Zalo Session

```bash
tar czf zalo-session-backup-$(date +%Y%m%d).tgz packages/backend/zalo-session/
```

### Environment

Keep `.env` secure — it contains all secrets. Do NOT commit it.

## Smoke Test

```bash
npm run smoke
```

Or manually:

```bash
# Health
curl http://localhost:3000/api/health

# Admin status (requires auth)
curl -u admin:password http://localhost:3000/api/admin/status

# Zalo status
curl http://localhost:3000/api/zalo/status

# Create schedule
curl -u admin:password -X POST http://localhost:3000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke test","type":"zalo_message","scheduledAt":"2026-12-31T23:59:00Z","messageContent":"Test","targetId":"smoke-test","createdBy":"system"}'

# Parse command
curl -u admin:password -X POST http://localhost:3000/api/agent/parse-command \
  -H "Content-Type: application/json" \
  -d '{"command":"22h nhac Le Phat vao group Lop Tu Hoc"}'
```

## Rollback (Instant Safe Mode)

To immediately disable AI auto-reply and return to safe mock mode:

```bash
# Edit packages/backend/.env and set:
ZALO_AUTO_REPLY_DRY_RUN=true        # Process messages but don't send to Zalo
HERMES_CHAT_ADAPTER=mock            # Echo replies instead of AI
ZALO_AUTO_REPLY_ENABLED=false       # Disable auto-reply entirely

# Restart backend (no restart needed for ZALO_AUTO_REPLY_ENABLED change — read on each message)
# But for adapter switch (mock ↔ real), restart is required:
pkill -f "tsx.*src/index.ts"
sleep 2
cd packages/backend
npx tsx src/index.ts &
```

> **Safety**: `ZALO_AUTO_REPLY_ENABLED=false` takes effect instantly (dispatcher reads config per-message). Adapter switch (`HERMES_CHAT_ADAPTER`) requires backend restart.

## Monitoring

- `GET /api/health` — backend uptime (<100ms)
- `GET /api/zalo/status` — Zalo connection status
- `GET /api/admin/status` — global system state
- `GET /api/worker/status` — queue worker status (<2s guaranteed, safe fallback on DB timeout)
- `GET /api/agent/auto-reply/status` — auto-reply pipeline: enabled, dryRun, allowedThreads, cooldownSeconds, activeCooldowns

## Zalo Live Chat Pipeline (2026-06-25)

The system routes incoming Zalo messages through a dispatcher that calls an AI adapter for reply generation, then sends the reply back to Zalo.

### Architecture

```
Zalo Message → zca-js listener → normalizeMessage → saveIncomingMessage
                                                       ↓
                                                  handleIncomingMessage()
                                                       ↓
                                             safety checks (6 gates)
                                                       ↓
                                             AgentTask created (audit)
                                                       ↓
                                             HermesChatAdapter.generateReply()
                                                       ↓
                                             ZaloMessageSender.sendMessage()
                                                       ↓
                                             Reply arrives in user's Zalo app
```

### Env Configuration

```ini
# packages/backend/.env
ZALO_AUTO_REPLY_ENABLED=true            # Master switch
ZALO_AUTO_REPLY_DRY_RUN=false           # false = real sends
ZALO_AUTO_REPLY_ALLOWED_THREADS=6792540503378312397  # Comma-separated thread IDs
ZALO_AUTO_REPLY_COOLDOWN_SECONDS=10     # Min seconds between replies per thread
```

### Safety Gates (in order)

1. `ZALO_AUTO_REPLY_ENABLED=false` → skip (reason: `auto_reply_disabled`)
2. Thread not in `ALLOWED_THREADS` → skip (reason: `thread_not_allowed`)
3. Empty/whitespace content → skip (reason: `empty_content`)
4. Non-text message → skip (reason: `non_text_message`)
5. No threadId → skip (reason: `no_threadId`)
6. In cooldown → skip (reason: `cooldown`)

### Current Adapter: RealHermesChatAdapter CLI ✅

The active adapter uses Hermes CLI (`spawn(shell=false)`) to generate AI replies via DeepSeek v4 Pro. Live tested 2026-06-25 with `dryRun=false` — replies confirmed on Zalo app.

### RealHermesChatAdapter (activated, live tested)

For AI-generated replies via Hermes, switch to real mode:

```ini
# packages/backend/.env
HERMES_CHAT_ADAPTER=real                # Switch from mock to real
HERMES_CHAT_ENDPOINT=http://...         # Hermes HTTP endpoint URL
HERMES_CHAT_TIMEOUT_MS=30000            # Request timeout (ms)
HERMES_CHAT_MIN_CONFIDENCE=0.5          # Skip real send if confidence < threshold
```

**How it works:**
1. RealHermesChatAdapter sends HTTP POST to `HERMES_CHAT_ENDPOINT`
2. Payload: `{ threadId, threadType, senderId, senderName, content, recentMessages, timestamp }`
3. Expected response: `{ reply: "text", confidence: 0.8 }`
4. Timeout via `AbortController`, errors caught safely (listener never crashes)

**Safety features:**
- Empty reply → AgentTask failed, no Zalo send
- Low confidence (< `HERMES_CHAT_MIN_CONFIDENCE`) → completion flagged `confidenceTooLow`, no real send
- Reply > 2000 chars → auto-truncated with "... (đã cắt)"
- Adapter errors → AgentTask failed, listener continues
- No token/session/cookie logging

**⚠️ Do NOT activate real adapter without:**
1. A working Hermes endpoint URL
2. Owner approval
3. First testing on single user thread only

### Live Test Verification (2026-06-25)

✅ Real Hermes CLI live auto-reply tested and passed:

| Check | Result |
|-------|--------|
| Inbound message saved | ✅ |
| RealHermesChatAdapter CLI called | ✅ (spawn shell=false) |
| Hermes AI reply generated | ✅ |
| Reply sent to Zalo | ✅ (sentMessageId confirmed) |
| AgentTask completed | ✅ (dryRun=false) |
| Confidence | 0.9 |
| Duplicate reply | No |
| Cooldown works | ✅ |
| Listener crash | No |
| Worker affected | No |

**Live test tasks:**
- `cmqtna0hr` — "Trả lời tui đi" → "Chào bạn! 👋 Mình đây..."
- `cmqtnayp0` — "Bạn có biết link..." → "Dạ có ạ! Admin Center chạy ở: http://localhost:3001..."

**Limitations:**
- Only tested on single allowed thread (6792540503378312397)
- Group auto-reply NOT enabled
- Hermes CLI latency: 8-15s
- Current provider: DeepSeek v4 Pro

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Zalo not sending | `GET /api/zalo/status` — check `connected` and `dryRun` |
| Zalo connected=false after restart | Check `zalo-session.json` exists in `ZALO_SESSION_DIR`. Backend auto-restores on startup. If missing, scan QR again. |
| Schedules not running | `GET /api/worker/status` — check worker is running |
| /api/worker/status hangs | DB read timeout (>1500ms). Returns safe fallback: `{"active":false,"provider":"unknown","error":"WORKER_STATUS_UNAVAILABLE"}`. Worker is still running — check DB lock. |
| Emergency stop won't clear | `POST /api/admin/clear-emergency` |
| Port in use | `lsof -i :3000` or `netstat -tlnp \| grep 3000`. Default port is 3002 (3000 used by Docker). |
| DB locked (SQLite) | Restart backend (SQLite doesn't support concurrent writes) |
| auto-restore fails | Check logs: `pm2 logs hermes-api \| grep -i restore`. Error types: NO_SESSION_FILE, CREDENTIALS_EXPIRED, ZALO_LOGIN_FAILED, RESTORE_FAILED |
| Hermes adapter fails | Check `HERMES_CHAT_ADAPTER` and `HERMES_CHAT_ENDPOINT`. Adapter errors are logged as `[dispatcher] error:` and saved to AgentTask. Listener does NOT crash. |
| Hermes reply empty | Adapter returned empty reply → AgentTask marked failed with `empty_reply`. Check endpoint response format. |
| Low confidence skip | Check `HERMES_CHAT_MIN_CONFIDENCE`. If adapter confidence < threshold, reply is skipped with `confidenceTooLow=true`. |
| Real adapter not working | Verify `HERMES_CHAT_ADAPTER=real` AND `HERMES_CHAT_ENDPOINT` is set. Test: `curl -X POST $HERMES_CHAT_ENDPOINT -H "Content-Type: application/json" -d '{"content":"test"}'` |

## Cloudflare Tunnel (2026-06-25)

Public access to the Admin Center web UI via Cloudflare Named Tunnel.

### Architecture

```
Browser (internet)
  ↓ https://<domain-cua-ban>
Cloudflare Tunnel (cloudflared)
  ↓ http://127.0.0.1:3001
Next.js frontend (port 3001)
  ├── /          → static pages
  └── /api/*     → rewrites → http://127.0.0.1:3002/api/* (backend)
```

### Configuration

| Key | Value |
|-----|-------|
| Public URL | `https://<domain-cua-ban>` |
| Tunnel type | Cloudflare Named Tunnel |
| Frontend local | `http://127.0.0.1:3001` |
| Backend local | `http://127.0.0.1:3002` (internal only) |
| API access | Same-origin `/api/*` via Next.js `rewrites()` |
| Ports exposed | **None** — 3001/3002 remain `127.0.0.1` only |

### Verification

```bash
curl https://<domain-cua-ban>/api/health
# → {"status":"ok","uptime":...}

curl https://<domain-cua-ban>/admin
# → HTTP 200
```

### How it works

1. `next.config.ts` has `rewrites()` → `/api/:path*` → `http://localhost:3002/api/:path*`
2. Frontend's `NEXT_PUBLIC_API_URL=""` → relative paths → no CORS needed
3. Cloudflared tunnel routes all traffic to `localhost:3001`
4. API calls go through Next.js proxy → backend — backend never exposed publicly

## Known Issues (Non-blocking)

5 pre-existing test failures (143/148 pass):
- 3x environment mismatch: tests expect `ZALO_DRY_RUN=true` (dev), but VPS runs `ZALO_DRY_RUN=false` (production)
- 2x Vietnamese diacritic normalization in NLP parser (cosmetic, does not affect schedule creation)
- See `CUSTOMER_READINESS_AUDIT.md` for full failure breakdown.
