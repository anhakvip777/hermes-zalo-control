# Agency 12-Factor Audit Report — Hermes Zalo Admin Center

**Date:** 2026-06-29
**Auditor:** Hermes Agency Agents (Principal Architect + 8 specialists)
**Framework:** [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents)
**Scope:** Full repo `~/hermes-zalo-control` (backend, worker, frontend, DB, deployment)

---

## 1. Executive Summary

The Hermes Zalo Admin Center (v1.0.0-mvp) is a functional beta with working core features (Zalo send/receive, dryRun safety, live test, reminder parser, document ingestion). However, **post-release instability** stems from architectural decisions made during rapid MVP development that now need production-grade hardening.

**Overall Assessment: 7/12 factors functional, 4 need work, 1 critical gap.**

The single most impactful change: **implement a Unified Outbound Dispatcher** that consolidates 12+ scattered `sender.sendMessage()` call sites into one policy-enforcement point. All other issues (stale worker config, missing heartbeats, dryRun/live drift, rate limit fragmentation) either stem from or are exacerbated by the lack of this centralized control.

**Recommendation: Refactor, not rebuild.** The core domain logic (Zalo gateway, reminder parser, rule engine, Hermes adapter) is solid. Focus on 2-3 structural changes (unified dispatcher, heartbeat hardening, worker config refresh) rather than a full rewrite.

---

## 2. Current System Map

```
┌──────────────────────────────────────────────────────────────────┐
│                         PM2 Process Model                         │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐ │
│  │ hermes-backend   │  │ hermes-worker    │  │ hermes-frontend │ │
│  │ Fastify :3002    │  │ DB poll :10s     │  │ next dev :3001  │ │
│  │ Zalo listener ✅ │  │ Scheduler +Batch │  │ Cloudflare tun  │ │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬────────┘ │
│           │                     │                      │          │
│           └──────────┬──────────┘                      │          │
│                      │                                 │          │
│              ┌───────▼────────┐                        │          │
│              │  SQLite dev.db │◄───────────────────────┘          │
│              │  Prisma ORM    │  (3 concurrent writers)           │
│              └───────┬────────┘                                   │
└──────────────────────┼────────────────────────────────────────────┘
                       │
          ┌────────────▼─────────────┐
          │   Zalo Session (file)    │
          │   zalo-session.json      │
          │   ⚠ Shared by backend    │
          │   AND worker process      │
          └──────────────────────────┘
```

### Inbound Flow
```
Zalo WebSocket → zca-js listener → normalizeMessage → saveIncoming
  → handleIncomingMessage (1841-line dispatcher):
      safetyCheck → groupGate → createAgentTask
      → [BATCHING interceptor: collect → ready → process]
      → [IMAGE pipeline: download → vision API → reply]
      → [FILE pipeline: download → ingest → reply]
      → [Create-Reminder: parse → schedule → job → reply]
      → [Context-Reminder: parse → confirm → schedule]
      → [Rule Engine: ignore | fixed_reply | route_to_hermes]
      → [HERMES FALLBACK: adapter.generateReply → send]
```

### Outbound Flow (Current — Scattered)
```
⚠ 12+ call sites each create `new ZaloMessageSender()` independently:
   - auto-reply (Hermes fallback)
   - rule fixed_reply
   - image analysis reply
   - file confirmation
   - reminder confirmation
   - reminder clarification
   - reminder error
   - schedule worker execution
   - batch processor
   - live test sender
   - document reply
   - generic error fallback
```

### DryRun Decision Sources
```
Layer 1: process.env.ZALO_AUTO_REPLY_DRY_RUN (env: "true")
   ↓
Layer 2: config.autoReply.dryRun (config.ts — from env)
   ↓
Layer 3: RuntimeSetting DB row ("autoReply.dryRun") ← currently "false"
   ↓
Layer 4: _cachedDryRun (in-memory, set at startup + on toggle)
   ↓
Layer 5: getCurrentEffectiveDryRun() ← Backend: per-message; Worker: ONCE
```

---

## 3. 12-Factor Compliance Matrix

| # | Factor | Status | Notes |
|---|--------|--------|-------|
| 1 | Natural Language Tool Use | ✅ | Hermes adapter + deterministic reminder parser |
| 2 | **Own Your Prompts** | ⚠️ | Single hardcoded prompt, no versioning, no domain-specific variants |
| 3 | **Own Your Context Window** | ⚠️ | Last 20 messages, no token budget, no domain context injection |
| 4 | **Tools = Structured Outputs** | ⚠️ | Reminder parser is deterministic; Hermes output is free-text |
| 5 | **Unify Execution & Business State** | ❌ | Message→AgentTask→OutboundRecord chain incomplete; no FK linkage |
| 6 | Launch/Pause/Resume APIs | ✅ | Runtime config API + live test API functional |
| 7 | Idempotency | ⚠️ | Atomic job claims OK; in-memory cooldowns break on restart |
| 8 | **Own Your Control Flow** | ❌ | **CRITICAL** — 12+ scattered send sites, no unified dispatcher |
| 9 | **Compact Errors into Context** | ⚠️ | Error logged but not always surfaced to UI or OutboundRecord |
| 10 | Small Focused Agents | ⚠️ | Hermes does everything; reminder/rule/image should be pre-processors |
| 11 | **Trigger from Anywhere** | ⚠️ | Multiple triggers exist but not all go through same safety path |
| 12 | **Stateless Reducer** | ❌ | In-memory cooldowns, stale worker config, process-specific rate limits |

---

## 4. End-to-End Message Flow Analysis

### Recent 5 inbound messages (thread 6792540503378312397)

| Inbound Message | AgentTask | status | dryRun | sentMessageId | Zalo received? |
|-----------------|-----------|--------|--------|---------------|----------------|
| "xin chào bạn" | cmqz2cp7w | completed | false | real-msg-123 | ⚠️ Placeholder |
| "xin chào bạn" | cmqz2d0g | completed | false | sent-1782... | ✅ Sent |
| "hi" | cmqz27hu | completed | false | real-msg-123 | ⚠️ Placeholder |
| "hi" | cmqz27nj | completed | false | sent-1782... | ✅ Sent |
| "hi" | cmqz25vf | completed | false | real-msg-123 | ⚠️ Placeholder |

**Finding:** `sentMessageId: "real-msg-123"` appears in test data — these are mock/test OutboundRecords, not real Zalo message IDs. Real sends use `sent-<timestamp>` format. The OutboundRecord table mixes test and production data.

### State Chain Gap

There is **no direct foreign key chain** linking:
```
Message → AgentTask → OutboundRecord → Zalo sentMessageId
```
`AgentTask.messageId` exists but doesn't match `OutboundRecord` records. `OutboundRecord` has `threadId` only. Cannot deterministically trace "did this specific inbound message result in a sent reply?"

---

## 5. Runtime dryRun/Live Analysis

### Current State (as of audit)
```
PM2 env ZALO_AUTO_REPLY_DRY_RUN: "true"
RuntimeSetting autoReply.dryRun:   "false" (overridden 2026-06-29T10:12:49 by admin, reason: "demo cho khach")
Effective dryRun (via API):        false
Backend behavior:                  Sends real messages ℹ️
Worker behavior:                   ⚠ STALE — sender created at startup with dryRun=true
```

### Drift Sources
| Source | Backend | Worker |
|--------|---------|--------|
| Env var | `true` (ignored) | `true` |
| DB Runtime Setting | `false` (respected) | ❌ Never re-read |
| In-memory cache | Refreshed on toggle | ❌ Frozen at startup |
| LiveTest session | Checked per-message | ❌ Never checked |

---

## 6. Outbound Architecture Analysis

### Current (Scattered)
```
incoming-dispatcher.ts:
  Line 933:   sender.sendMessage()  // hermes fallback
  Line 1014:  sender.sendMessage()  // rule fixed_reply
  Line 1096:  sender.sendMessage()  // image reply
  Line 1178:  sender.sendMessage()  // reminder confirmation
  Line 1219:  sender.sendMessage()  // file confirmation
  Line 1297:  sender.sendMessage()  // context reminder
  Line 1318:  sender.sendMessage()  // error fallback
  Line 1381:  sender.sendMessage()  // document reply
  Line 1430:  sender.sendMessage()  // clarification
  Line 1512:  sender.sendMessage()  // batch reply
  Line 1678:  sender.sendMessage()  // generic
  Line 1723:  sender.sendMessage()  // catch-all

workers/index.ts:
  Line 21:   sender.sendMessage()  // schedule execution (stale config!)
```

### Proposed (Unified)
```
All paths → OutboundDispatcher.send(params) {
  1. safetyCheck(threadId)
  2. getEffectiveDryRun()
  3. shouldSendLiveForThread()
  4. rateLimit.check()
  5. saveOutboundRecord({dryRun, decision, ...})
  6. if (!dryRun) → ZaloMessageSender.sendMessage()
  7. update OutboundRecord with result
  8. return SendResult
}
```

---

## 7. Worker/Backend State Consistency

| State | Backend | Worker | Consistent? |
|-------|---------|--------|-------------|
| dryRun | ✅ Refreshes per dispatch | ❌ Frozen at startup | NO |
| Zalo session | ✅ Listener active | ✅ API only (no listener) | Partial |
| Rate limit counter | Per-process | Per-process | NO (fragmented) |
| Cooldown Map | In-memory | N/A (no auto-reply) | OK |
| LiveTest session | Checked | ❌ Never checked | NO |
| Runtime settings | Read from DB | ❌ Never re-read | NO |
| Heartbeat | Every 30s | Every 10s | OK |

---

## 8. Zalo Session Ownership

**Current:** Both backend and worker hold `zca-js` API references to the same Zalo account.
- Backend: `restoreSession({startListener: true})` → starts WebSocket listener
- Worker: `restoreSession({startListener: false})` → API only, for sending messages

**Risk:** zca-js behavior with dual API references to the same session is undefined. Could cause:
- Connection drops if one process's heartbeat conflicts with the other
- Rate limit from Zalo side (two processes sending = double the requests)
- Session invalidation if credentials are refreshed in one process

**Recommendation:** Backend should be the SOLE owner of the Zalo session. Worker should send messages through the backend API (HTTP to localhost:3002) rather than directly via zca-js.

---

## 9. UI/API/Auth/Tunnel Analysis

### Resolved Issues
- ✅ Cloudflare tunnel 1033/530 → Fixed (separate tunnel + PM2)
- ✅ Frontend PM2 integration → Done
- ✅ Heartbeat static import fix → Done (zaloConnection/zaloListener now write)
- ✅ API base URL → Fixed (`""` for relative URLs)
- ✅ Session file path → Corrected

### Remaining Issues
- ⚠️ `zaloConnection` heartbeat: writes once at connect, never refreshes → goes stale after 90s
- ⚠️ `messagePipeline` heartbeat: only on dispatch → stale during quiet periods
- ⚠️ Health endpoint returns "degraded" when heartbeats stale — but UI now handles it gracefully after API_URL fix
- ⚠️ Frontend PM2 inherits secrets from parent process (SUPERMEMORY_API_KEY, CHIASEGPU_API_KEY)
- ⚠️ Old next-server process (pid 1305, v16.2.3, from June 24) still running
- ⚠️ `npx next dev` is dev mode — should eventually use production build

---

## 10. Root Causes for Current Instability

| # | Symptom | Root Cause | Severity |
|---|---------|------------|----------|
| 1 | Bot gửi thật dù PM2 env nói dryRun=true | RuntimeSetting DB overrides env; UI shows stale env | **CRITICAL** |
| 2 | Worker không gửi được khi chuyển dryRun→live | Sender frozen at startup, never re-evaluates config | **CRITICAL** |
| 3 | Heartbeat "down"/"degraded" liên tục | zaloConnection heartbeat only once on connect, never refreshes | **HIGH** |
| 4 | Rate limit fragmented giữa backend/worker | Per-process counters, không shared | **HIGH** |
| 5 | Cooldown reset khi restart PM2 | In-memory Map, không persist | **MEDIUM** |
| 6 | `sentMessageId: "real-msg-123"` trong DB | Test data mixed with production | **MEDIUM** |
| 7 | Không trace được Message → OutboundRecord | Thiếu FK chain | **MEDIUM** |
| 8 | UI "Failed to load status" | API_URL mặc định sai (`localhost:3000` thay vì relative) | **FIXED** |
| 9 | Cloudflare 1033/530 | Tunnel cũ mất, thiếu public hostname | **FIXED** |
| 10 | Frontend chạy thủ công, không PM2 | Next.js dev chạy ngoài PM2 | **FIXED** |

---

## 11. Recommended Rebuild Architecture

### Decision: **Refactor, not rebuild**

The core domain logic is solid. Focus on 3 structural changes:

### New Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Zalo Session                         │
│         ⚡ OWNED BY BACKEND ONLY                         │
│         Worker → HTTP API → Backend → Zalo               │
└─────────────────────────────────────────────────────────┘

┌──────────────────┐     ┌──────────────────┐
│  hermes-backend  │     │  hermes-worker   │
│                  │     │                  │
│  Zalo Gateway    │     │  Schedule Poll   │
│  Message Receiver│     │  Batch Processor │
│  Inbound Dispatch│     │  Document Worker │
│  ┌──────────────┐│     │                  │
│  │OUTBOUND      ││◄────│  POST /api/      │
│  │DISPATCHER    ││     │  outbound/send   │
│  │(UNIFIED)     ││     │                  │
│  └──────────────┘│     └──────────────────┘
│        │          │
│        ▼          │
│  Zalo Send        │
└──────────────────┘
```

### OutboundDispatcher Design

```typescript
// Single entry point for ALL outbound messages
class OutboundDispatcher {
  async send(params: {
    content: string;
    threadId: string;
    threadType: "user" | "group";
    source: "auto_reply" | "schedule" | "rule" | "image" | "file" | "reminder" | "batch";
    metadata?: Record<string, unknown>;
    bypassCooldown?: boolean;
  }): Promise<{
    success: boolean;
    dryRun: boolean;
    sentMessageId?: string;
    error?: string;
    outboundRecordId: string;
  }> {
    // 1. Safety gates (allowlist, group mention, self-guard)
    // 2. Get effective dryRun from DB (NOT from cache)
    // 3. Check liveTest override
    // 4. Rate limit check (shared Redis counter)
    // 5. Save OutboundRecord with decision
    // 6. If not dryRun → send via Zalo
    // 7. Update OutboundRecord with result
    // 8. Save assistant Message with status
  }
}
```

### Key Changes

1. **Unified Outbound Dispatcher** (fixes 8 issues: C1, C2, H4, H5, M5 + consistency)
2. **Backend owns Zalo session exclusively** (fixes H4, session conflict)
3. **Worker → Backend HTTP for sends** (fixes C2, M5, worker staleness)
4. **Runtime config read from DB every cycle** (fixes C2, dryRun drift)
5. **Heartbeat periodic refresh** (fixes H2, H3)
6. **Persist cooldowns to DB** (fixes H1)

---

## 12. Migration Plan (5 Batches)

### Batch 1: Stabilize Current (immediate, no code changes)
- ✅ Session file path fix (done)
- ✅ API base URL fix (done)
- Reset `RuntimeSetting autoReply.dryRun` to `"true"` (user safety preference)
- Kill old next-server (pid 1305)
- Strip secrets from frontend PM2 env

### Batch 2: Outbound Dispatcher (core refactor)
- Create `OutboundDispatcher` service
- Migrate `sendAutoReply` paths (12 call sites → 1 dispatcher)
- Add outboundRecordId to Message table (FK chain)
- Worker reads dryRun from DB each poll cycle

### Batch 3: Zalo Session Ownership
- Worker → Backend HTTP for all sends (`POST /api/outbound/send`)
- Backend becomes sole zca-js owner
- Remove `restoreSession` from worker startup

### Batch 4: Observability Hardening
- Periodic heartbeat refresh (every 30s for zaloConnection)
- Structured logging (pino JSON)
- Request/trace ID propagation
- Health endpoint: never crash UI on degraded status

### Batch 5: Production Hardening
- PostgreSQL migration (or at minimum separate DB per process)
- Redis for rate limiting and cooldowns
- Production Next.js build (not `next dev`)
- Alert system integration

---

## 13. Test Plan

| Batch | Test Scope |
|-------|-----------|
| 1 | Manual verification of fixes + full test suite (504 tests) |
| 2 | OutboundDispatcher unit tests + E2E: send message → verify OutboundRecord → verify Zalo receive |
| 3 | Worker send via backend API test + Zalo session singleton test |
| 4 | Heartbeat refresh test + health endpoint resilience test |
| 5 | PostgreSQL migration test + Redis integration test + load test |

---

## 14. Rollback Plan

- **Git tags** before each batch
- **DB backup** before Batch 2 (OutboundRecord schema change)
- **Dry-run smoke test** after each deploy
- **Canary:** Deploy to worker first, verify 24h, then backend

---

## 15. Open Questions

1. **Should worker talk to Zalo at all?** User preference: backend-only. This aligns with the recommendation.
2. **SQLite → PostgreSQL timeline?** Can defer to Batch 5; SQLite works for <1000 messages/day.
3. **Redis needed for rate limiting?** Shared rate limiter between backend/worker requires external state. Options: Redis, DB table, or accept fragmented limits.
4. **Should we rebuild prompt system?** User's preferred architecture suggests deterministic pre-processing before Hermes. Reminder parser already does this. Extend to rule engine and image/document intent detection.

---

## 16. Severity Classification

| Level | Count | Key Items |
|-------|-------|-----------|
| **CRITICAL** | 3 | No unified dispatcher, Worker stale config, SQLite 3-process contention |
| **HIGH** | 5 | In-memory cooldowns, passive heartbeats, missing zaloConnection beat, dual session, no worker liveTest |
| **MEDIUM** | 7 | tsx in prod, no trace IDs, port mismatch, no cleanup timer, fragmented rate limit, unstructured logging, PM2 restart cap |
| **LOW** | 4 | React warnings, no migration docs, README dev commands, Node 17+ API |
| **COSMETIC** | 2 | Test data in prod DB, UI "Failed to load status" (fixed) |

---

*Report compiled by Agency Agents (Principal Architect + orchestrator). Source review of `~/hermes-zalo-control/packages/backend/src/*`, `ecosystem.config.cjs`, `prisma/schema.prisma`, DB state, and live API endpoints. Frontend reviewed at API integration level only.*
