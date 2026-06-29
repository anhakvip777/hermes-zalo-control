# Changelog — MVP (v0.1.0)

## Batch 21 — Release Package / Customer Demo
**Date:** 2026-06-29  
**Status:** ✅ PASS

- Created `docs/release/` with 10 release docs:
  - RELEASE_OVERVIEW.md, QUICK_START.md, ADMIN_USER_GUIDE.md
  - OPERATIONS_RUNBOOK.md, DEMO_SCRIPT.md, SAFETY_CHECKLIST.md
  - ROLLBACK_GUIDE.md, FEATURE_MATRIX.md, KNOWN_LIMITATIONS.md
  - CHANGELOG_MVP.md
- Restored `secret:audit` script to root package.json
- Verification: typecheck PASS, 586/586 tests PASS, builds PASS, secret audit clean

## Batch 20 — Quota Completion + Post-Quota Fallback
**Date:** 2026-06-29  
**Status:** ✅ PASS

- Live quota consumption: sentCount capped at maxMessages (1/1)
- Session auto-completed after quota reached
- Post-quota messages fall back to dryRun (effective dryRun=true)
- Unified live-test bypass across 6 outbound paths (reminder, context, file confirmations)
- Worker ZALO_SESSION_DIR fix for batch sends
- ecosystem.config.cjs: added MESSAGE_BATCHING_* env vars

## Batch 19 — Production Pilot Runbook
**Date:** 2026-06-28  
**Status:** ✅ PASS

- Created PRODUCTION_PILOT_RUNBOOK.md
- Defined pilot phases: dryRun verification → controlled live → quota completion → post-quota

## Batch 18 — Controlled Live Test
**Date:** 2026-06-28  
**Status:** ✅ PASS

- LiveTestSession model: maxMessages quota + TTL
- Start/stop/status API
- Dispatcher detects active session → bypasses dryRun for allowed thread
- Auto-completion when quota exhausted
- Post-quota auto-revert to dryRun

## Batch 17 — Production Readiness Gate
**Date:** 2026-06-27  
**Status:** ✅ Stable

- 12-point production readiness check
- Process lock (single backend instance)
- Config consistency validation
- READY_FOR_LIVE verdict with score

## Batch 16 — Zalo Ops Dashboard
**Date:** 2026-06-27  
**Status:** ✅ Stable

- Zalo connection status page (`/zalo-ops`)
- Session restore, QR login
- Self user info, connection health

## Batch 15 — Runtime Settings
**Date:** 2026-06-26  
**Status:** ✅ Stable

- Hot-reloadable config via UI (`/runtime-settings`)
- Audit trail for all config changes
- Secret audit scanner (`npm run secret:audit`)
- Backup/restore scripts

## Batch 14 — Message Batching
**Date:** 2026-06-26  
**Status:** ✅ Stable

- MessageBatch model: collecting → ready → processing → completed
- Debounce window (configurable, default 4s)
- Batch worker polls every 5s for overdue batches
- Unsupported system claim guard
- Reminder parser: `nhắc [target] <content> lúc <time>`

## Batch 13 — Document UI
**Date:** 2026-06-25  
**Status:** ✅ Stable

- Document upload + list page (`/documents`)
- Status tracking: pending → processing → completed → failed
- Chunk preview

## Batch 12 — Document Ingestion
**Date:** 2026-06-25  
**Status:** ✅ Stable

- Docling-powered PDF to markdown conversion
- Direct text ingestion (TXT, MD, CSV)
- Document worker (separate PM2 process)
- Error codes: DOCLING_TIMEOUT, DOCLING_FAILED, etc.

## Batch 7 — Image/OCR Understanding
**Date:** 2026-06-24  
**Status:** ✅ Stable

- Vision API integration (ChiaseGPU)
- Image → text extraction + description
- Multi-turn image context

## Batch 4-6 — Rule Engine + Outbound Guardrails
**Date:** 2026-06-23  
**Status:** ✅ Stable

- Rule CRUD with UI (`/rules`)
- Keyword/regex triggers → fixed_reply / route_to_hermes / ignore
- Outbound dedup (60s window)
- Rate limiting
- Content sanitization

## Batch 1-3 — Core Zalo Integration
**Date:** 2026-06-22  
**Status:** ✅ Stable

- Zalo WebSocket listener (zca-js)
- Message receive/send with dryRun toggle
- Auto-reply via Hermes CLI adapter
- Safety gates: allowlist, self-guard, cooldown
- Schedule CRUD with worker
- Thread settings per-thread
