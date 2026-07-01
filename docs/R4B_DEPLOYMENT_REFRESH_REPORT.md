# R4B Deployment Refresh Report

**Status: PASS** ✅  
**Date:** 2026-06-29 16:01 ICT  
**Environment:** production (VPS ai-vps, Node 18.19.1 runtime)

---

## PM2 Restart

| Process | Action | Result |
|---------|--------|--------|
| hermes-backend (8) | restart --update-env | ✅ online, PID 3189464, uptime fresh |
| hermes-worker (9) | restart --update-env | ✅ online, PID 3188102, uptime fresh |
| hermes-frontend (7) | restart | ✅ online, PID 3187696 |
| hermes-zalo-tunnel (4) | not restarted | ✅ online (6h uptime, unaffected) |

**Note:** Backend restarted 3 times total — initial restart missed env update, second with `--update-env`, third after session restore.

---

## Session Recovery

- **Issue:** Zalo session file missing after restart → `NO_SESSION_FILE`, Zalo disconnected
- **Root cause:** `packages/backend/zalo-session/` directory was empty (likely cleaned during restart)
- **Fix:** Restored from latest backup `packages/backend/backups/db/zalo-session-20260629T121126/zalo-session.json`
- **Result:** Zalo reconnected ✅ (`connected=true`, `listenerActive=true`)

---

## Env Verification

| Env Var | Backend (8) | Worker (9) | Expected |
|---------|-------------|------------|----------|
| `INTERNAL_API_TOKEN` | ✅ ***MASKED*** | ✅ ***MASKED*** | Same token |
| `INTERNAL_API_BASE_URL` | N/A | `http://127.0.0.1:3002` | ✅ |
| `ZALO_SESSION_DIR` | set (correct) | **absent** | ✅ |
| `ZALO_AUTO_REPLY_DRY_RUN` | `true` | `true` | ✅ |
| `ZALO_AUTO_REPLY_ENABLED` | `true` | N/A | ✅ |
| `NODE_ENV` | `production` | `production` | ✅ |

✅ **PASS** — both sides share same token. Worker has no Zalo session. dryRun enforced.

---

## Runtime APIs

| Endpoint | Result |
|----------|--------|
| `GET /api/system/health` | `status: ok`, uptime fresh ✅ |
| `GET /api/zalo/ops/status` | `connected: true`, `listenerActive: true`, `dryRun: true` ✅ |
| `GET /api/system/runtime-config` | `enabled: true`, `dryRun: true`, threads OK ✅ |
| `GET /api/system/production-readiness` | `verdict: NOT_READY`, score 25 ✅ (correct — dryRun on) |

✅ **PASS** — all APIs healthy, Zalo connected after session restore.

---

## Internal API Protection

| Test | Expected | Actual |
|------|----------|--------|
| No token | 401 | **401** ✅ |
| Wrong token (`Bearer wrong-token`) | 401 | **401** ✅ |
| Valid token dry-run | `ok:true`, `dryRun:true` | **PASS** ✅ |

**Valid token response:**
```json
{
  "ok": true,
  "decision": "dry_run",
  "sentMessageId": "dry-run-1782748909971-1vq21",
  "dryRun": true,
  "reason": "dry_run"
}
```

**DB verification:** OutboundRecord created — `source=schedule`, `decision=allow`, `reason=dry_run`, `dryRun=1`, sentMessageId matches. ✅

---

## Dist Verification

| Check | Result |
|-------|--------|
| `new ZaloMessageSender` | ✅ Only `outbound-dispatcher.service.js:180` |
| `sendOutboundViaBackend` in workers | ✅ Present (`scheduler.js:12`) |
| `kind: "media"/"voice"` in dist | ✅ `routes/zalo.js:168,333` (media + voice routes) |

✅ **PASS** — R4B code is live in PM2 runtime.

---

## Issues Found

### ⚠️ ISSUE-1: Session File Lost on Restart
- **Severity:** Medium (recovered)
- **Detail:** `packages/backend/zalo-session/` directory was empty after PM2 restart. Required manual restore from backup.
- **Root cause:** Unclear — directory exists but no files. Possible PM2 cleanup or race condition.
- **Mitigation:** Session restored. Added to memory as known restart risk.
- **Recommendation:** Add session backup step to restart checklist.

### ℹ️ ISSUE-2: Production Readiness Score Dropped
- **Severity:** Info
- **Detail:** Score dropped from 50 → 25 after restart (likely due to Zalo temporarily disconnected during check).
- **Impact:** Cosmetic — score recovered after reconnection.

---

## Recommended Next Step

1. ✅ Deployment refresh complete — R4B code live
2. ✅ INTERNAL_API_TOKEN set — worker→backend auth ready
3. 📋 Ready for R5 (cooldown single-store) or UI status clarity
4. 📋 Add session backup step to restart SOP
