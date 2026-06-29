# FINAL SCENARIO TEST REPORT — Hermes Zalo Control Center

**Date**: 2026-06-29
**Test Scope**: Batch 12 + 12.1 + Old Jobs Cleanup + Batch 18 Live Test
**Environment**: Dev (ZALO_AUTO_REPLY_DRY_RUN=true, live test bypass used for 1 real DM)

---

## Scenario 1: TXT Direct Ingestion

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| Pre-check | Backend health, worker alive | OK | ✅ PASS |
| Create file | Write test.txt to safe dir | File created | ✅ PASS |
| POST ingest | curl /api/documents/ingest | 202, documentId + jobId | ✅ PASS |
| Worker picks up | Poll interval 5s | Job claimed, processed | ✅ PASS |
| Document completed | GET /api/documents/:id | status=completed, chunks > 0 | ✅ PASS |
| Ask document | POST /api/documents/:id/ask | Relevant answer in Vietnamese | ✅ PASS |
| Hallucination guard | Ask about missing info | "Tài liệu không đề cập" | ✅ PASS |

---

## Scenario 2: PDF Via Docling

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| Create PDF | Python fpdf2, 1 page with Vietnamese text | PDF created | ✅ PASS |
| Ingest | POST /api/documents/ingest | 202, method=docling | ✅ PASS |
| Docling spawn | Worker spawns `docling --no-ocr` | Child process runs | ✅ PASS |
| Markdown output | Docling completes | markdownPath populated | ✅ PASS |
| Chunks created | Document split into chunks | 2 chunks | ✅ PASS |
| Text preview | GET document | "Lịch Lễ Phật..." | ✅ PASS |
| Processing time | Total from ingest to completed | < 10 seconds | ✅ PASS |
| Ask document Q1 | "Lễ Phật diễn ra lúc mấy giờ?" | Answer: 19h | ✅ PASS |
| Ask document Q2 | "Ai là người phụ trách?" | "Tài liệu không đề cập" | ✅ PASS |

---

## Scenario 3: Docling Process Isolation

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| Worker separate | ps aux | Separate process from backend | ✅ PASS |
| Memory limit | NODE_OPTIONS | 2048MB max | ✅ PASS |
| Timeout config | DOCUMENT_DOCLING_TIMEOUT_MS | 60000ms | ✅ PASS |
| Kill grace | DOCUMENT_DOCLING_KILL_GRACE_MS | 5000ms | ✅ PASS |
| Backend survives | Simulate worker kill | Backend health OK after | ✅ PASS |

---

## Scenario 4: Failed PDF — RapidOCR Missing

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| Upload scanned PDF | test-docling-small.pdf | Ingest queued | ✅ PASS |
| Docling fails | Exit code 1, RapidOCR missing | Job failed | ✅ PASS |
| Error code | DB check | DOCLING_FAILED (not PROCESSING_FAILED) | ✅ PASS |
| Error message | DB check | RapidOCR_MODEL_MISSING noted | ✅ PASS |
| Backend health | /api/health | OK | ✅ PASS |
| Worker alive | ps aux | Still running | ✅ PASS |
| Dashboard label | /documents page | "📄 Conversion failed" (orange) | ✅ PASS |

---

## Scenario 5: Failed PDF — No Markdown Output

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| Upload problematic PDF | test-docling-real.pdf | Ingest queued | ✅ PASS |
| Docling completes | Exit code 0 but no markdown | Job failed | ✅ PASS |
| Error code | DB check | DOCLING_NO_OUTPUT | ✅ PASS |
| Dashboard label | /documents page | "📄 No extractable text" (orange) | ✅ PASS |
| Backend health | /api/health | OK | ✅ PASS |

---

## Scenario 6: Old Failed Jobs Cleanup

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| Identify old failed | DB query | 2 jobs with PROCESSING_FAILED | ✅ PASS |
| Reclassify | Update error codes | DOCLING_FAILED + DOCLING_NO_OUTPUT | ✅ PASS |
| No auto-retry | Worker poll check | Only polls queued, not failed | ✅ PASS |
| Dashboard updated | /documents page | Error classification visible | ✅ PASS |
| Docs updated | CLAUDE.md | Error codes documented | ✅ PASS |

---

## Scenario 7: Ask Document Accuracy

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| Question in doc | "Lễ Phật diễn ra lúc mấy giờ?" | Answer: 19h, 2 chunks used | ✅ PASS |
| Question NOT in doc | "Ai là người phụ trách?" | "Tài liệu không đề cập" | ✅ PASS |
| Completely unrelated | "Ai là tổng thống Mỹ?" | "Không tìm thấy thông tin" | ✅ PASS |
| Vietnamese output | All answers | Tiếng Việt | ✅ PASS |
| Chunk count accurate | Response includes chunksUsed | Matches actual chunks | ✅ PASS |

---

## Scenario 8: Batch 18 — Controlled Live Test (Real DM Send)

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| Create live session | POST /api/system/live-test/start | LiveTestSession active, maxMessages=1, TTL=300s | ✅ PASS |
| Send first DM | User sends "live test hello" to allowed thread | inbound saved, dispatcher detects live session | ✅ PASS |
| Real Zalo send | Dispatcher bypasses dryRun for live session | dryRun=0 outbound, actual Zalo DM sent | ✅ PASS |
| Quota reached | sentCount=1 → maxMessages=1 | Session auto-completed | ✅ PASS |
| Post-quota DM | User sends "live test second" | No active session → falls back to dryRun=true | ✅ PASS |
| No real send | Post-quota message processed | dryRun=true, AgentTask with dryRun:true, no dryRun=0 outbound | ✅ PASS |
| Assistant saved | Hermes generates reply | Reply saved to DB with dryRun tag, not sent to Zalo | ✅ PASS |
| No duplicate | Check DB | Only 1 "live test second" message, 1 reply | ✅ PASS |
| Total real sends | Check OutboundRecord | Exactly 1 real send from entire Batch 18 | ✅ PASS |

---

## Scenario 9: Zalo Process Conflict Cleanup

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| Detect conflict | Check backend processes | 3 concurrent backends found (PM2 hermes-api + old tsx watch + new npx tsx) | ✅ Found |
| Zalo error | Check logs | "Another connection is opened, closing this one" | ✅ Confirmed |
| Message missed | User sends DM during conflict | Message NOT received (listener dropped) | ✅ Confirmed |
| Kill old processes | kill -9 old PIDs + pm2 stop | Old processes terminated | ✅ PASS |
| Fix code | Change index.ts gate from config.zalo.dryRun to config.autoReply.enabled | Listener starts regardless of dryRun | ✅ PASS |
| Symlink DB | ln -s packages/backend/prisma prisma | Production build finds DB | ✅ PASS |
| Restart single | pm2 start ecosystem.config.cjs --only hermes-backend | 1 backend instance, Zalo reconnects, listener active | ✅ PASS |
| Verify | API heartbeats, listener status, port check | 1 instance on port 3002, Zalo connected, PM2 managed | ✅ PASS |

---

## Regression Checks

| Suite | Tests | Result |
|-------|-------|--------|
| document-ingestion.test.ts | 19/19 | ✅ PASS |
| document-ingestion-12.1.test.ts | 4/4 | ✅ PASS |
| batch18-live-test.test.ts | 18/18 | ✅ PASS |
| batch16-zalo-ops.test.ts | included | ✅ PASS |
| batch17-production-readiness.test.ts | included | ✅ PASS |
| Full test suite | 586/586 | ✅ PASS |
| TypeScript | shared + backend + frontend | ✅ PASS |
| Backend build | tsc | ✅ PASS |
| Frontend build | next build | ✅ PASS |
| Secret audit | .env, git, tokens | ✅ PASS |

---

## Final Verdict

### ✅ ALL SCENARIOS PASS

| Batch | Status | Notes |
|-------|--------|-------|
| **Batch 12** — Docling Document Understanding | ✅ PASS | Full e2e: ingest → docling → chunks → ask |
| **Batch 12.1** — Docling Process Isolation | ✅ PASS | Worker separate, timeout, kill grace |
| **Old Jobs Cleanup** — Error Classification | ✅ PASS | Specific codes, dashboard labels |
| **Batch 18** — Controlled Live Test | ✅ PASS | 1 real DM, post-quota dryRun, Zalo conflict fixed |

**System is production-ready for controlled live deployment.**
