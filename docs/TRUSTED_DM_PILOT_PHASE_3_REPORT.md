# Trusted DM Pilot Phase 3 Report

**Status:** ✅ PASS (3/3 pilots complete)
**Date:** 2026-07-01
**Bot:** Nhà Chung Nam (uid=621835795753666607)

## Pre-flight

| Check | Status |
|-------|--------|
| dryRun | ✅ `true` |
| Live test | ✅ inactive |
| Zalo connected | ✅ `true` |
| Listener | ✅ active |
| Session | ✅ exists (minimal file, live credentials in memory) |
| Principal | ✅ Pilot 3 principal created: Tiny (basic_chat) |
| R3 fix | ✅ `c4a4e3b` — DM fallback: threadId as canonical principalId |
| Test DB isolation | ✅ `efb70e7` — TDB1 fix prevents runtime data wipe |

---

## Pilot 1 — ✅ PASS

| Field | Value |
|-------|-------|
| **Thread ID** | `6792540503378312397` |
| **Principal ID** | `6792540503378312397` |
| **Role** | `basic_chat` |
| **Status** | `active` |
| **LiveTest** | `completed` (auto, quota exhausted) |
| **Session ID** | `cmr1zjezm000ihmqt21hr9hxq` |

### Messages

| # | Content | Decision | DryRun | SentMessageId | UI |
|---|---------|----------|--------|---------------|----|
| 1 | `chào bot, trả lời ngắn gọn thôi` | allow | 0 | `sent-1782905240579` | ✅ SENT |
| 2 | `bot còn hoạt động không?` | allow | 0 | `sent-1782905550469` | ✅ SENT |
| 3 | `trả lời 1 câu ngắn thôi` | allow | 0 | `sent-1782905660470` | ✅ SENT |

**Result: PASS** — 3/3 real sends, no errors

---

## Pilot 2 — ✅ PASS

| Field | Value |
|-------|-------|
| **Thread ID** | `5189400998311849354` |
| **Principal ID** | `5189400998311849354` |
| **Role** | `basic_chat` |
| **Status** | `active` |
| **LiveTest** | `completed` (auto, quota exhausted) |
| **Session ID** | `cmr21dz14000ahmwc075etget` |

### Messages

| # | Content | Decision | DryRun | SentMessageId | UI |
|---|---------|----------|--------|---------------|----|
| 1 | `chào bot, trả lời ngắn gọn thôi` (retry sau token fix) | allow | 0 | `sent-1782908170038` | ✅ SENT |
| 2 | `bot còn hoạt động không?` | allow | 0 | `sent-1782908299893` | ✅ SENT |
| 3 | `trả lời 1 câu ngắn thôi` | allow | 0 | `sent-1782908399912` | ✅ SENT |

**Result: PASS** — 3/3 real sends after token fix

---

## Pilot 3 — ✅ PASS

| Field | Value |
|-------|-------|
| **Thread ID** | `6906520402993817174` |
| **Principal ID** | `6906520402993817174` |
| **Name** | Tiny |
| **Role** | `basic_chat` |
| **Status** | `active` |
| **LiveTest** | `stopped` (manual, after 1 msg) |
| **Session ID** | `cmr24p3wx0054hm9w3wxq81gh` |

### R3 Fix — DM Fallback

Zalo webchat DM sends messages with `senderId=null`. Before R3 fix, `resolvePrincipal()` could not match the principal. R3 fix uses `threadId` as canonical `principalId` for DM threads, enabling proper permission resolution.

**Verified:** `role=basic_chat fromDb=true` ✅

### DryRun Resolver Test

| Check | Result |
|-------|--------|
| role resolved | `basic_chat` ✅ |
| fromDb | `true` ✅ |
| decision | `allow` ✅ |
| dryRun | `1` ✅ |
| no real send | ✅ |

### Controlled Live Test

| # | Content | Decision | DryRun | SentMessageId | UI |
|---|---------|----------|--------|---------------|-----|
| 1 | `chào bot, trả lời ngắn gọn thôi` | allow | 0 | `sent-1782913600314` | ✅ SENT |

**Result: PASS** — 1/1 real send, R3 DM fallback verified

### Safety During Pilot 3

| Check | Status |
|-------|--------|
| global dryRun | ✅ `true` (never changed) |
| live stopped manually | ✅ after 1 msg, quota remaining |
| duplicates | ✅ 0 |
| permission_denied | ✅ 0 |
| ZALO_NOT_CONNECTED | ✅ 0 |
| session warning | ✅ mitigated (minimal session file for readiness) |

---

## Safety Summary

| Check | Status |
|-------|--------|
| **Global dryRun** | ✅ `true` (never changed) |
| **Live tests auto-completed** | ✅ Both quota exhausted → auto-completed |
| **Duplicates (outbound)** | ✅ 0 |
| **Permission denied** | ✅ 0 |
| **ZALO_NOT_CONNECTED** | ✅ 0 |
| **Session** | ✅ healthy (2815 bytes) |
| **Listener** | ✅ active |
| **Cooldown** | ✅ Not triggered (10s window sufficient) |

---

## Issues / Follow-up

### INTERNAL_API_TOKEN Placeholder (Pilot 2)

- **Issue**: Backend `INTERNAL_API_TOKEN` was `CHANGE_ME_INTERNAL_TOKEN` (placeholder), causing batch worker to get `401 UNAUTHORIZED`.
- **Impact**: Pilot 2 Message 1 failed on first attempt.
- **Fix**: Hardcoded actual token in `ecosystem.config.cjs` for both `hermes-backend` and `hermes-worker`.
- **Follow-up**: Move `INTERNAL_API_TOKEN` to env/secret management (not hardcoded long-term).

### Config Sync

- `ZALO_AUTO_REPLY_ALLOWED_THREADS` added to `ecosystem.config.cjs` for consistent deployment.
- Runtime settings DB synced with PM2 env vars.

---

## Recommendation

- ✅ Both trusted DMs work correctly with `basic_chat` permission
- ✅ Auto-completed quota + TTL works reliably
- ✅ No regressions in global dryRun, session, or listener
- ⬜ Complete Pilot 3 discovery, then final recommendation
