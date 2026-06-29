     1|# FINAL SCENARIO TEST REPORT — Hermes Zalo Control Center
     2|
     3|**Date**: 2026-06-29
     4|**Test Scope**: Batch 12 + 12.1 + Old Jobs Cleanup + Batch 18 Live Test + Batch 19 Runbook
     5|**Environment**: Dev (ZALO_AUTO_REPLY_DRY_RUN=true, live test bypass used for 1 real DM)
     6|
     7|---
     8|
     9|## Scenario 1: TXT Direct Ingestion
    10|
    11|| Step | Action | Expected | Result |
    12||------|--------|----------|--------|
    13|| Pre-check | Backend health, worker alive | OK | ✅ PASS |
    14|| Create file | Write test.txt to safe dir | File created | ✅ PASS |
    15|| POST ingest | curl /api/documents/ingest | 202, documentId + jobId | ✅ PASS |
    16|| Worker picks up | Poll interval 5s | Job claimed, processed | ✅ PASS |
    17|| Document completed | GET /api/documents/:id | status=completed, chunks > 0 | ✅ PASS |
    18|| Ask document | POST /api/documents/:id/ask | Relevant answer in Vietnamese | ✅ PASS |
    19|| Hallucination guard | Ask about missing info | "Tài liệu không đề cập" | ✅ PASS |
    20|
    21|---
    22|
    23|## Scenario 2: PDF Via Docling
    24|
    25|| Step | Action | Expected | Result |
    26||------|--------|----------|--------|
    27|| Create PDF | Python fpdf2, 1 page with Vietnamese text | PDF created | ✅ PASS |
    28|| Ingest | POST /api/documents/ingest | 202, method=docling | ✅ PASS |
    29|| Docling spawn | Worker spawns `docling --no-ocr` | Child process runs | ✅ PASS |
    30|| Markdown output | Docling completes | markdownPath populated | ✅ PASS |
    31|| Chunks created | Document split into chunks | 2 chunks | ✅ PASS |
    32|| Text preview | GET document | "Lịch Lễ Phật..." | ✅ PASS |
    33|| Processing time | Total from ingest to completed | < 10 seconds | ✅ PASS |
    34|| Ask document Q1 | "Lễ Phật diễn ra lúc mấy giờ?" | Answer: 19h | ✅ PASS |
    35|| Ask document Q2 | "Ai là người phụ trách?" | "Tài liệu không đề cập" | ✅ PASS |
    36|
    37|---
    38|
    39|## Scenario 3: Docling Process Isolation
    40|
    41|| Step | Action | Expected | Result |
    42||------|--------|----------|--------|
    43|| Worker separate | ps aux | Separate process from backend | ✅ PASS |
    44|| Memory limit | NODE_OPTIONS | 2048MB max | ✅ PASS |
    45|| Timeout config | DOCUMENT_DOCLING_TIMEOUT_MS | 60000ms | ✅ PASS |
    46|| Kill grace | DOCUMENT_DOCLING_KILL_GRACE_MS | 5000ms | ✅ PASS |
    47|| Backend survives | Simulate worker kill | Backend health OK after | ✅ PASS |
    48|
    49|---
    50|
    51|## Scenario 4: Failed PDF — RapidOCR Missing
    52|
    53|| Step | Action | Expected | Result |
    54||------|--------|----------|--------|
    55|| Upload scanned PDF | test-docling-small.pdf | Ingest queued | ✅ PASS |
    56|| Docling fails | Exit code 1, RapidOCR missing | Job failed | ✅ PASS |
    57|| Error code | DB check | DOCLING_FAILED (not PROCESSING_FAILED) | ✅ PASS |
    58|| Error message | DB check | RapidOCR_MODEL_MISSING noted | ✅ PASS |
    59|| Backend health | /api/health | OK | ✅ PASS |
    60|| Worker alive | ps aux | Still running | ✅ PASS |
    61|| Dashboard label | /documents page | "📄 Conversion failed" (orange) | ✅ PASS |
    62|
    63|---
    64|
    65|## Scenario 5: Failed PDF — No Markdown Output
    66|
    67|| Step | Action | Expected | Result |
    68||------|--------|----------|--------|
    69|| Upload problematic PDF | test-docling-real.pdf | Ingest queued | ✅ PASS |
    70|| Docling completes | Exit code 0 but no markdown | Job failed | ✅ PASS |
    71|| Error code | DB check | DOCLING_NO_OUTPUT | ✅ PASS |
    72|| Dashboard label | /documents page | "📄 No extractable text" (orange) | ✅ PASS |
    73|| Backend health | /api/health | OK | ✅ PASS |
    74|
    75|---
    76|
    77|## Scenario 6: Old Failed Jobs Cleanup
    78|
    79|| Step | Action | Expected | Result |
    80||------|--------|----------|--------|
    81|| Identify old failed | DB query | 2 jobs with PROCESSING_FAILED | ✅ PASS |
    82|| Reclassify | Update error codes | DOCLING_FAILED + DOCLING_NO_OUTPUT | ✅ PASS |
    83|| No auto-retry | Worker poll check | Only polls queued, not failed | ✅ PASS |
    84|| Dashboard updated | /documents page | Error classification visible | ✅ PASS |
    85|| Docs updated | CLAUDE.md | Error codes documented | ✅ PASS |
    86|
    87|---
    88|
    89|## Scenario 7: Ask Document Accuracy
    90|
    91|| Step | Action | Expected | Result |
    92||------|--------|----------|--------|
    93|| Question in doc | "Lễ Phật diễn ra lúc mấy giờ?" | Answer: 19h, 2 chunks used | ✅ PASS |
    94|| Question NOT in doc | "Ai là người phụ trách?" | "Tài liệu không đề cập" | ✅ PASS |
    95|| Completely unrelated | "Ai là tổng thống Mỹ?" | "Không tìm thấy thông tin" | ✅ PASS |
    96|| Vietnamese output | All answers | Tiếng Việt | ✅ PASS |
    97|| Chunk count accurate | Response includes chunksUsed | Matches actual chunks | ✅ PASS |
    98|
    99|---
   100|
   101|## Scenario 8: Batch 18 — Controlled Live Test (Real DM Send)
   102|
   103|| Step | Action | Expected | Result |
   104||------|--------|----------|--------|
   105|| Create live session | POST /api/system/live-test/start | LiveTestSession active, maxMessages=1, TTL=300s | ✅ PASS |
   106|| Send first DM | User sends "live test hello" to allowed thread | inbound saved, dispatcher detects live session | ✅ PASS |
   107|| Real Zalo send | Dispatcher bypasses dryRun for live session | dryRun=0 outbound, actual Zalo DM sent | ✅ PASS |
   108|| Quota reached | sentCount=1 → maxMessages=1 | Session auto-completed | ✅ PASS |
   109|| Post-quota DM | User sends "live test second" | No active session → falls back to dryRun=true | ✅ PASS |
   110|| No real send | Post-quota message processed | dryRun=true, AgentTask with dryRun:true, no dryRun=0 outbound | ✅ PASS |
   111|| Assistant saved | Hermes generates reply | Reply saved to DB with dryRun tag, not sent to Zalo | ✅ PASS |
   112|| No duplicate | Check DB | Only 1 "live test second" message, 1 reply | ✅ PASS |
   113|| Total real sends | Check OutboundRecord | Exactly 1 real send from entire Batch 18 | ✅ PASS |
   114|
   115|---
   116|
   117|## Scenario 9: Zalo Process Conflict Cleanup
   118|
   119|| Step | Action | Expected | Result |
   120||------|--------|----------|--------|
   121|| Detect conflict | Check backend processes | 3 concurrent backends found (PM2 hermes-api + old tsx watch + new npx tsx) | ✅ Found |
   122|| Zalo error | Check logs | "Another connection is opened, closing this one" | ✅ Confirmed |
   123|| Message missed | User sends DM during conflict | Message NOT received (listener dropped) | ✅ Confirmed |
   124|| Kill old processes | kill -9 old PIDs + pm2 stop | Old processes terminated | ✅ PASS |
   125|| Fix code | Change index.ts gate from config.zalo.dryRun to config.autoReply.enabled | Listener starts regardless of dryRun | ✅ PASS |
   126|| Symlink DB | ln -s packages/backend/prisma prisma | Production build finds DB | ✅ PASS |
   127|| Restart single | pm2 start ecosystem.config.cjs --only hermes-backend | 1 backend instance, Zalo reconnects, listener active | ✅ PASS |
   128|| Verify | API heartbeats, listener status, port check | 1 instance on port 3002, Zalo connected, PM2 managed | ✅ PASS |
   129|
   130|---
   131|
   132|## Regression Checks
   133|
   134|| Suite | Tests | Result |
   135||-------|-------|--------|
   136|| document-ingestion.test.ts | 19/19 | ✅ PASS |
   137|| document-ingestion-12.1.test.ts | 4/4 | ✅ PASS |
   138|| batch18-live-test.test.ts | 18/18 | ✅ PASS |
   139|| batch16-zalo-ops.test.ts | included | ✅ PASS |
   140|| batch17-production-readiness.test.ts | included | ✅ PASS |
   141|| Full test suite | 586/586 | ✅ PASS |
   142|| TypeScript | shared + backend + frontend | ✅ PASS |
   143|| Backend build | tsc | ✅ PASS |
   144|| Frontend build | next build | ✅ PASS |
   145|| Secret audit | .env, git, tokens | ✅ PASS |
   146|
   147|---
   148|
   149|## Final Verdict
   150|
   151|### ✅ ALL SCENARIOS PASS
   152|
   153|| Batch | Status | Notes |
   154||-------|--------|-------|
   155|| **Batch 12** — Docling Document Understanding | ✅ PASS | Full e2e: ingest → docling → chunks → ask |
   156|| **Batch 12.1** — Docling Process Isolation | ✅ PASS | Worker separate, timeout, kill grace |
   157|| **Old Jobs Cleanup** — Error Classification | ✅ PASS | Specific codes, dashboard labels |
   158|| **Batch 18** — Controlled Live Test | ✅ PASS | 1 real DM, post-quota dryRun, Zalo conflict fixed |
| **Batch 19** — Production Pilot Runbook | ✅ READY | Runbook, checklists, rollback plan, pilot phases |
   159|
   160|**System is production-ready for controlled live deployment.**
   161|