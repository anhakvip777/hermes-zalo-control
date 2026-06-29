# CUSTOMER READINESS AUDIT — Hermes Zalo Control Center

**Date**: 2026-06-29
**Auditor**: Hermes Agent
**Scope**: Batch 12 + 12.1 + Batch 18 — Docling + Controlled Live Test

---

## Production Readiness Checklist

### 1. Code Quality

| Check | Status | Notes |
|-------|--------|-------|
| TypeScript strict | ✅ PASS | All 3 packages typecheck clean |
| ESLint | ✅ PASS | No new errors |
| Test coverage | ✅ 586/586 | Full suite passing |
| No dead code | ✅ PASS | All services used in live test |

### 2. Architecture

| Check | Status | Notes |
|-------|--------|-------|
| Process isolation | ✅ PASS | Docling spawned as child, not loaded in-process |
| Timeout protection | ✅ PASS | 60s hard timeout + 5s kill grace |
| Backend survives crash | ✅ PASS | Live tested: worker OOM → backend OK |
| No blocking API | ✅ PASS | Ingest returns 202 immediately |
| Error classification | ✅ PASS | System vs Document errors distinguished |
| Single backend instance | ✅ PASS | PM2 managed, process lock enforces singleton |
| Zalo listener always starts | ✅ PASS | Gated on autoReply.enabled, not dryRun |

### 3. Security

| Check | Status | Notes |
|-------|--------|-------|
| Path traversal blocked | ✅ PASS | `../` filtered, safe dir enforced |
| File type whitelist | ✅ PASS | Only allowed extensions |
| File size limit | ✅ PASS | Max 50MB |
| Sensitive files blocked | ✅ PASS | .env, session, key, passwd filtered |
| No hardcoded secrets | ✅ PASS | Audit clean |
| .env not tracked | ✅ PASS | In .gitignore |
| DB not tracked | ✅ PASS | In .gitignore |
| Zalo session not tracked | ✅ PASS | In .gitignore |
| Admin password not default | ✅ PASS | Custom password in .env |

### 4. Reliability

| Check | Status | Notes |
|-------|--------|-------|
| Worker restart survival | ✅ PASS | Survives kill + restart |
| DB consistency | ✅ PASS | Document/Job status sync |
| No data loss on crash | ✅ PASS | Failed jobs marked with specific error |
| Clean error codes | ✅ PASS | DOCLING_FAILED, DOCLING_NO_OUTPUT, etc. |
| No auto-retry on failure | ✅ PASS | Worker only polls queued jobs |
| Live test quota respected | ✅ PASS | 1 real send, post-quota dryRun fallback |
| Zalo reconnect on restart | ✅ PASS | Session auto-restore, listener restarts |
| PM2 auto-restart | ✅ PASS | ecosystem.config.cjs with max_restarts=5 |

### 5. User Experience

| Check | Status | Notes |
|-------|--------|-------|
| Dashboard page | ✅ PASS | /documents with ingest + table + detail |
| Error visibility | ✅ PASS | Color-coded: red (system) vs orange (document) |
| Vietnamese support | ✅ PASS | Ask answers in Vietnamese |
| Hallucination guard | ✅ PASS | "Tài liệu không đề cập" when not found |
| Production readiness page | ✅ PASS | /production-readiness with live audit |
| Zalo Ops page | ✅ PASS | /zalo-ops with status, heartbeats, live test |

### 6. Backward Compatibility

| Check | Status | Notes |
|-------|--------|-------|
| Schedule system untouched | ✅ PASS | No regression |
| Zalo system enhanced | ✅ PASS | Live test mode added, dryRun default unchanged |
| Existing API unchanged | ✅ PASS | All existing routes work |
| Database migrations clean | ✅ PASS | Only new tables added (LiveTestSession) |

### 7. Production Deployment

| Check | Status | Notes |
|-------|--------|-------|
| PM2 ecosystem config | ✅ PASS | hermes-backend + hermes-worker |
| Single backend enforcement | ✅ PASS | Process lock + PM2 singleton |
| Zalo session persistence | ✅ PASS | Auto-restore on restart |
| dryRun safe default | ✅ PASS | ZALO_AUTO_REPLY_DRY_RUN=true |
| Controlled live test | ✅ PASS | API-based, quota + TTL, auto-rollback |
| Graceful degradation | ✅ PASS | Listener down → backend still serves API |

---

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Docling crash | 🟡 LOW | Process isolation, backend survives |
| Docling OOM | 🟡 LOW | 2GB worker limit, 60s timeout |
| Scanned PDF fail | 🟢 EXPECTED | Clear DOCLING_FAILED error, not crash |
| Large PDF timeout | 🟡 LOW | 60s limit, killed gracefully |
| Worker restart needed | 🟢 MINIMAL | PM2 auto-restart configured |
| Zalo duplicate connection | 🟡 LOW | Process lock + PM2 singleton enforced |
| Live test over-send | 🟢 SAFE | Quota tracked per session, auto-completes |
| messagePipeline stale | 🟢 COSMETIC | Heartbeat refresh on next dispatch |

---

## Verdict

### ✅ PRODUCTION READY

All critical checks pass. Batch 12 + 12.1 + Batch 18 are stable, tested end-to-end, and safe to deploy.

**Controlled live test mode** enables safe production verification without risking duplicate/unexpected sends.
