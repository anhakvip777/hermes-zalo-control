# Outbound Refactor Progress

**Last updated**: 2026-06-29  
**Status**: ✅ R1–R4C complete  
**dryRun**: true (safe)

---

## Completed

### R1 — Unified Outbound Dispatcher
- Incoming dispatcher reply paths migrated to `sendOutbound()`
- `OutboundRecord` created for all incoming outbound intents
- 3 initial paths (Hermes, rule, reminder) + 8 remaining paths
- Commit: `79c3cd0`

### R2 — Runtime dryRun per job
- Worker no longer freezes sender at startup
- Runtime dryRun evaluated per job via `getEffectiveDryRunInfo()`
- Optional `deps?.sender` injection for test compatibility
- Commit: `54cdcde`

### R3 — Backend sole Zalo owner for worker
- Worker no longer imports `ZaloMessageSender`
- Worker no longer has `ZALO_SESSION_DIR`
- Worker no longer calls `restoreSession` or uses `zalo-gateway`
- Worker sends via `POST /api/internal/outbound/send` → dispatcher
- Internal API: localhost-only, Bearer token, `crypto.timingSafeEqual`
- 13 security tests (isLocalRequest, safeTokenEquals, route auth)
- Deployment refreshed 13:15 UTC
- Commit: `a9e77c4`

### R4A — send-test route migration
- `POST /zalo/send-test` text route migrated to `sendOutbound()` with `source: "manual_test"`
- Media (`POST /zalo/send-media`) + Voice (`POST /zalo/send-voice`) documented exceptions for R4B
- `new ZaloMessageSender` remaining: `outbound-dispatcher.service.ts` (sole owner) + 2 R4B paths
- 6 route integration tests
- Commit: `8c29d59`

### R4C — ThreadId defensive normalization
- Created `thread-id.ts` with `normalizeThreadId()` + `assertValidThreadId()`
- Option A: Canonical Exact String — no DB migration, no alias, no truncation
- Applied at 5 boundaries: inbound, outbound, live-test start, live-test check, send-test route
- Long 18-digit Zalo IDs preserved exactly
- Zero `parseInt(threadId)` / `Number(threadId)` in codebase
- 17 unit + boundary tests
- Commit: `a996066`

---

## Current Safety State

| Check | Status |
|-------|--------|
| dryRun | ✅ true |
| Zalo connected | ✅ |
| Listener active | ✅ |
| Worker no Zalo session | ✅ |
| Internal API protected | ✅ 401/401/400 |
| Tests passing | ✅ 637/637 |
| Typecheck | ✅ 0 errors |
| Build | ✅ Clean |

---

## Remaining

| Item | Priority | Batch |
|------|----------|-------|
| Media/voice dispatcher support | MEDIUM | R4B |
| UI message delivery status clarity | LOW | TBD |
| Historical test data cleanup (`group-123`, `g1`) | LOW | TBD |
| Cooldown dual Map cleanup | LOW | R5 |

---

## Direct Sender Status

| Location | Type | Status |
|----------|------|--------|
| `outbound-dispatcher.service.ts:210` | Text | ✅ **Sole Zalo owner** |
| `routes/zalo.ts:197` | Media (image/file) | 📝 R4B documented exception |
| `routes/zalo.ts:389` | Voice (TTS) | 📝 R4B documented exception |
| `routes/zalo.ts:109` | Text (send-test) | ✅ Migrated to `sendOutbound()` |

---

## Git History

```
a996066 fix(thread-id): normalize thread ids at outbound boundaries
8c29d59 refactor(zalo): route send-test through outbound dispatcher
a9e77c4 feat(worker): route worker outbound via backend internal API
54cdcde fix(worker): evaluate runtime dryRun per job
79c3cd0 refactor(outbound): migrate incoming dispatcher replies
```
