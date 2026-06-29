# CUSTOMER DEMO SUMMARY — Hermes Zalo Control Center

**Date**: 2026-06-29
**Version**: Batch 12 + 12.1 + Batch 18 Complete

---

## What We Built

A production-ready **Document Understanding** system integrated into the Admin Center. Users can upload PDFs, Word docs, and text files — the system automatically converts them, chunks them, and lets you ask questions in Vietnamese about the content.

---

## Key Features (Working End-to-End)

### 1. Document Ingestion
- **Drag-and-drop via API**: POST any supported file path → 202 Accepted immediately
- **Async processing**: Document worker picks up jobs in background
- **Format support**: TXT, MD, CSV, PDF (text-based), DOCX, PPTX, XLSX, HTML

### 2. Docling AI Engine
- **Spawn-based isolation**: Docling runs as a separate child process with hard timeout
- **Backend survives crashes**: If Docling hangs or OOMs, the backend stays alive
- **Timeout protection**: 60s hard timeout + 5s SIGKILL grace period
- **Memory limits**: Worker limited to 2GB, Docling killed if exceeds

### 3. Smart Chunking
- Text split into semantic chunks with heading detection
- Paragraph/sentence boundary-aware splitting
- Chunk overlap for context continuity

### 4. Ask Document (Vietnamese)
- Natural language questions about document content
- Keyword scoring to find most relevant chunks
- Hallucination guard: "Tài liệu không đề cập" when answer not in document
- Hermes CLI integration for intelligent answers

### 5. Error Classification Dashboard
- Failed documents labeled: System error vs Document limitation
- Clear error codes shown: DOCLING_FAILED, DOCLING_NO_OUTPUT, etc.
- Orange warning for document issues, red only for system crashes

---

## Architecture

```
User → Dashboard → POST /api/documents/ingest → 202 (queued)
                              ↓
                   Document Worker (separate process)
                     ├── TXT/MD/CSV: direct read
                     └── PDF/DOCX: spawn docling --no-ocr
                              ↓
                   Markdown → Chunks → Completed
                              ↓
                   GET /api/documents/:id/ask → Hermes CLI
```

---

## Safety

| Feature | Status |
|---------|--------|
| Safe directory only | ✅ Files must be under /tmp/hermes-media/documents |
| Path traversal blocked | ✅ `../` filtered, must be inside base dir |
| File type whitelist | ✅ Only allowed extensions |
| File size limit | ✅ Max 50MB |
| Sensitive file blocking | ✅ .env, session, key files rejected |
| Process isolation | ✅ Docling spawned, not loaded |
| Backend survives OOM | ✅ Worker separate, 2GB limit |
| Dry-run mode | ✅ No real Zalo messages |

---

## Known Limitations

1. **Scanned/OCR PDFs**: Require RapidOCR torch model (not installed) — failing with clear MEDIUM error
2. **Image-only PDFs**: Docling may produce no text — failing with DOCLING_NO_OUTPUT
3. **No parallel large PDFs**: Worker processes max 5 jobs per poll cycle
4. **Single worker**: One document worker process currently

---

## Batch 18: Controlled Live Test Mode

### What We Built

A **safe production verification system** that allows exactly ONE real Zalo DM send per test session, with automatic quota tracking and TTL-based expiry. After the live test completes, the system automatically returns to dry-run mode.

### Key Features

1. **One-shot live test**: Start session via API → 1 real DM send ONLY
2. **Quota + TTL**: maxMessages=1, TTL=300s — auto-completes when reached
3. **Post-quota safety**: After session completes, all DMs fall back to dryRun=true
4. **No duplicate sends**: sentCount tracked per session, enforced at dispatch level
5. **Zalo process conflict fixed**: Single PM2 backend instance, listener always starts
6. **Production readiness UI**: /production-readiness page with live audit checks
7. **Zalo ops dashboard**: /zalo-ops page with connection status, heartbeats, live test controls

### Test Results

| Test | Result |
|------|--------|
| Live test first DM | ✅ Real Zalo send, session auto-completed |
| Post-quota second DM | ✅ Fallback to dryRun, no real send |
| Zalo conflict cleanup | ✅ 3→1 backends, listener stable |
| Full regression (586 tests) | ✅ PASS |

---

## Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| Document Ingestion | 19/19 | ✅ PASS |
| Batch 12.1 Process Isolation | 4/4 | ✅ PASS |
| Batch 18 Live Test | 18/18 | ✅ PASS |
| TypeScript | All packages | ✅ PASS |
| Backend Build | tsc | ✅ PASS |
| Frontend Build | Next.js | ✅ PASS |
| Secret Audit | .env, git, tokens | ✅ PASS |

---

## Next Steps

- Batch 19: Production Pilot Runbook
- Install RapidOCR for scanned PDF support
- Bulk document ingestion
- Zalo integration (send PDF → auto-ingest + answer)
