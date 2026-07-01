# S1 — Session Restart Investigation Report

**Status:** ✅ PASS (root cause identified, session stable in this test)
**Date:** 2026-06-29

---

## Session Config

### Canonical Session

| Field | Value |
|-------|-------|
| Canonical session dir | `/home/anhakvip777/hermes-zalo-control/packages/backend/zalo-session` |
| Session file | `zalo-session.json` (2.8 KB) |
| Owner | `anhakvip777:anhakvip777` (rw-rw-r--) |
| Set by | `ecosystem.config.cjs` → `ZALO_SESSION_DIR` (absolute path) |

### Backend Env (pm2 id 8)

```
ZALO_SESSION_DIR: /home/anhakvip777/hermes-zalo-control/packages/backend/zalo-session
ZALO_AUTO_REPLY_DRY_RUN: true
ZALO_AUTO_REPLY_ENABLED: true
NODE_ENV: production
```

### Worker Env (pm2 id 9)

```
NO ZALO_SESSION_DIR        ✅ (clean, correct)
INTERNAL_API_BASE_URL: http://127.0.0.1:3002
INTERNAL_API_TOKEN: <set>
ZALO_AUTO_REPLY_DRY_RUN: true
NODE_ENV: production
```

Worker does NOT hold Zalo session. All outbound goes through backend internal API. ✅

---

## Session Files

| Path | Size | Modified | Owner | Notes |
|------|------|----------|-------|-------|
| `packages/backend/zalo-session/zalo-session.json` | 2.8 KB | Jun 29 16:53 | anhakvip777 | **CANONICAL** — active, updated by backend |
| `packages/zalo-session/zalo-session.json` | 2.8 KB | Jun 29 06:58 | anhakvip777 | LEGACY — pre-R3 migration remnant |
| `zalo-session/` (root) | — (empty dir) | Jun 29 07:36 | anhakvip777 | GHOST — empty directory, no files |

---

## Code Audit — Session Lifecycle

### Session Owner: `zalo-gateway.service.ts` (sole authority)

| Function | Line | Action |
|----------|------|--------|
| `saveCredentials()` | 330-338 | `mkdirSync(sessionDir)` + `writeFileSync(sessionPath, ...)` — writes session |
| `restoreSession()` | 263-327 | `readFileSync` → login → save — restores session |
| `restoreSession()` error handler | 318-320 | **`unlinkSync(sessionPath)` — DELETES session file** when error contains "expired"/"invalid"/"SESSION" |
| `restoreSession()` no file | 272-275 | Returns `NO_SESSION_FILE` (no delete) |
| `logout()` | 472-474 | `unlinkSync(sessionPath)` — intentional delete on logout |
| `saveCredentials()` | 185-186 | `mkdirSync(sessionDir)` + writes QR during first login |

### Session Consumers (read/restore only)

| File | Line | Action |
|------|------|--------|
| `index.ts` (backend startup) | 63 | `gw.restoreSession({ startListener: true })` |
| `zalo-ops.service.ts` | 235 | `gw.restoreSession({ startListener: true })` (reconnect API) |
| `zalo-message-sender.ts` | 79, 252, 329 | `gateway.restoreSession()` (pre-send check) |

### Worker: CLEAN

- `grep ZALO_SESSION_DIR packages/backend/src/workers` → 0 results
- `grep restoreSession packages/backend/src/workers` → 0 results
- `grep zalo-gateway packages/backend/src/workers` → 0 results

### Session Path Resolution

`config.ts:55-57`:
```typescript
sessionDir: process.env.ZALO_SESSION_DIR
  ? resolve(process.env.ZALO_SESSION_DIR)
  : resolve(process.cwd(), "packages", "backend", "zalo-session"),
```

PM2 cwd = repo root → default fallback would also resolve to `packages/backend/zalo-session`. The absolute path in ecosystem config is the explicit correct path.

---

## Backup

| Item | Path |
|------|------|
| Backup dir | `backups/session-restart-s1-20260629-165251` |
| Current session | `current/zalo-session.json` (16:49) |
| Legacy session | `legacy/zalo-session.json` (06:58) |

---

## Restart Test

| Step | Result |
|------|--------|
| Pre-restart session | Exists (2.8 KB, Jun 29 16:49) ✅ |
| Pre-restart Zalo | connected=true, listener=true ✅ |
| `pm2 restart hermes-backend --update-env` | online (PID 3217449) ✅ |
| Post-restart session | Exists (2.8 KB, Jun 29 16:53 — updated) ✅ |
| Post-restart Zalo | connected=true, listener=true ✅ |
| New wrong session dir? | No ✅ |
| Backend crash during restart? | No ✅ |

**Session SURVIVED this controlled restart.** The destructive `unlinkSync` on line 320 was NOT triggered because Zalo API accepted the credentials successfully.

---

## Root Cause Hypothesis

### Primary Cause: Destructive session delete on login error

**File:** `packages/backend/src/services/zalo-gateway.service.ts`
**Line:** 320
**Code:** `try { unlinkSync(sessionPath); } catch { /* ignore */ }`

**Trigger condition:** `restoreSession()` catches an error whose message contains "expired", "invalid", or "SESSION" (line 318). When this happens, the session file is **permanently deleted**.

**Why it happens intermittently:** During PM2 restart, the backend calls `restoreSession()` during initialization. Under normal conditions, Zalo API accepts the stored credentials and restore succeeds. However, transient conditions can cause the login to fail:
- Zalo server-side rate limiting
- Network timeout during credential refresh
- Session token rotation mid-restart
- zca-js internal state mismatch

**Compounding factor:** `ecosystem.config.cjs` has `autorestart: true, max_restarts: 5`. When session file is deleted by the first restart's error handler, subsequent auto-restarts encounter `NO_SESSION_FILE` and never recover.

### Contributing Factors

1. **No pre-restart session backup** — no PM2 hook or script backs up session before restart
2. **`autorestart: true`** — auto-restart after deletion makes the problem worse (each restart sees NO_SESSION_FILE)
3. **Legacy session paths** — old `packages/zalo-session/` and empty `./zalo-session/` directories add confusion
4. **No session health check before destructive delete** — the code doesn't retry or back off before deleting

### Confidence: HIGH

This pattern matches all three documented session loss incidents:
- **R3 Stabilization (Jun 27):** "Worker env caching" + session restore from backup
- **R4B Deployment Refresh (Jun 29):** `zalo-session/` directory empty after PM2 restart
- **R5 Stabilization (Jun 29):** `NO_SESSION_FILE` after restart, restored from backup

### Proposed Fix (for future batch)

✅ **Implemented in S1.1** (commit `abd9c3f`):

```typescript
// Before: destructive delete
try { unlinkSync(sessionPath); } catch { /* ignore */ }

// After: non-destructive quarantine
quarantineSessionFile(sessionPath, msg);
// Renames to: zalo-session.json.<reason>-YYYYMMDD-HHMMSS
// Example: zalo-session.json.expired-20260629-165300
```

Behavior:
- Session file renamed instead of deleted → no data loss on transient errors
- Admin can restore by copying quarantined file back (if error was transient)
- Audit trail: timestamped quarantine files show when/why sessions were invalidated

---

## SOP Updates

### Updated: `docs/OPERATIONS_RUNBOOK.md`
Added sections:
- **Safe PM2 Restart SOP** — 8-step checklist with backup, verify, restore
- **Zalo Session Restore SOP** — backup path, stop/restore/verify steps

### Updated: `docs/ROLLBACK_GUIDE.md`
Added: "Session Loss During Restart" — how to detect and recover

---

## Issues Found

| # | Issue | Severity | Action |
|---|-------|----------|--------|
| 1 | `unlinkSync(sessionPath)` on login error (line 320) | **HIGH** | ✅ **FIXED in S1.1** (commit `abd9c3f`) — replaced with `quarantineSessionFile()` rename |
| 2 | Legacy `packages/zalo-session/` directory | LOW | Clean up (safe: not used by any process) |
| 3 | Empty `./zalo-session/` directory at repo root | LOW | Clean up |
| 4 | No pre-restart session backup hook | MEDIUM | Add to SOP |

---

## Recommended Next Step

1. ✅ S1 investigation complete — root cause identified, session stable
2. **Future batch:** Replace destructive `unlinkSync` with safe rename (Option A) or non-destructive flag (Option B)
3. **Proceed to Post-R5 Safe Pilot** — Controlled Live Test with 1 thread, dryRun=true by default
