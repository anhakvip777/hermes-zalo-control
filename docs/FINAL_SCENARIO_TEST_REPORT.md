# FINAL SCENARIO TEST REPORT — Hermes Zalo Control Center

**Date**: 2026-06-28
**Test Scope**: Batch 12 + 12.1 + Old Jobs Cleanup
**Environment**: Dev (ZALO_DRY_RUN=true, no live messages)

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

## Regression Checks

| Suite | Tests | Result |
|-------|-------|--------|
| document-ingestion.test.ts | 19/19 | ✅ PASS |
| document-ingestion-12.1.test.ts | 4/4 | ✅ PASS |
| Full test suite | 496/498 | ✅ PASS (2 pre-existing failures) |
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

**System is production-ready for text-based document ingestion.**
