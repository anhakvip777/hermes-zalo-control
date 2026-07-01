# R1/R2/R3/R4B Stabilization Report

**Status: PASS** ⚠️ (deployment stale — dist rebuilt but PM2 not restarted)  
**Date:** 2026-06-29  
**Environment:** production (VPS ai-vps, Node 18.19.1 runtime, Node 22.23.0 build)

---

## Commits Verified

| Batch | Commit | Scope |
|-------|--------|-------|
| R1.2 | `79c3cd0` | incoming-dispatcher outbound migration (8 call sites → `sendOutbound()`) |
| R2.1 | `54cdcde` | runtime dryRun per job, worker frozen sender fix |
| R3.1 | `a9e77c4` | worker outbound via backend internal API, worker no Zalo session |
| R4C | `a996066` | threadId normalization at boundaries (5 call sites) |
| R4B | `e4f9d22` | media/voice through outbound dispatcher, discriminated union |

---

## 1. Architecture Verification

### `new ZaloMessageSender` location
```
packages/backend/src/services/outbound-dispatcher.service.ts:259
packages/backend/dist/services/outbound-dispatcher.service.js:180
```
✅ **PASS** — sole owner is `outbound-dispatcher.service.ts`. No other production file.

### `zalo-message-sender` import
```
packages/backend/src/services/outbound-dispatcher.service.ts:24
packages/backend/dist/services/outbound-dispatcher.service.js:23
```
✅ **PASS** — only imported by dispatcher. `routes/zalo.ts` has zero ZMS imports.

### Worker isolation (no Zalo dependencies)
| Check | Result |
|-------|--------|
| ZaloMessageSender in workers | ✅ CLEAN |
| ZALO_SESSION_DIR in workers | ✅ CLEAN |
| restoreSession in workers | ✅ CLEAN |
| zalo-gateway in workers | ✅ CLEAN |
| sendOutboundViaBackend in workers | ✅ PRESENT (production path) |

### Outbound dispatch paths
All outbound flows through `sendOutbound()`:
- **incoming-dispatcher** → text auto-reply, error fallback, catch-all (12+ call sites)
- **routes/zalo** → send-test (text), send-media (image/file), send-voice (TTS audio)
- **routes/internal** → worker→backend relay
- **outbound-dispatcher** → definition + sole ZMS owner

✅ **PASS** — all paths use dispatcher.

---

## 2. Process / PM2 Verification

```
┌────┬───────────────────────┬─────────┬──────────┬────────┐
│ id │ name                  │ status  │ uptime   │ mem    │
├────┼───────────────────────┼─────────┼──────────┼────────┤
│ 8  │ hermes-backend        │ online  │ 2h       │ 117mb  │
│ 9  │ hermes-worker         │ online  │ 2h       │ 90mb   │
│ 7  │ hermes-frontend       │ online  │ 6h       │ 77mb   │
│ 4  │ hermes-zalo-tunnel    │ online  │ 6h       │ 39mb   │
└────┴───────────────────────┴─────────┴──────────┴────────┘
```

✅ **PASS** — all 4 processes online.

### Environment verification

| Env Var | Backend (8) | Worker (9) | Expected |
|---------|-------------|------------|----------|
| `ZALO_AUTO_REPLY_DRY_RUN` | `true` | `true` | ✅ |
| `ZALO_SESSION_DIR` | set (correct path) | **absent** | ✅ |
| `INTERNAL_API_BASE_URL` | N/A | `http://127.0.0.1:3002` | ✅ |
| `INTERNAL_API_TOKEN` | `CHANGE_ME_INTERNAL_TOKEN` | `CHANGE_ME_INTERNAL_TOKEN` | ⚠️ placeholder |
| `MESSAGE_BATCHING_ENABLED` | `true` | N/A | ℹ️ enabled |
| `NODE_ENV` | `production` | `production` | ✅ |

✅ **PASS** — worker has no Zalo session. Internal API configured.  
⚠️ **NOTE** — `INTERNAL_API_TOKEN` is placeholder. Worker→backend auth not enforced until real token is set.

---

## 3. Internal API Safety

| Test | Expected | Actual |
|------|----------|--------|
| No token | 401 | **401** ✅ |
| Wrong token (`Bearer wrong-token`) | 401 | **401** ✅ |

✅ **PASS** — internal API rejects unauthorized requests.

---

## 4. Runtime API Verification

| Endpoint | Result |
|----------|--------|
| `GET /api/system/health` | `status: "ok"`, uptime 9248s ✅ |
| `GET /api/zalo/ops/status` | `connected: true`, `listenerActive: true`, `dryRun: true` ✅ |
| `GET /api/system/runtime-config` | `enabled: true`, `dryRun: true`, `allowedThreads: [test thread]` ✅ |
| `GET /api/system/production-readiness` | `verdict: "NOT_READY"`, score 50 ✅ (correct — dryRun on) |

✅ **PASS** — Zalo connected, listener active, dry-run enforced, production readiness correct.

---

## 5. DB Audit (prisma/dev.db)

### OutboundRecord (last entry)
```
threadId: 6792540503378312397
source: auto_reply
decision: allow
reason: dry_run
dryRun: 1 (true)
sentMessageId: dry-run-1782748262285-qceck
errorCode: null
```
✅ **PASS** — OutboundRecord created correctly. dryRun=1. No real Zalo message IDs. No errors.

### Message
- 5 recent user messages (thread 7384893897915579378 — not allowed thread)
- 0 bot/assistant messages (current dist doesn't create them for dry-run text)
- Inbound messages from allowed test thread present

✅ **PASS** — no anomalies.

### AgentTask
- All recent tasks: `completed`
- No errors, no stuck tasks
- Types: create_schedule, parse_command, run_dry, attendance_summary

✅ **PASS** — all tasks healthy.

### Schedules
- No active schedules

ℹ️ **NOTE** — no active schedules to test worker dry-run path.

---

## 6. Dry-run Functional Test

**Test:** `POST /api/zalo/send-test` with thread `6792540503378312397`

**Request:**
```json
{"threadId":"6792540503378312397","content":"[STABILIZATION TEST] dry-run test message","threadType":"user"}
```

**Response:**
```json
{"data":{"success":true,"messageId":"dry-run-1782748262285-qceck"}}
```

**DB verification:**
- OutboundRecord created: `source=auto_reply`, `decision=allow`, `reason=dry_run`, `dryRun=1`
- sentMessageId matches response: `dry-run-1782748262285-qceck`
- No real Zalo send

✅ **PASS** — dry-run functional. No real message sent. OutboundRecord created.

---

## 7. Worker Schedule Dry-run Test

- No active schedules → cannot trigger run-now
- `sendOutboundViaBackend()` confirmed present in worker source + dist
- Worker env has `INTERNAL_API_BASE_URL` + `INTERNAL_API_TOKEN`

ℹ️ **SKIPPED** — no active schedules. Code path verified via grep.

---

## 8. Test / Typecheck / Build

| Check | Result |
|-------|--------|
| Backend tests | **40 files / 649 tests / ALL PASS** (11.03s) |
| Backend typecheck | **0 errors** |
| Backend build | **clean** |
| Frontend build | **clean** |

✅ **PASS** — all checks green.

---

## 9. Issues Found

### ⚠️ ISSUE-1: Deployment Stale
- **Severity:** Medium
- **Detail:** R4B dist was rebuilt (timestamps 15:52) but PM2 processes still running R4C code from 2h ago. PM2 has not been restarted.
- **Impact:** R4B changes (media/voice union type, new test routes) not live. Current runtime is R4C (a996066) which is stable.
- **Resolution:** `pm2 restart hermes-backend hermes-worker` after verifying Zalo session preservation.

### ⚠️ ISSUE-2: INTERNAL_API_TOKEN Placeholder
- **Severity:** Low (dry-run protects)
- **Detail:** Both backend and worker have `INTERNAL_API_TOKEN=CHANGE_ME_INTERNAL_TOKEN`. The internal endpoint accepts any token since both sides share the same placeholder.
- **Impact:** No real security risk while dry-run is on + localhost-only. Risk exists when going live.
- **Resolution:** Generate real token, set in both envs, restart.

### ℹ️ ISSUE-3: No Active Schedules
- **Severity:** Info
- **Detail:** No active schedules to test worker→backend→dispatcher pipeline end-to-end.
- **Impact:** Worker schedule path not exercised in this report.
- **Resolution:** Create a test schedule or verify when schedules are configured.

### ℹ️ ISSUE-4: Historical Test Data
- **Severity:** Info
- **Detail:** DB contains test entries (`real-msg-123`, `group-123`, `g1`) from previous test runs.
- **Impact:** Cosmetic — no functional impact.
- **Resolution:** Cleanup in future maintenance task.

---

## 10. Remaining Risks

| Risk | Status |
|------|--------|
| threadId cleanup | ✅ Complete (R4C committed) |
| UI status clarity | 📋 Pending |
| cooldown dual Map | 📋 R5 pending |
| production env/internal token deployment | 📋 Pending |
| deployment refresh (restart PM2) | 📋 Needed for R4B live |
| RAG/context eval suite | 📋 Pending |

---

## 11. Recommended Next Step

1. **Deploy R4B:** Restart PM2 backend + worker to pick up latest dist (preserve Zalo session)
2. **Set INTERNAL_API_TOKEN:** Generate real token, update both envs
3. **Post-deploy verify:** Re-run send-test to confirm R4B code active
4. **Priority after deploy:** cooldown single-store cleanup (R5) or UI status clarity
