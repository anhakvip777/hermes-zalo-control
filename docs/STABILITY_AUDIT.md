# STABILITY AUDIT — Hermes Zalo Control Center

**Date**: 2026-06-28
**Scope**: Batch 12 + 12.1 + Old Jobs Cleanup

---

## Stability History

| Date | Event | Resolution |
|------|-------|------------|
| 2026-06-28 | PDF live test: Docling process isolation | PASS |
| 2026-06-28 | Worker OOM simulation | Backend survived ✅ |
| 2026-06-28 | Docling timeout test | Kill + cleanup works ✅ |
| 2026-06-28 | Old failed jobs cleanup | Classified, no retry ✅ |

---

## Current System State

### Backend
- **Status**: ✅ Healthy (1300+ seconds uptime)
- **Memory**: Stable
- **API**: All endpoints responding

### Document Worker
- **Status**: ✅ Running (separate process, PID tracked)
- **Memory limit**: 2048MB (NODE_OPTIONS)
- **Poll interval**: 5 seconds
- **Docling timeout**: 60 seconds + 5 second kill grace

### Database
- **Size**: Normal
- **Migration**: Clean
- **Failed jobs**: 0 active (2 old classified)
- **Document count**: 0 (clean after tests)

### Frontend
- **Status**: ✅ Building and serving
- **All pages**: Functional
- **Documents page**: Error classification active

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
- **Detection**: Process manager (external)
- **DB state**: Any in-progress job marked failed
- **Backend**: Unaffected ✅ (separate process)
- **Recovery**: Restart worker process

### 5. Backend Crash
- **Detection**: Health check
- **Worker**: Unaffected (separate process, keeps polling)
- **DB state**: Intact
- **Recovery**: Restart backend via process manager

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

---

## Known Stability Issues

1. **RapidOCR model missing**: Scanned PDFs fail with DOCLING_FAILED (not a crash)
2. **system-health.test.ts**: 2 pre-existing test failures (backup check, DB snapshot) — unrelated to documents
3. **No process manager**: Worker must be manually restarted if it crashes (pm2/supervisord not configured)

---

## Verdict

### ✅ STABLE — No regressions, no crashes, no data loss

Batch 12 + 12.1 has been live-tested and verified. The system handles failures gracefully:
- Document conversion failures → MEDIUM errors, not crashes
- Process crashes → Backend survives
- Timeouts → Auto-kill + cleanup
- Old failed jobs → Properly classified, no retry loops
