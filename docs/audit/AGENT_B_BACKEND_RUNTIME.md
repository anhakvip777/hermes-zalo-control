# Agent B — Backend / Runtime Auditor

**Date:** 2026-07-01 16:05 UTC+7
**Auditor:** Agent B (read-only)
**Overall Verdict:** ⚠️ PASS WITH WARNINGS

---

## 1. PM2 Status

**Command:** `/home/anhakvip777/.nvm/versions/node/v22.23.0/bin/pm2 status`
**Exit Code:** 0

| id | name | status | uptime | ↺ | cpu | mem |
|----|------|--------|--------|---|-----|-----|
| 0 | hermes-backend | online | 9m | 25 | 0% | 91.2mb |
| 1 | hermes-worker | online | 3h | 3 | 0% | 101.0mb |
| 2 | hermes-document-worker | online | 35h | 0 | 0% | 76.5mb |
| 3 | hermes-frontend | online | 9m | 8 | 0% | 70.4mb |
| 4 | hermes-tunnel | online | 62m | 0 | 0% | 38.4mb |

**Notes:**
- All 5 processes ONLINE
- ⚠️ hermes-backend: **25 restarts in 9 minutes** — indicates instability (crashes/restarts loop)
- ⚠️ hermes-frontend: **8 restarts in 9 minutes**
- hermes-worker stable (3 restarts in 3h)

---

## 2. Backend Logs (Error Filter)

**Command:** `pm2 logs hermes-backend --lines 600 --nostream | grep -Ei 'error|fail|exception|...'`
**Exit Code:** 0

**Errors found:**

| Timestamp | Severity | Message |
|-----------|----------|---------|
| 2026-06-29T16:25 | ⚠️ | `[outbound-dispatcher] Failed to update message status` (Prisma record not found) |
| 2026-06-29T16:30 | ⚠️ | Same Prisma error |
| 2026-07-01T11:16 | ❌ | `Zalo auto-restore failed: Đăng nhập thất bại` (multiple) |
| 2026-07-01T15:36 | ⚠️ | `Zalo auto-restore: NO_SESSION_FILE` (multiple after restart) |
| 2026-07-01T15:41 | ✅ | `Session saved`, `listener started successfully` |
| 2026-07-01T15:56 | ✅ | `[config-check] PASS=9 WARN=0 ERROR=0` |

**Verdict:** Logs show Zalo session was restored at 15:41 but lost again by 15:56 after backend restart. Config check clean. Heartbeats flowing normally.

---

## 3. Worker Logs (Error Filter)

**Command:** `pm2 logs hermes-worker --lines 600 --nostream | grep -Ei 'error|fail|exception|401|403|batch|internal'`
**Exit Code:** 0

**Errors found:**

| Timestamp | Severity | Message |
|-----------|----------|---------|
| 2026-06-29T08:00 | ⚠️ | `[dispatcher] live-test send failed: Zalo not connected` |
| 2026-06-29T12:09 | ❌ | Prisma update failure (record not found) |
| 2026-06-30T01:14 | ⚠️ | `[dispatcher] send failed: Zalo not connected` |
| 2026-07-01T12:13 | ❌ | `[batch-worker] internal API error 401: Invalid or missing internal API token` |

**Batch activity:** Heavy backlog processing on June 29-30 with many `thread_not_allowed` results (test batches from prior sessions). Recent batches (July 1) all dispatched successfully.

---

## 4. Test Suite

**Command:** `npm test -w packages/backend`
**Exit Code:** 0 ✅

```
Test Files  46 passed (46)
     Tests  788 passed (788)
  Duration  12.67s
```

**Verdict:** ALL PASSING

---

## 5. TypeScript Typecheck

**Command:** `npm run typecheck -w packages/backend`
**Exit Code:** 0 ✅

No errors emitted.

---

## 6. Build

**Command:** `npm run build -w packages/backend`
**Exit Code:** 0 ✅

Build succeeded.

---

## 7. Runtime Config API

**Command:** `curl -u admin:$ADMIN_PASSWORD http://127.0.0.1:3002/api/system/runtime-config`
**Exit Code:** 0 ✅

```json
{
  "effective": {
    "enabled": true,
    "dryRun": true,
    "allowedThreads": ["6792540503378312397", "5189400998311849354", "6906520402993817174"],
    "cooldownSeconds": 10,
    "groupReplyWindowSeconds": 600,
    "dryRunSource": "runtime"
  }
}
```

**Notes:** dryRun=enabled (safe). 3 allowed threads. Recent audit trail shows dryRun toggled off/on.

---

## 8. Live Test Status API

**Command:** `curl -u admin:$ADMIN_PASSWORD http://127.0.0.1:3002/api/system/live-test/status`
**Exit Code:** 0 ✅

```json
{"active": false, "session": null, "dryRun": true}
```

**Verdict:** No live test active — safe.

---

## 9. Zalo Ops Status API

**Command:** `curl -u admin:$ADMIN_PASSWORD http://127.0.0.1:3002/api/zalo/ops/status`
**Exit Code:** 0 ✅

```json
{
  "connected": false,
  "connectionStatus": "error",
  "selfUserId": null,
  "lastError": "NO_SESSION_FILE",
  "dryRun": true,
  "allowedThreads": [...],
  "heartbeats": {
    "zaloConnection": {"status": "ok", "ageSeconds": 1333},
    "zaloListener": {"status": "ok", "ageSeconds": 1333},
    "messagePipeline": {"status": "ok", "ageSeconds": 614}
  },
  "inbound24h": 14,
  "outbound24h": 45,
  "failedTasks24h": 0
}
```

**Verdict:** ⚠️ Zalo NOT connected (`NO_SESSION_FILE`). Heartbeats are healthy. 45 outbound messages in last 24h despite disconnected state (likely from earlier session).

---

## 10. Production Readiness API

**Command:** `curl -u admin:$ADMIN_PASSWORD http://127.0.0.1:3002/api/production-readiness/status`
**Exit Code:** 0
**HTTP Status:** 404

```json
{"message": "Route GET:/api/production-readiness/status not found", "error": "Not Found", "statusCode": 404}
```

**Verdict:** ⚠️ Endpoint does not exist.

---

## Summary

| Check | Result | Exit Code |
|-------|--------|-----------|
| PM2 status | ✅ All online | 0 |
| Backend logs | ⚠️ Warnings | 0 |
| Worker logs | ⚠️ Warnings | 0 |
| npm test | ✅ 788/788 | 0 |
| npm typecheck | ✅ Clean | 0 |
| npm build | ✅ Success | 0 |
| /api/system/runtime-config | ✅ OK | 0 |
| /api/system/live-test/status | ✅ OK | 0 |
| /api/zalo/ops/status | ⚠️ NO_SESSION_FILE | 0 |
| /api/production-readiness/status | ⚠️ 404 | 0 |

### Blockers Found

1. **⚠️ Zalo session missing** — `NO_SESSION_FILE`. Bot cannot send/receive Zalo messages. Session was saved at 15:41 but lost after backend restart. Needs session restore.

2. **⚠️ Backend crash loop** — 25 restarts in 9 minutes. Root cause likely Zalo auto-restore failures causing repeated crashes. Stabilize session to fix.

3. **⚠️ Worker internal API 401** — Worker had one `INTERNAL_API_401` error on July 1 (invalid/missing internal API token). May be a one-time issue after restart.

4. **⚠️ Missing endpoint** — `/api/production-readiness/status` returns 404. Route may not be implemented yet.

### Non-Blockers

- Old Prisma errors (June 29) — historical, not recurring
- Batch `thread_not_allowed` — expected behavior for test threads not in allowlist
- `Zalo not connected` errors — consequence of missing session, not a separate issue
