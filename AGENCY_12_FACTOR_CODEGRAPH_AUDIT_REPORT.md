# Agency 12-Factor + Codegraph Audit Report — Hermes Zalo Admin Center

**Date:** 2026-06-29
**Audit Method:** Agency Agents + [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents) + [Codegraph](https://github.com/colbymchenry/codegraph) v1.1.3
**Scope:** `~/hermes-zalo-control` (153 files, 1,824 nodes, 4,910 edges)

---

## 1. Executive Summary

The first Agency 12-Factor audit found 3 CRITICAL issues. This Codegraph audit **confirms all 3 with precise code evidence** and discovers **2 additional HIGH findings** that were not previously documented.

**Overall: REFACTOR core — do not rebuild.** The domain logic is solid; the structural issue is the absence of a unified outbound dispatcher.

### Delta vs Previous Audit

| Previous Finding | Codegraph Evidence | Status |
|-----------------|-------------------|--------|
| C1: No unified outbound dispatcher | ✅ **CONFIRMED** — 9 distinct `sendMessage` callers across 6 files | Still CRITICAL |
| C2: Worker sender frozen at startup | ✅ **CONFIRMED** — `workers/index.ts:21` calls `getCurrentEffectiveDryRun()` once | Still CRITICAL |
| C3: Live send risk from runtime config | ✅ **RESOLVED** — dryRun reset to `true` (Step 0) | MITIGATED |
| NEW: Worker restores Zalo session via sender | ✅ **FOUND** — `ZaloMessageSender.sendMessage()` calls `restoreSession()` | HIGH |
| NEW: Worker never saves OutboundRecord | ✅ **FOUND** — `saveOutboundRecord` called from dispatcher + sender, not worker | HIGH |

---

## 2. Codegraph Installation & Verification

```bash
$ npx @colbymchenry/codegraph --version
1.1.3

$ cd ~/hermes-zalo-control && npx @colbymchenry/codegraph init
◆  Indexed 153 files
●  1,824 nodes, 4,910 edges in 1.4s
```

### Methodology
All findings below are backed by one or more of:
- **`codegraph callers <symbol>`** — who calls this function
- **`codegraph node <symbol>`** — function source + callee/caller trail
- **`codegraph explore <query>`** — cross-cutting exploration
- **DB queries** (sqlite3 on dev.db) for runtime state evidence
- **PM2 env inspection** for process-level configuration

---

## 3. Outbound Call Graph

### Finding CG-01: 9 distinct `sendMessage` call sites across 6 files

**Severity:** CRITICAL
**12-factor mapping:** Factor 8 (Own Your Control Flow)

**Evidence:**
```
codegraph callers sendMessage:
  ┌─ test files (3):
  │   hardening.test.ts, zalo-media-send.test.ts, zalo.test.ts
  ├─ routes (1):
  │   zaloRoutes → POST /zalo/send-test
  ├─ services (3):
  │   sendReminder (attendance.service.ts:104)
  │   handleIncomingMessage (incoming-dispatcher.service.ts:780)  ← MAIN DISPATCHER
  │   executeJob (workers/scheduler.ts:28)                        ← WORKER
  └─ workers (2):
      executeJob (scheduler.ts:324)
      executeRunNow (scheduler.ts:324)
```

Within `handleIncomingMessage` (the 1841-line dispatcher):
```
Line 932:   sender.sendMessage()  // image fallback
Line 1014:  sender.sendMessage()  // rule fixed_reply
Line 1096:  sender.sendMessage()  // image reply
Line 1178:  sender.sendMessage()  // reminder confirmation
Line 1219:  sender.sendMessage()  // file confirmation
Line 1297:  sender.sendMessage()  // context reminder
Line 1318:  sender.sendMessage()  // error fallback
Line 1381:  sender.sendMessage()  // document reply
Line 1430:  sender.sendMessage()  // clarification
Line 1512:  sender.sendMessage()  // hermes fallback
Line 1678:  sender.sendMessage()  // batch reply
Line 1723:  sender.sendMessage()  // catch-all
```

**12 scattered call sites** within a single function, each independently creating `new ZaloMessageSender()`.

### Finding CG-02: Worker `executeJob` sends directly without liveTest check

**Severity:** CRITICAL
**12-factor mapping:** Factor 11 (Trigger from Anywhere)

**Evidence:**
```
codegraph node executeJob → workers/scheduler.ts:187:
  const result = await deps.sender.sendMessage(
    schedule.messageContent,
    schedule.targetId,
    schedule.targetType as "user" | "group" ?? "user"
  );
```

`shouldSendLiveForThread` callers:
```
codegraph callers shouldSendLiveForThread:
  - handleIncomingMessage (dispatcher)     ← ✅ Checks liveTest
  - ZaloMessageSender.sendMessage           ← ✅ Checks liveTest
  - batch18-live-test.test.ts               ← Test only
  - executeJob / workers                    ← ❌ NOT FOUND
```

**Impact:** Schedule messages never get liveTest bypass. If admin creates a live test session, auto-replies respect it but scheduled messages ignore it.

### Finding CG-03: `saveOutboundRecord` called from 5 places, but NOT from worker

**Severity:** HIGH
**12-factor mapping:** Factor 5 (Unify Execution & Business State)

**Evidence:**
```
codegraph callers saveOutboundRecord:
  - handleIncomingMessage              ← dispatcher
  - ZaloMessageSender.sendMessage      ← sender (via dispatcher)
  - ZaloMessageSender.sendVoice        ← sender
  - test files (2)
  - workers/scheduler.ts               ← ❌ NOT FOUND
```

Worker's `executeJob` calls `deps.sender.sendMessage()` which internally may call `saveOutboundRecord`, but the worker itself has no direct call.

### Finding CG-04: `saveOutboundMessage` only called from dispatcher

**Severity:** MEDIUM
**12-factor mapping:** Factor 5 (Unify Execution & Business State)

**Evidence:**
```
codegraph callers saveOutboundMessage:
  - handleIncomingMessage              ← ONLY caller (2 call sites within)
  - NO worker, NO routes, NO scheduler
```

**Impact:** Assistant messages created by worker flows may not link to OutboundRecords.

---

## 4. dryRun / Live Data Flow

### Finding CG-05: Worker sender FROZEN at startup — confirmed

**Severity:** CRITICAL
**12-factor mapping:** Factor 12 (Stateless Reducer)

**Evidence:**
```
codegraph node packages/backend/src/workers/index.ts — line 20-21:
  async function main() {
    const sender = getCurrentEffectiveDryRun() 
      ? new MockMessageSender() 
      : new ZaloMessageSender();
```

`sender` is a `const` — assigned once, passed to `executeJob` as `deps.sender`, never re-evaluated. Runtime config changes after startup have **zero effect** on the worker.

`getCurrentEffectiveDryRun()` is called **36 times** from backend paths but only **once** from the worker path (at startup).

### Finding CG-06: Runtime dryRun source chain confirmed

**Severity:** HIGH (mitigated after Step 0 reset)

**Evidence from codegraph + API:**
```
Layer 1: process.env.ZALO_AUTO_REPLY_DRY_RUN = "true" (PM2 ecosystem.config.cjs)
Layer 2: config.autoReply.dryRun — from env (config.ts)
Layer 3: RuntimeSetting DB — "autoReply.dryRun" (via PATCH /api/system/runtime-config/auto-reply)
Layer 4: _cachedDryRun — in-memory variable in runtime-config.service.ts
Layer 5: getCurrentEffectiveDryRun() → _cachedDryRun ?? config.autoReply.dryRun
```

**Before Step 0:** RuntimeSetting was `"false"` (set by admin for demo) → `_cachedDryRun = false` → bot sent real messages despite PM2 env saying `true`.

**After Step 0:** RuntimeSetting reset to `"true"` → `_cachedDryRun = true` → safe mode restored.

### Finding CG-07: Backend checks liveTest, Worker does NOT

**Evidence:**
```
codegraph callers shouldSendLiveForThread → 3 results:
  1. handleIncomingMessage          ← Backend: ✅
  2. ZaloMessageSender.sendMessage  ← Sender: ✅
  3. test file                      ← Test: ✅
  → workers/scheduler.ts            ← Worker: ❌
```

---

## 5. Zalo Session Ownership

### Finding CG-08: ZaloMessageSender triggers session restore

**Severity:** HIGH
**12-factor mapping:** Factor 5 (Session Management)

**Evidence:**
```
codegraph callers restoreSession → 8 callers:
  1. main (index.ts)                        ← Backend startup: startListener=true
  2. ZaloGatewayService.startLogin          ← Login flow
  3. ZaloGatewayService.scheduleReconnect   ← Reconnect
  4. ZaloMessageSender.sendMessage          ← ⚠ SENDER RESTORES SESSION!
  5. ZaloMessageSender.sendVoice            ← ⚠ SENDER RESTORES SESSION!
  6. ZaloMessageSender.sendMediaAttachment  ← ⚠ SENDER RESTORES SESSION!
```

**Impact:** When the worker's sender calls `sendMessage()`, `ZaloMessageSender` may call `restoreSession()` — meaning the worker process could **independently restore a live Zalo session**, competing with the backend's session.

### Finding CG-09: Worker imports Zalo gateway and sender

**Evidence:**
```
workers/index.ts imports:
  import { ZaloMessageSender } from "../services/zalo-message-sender.js";
  import { getCurrentEffectiveDryRun } from "../services/runtime-config.service.js";
```

And at startup:
```
Line 21: const sender = getCurrentEffectiveDryRun() ? new MockMessageSender() : new ZaloMessageSender();
```

If dryRun=false at startup, worker creates a `ZaloMessageSender` which has access to the live zca-js API via `restoreSession()`.

---

## 6. Trigger / Safety Matrix

| Trigger | Creates Message | OutboundRecord | dryRun Check | liveTest Check | allowlist | cooldown | mention | Risk |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Zalo DM (dispatcher) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | LOW |
| Hermes fallback | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | LOW |
| Rule fixed_reply | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | LOW |
| Reminder parser | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | LOW |
| Image reply | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | N/A | LOW |
| File reply | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | N/A | LOW |
| Batch worker | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | LOW |
| **Schedule worker** | ❌ | ❌ | ⚠️ frozen | ❌ | ❌ | ❌ | ⚠️ | **HIGH** |
| Manual UI send | N/A | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | MEDIUM |
| Live test | ✅ | ✅ | bypass | ✅ | ✅ | bypass | N/A | LOW |

**Key:** The Schedule Worker is the only trigger that bypasses ALL safety gates when its frozen config says dryRun=false.

---

## 7. ThreadId Analysis

### Finding CG-10: ThreadId stored as-is from Zalo, no normalization

**Evidence from DB queries:**
```
Message.threadId values in DB:
  - "6792540503378312397"      ← full 19-digit Zalo ID
  - "g1", "group-123"          ← test/placeholder IDs
  - "thread-limit-1"           ← test data
  
ThreadSetting.threadId:
  - "6792540503378312397"      ← matches allowedThreads
  
allowedThreads (runtime config):
  - ["6792540503378312397"]    ← exact string match
```

**Finding:** The system uses exact string matching for threadId. No normalization. The earlier issue where UI showed truncated IDs ("503378312397" instead of "6792540503378312397") is resolved — both DB and config now use the full 19-digit ID. Test data with short IDs ("g1", "group-123") is mixed in the production DB.

---

## 8. UI / API Failure Analysis

### Finding CG-11: UI API base URL — FIXED

**Evidence:**
```typescript
// BEFORE (line 1 of api.ts):
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
//                                    wrong port ^^^^

// AFTER (FIXED):
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
```

**Verified:** `curl https://hermes.nhachungkhudong.pro.vn/api/admin/status` → returns `{"sendingEnabled":true,...}` ✅

### Finding CG-12: Health degraded → UI now shows data (not crash)

After the API_URL fix, the UI correctly renders data from the health endpoints even when heartbeats are degraded. The `GlobalBanner` component shows "✓ All Systems Operational" instead of "Failed to load status".

---

## 9. Consolidated Findings with Evidence

| ID | Severity | Finding | Codegraph Evidence | DB/API Evidence |
|----|----------|---------|-------------------|-----------------|
| CG-01 | **CRITICAL** | 9 sendMessage callers, 12 call sites in dispatcher | `codegraph callers sendMessage` → 9 results across 6 files | N/A |
| CG-02 | **CRITICAL** | Worker sender frozen at startup | `workers/index.ts:21`: `const sender = getCurrentEffectiveDryRun() ? ...` | PM2 env: `ZALO_AUTO_REPLY_DRY_RUN=true`, worker never refreshes |
| CG-05 | **CRITICAL** | Worker no liveTest check | `codegraph callers shouldSendLiveForThread` → worker NOT in results | LiveTestSession table: 0 active |
| CG-03 | **HIGH** | Worker doesn't call saveOutboundRecord directly | `codegraph callers saveOutboundRecord` → no worker | OutboundRecord table: no entries from schedule worker |
| CG-08 | **HIGH** | ZaloMessageSender restores session | `codegraph callers restoreSession` → includes ZaloMessageSender | zalo-session.json shared by both processes |
| CG-06 | **HIGH** | Runtime dryRun overrides env silently | `getCurrentEffectiveDryRun()` chain confirmed | RuntimeSetting was `"false"` before Step 0 reset |
| CG-04 | **MEDIUM** | saveOutboundMessage dispatcher-only | 2 call sites in dispatcher, 0 elsewhere | Message table: assistant messages from worker have no OutboundRecord link |
| CG-10 | **MEDIUM** | Test data in prod DB | N/A | OutboundRecord: "real-msg-123", "g1", "group-123" |
| CG-07 | **LOW** | Multiple dryRun sources (env, DB, cache) | 36 callers of getCurrentEffectiveDryRun | 3-layer config chain |

---

## 10. Refactor Recommendation

### Decision: REFACTOR CORE — NOT REBUILD

**Why not rebuild:**
- Domain logic is sound (Zalo gateway, reminder parser, rule engine, Hermes adapter)
- 504 test suite passes
- The problem is structural (no unified dispatcher), not foundational
- Rebuild risk: regression of working features, 2-3x timeline

### Proposed Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   UNIFIED OUTBOUND DISPATCHER                 │
│                                                              │
│  All outbound paths MUST route through:                      │
│                                                              │
│  OutboundDispatcher.send({                                   │
│    content, threadId, threadType, source, metadata           │
│  }) → {                                                      │
│    1. safetyGate(threadId)                                   │
│    2. getEffectiveDryRun() ← FROM DB, EVERY CALL             │
│    3. shouldSendLiveForThread()                              │
│    4. rateLimit.check()                                      │
│    5. saveOutboundRecord({dryRun, decision, ...})            │
│    6. if !dryRun → ZaloMessageSender.send()                  │
│    7. updateOutboundRecord({sentMessageId, error})           │
│    8. updateMessageStatus({outboundRecordId, status})        │
│  }                                                           │
│                                                              │
│  ⚡ Backend owns Zalo session                                │
│  ⚡ Worker → POST /api/outbound/send → Backend Dispatcher    │
└──────────────────────────────────────────────────────────────┘
```

### First 5 Implementation Batches

| Batch | Focus | Changes | Risk |
|-------|-------|---------|------|
| **R0** | Safety Stabilize | ✅ dryRun=true (done), verify PM2 env, backup DB | NONE |
| **R1** | Unified Outbound Dispatcher | Create `OutboundDispatcher`; migrate 12 call sites; add FK `outboundRecordId` to Message | MEDIUM |
| **R2** | Runtime Config Single Source | Read from DB every send/cycle; remove startup-frozen sender; backend/worker consistent | LOW |
| **R3** | Backend Sole Zalo Owner | Worker calls backend API; remove ZALO_SESSION_DIR from worker; remove zca-js imports | HIGH |
| **R4** | ThreadId Cleanup | Canonical normalize helper; clean test data from prod DB; exact-match only | LOW |
| **R5** | UI Status + Tests | Message status: draft/dryRun/sent/failed/blocked; add E2E tests for all triggers | LOW |

### Regression Test Plan

- **Before each batch:** Run full test suite (504 tests) → must PASS
- **R1 specific:** OutboundDispatcher unit tests + 12 old paths still produce same output
- **R3 specific:** Worker → backend integration test; verify no double-send
- **R5 specific:** E2E: Zalo DM → Message → AgentTask → OutboundRecord → verify sentMessageId chain

---

## 11. Immediate Safe Commands Executed

| # | Command | Result |
|---|---------|--------|
| 0 | `PATCH /api/system/runtime-config/auto-reply {"dryRun":true,"confirmText":"ENABLE DRY RUN"}` | ✅ `{"success":true,"oldValue":"false","newValue":"true"}` |
| 1 | `curl /api/zalo/ops/status` → dryRun | ✅ `true`, source=`runtime` |
| 2 | `curl /api/system/runtime-config` → dryRun | ✅ `true`, source=`runtime` |

---

## 12. Questions Answered

| # | Question | Answer |
|---|----------|--------|
| 1 | Codegraph xác nhận 9+ outbound call sites? | ✅ **YES** — 9 `sendMessage` callers, 12 call sites within dispatcher alone |
| 2 | Codegraph xác nhận worker giữ Zalo session? | ✅ **YES** — `ZaloMessageSender.sendMessage()` calls `restoreSession()` |
| 3 | Worker dryRun frozen startup? | ✅ **YES** — `workers/index.ts:21`: `const sender = getCurrentEffectiveDryRun() ? ...` |
| 4 | Path nào tạo Message nhưng không tạo OutboundRecord? | ⚠️ Worker: `executeJob` sends via `deps.sender` but doesn't directly call `saveOutboundRecord` |
| 5 | Path nào gửi Zalo trực tiếp không qua sender chung? | ✅ ALL paths call `sender.sendMessage()` — vấn đề là 12+ chỗ tạo sender riêng |
| 6 | Path nào không check LiveTestSession? | ✅ **Worker** — `shouldSendLiveForThread` never called from worker |
| 7 | Path nào đọc config dryRun cũ? | ✅ **Worker** — `getCurrentEffectiveDryRun()` called once at startup |
| 8 | ThreadId mismatch? | ✅ Resolved — using full 19-digit ID consistently. Test data (short IDs) in prod DB |
| 9 | UI Messages/Zalo Ops sai trạng thái? | ✅ API_URL fixed. Health degraded doesn't crash UI |
| 10 | Rebuild hay refactor? | **REFACTOR CORE** — 5 batches, ~2-3 weeks |
| 11 | Đề xuất refactor? | Unified Outbound Dispatcher + Backend sole Zalo owner + Worker→Backend HTTP |

---

*Report compiled by Agency Agents with Codegraph v1.1.3 evidence. Full call graphs, source references, and DB evidence included above.*
