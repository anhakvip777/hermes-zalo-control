# CLAUDE.md — Hermes Zalo Control Center

## Agent Operating Protocol (Iron Laws)

> See full protocol: [docs/AGENT_OPERATING_PROTOCOL.md](docs/AGENT_OPERATING_PROTOCOL.md)

### Iron Laws

1. **Verification:** No PASS/SUCCESS claim without fresh evidence (test output, exit code, API response). Exit code != 0 → CANNOT claim PASS.
2. **Mini-Plan:** No code/config changes without user-approved plan first.
3. **State Reconciliation:** After empty response, interruption, tool error — reconcile state before proceeding.
4. **Safety:** ⛔ Never set global live=true. Never delete session/DB without approval. Never expose tokens/session.
5. **Evidence:** Every status report includes actual command output, not interpretation.

### Pre-Commit Gates

```
[ ] npm test -w packages/backend         → All pass, exit 0
[ ] npm run typecheck -w packages/backend → exit 0
[ ] npm run build -w packages/backend     → exit 0
[ ] npm run build -w packages/frontend    → exit 0
[ ] git diff --stat                       → No unintended changes
```

Failure at any gate → STOP. Do not commit. Fix first.

### Live Ops Verification

After any live system change, verify:
- Runtime config: `dryRun=true`, allowedThreads correct
- Live test: `active=false` (unless intentional)
- Zalo: `connected=true`, `listenerActive=true`, session exists
- Heartbeats: all `"ok"` (not `"down"`)

## Project Summary

A web dashboard for controlling AI agents that operate through Zalo. The system lets an AI agent (Hermes) create schedules, send messages, and interact with Zalo groups — but every action is transparent, auditable, and user-controllable via the web UI.

**Core rule**: AI never touches zca-js directly. All Zalo actions go through backend services.

## Architecture

```
User (Web Dashboard)
    ↓
Backend API (Fastify :3000)
    ├── Schedule Service → Prisma → SQLite/PostgreSQL
    ├── Queue Worker (BullMQ / node-cron) → Scheduler
    ├── Zalo Gateway → zca-js → Zalo WebSocket
    └── SSE → Frontend realtime updates

Frontend (Next.js :3001)
    └── Dashboard / Schedule Center / Attendance

Hermes Agent (external)
    └── Internal API → Backend (not zca-js directly)
```

## Key Design Rules

1. **Worker always reloads schedule from DB** before executing — never trusts job payload
2. **Every schedule has a version number** — incremented on every edit
3. **Jobs carry scheduleId + scheduleVersion** — skipped if version outdated
4. **All edits create revision log** + increment version + cancel old job + create new job
5. **Global pause/emergency stop** — worker checks before any individual schedule
6. **Dry-run mode** — runs all validation but doesn't actually send
7. **Zalo session persists** — restore on restart, reconnect with backoff
8. **Production secrets must be set** — server fails fast if default passwords in prod

See `PLAN.md` for the full architecture and mandatory requirements.

## Commands

```bash
npm run dev              # backend + frontend
npm run dev:all          # backend + frontend + worker
npm run typecheck        # tsc --noEmit all packages
npm test                 # vitest all packages
npm run test:e2e         # e2e tests only
npm run lint             # eslint
npm run format           # prettier
npm run db:migrate       # prisma migrate dev
npm run db:studio        # prisma studio
```

## Package tsconfig Rules

- **shared**: `module: "ESNext"`, `moduleResolution: "bundler"`
- **backend**: `module: "NodeNext"`, `moduleResolution: "NodeNext"`
- **frontend**: `module: "ESNext"`, `moduleResolution: "bundler"`, `jsx: "preserve"`
- **base**: No `module`/`moduleResolution` — each package overrides

## Document Ingestion (Batch 12)

**Status**: ✅ PRODUCTION READY (live-tested 2026-06-28)

### Supported Formats

| Format | Method | Status |
|--------|--------|--------|
| TXT, MD, CSV | Direct text ingestion | ✅ Stable |
| PDF (text-based, small/medium) | Docling spawn with `--no-ocr` | ✅ Stable |
| PDF (scanned/image-only) | Docling + OCR | ❌ Requires RapidOCR torch model |

### Architecture

```
POST /api/documents/ingest → 202 (queued) → Document Worker (separate process)
  → TXT/MD/CSV: direct read + chunk (no spawn)
  → PDF: spawn `docling --no-ocr` with 60s hard timeout + 5s kill grace
  → Markdown → chunks → completed
```

### Error Codes

**System errors (CRITICAL)** — backend/worker issue:
- `DOCLING_TIMEOUT` — Docling process killed after timeout
- `DOCLING_SPAWN_ERROR` — Failed to start docling process
- `DOCLING_POSTPROCESS_FAILED` — Chunk/DB write failed after successful conversion
- `DOCUMENT_NOT_FOUND` — Document record disappeared

**Document errors (MEDIUM)** — document limitation, not system crash:
- `DOCLING_FAILED` — Docling exit code != 0 (corrupted PDF, missing OCR model, etc.)
- `DOCLING_NO_OUTPUT` — Docling ran successfully but no markdown (image-only PDF)
- `PROCESSING_FAILED` — Catch-all for unclassified errors

### Known Limitations

1. **No OCR**: `--no-ocr` flag means scanned/image PDFs will fail with `DOCLING_NO_OUTPUT` or `DOCLING_FAILED`
2. **No retry**: Failed jobs are final — no automatic retry
3. **No parallel PDFs**: Worker processes 5 jobs max per poll cycle
4. **Safe dir only**: Files must be under `DOCUMENT_ALLOWED_BASE_DIR`

## Message Batching / Debounce (Batch 14 + 14.1)

**Status**: ✅ PASS (live-tested 2026-06-28)

### Overview

When enabled, consecutive text DMs within a configurable window are combined into a single MessageBatch and processed once — reducing duplicate Hermes calls and enabling multi-line reminder parsing.

### Config

| Key | Default | Description |
|-----|---------|-------------|
| `MESSAGE_BATCHING_ENABLED` | `false` | Safe default — disabled |
| `MESSAGE_BATCHING_WINDOW_MS` | `4000` | Debounce window (tested at 6000ms) |
| `MESSAGE_BATCHING_MAX_MESSAGES` | `5` | Max messages per batch |
| `MESSAGE_BATCHING_MAX_CHARS` | `3000` | Max chars per batch |
| `MESSAGE_BATCHING_THREAD_TYPES` | `user` | DM only (no groups) |

### Architecture

```
Zalo inbound → safety gates → Batching Interceptor
  → addToBatch() → collecting / ready (limits hit)
  → AgentTask skipped (reason: added_to_batch)
  → Batch Worker (10s poll) → processBatchNow()
  → Rules → Create-Reminder Parser → Hermes fallback
```

### Key Behaviors

- **Cooldown skipped during collecting**: `safetyCheck()` bypasses cooldown for text DMs when batching is active — messages 2..N are NOT blocked
- **Cooldown applied after batch**: Set when batch becomes `ready` (limits hit) or after processing
- **Combined text stored as-is**: `combinedText` preserves original `\n` separators for audit
- **Normalized for parsing**: `parseReminderFromMessage` normalizes `\n` → ` ` internally for pattern matching
- **Non-text passthrough**: Images/files always go through individually, not batched
- **Groups excluded**: Only DM text is batched; group messages follow normal pipeline

### Reminder Parser (Batch 14.1)

Added pattern: `nhắc [target]? <content> lúc <time>`

| Example | Content | Time |
|---------|---------|------|
| `Nhắc mình đi lễ Phật lúc 19h` | `đi lễ Phật` | `19h` |
| `Nhắc mình\nĐi Lễ Phật\nLúc 19h` | `Đi Lễ Phật` | `19h` (batched) |
| `nhắc đi chợ lúc 7h sáng` | `đi chợ` | `7h sáng` |

`parseLúcTime()` helper: 12h/24h notation, period detection (sáng/chiều/tối/trưa), auto-PM for hours 1-6.

### Safety

- Disabled by default (`MESSAGE_BATCHING_ENABLED=false`)
- DM only — groups still use normal pipeline
- All safety gates run BEFORE batching (allowlist, self-guard)
- Unsupported System Claim Guard still blocks Hermes fake "đã đặt lịch" claims
- Dry-run always respected

### DB Schema

`MessageBatch` model with lifecycle: `collecting` → `ready` → `processing` → `completed`/`cancelled`

### Tests

- `batch14-message-batching.test.ts`: 19 tests (10 service + 9 parser)
- Full suite: 30 files, 504/504 PASS

### Key Files

| File | Purpose |
|------|---------|
| `packages/backend/src/services/message-batch.service.ts` | Batch CRUD: create, append, claim, complete |
| `packages/backend/src/workers/message-batch-worker.ts` | Polling worker for overdue batches |
| `packages/backend/src/services/incoming-dispatcher.service.ts` | Batching interceptor + `processBatchNow` + reminder parser |

### Known Limitations

1. **Group not supported**: Batching only for DM (`user` thread type)
2. **In-memory cooldown**: `lastReplyAt` Map resets on restart (cooldown window may reopen)
3. **No batch UI yet**: Batch status visible via DB only; no Admin Center card

## Controlled Live Test (Batch 18)

**Status**: ✅ PASS (live-tested 2026-06-29)

### Overview

Live test mode allows ONE real Zalo DM send with automatic quota (maxMessages) + TTL. After quota, all subsequent DMs fall back to dry-run.

### Config

| Key | Default | Description |
|-----|---------|-------------|
| LiveTestSession | API | One-shot, maxMessages=1, TTL 300s |
| `ZALO_AUTO_REPLY_DRY_RUN` | `true` | Always true except during live test bypass |
| `ZALO_DRY_RUN` | `true` | PM2 ecosystem env (does NOT block listener) |

### Architecture

```
POST /api/system/live-test/start → LiveTestSession (active, maxMessages, TTL)
  → Incoming DM → dispatcher detects active session
  → If sentCount < maxMessages: dryRun bypass → REAL send → sentCount++
  → If sentCount >= maxMessages: session auto-completed → fallback to dryRun
POST /api/system/live-test/stop → force-complete session
```

### Key Behaviors

- **Listener always starts**: `config.autoReply.enabled` gates Zalo listener (was `config.zalo.dryRun` which blocked it in PM2)
- **Post-quota safety**: After live test completes, all messages revert to `dryRun=true`
- **No duplicate sends**: Each live test session tracks `sentCount` vs `maxMessages`
- **Session auto-completes**: When sentCount reaches maxMessages, session status → `completed`

### Zalo Process Conflict Fix

- **Root cause**: Old PM2 `hermes-api` (npm run dev:backend) + manual `npx tsx` → 3 concurrent backends → Zalo "Another connection" error → listener dropped
- **Fix**: Single PM2 `hermes-backend` via `ecosystem.config.cjs` + symlink `prisma → packages/backend/prisma` for dist build
- **Code fix**: `src/index.ts` — Zalo auto-restore now gated on `config.autoReply.enabled` (not `config.zalo.dryRun`)

### Known Backlog

1. **messagePipeline heartbeat stale** after message received — heartbeat emission path needs audit (cosmetic)

### Key Files

| File | Purpose |
|------|---------|
| `packages/backend/src/services/live-test.service.ts` | Live test session CRUD + quota tracking |
| `packages/backend/src/routes/system.ts` | `/api/system/live-test/*` endpoints |
| `packages/backend/src/__tests__/batch18-live-test.test.ts` | 18 tests for live test flow |

## Production Pilot Runbook (Batch 19)

**Status**: ✅ READY (2026-06-29)

### Overview

Comprehensive runbook for safe production pilot deployment. Includes pre-live checklist, monitoring plan, rollback procedures, and PASS/FAIL criteria.

### Pilot Phases

| Phase | Scope | Method | Gate |
|-------|-------|--------|------|
| 1 | 1 DM test thread, 1-3 replies, 5min TTL | Controlled Live Test API | Batch 18 ✅ |
| 2 | 1 trusted DM, 30-60min | LiveTestSession or thread-level dryRun=false | Phase 1 must PASS |
| 3 | 1 small group, @mention only, 1-2hr | groupMentionRequired=true | Phase 2 must PASS |

### Key Document

`docs/PRODUCTION_PILOT_RUNBOOK.md` — full runbook with:
- Pre-live checklist (22 items)
- Monitoring checklist (dashboards + API + DB)
- Rollback plan (6 steps, <30s to execute)
- PASS/FAIL criteria
- Pilot log template

### Related UI

- `/production-readiness` — runbook link in Production Pilot section
- `/zalo-ops` — live test controls
- `/safety-mode` — dryRun toggle, cooldown, batching


## Key Files

| File                                        | Purpose                                      |
| ------------------------------------------- | -------------------------------------------- |
| `packages/backend/src/services/document-ingestion.service.ts` | Docling spawn, chunking, ask document API  |
| `packages/backend/src/workers/document-worker.ts` | Document worker (separate process, poll loop) |
| `packages/backend/src/routes/documents.ts`  | Document REST API routes                     |
| `packages/frontend/src/app/documents/page.tsx` | Document dashboard with error classification |
| `PLAN.md`                                   | Full architecture, phases, database schema   |
| `packages/backend/prisma/schema.prisma`     | Database schema                              |
| `packages/shared/src/schemas/`              | Shared Zod validation                        |
| `packages/backend/src/config.ts`            | Env config with production secret validation |
| `packages/backend/src/workers/scheduler.ts` | Main worker logic                            |

## Database Tables

`schedules` → `schedule_executions` → `schedule_revisions` → `schedule_jobs` → `messages` → `zalo_threads` → `agent_tasks` → `audit_logs` → `attendance_sessions` → `attendance_records` → `app_settings` → `documents` → `document_ingestion_jobs` → `document_chunks`

## Phases

1. ✅ Project skeleton (current)
2. Schedule Core — CRUD + revision log + version bump
3. Queue Worker — BullMQ/node-cron + execution tracking
4. Frontend Schedule Center — full UI
5. Zalo Gateway — zca-js integration
6. Hermes Integration — agent task API
7. Attendance MVP
8. Hardening — security, tests, docs

## Development Notes

- `ZALO_DRY_RUN=true` by default in dev — no real Zalo messages sent
- Redis is optional for dev — node-cron used as fallback
- SQLite database file is gitignored
- Zalo session data must NEVER be committed
- Backend is `"type": "module"` — use ESM imports with `.js` extensions in relative paths
- Shared package must be built (`npm run build -w packages/shared`) before other packages can import it
