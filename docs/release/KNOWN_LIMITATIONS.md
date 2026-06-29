# Known Limitations

## Production Scope

| Limitation | Impact | Workaround |
|------------|--------|------------|
| **Voice disabled** | No voice message reply | Zalo voice support unstable; use text only |
| **Scanned PDFs need OCR model** | Image-only PDFs fail ingestion | Use text-based PDFs, or install RapidOCR torch model |
| **Group live not default** | Groups use dryRun by default | Manually add group to allowedThreads + enable group reply |
| **Live toàn hệ thống chưa bật** | Global dryRun=true always | Use controlled live test per-thread |
| **Single backend process** | No horizontal scaling | Process lock enforced; use PM2 for reliability |
| **SQLite database** | Not suitable for high concurrency | Fine for single-instance deployment; migrate to PostgreSQL for scale |

## Known Bugs / Cosmetic

| Issue | Severity | Status |
|-------|----------|--------|
| `messagePipeline` heartbeat stale | Cosmetic | Backlog — no functional impact |
| `[heartbeat] Failed to record` in tests | Cosmetic | Test-only; prisma mock not available in unit tests |
| `[dispatcher] rule engine error` in tests | Cosmetic | Test-only; DB not available in unit tests |

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| AI never touches zca-js directly | Safety: all Zalo actions go through backend services |
| dryRun=true by default | Safety: no accidental real sends |
| Worker polls DB every 10s | Simplicity: no Redis dependency |
| Batch worker runs in scheduler process | Simplicity: single process for both schedule + batch |
| No auto-retry on failed sends | Safety: prevents spam loops |
| Cooldown applied per-thread (in-memory) | Resets on restart — acceptable gap for MVP |

## Feature Requests (Backlog)

- [ ] OCR model for scanned PDFs
- [ ] PostgreSQL support for production scale
- [ ] Webhook notifications for errors
- [ ] Multi-language UI (currently Vietnamese)
- [ ] Group live test
- [ ] Voice reply integration
- [ ] Analytics dashboard
