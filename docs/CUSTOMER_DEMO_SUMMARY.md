     1|# CUSTOMER DEMO SUMMARY — Hermes Zalo Control Center
     2|
     3|**Date**: 2026-06-29
     4|**Version**: Batch 12 + 12.1 + Batch 18 + Batch 19 Complete
     5|
     6|---
     7|
     8|## What We Built
     9|
    10|A production-ready **Document Understanding** system integrated into the Admin Center. Users can upload PDFs, Word docs, and text files — the system automatically converts them, chunks them, and lets you ask questions in Vietnamese about the content.
    11|
    12|---
    13|
    14|## Key Features (Working End-to-End)
    15|
    16|### 1. Document Ingestion
    17|- **Drag-and-drop via API**: POST any supported file path → 202 Accepted immediately
    18|- **Async processing**: Document worker picks up jobs in background
    19|- **Format support**: TXT, MD, CSV, PDF (text-based), DOCX, PPTX, XLSX, HTML
    20|
    21|### 2. Docling AI Engine
    22|- **Spawn-based isolation**: Docling runs as a separate child process with hard timeout
    23|- **Backend survives crashes**: If Docling hangs or OOMs, the backend stays alive
    24|- **Timeout protection**: 60s hard timeout + 5s SIGKILL grace period
    25|- **Memory limits**: Worker limited to 2GB, Docling killed if exceeds
    26|
    27|### 3. Smart Chunking
    28|- Text split into semantic chunks with heading detection
    29|- Paragraph/sentence boundary-aware splitting
    30|- Chunk overlap for context continuity
    31|
    32|### 4. Ask Document (Vietnamese)
    33|- Natural language questions about document content
    34|- Keyword scoring to find most relevant chunks
    35|- Hallucination guard: "Tài liệu không đề cập" when answer not in document
    36|- Hermes CLI integration for intelligent answers
    37|
    38|### 5. Error Classification Dashboard
    39|- Failed documents labeled: System error vs Document limitation
    40|- Clear error codes shown: DOCLING_FAILED, DOCLING_NO_OUTPUT, etc.
    41|- Orange warning for document issues, red only for system crashes
    42|
    43|---
    44|
    45|## Architecture
    46|
    47|```
    48|User → Dashboard → POST /api/documents/ingest → 202 (queued)
    49|                              ↓
    50|                   Document Worker (separate process)
    51|                     ├── TXT/MD/CSV: direct read
    52|                     └── PDF/DOCX: spawn docling --no-ocr
    53|                              ↓
    54|                   Markdown → Chunks → Completed
    55|                              ↓
    56|                   GET /api/documents/:id/ask → Hermes CLI
    57|```
    58|
    59|---
    60|
    61|## Safety
    62|
    63|| Feature | Status |
    64||---------|--------|
    65|| Safe directory only | ✅ Files must be under /tmp/hermes-media/documents |
    66|| Path traversal blocked | ✅ `../` filtered, must be inside base dir |
    67|| File type whitelist | ✅ Only allowed extensions |
    68|| File size limit | ✅ Max 50MB |
    69|| Sensitive file blocking | ✅ .env, session, key files rejected |
    70|| Process isolation | ✅ Docling spawned, not loaded |
    71|| Backend survives OOM | ✅ Worker separate, 2GB limit |
    72|| Dry-run mode | ✅ No real Zalo messages |
    73|
    74|---
    75|
    76|## Known Limitations
    77|
    78|1. **Scanned/OCR PDFs**: Require RapidOCR torch model (not installed) — failing with clear MEDIUM error
    79|2. **Image-only PDFs**: Docling may produce no text — failing with DOCLING_NO_OUTPUT
    80|3. **No parallel large PDFs**: Worker processes max 5 jobs per poll cycle
    81|4. **Single worker**: One document worker process currently
    82|
    83|---
    84|
    85|## Batch 18: Controlled Live Test Mode
    86|
    87|### What We Built
    88|
    89|A **safe production verification system** that allows exactly ONE real Zalo DM send per test session, with automatic quota tracking and TTL-based expiry. After the live test completes, the system automatically returns to dry-run mode.
    90|
    91|### Key Features
    92|
    93|1. **One-shot live test**: Start session via API → 1 real DM send ONLY
    94|2. **Quota + TTL**: maxMessages=1, TTL=300s — auto-completes when reached
    95|3. **Post-quota safety**: After session completes, all DMs fall back to dryRun=true
    96|4. **No duplicate sends**: sentCount tracked per session, enforced at dispatch level
    97|5. **Zalo process conflict fixed**: Single PM2 backend instance, listener always starts
    98|6. **Production readiness UI**: /production-readiness page with live audit checks
    99|7. **Zalo ops dashboard**: /zalo-ops page with connection status, heartbeats, live test controls
   100|
   101|### Test Results
   102|
   103|| Test | Result |
   104||------|--------|
   105|| Live test first DM | ✅ Real Zalo send, session auto-completed |
   106|| Post-quota second DM | ✅ Fallback to dryRun, no real send |
   107|| Zalo conflict cleanup | ✅ 3→1 backends, listener stable |
   108|| Full regression (586 tests) | ✅ PASS |
| Production Pilot Runbook | ✅ READY |
   109|
   110|---
   111|
   112|## Test Results
   113|
   114|| Suite | Tests | Result |
   115||-------|-------|--------|
   116|| Document Ingestion | 19/19 | ✅ PASS |
   117|| Batch 12.1 Process Isolation | 4/4 | ✅ PASS |
   118|| Batch 18 Live Test | 18/18 | ✅ PASS |
   119|| TypeScript | All packages | ✅ PASS |
   120|| Backend Build | tsc | ✅ PASS |
   121|| Frontend Build | Next.js | ✅ PASS |
   122|| Secret Audit | .env, git, tokens | ✅ PASS |
   123|
   124|---
   125|
   126|## Next Steps
   127|
   128|- Batch 19: Production Pilot Runbook
   129|- Install RapidOCR for scanned PDF support
   130|- Bulk document ingestion
   131|- Zalo integration (send PDF → auto-ingest + answer)
   132|