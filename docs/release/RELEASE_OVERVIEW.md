# Hermes Zalo Admin Center — MVP Release Overview

**Version:** 0.1.0  
**Date:** 2026-06-29  
**Status:** ✅ Production-safe (dryRun mode)

## System Summary

Hermes Zalo Admin Center is a web dashboard for monitoring and controlling AI agents that operate through Zalo. The system lets an AI agent (Hermes) receive messages, generate replies, create schedules, and interact with Zalo users — but every action is transparent, auditable, and user-controllable via the web UI.

## Core Features

| Feature | Batch | Status |
|---------|-------|--------|
| Zalo message receive/send | Batch 1-3 | ✅ Stable |
| dryRun/live safety toggle | Batch 1 | ✅ Stable |
| Reminder/schedule system | Batch 2-3 | ✅ Stable |
| Rule engine with UI | Batch 4-6 | ✅ Stable |
| Outbound guardrails (dedup, rate-limit) | Batch 4 | ✅ Stable |
| Image/OCR understanding | Batch 7 | ✅ Stable |
| Document/PDF ingestion (Docling) | Batch 12-13 | ✅ Stable |
| Message batching/debounce | Batch 14-14.1 | ✅ Stable |
| Runtime settings (hot reload) | Batch 15 | ✅ Stable |
| Zalo Ops dashboard | Batch 16 | ✅ Stable |
| Production readiness gate | Batch 17 | ✅ Stable |
| Controlled live test (quota + TTL) | Batch 18 | ✅ Stable |
| Production pilot runbook | Batch 19 | ✅ Stable |
| Live quota completion + post-quota dryRun | Batch 20 | ✅ PASS |
| **Release package / Customer demo** | **Batch 21** | ✅ PASS |

## Safety Architecture

```
User message → Zalo listener → safety gates:
  1. allowlist check
  2. self-message guard
  3. group gate (mention check)
  4. cooldown enforcement
  5. unsupported system claim guard
  6. rule engine match
  7. live-test session detection
  8. dryRun/dedup/rate-limit

AI response ← Hermes/CLI ← dispatch ← safety gates
```

### Key safety invariants:
- **dryRun=true** is the default — no real sends unless explicitly enabled
- **Controlled live test**: one-shot real send with automatic quota (maxMessages) + TTL
- **Post-quota fallback**: subsequent messages auto-revert to dryRun
- **Unsupported system claim guard**: blocks AI from fabricating schedule/reminder claims
- **Dedup**: identical outbound within 60s is blocked
- **Rate limiting**: configurable per-thread and global limits

## Deployment

- **Backend:** Fastify on port 3002 (PM2)
- **Frontend:** Next.js 15 on port 3001
- **Worker:** Schedule executor (PM2)
- **Document Worker:** PDF/text ingestion (PM2)
- **Database:** SQLite (Prisma ORM)
- **Zalo:** zca-js WebSocket connection

## Live Test Results (Batch 20)

| Scenario | Result | Real Sends |
|----------|--------|------------|
| Cooldown enforcement | ✅ | 1 |
| Reminder confirmation live bypass | ✅ | 1 |
| Batching (2 msgs → 1 reply) | ✅ | 1 |
| Quota consumption (1/1) | ✅ | 1 |
| Post-quota dryRun fallback | ✅ | 0 |
| **Total** | **PASS** | **5 safe sends** |

## Next Steps
- Enable production live for specific trusted threads
- Add OCR model for scanned PDFs
- Group live test
- Voice integration (when Zalo supports)
