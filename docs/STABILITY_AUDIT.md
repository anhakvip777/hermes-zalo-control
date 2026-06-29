     1|# STABILITY AUDIT — Hermes Zalo Control Center
     2|
     3|**Date**: 2026-06-29
     4|**Scope**: Batch 12 + 12.1 + Old Jobs Cleanup + Batch 18 Live Test
     5|
     6|---
     7|
     8|## Stability History
     9|
    10|| Date | Event | Resolution |
    11||------|-------|------------|
    12|| 2026-06-29 | Batch 19: Production Pilot Runbook | READY |
| 2026-06-29 | Batch 18: Controlled live test mode | PASS |
    13|| 2026-06-29 | Zalo process conflict (3 backends) | Cleaned → 1 PM2 instance |
    14|| 2026-06-28 | PDF live test: Docling process isolation | PASS |
    15|| 2026-06-28 | Worker OOM simulation | Backend survived ✅ |
    16|| 2026-06-28 | Docling timeout test | Kill + cleanup works ✅ |
    17|| 2026-06-28 | Old failed jobs cleanup | Classified, no retry ✅ |
    18|
    19|---
    20|
    21|## Current System State
    22|
    23|### Backend
    24|- **Status**: ✅ Healthy (PM2 managed, PID 2928242)
    25|- **Memory**: Stable (~92MB)
    26|- **API**: All endpoints responding
    27|- **Zalo**: Connected, listener active
    28|
    29|### PM2 Worker
    30|- **Status**: ✅ Running (PID 2928373)
    31|- **Poll interval**: 10 seconds
    32|- **Dry-run**: true (safe default)
    33|
    34|### Database
    35|- **Size**: Normal
    36|- **Migration**: Clean
    37|- **LiveTestSessions**: 1 completed (Batch 18)
    38|- **Total real sends**: 138 (1 from live test)
    39|
    40|### Frontend
    41|- **Status**: ✅ Building and serving (Next.js, port 3001)
    42|- **All pages**: Functional
    43|- **Production readiness page**: Active
    44|- **Zalo ops page**: Active
    45|
    46|---
    47|
    48|## Failure Modes & Recovery
    49|
    50|### 1. Docling Crash (exit code != 0)
    51|- **Detection**: Worker catches spawn error
    52|- **DB update**: Document + Job marked `failed` with `DOCLING_FAILED`
    53|- **Dashboard**: Orange "📄 Conversion failed" badge
    54|- **Backend**: Unaffected ✅
    55|- **Recovery**: No auto-retry. Manual re-ingest with fixed file.
    56|
    57|### 2. Docling No Output (exit 0, no markdown)
    58|- **Detection**: Post-processing checks for readable markdown
    59|- **DB update**: `DOCLING_NO_OUTPUT`
    60|- **Dashboard**: Orange "📄 No extractable text"
    61|- **Recovery**: PDF may be image-only. Install RapidOCR for scan support.
    62|
    63|### 3. Docling Timeout (hung process)
    64|- **Detection**: 60s hard timeout
    65|- **Action**: SIGTERM → 5s grace → SIGKILL
    66|- **DB update**: `DOCLING_TIMEOUT`
    67|- **Dashboard**: Red "⚡ System error"
    68|- **Backend**: Unaffected ✅
    69|- **Recovery**: Auto-killed. Worker continues polling.
    70|
    71|### 4. Worker Process Crash
    72|- **Detection**: PM2 auto-restart
    73|- **DB state**: Any in-progress job marked failed
    74|- **Backend**: Unaffected ✅ (separate process)
    75|- **Recovery**: PM2 restarts worker automatically
    76|
    77|### 5. Backend Crash
    78|- **Detection**: Health check
    79|- **Worker**: Unaffected (separate process, keeps polling)
    80|- **DB state**: Intact
    81|- **Recovery**: PM2 restarts backend automatically
    82|
    83|### 6. Zalo Process Conflict (Multiple Backends)
    84|- **Detection**: Zalo "Another connection is opened" error in logs
    85|- **Cause**: Multiple backend processes (PM2 + manual) all login to same Zalo account
    86|- **Impact**: Listener dropped, incoming messages missed
    87|- **Fix**: Single PM2 `hermes-backend` via `ecosystem.config.cjs`; symlink `prisma → packages/backend/prisma`; code gate on `config.autoReply.enabled`
    88|- **Recovery**: Kill old processes, restart single backend via PM2
    89|
    90|---
    91|
    92|## Resource Limits
    93|
    94|| Resource | Limit | Enforced By |
    95||----------|-------|-------------|
    96|| Worker heap | 2048 MB | NODE_OPTIONS |
    97|| Docling runtime | 60 seconds | setTimeout + process.kill |
    98|| Docling kill grace | 5 seconds | setTimeout after SIGTERM |
    99|| Docling output | 1 MB | Buffer cap |
   100|| File size | 50 MB | Config validation |
   101|| Jobs per poll | 5 | Worker query limit |
   102|| DB connections | Prisma default | Connection pool |
   103|| PM2 max restarts | 5 | ecosystem.config.cjs |
   104|| Live test quota | 1 message | LiveTestSession.maxMessages |
   105|
   106|---
   107|
   108|## Known Stability Issues
   109|
   110|1. **RapidOCR model missing**: Scanned PDFs fail with DOCLING_FAILED (not a crash)
   111|2. **system-health.test.ts**: 2 pre-existing test failures (backup check, DB snapshot) — unrelated to documents
   112|3. **messagePipeline heartbeat stale**: After message received, heartbeat may not refresh until next dispatch (cosmetic)
   113|
   114|---
   115|
   116|## Verdict
   117|
   118|### ✅ STABLE — Batch 18 Live Test PASS, Zalo conflict cleaned, no regressions
   119|
   120|Batch 12 + 12.1 + Batch 18 have been live-tested and verified. The system handles failures gracefully:
   121|- Document conversion failures → MEDIUM errors, not crashes
   122|- Process crashes → Backend survives
   123|- Timeouts → Auto-kill + cleanup
   124|- Old failed jobs → Properly classified, no retry loops
   125|- **Controlled live test (Batch 18)**: One real DM send with quota + TTL verified; post-quota dry-run fallback confirmed
   126|- **Zalo process conflict**: Root cause (3 backends) found and fixed; single PM2 backend enforced
   127|