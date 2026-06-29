     1|# CUSTOMER READINESS AUDIT — Hermes Zalo Control Center
     2|
     3|**Date**: 2026-06-29
     4|**Auditor**: Hermes Agent
     5|**Scope**: Batch 12 + 12.1 + Batch 18 + Batch 19 — Docling + Controlled Live Test + Pilot Runbook
     6|
     7|---
     8|
     9|## Production Readiness Checklist
    10|
    11|### 1. Code Quality
    12|
    13|| Check | Status | Notes |
    14||-------|--------|-------|
    15|| TypeScript strict | ✅ PASS | All 3 packages typecheck clean |
    16|| ESLint | ✅ PASS | No new errors |
    17|| Test coverage | ✅ 586/586 | Full suite passing |
    18|| No dead code | ✅ PASS | All services used in live test |
    19|
    20|### 2. Architecture
    21|
    22|| Check | Status | Notes |
    23||-------|--------|-------|
    24|| Process isolation | ✅ PASS | Docling spawned as child, not loaded in-process |
    25|| Timeout protection | ✅ PASS | 60s hard timeout + 5s kill grace |
    26|| Backend survives crash | ✅ PASS | Live tested: worker OOM → backend OK |
    27|| No blocking API | ✅ PASS | Ingest returns 202 immediately |
    28|| Error classification | ✅ PASS | System vs Document errors distinguished |
    29|| Single backend instance | ✅ PASS | PM2 managed, process lock enforces singleton |
    30|| Zalo listener always starts | ✅ PASS | Gated on autoReply.enabled, not dryRun |
    31|
    32|### 3. Security
    33|
    34|| Check | Status | Notes |
    35||-------|--------|-------|
    36|| Path traversal blocked | ✅ PASS | `../` filtered, safe dir enforced |
    37|| File type whitelist | ✅ PASS | Only allowed extensions |
    38|| File size limit | ✅ PASS | Max 50MB |
    39|| Sensitive files blocked | ✅ PASS | .env, session, key, passwd filtered |
    40|| No hardcoded secrets | ✅ PASS | Audit clean |
    41|| .env not tracked | ✅ PASS | In .gitignore |
    42|| DB not tracked | ✅ PASS | In .gitignore |
    43|| Zalo session not tracked | ✅ PASS | In .gitignore |
    44|| Admin password not default | ✅ PASS | Custom password in .env |
    45|
    46|### 4. Reliability
    47|
    48|| Check | Status | Notes |
    49||-------|--------|-------|
    50|| Worker restart survival | ✅ PASS | Survives kill + restart |
    51|| DB consistency | ✅ PASS | Document/Job status sync |
    52|| No data loss on crash | ✅ PASS | Failed jobs marked with specific error |
    53|| Clean error codes | ✅ PASS | DOCLING_FAILED, DOCLING_NO_OUTPUT, etc. |
    54|| No auto-retry on failure | ✅ PASS | Worker only polls queued jobs |
    55|| Live test quota respected | ✅ PASS | 1 real send, post-quota dryRun fallback |
    56|| Zalo reconnect on restart | ✅ PASS | Session auto-restore, listener restarts |
    57|| PM2 auto-restart | ✅ PASS | ecosystem.config.cjs with max_restarts=5 |
    58|
    59|### 5. User Experience
    60|
    61|| Check | Status | Notes |
    62||-------|--------|-------|
    63|| Dashboard page | ✅ PASS | /documents with ingest + table + detail |
    64|| Error visibility | ✅ PASS | Color-coded: red (system) vs orange (document) |
    65|| Vietnamese support | ✅ PASS | Ask answers in Vietnamese |
    66|| Hallucination guard | ✅ PASS | "Tài liệu không đề cập" when not found |
    67|| Production readiness page | ✅ PASS | /production-readiness with live audit |
    68|| Zalo Ops page | ✅ PASS | /zalo-ops with status, heartbeats, live test |
    69|
    70|### 6. Backward Compatibility
    71|
    72|| Check | Status | Notes |
    73||-------|--------|-------|
    74|| Schedule system untouched | ✅ PASS | No regression |
    75|| Zalo system enhanced | ✅ PASS | Live test mode added, dryRun default unchanged |
    76|| Existing API unchanged | ✅ PASS | All existing routes work |
    77|| Database migrations clean | ✅ PASS | Only new tables added (LiveTestSession) |
    78|
    79|### 7. Production Deployment
    80|
    81|| Check | Status | Notes |
    82||-------|--------|-------|
    83|| PM2 ecosystem config | ✅ PASS | hermes-backend + hermes-worker |
    84|| Single backend enforcement | ✅ PASS | Process lock + PM2 singleton |
    85|| Zalo session persistence | ✅ PASS | Auto-restore on restart |
    86|| dryRun safe default | ✅ PASS | ZALO_AUTO_REPLY_DRY_RUN=true |
    87|| Controlled live test | ✅ PASS | API-based, quota + TTL, auto-rollback |
    88|| Graceful degradation | ✅ PASS | Listener down → backend still serves API |
    89|
    90|---
    91|
    92|## Risk Assessment
    93|
    94|| Risk | Level | Mitigation |
    95||------|-------|------------|
    96|| Docling crash | 🟡 LOW | Process isolation, backend survives |
    97|| Docling OOM | 🟡 LOW | 2GB worker limit, 60s timeout |
    98|| Scanned PDF fail | 🟢 EXPECTED | Clear DOCLING_FAILED error, not crash |
    99|| Large PDF timeout | 🟡 LOW | 60s limit, killed gracefully |
   100|| Worker restart needed | 🟢 MINIMAL | PM2 auto-restart configured |
   101|| Zalo duplicate connection | 🟡 LOW | Process lock + PM2 singleton enforced |
   102|| Live test over-send | 🟢 SAFE | Quota tracked per session, auto-completes |
   103|| messagePipeline stale | 🟢 COSMETIC | Heartbeat refresh on next dispatch |
   104|
   105|---
   106|
   107|## Verdict
   108|
   109|### ✅ PRODUCTION READY
   110|
   111|All critical checks pass. Batch 12 + 12.1 + Batch 18 are stable, tested end-to-end, and safe to deploy.
   112|
   113|**Controlled live test mode** enables safe production verification without risking duplicate/unexpected sends.
   114|