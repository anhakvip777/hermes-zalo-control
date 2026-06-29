# STABILITY AUDIT — Hermes Zalo Control Center

**Date**: 2026-06-29
**Scope**: Batch 12 + 12.1 + Old Jobs Cleanup + Batch 18 Live Test

---

## Stability History

| Date | Event | Resolution |
|------|-------|------------|
| 2026-06-29 | Batch 18: Controlled live test mode | PASS |
| 2026-06-29 | Zalo process conflict (3 backends) | Cleaned → 1 PM2 instance |
| 2026-06-28 | PDF live test: Docling process isolation | PASS |
| 2026-06-28 | Worker OOM simulation | Backend survived ✅ |
| 2026-06-28 | Docling timeout test | Kill + cleanup works ✅ |
| 2026-06-28 | Old failed jobs cleanup | Classified, no retry ✅ |

---

## Current System State

### Backend
- **Status**: ✅ Healthy (PM2 managed, PID 2928242)
- **Memory**: Stable (~92MB)
- **API**: All endpoints responding
- **Zalo**: Connected, listener active

### PM2 Worker
- **Status**: ✅ Running (PID 2928373)
- **Poll interval**: 10 seconds
- **Dry-run**: true (safe default)

### Database
- **Size**: Normal
- **Migration**: Clean
- **LiveTestSessions**: 1 completed (Batch 18)
- **Total real sends**: 138 (1 from live test)

### Frontend
- **Status**: ✅ Building and serving (Next.js, port 3001)
- **All pages**: Functional
- **Production readiness page**: Active
- **Zalo ops page**: Active

---

## Failure Modes & Recovery

### 1. Docling Crash (exit code != 0)
- **Detection**: Worker catches spawn error
- **DB update**: Document + Job marked `failed` with `DOCLING_FAILED`
- **Dashboard**: Orange "📄 Conversion failed" badge
- **Backend**: Unaffected ✅
- **Recovery**: No auto-retry. Manual re-ingest with fixed file.

### 2. Docling No Output (exit 0, no markdown)
- **Detection**: Post-processing checks for readable markdown
- **DB update**: `DOCLING_NO_OUTPUT`
- **Dashboard**: Orange "📄 No extractable text"
- **Recovery**: PDF may be image-only. Install RapidOCR for scan support.

### 3. Docling Timeout (hung process)
- **Detection**: 60s hard timeout
- **Action**: SIGTERM → 5s grace → SIGKILL
- **DB update**: `DOCLING_TIMEOUT`
- **Dashboard**: Red "⚡ System error"
- **Backend**: Unaffected ✅
- **Recovery**: Auto-killed. Worker continues polling.

### 4. Worker Process Crash
- **Detection**: PM2 auto-restart
- **DB state**: Any in-progress job marked failed
- **Backend**: Unaffected ✅ (separate process)
- **Recovery**: PM2 restarts worker automatically

### 5. Backend Crash
- **Detection**: Health check
- **Worker**: Unaffected (separate process, keeps polling)
- **DB state**: Intact
- **Recovery**: PM2 restarts backend automatically

### 6. Zalo Process Conflict (Multiple Backends)
- **Detection**: Zalo "Another connection is opened" error in logs
- **Cause**: Multiple backend processes (PM2 + manual) all login to same Zalo account
- **Impact**: Listener dropped, incoming messages missed
- **Fix**: Single PM2 `hermes-backend` via `ecosystem.config.cjs`; symlink `prisma → packages/backend/prisma`; code gate on `config.autoReply.enabled`
- **Recovery**: Kill old processes, restart single backend via PM2

---

## Resource Limits

| Resource | Limit | Enforced By |
|----------|-------|-------------|
| Worker heap | 2048 MB | NODE_OPTIONS |
| Docling runtime | 60 seconds | setTimeout + process.kill |
| Docling kill grace | 5 seconds | setTimeout after SIGTERM |
| Docling output | 1 MB | Buffer cap |
| File size | 50 MB | Config validation |
| Jobs per poll | 5 | Worker query limit |
| DB connections | Prisma default | Connection pool |
| PM2 max restarts | 5 | ecosystem.config.cjs |
| Live test quota | 1 message | LiveTestSession.maxMessages |

---

## Known Stability Issues

1. **RapidOCR model missing**: Scanned PDFs fail with DOCLING_FAILED (not a crash)
2. **system-health.test.ts**: 2 pre-existing test failures (backup check, DB snapshot) — unrelated to documents
3. **messagePipeline heartbeat stale**: After message received, heartbeat may not refresh until next dispatch (cosmetic)

---

## Verdict

### ✅ STABLE — Batch 18 Live Test PASS, Zalo conflict cleaned, no regressions

Batch 12 + 12.1 + Batch 18 have been live-tested and verified. The system handles failures gracefully:
- Document conversion failures → MEDIUM errors, not crashes
- Process crashes → Backend survives
- Timeouts → Auto-kill + cleanup
- Old failed jobs → Properly classified, no retry loops
- **Controlled live test (Batch 18)**: One real DM send with quota + TTL verified; post-quota dry-run fallback confirmed
- **Zalo process conflict**: Root cause (3 backends) found and fixed; single PM2 backend enforced
