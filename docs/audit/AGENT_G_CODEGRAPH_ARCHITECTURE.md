# Agent G — Codegraph / Architecture Audit Report

**Date**: 2026-07-01  
**Scope**: READ-ONLY — trace message flow end-to-end, find bypass paths  
**Repository**: `~/hermes-zalo-control`  
**Tool used**: Manual grep/search via `search_files` (no codegraph available)

---

## 1. End-to-End Message Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ INBOUND                                                              │
│                                                                      │
│ Zalo API                                                             │
│   │                                                                  │
│   ▼                                                                  │
│ zalo-gateway.service.ts  (listener: "message" event)                │
│   │ normalizeMessage() → saveIncomingMessage()                       │
│   │  ├─ anti-loop (isSelf)                                           │
│   │  ├─ dedup (in-memory + DB)                                       │
│   │  └─ DB: message, zaloThread, threadProfile                      │
│   ▼                                                                  │
│ handleIncomingMessage()  [incoming-dispatcher.service.ts]            │
│   │                                                                  │
│   ╔══ Gates (in order): ═══════════════════════════════════════════╗ │
│   ║  1. safetyCheck()                                               ║ │
│   ║     ├─ isSelf / isFromBot guard                                 ║ │
│   ║     ├─ autoReply.enabled                                        ║ │
│   ║     ├─ allowedThreads (config)                                  ║ │
│   ║     ├─ empty content check                                      ║ │
│   ║     └─ messageType filter (text/image/file only)                ║ │
│   ║  2. groupGateCheck()                                            ║ │
│   ║     ├─ autoReplyEnabled (thread setting)                        ║ │
│   ║     ├─ groupMentionRequired → mention check + reply window      ║ │
│   ║  3. Permission Gate (P1.1)                                      ║ │
│   ║     ├─ resolvePrincipal(senderId, threadId)                     ║ │
│   ║     ├─ isBlocked() → silent skip                                ║ │
│   ║     └─ Fail-safe: form_only default on error                    ║ │
│   ╚═════════════════════════════════════════════════════════════════╝ │
│   │                                                                  │
│   ├── Image pipeline → sendOutbound()  ✓                             │
│   ├── File ingestion  → sendOutbound()  ✓                             │
│   ├── Create-reminder → sendOutbound()  ✓                             │
│   ├── Rule engine     → sendOutbound()  ✓                             │
│   └── Hermes chat     → sendOutbound()  ✓                             │
│                                                                      │
┌─────────────────────────────────────────────────────────────────────┐
│ OUTBOUND                                                             │
│                                                                      │
│ sendOutbound()  [outbound-dispatcher.service.ts]                     │
│   │                                                                  │
│   ╔══ Gates (in order): ═══════════════════════════════════════════╗ │
│   ║  1. Thread autoReplyEnabled check                              ║ │
│   ║  2. PROMPT ECHO GUARD (text only)                              ║ │
│   ║  3. Cooldown (acquireCooldown) — DB-backed atomic              ║ │
│   ║  4. DryRun decision (getCurrentEffectiveDryRun)                 ║ │
│   ║  5. LiveTest override (shouldSendLiveForThread)                 ║ │
│   ║  6. Create AssistantMessage (text only)                        ║ │
│   ║  7. Create OutboundRecord                                       ║ │
│   ╚═════════════════════════════════════════════════════════════════╝ │
│   │                                                                  │
│   If dryRun → return fake messageId                                  │
│   If live   → ZaloMessageSender.send*()                              │
│               └─ Internal gates: dryRun, group outbound gate,       │
│                  sanitize, dedup, split, rate-limit, connection      │
│   │                                                                  │
│   → Update Message status → Cooldown → Heartbeat                     │
│                                                                      │
┌─────────────────────────────────────────────────────────────────────┐
│ WORKER PATH                                                          │
│                                                                      │
│ Worker (scheduler.ts)                                                │
│   │ executeJob()                                                     │
│   │  ├─ Version guard, Status guard, Emergency stop, Schedules active│
│   │  ├─ AI dryRun guard (R13)                                       │
│   │  ├─ Group outbound gate                                          │
│   │  └─ sendOutboundViaBackend()                                     │
│   │        └─→ POST /api/internal/outbound/send                      │
│   │             └─→ sendOutbound()  ✓                                │
│   │                                                                  │
│ Message Batch Worker (message-batch-worker.ts)                       │
│   └─→ POST /api/internal/messages/handle-batch                      │
│        └─→ handleIncomingMessage()  ✓                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Critical Paths Found

### Path A: Zalo message → Hermes auto-reply (primary)
```
zalo-gateway.listener → handleIncomingMessage → Hermes chat → sendOutbound → ZaloMessageSender.sendMessage → Zalo API
```
✅ Fully guarded. Passes all gates.

### Path B: Rule engine fixed_reply
```
zalo-gateway.listener → handleIncomingMessage → rule-engine → sendOutbound → Zalo
```
✅ Fully guarded. Uses sendOutbound.

### Path C: Worker scheduled job
```
Worker poll → executeJob → sendOutboundViaBackend → POST /internal/outbound/send → sendOutbound → Zalo
```
✅ Fully guarded. Worker has own guards + goes through sendOutbound.

### Path D: Manual send via admin API
```
POST /api/zalo/send-test → sendOutbound → Zalo
POST /api/zalo/send-media → sendOutbound → Zalo
POST /api/zalo/send-voice → sendOutbound → Zalo
```
✅ Fully guarded. Admin auth required + goes through sendOutbound.

### Path E: Internal batch processing
```
batch-worker → POST /internal/messages/handle-batch → handleIncomingMessage → sendOutbound
```
✅ Guarded. Goes through full incoming dispatch pipeline.

---

## 3. Bypass Risks Found

### 🔴 CRITICAL — `attendance.service.ts:113` direct `sender.sendMessage()` bypass

**File**: `packages/backend/src/services/attendance.service.ts`  
**Line 113**: `const result = await sender.sendMessage(content, session.targetId, "group");`

**Route**: `POST /api/attendance/sessions/:id/send-reminder`  
**Injection point**: `routes/attendance.ts:87` passes `mockSender` (MockMessageSender)

**Risk**: 
- Currently safe because `mockSender` is a MockMessageSender (no real send).
- **BUT**: if anyone changes `mockSender` to `ZaloMessageSender`, ALL outbound guards are bypassed:
  - ❌ No `sendOutbound()` → no prompt echo guard
  - ❌ No `sendOutbound()` → no cooldown check
  - ❌ No `sendOutbound()` → no dryRun check
  - ❌ No `sendOutbound()` → no liveTest override
  - ❌ No `sendOutbound()` → no OutboundRecord audit
  - ❌ No `sendOutbound()` → no AssistantMessage tracking
  - ❌ Uses `config.autoReply.dryRun` (bypasses runtime-configured dryRun)

**Vulnerability window**: The architecture allows this injection point. A simple code change (or a new route using the same pattern) could silently send to Zalo without any guard.

### 🟡 MODERATE — `zalo-reaction.service.ts:129` uses env dryRun, not runtime

**File**: `packages/backend/src/services/zalo-reaction.service.ts`  
**Line 129**: `const dryRun = config.autoReply.dryRun;`

**Risk**: 
- Reactions check `config.autoReply.dryRun` (env-based) instead of `getCurrentEffectiveDryRun()` (runtime-aware).
- If admin toggles dryRun via runtime API, reactions ignore it.
- **Also**: `zalo-reaction.service.ts:168-190` calls `api.addReaction()` directly — bypasses outbound-dispatcher entirely.
- No OutboundRecord for reactions (console-only audit).

### 🟡 MODERATE — `zalo-poll.service.ts:26` no dryRun check

**File**: `packages/backend/src/services/zalo-poll.service.ts`  
**Route**: `POST /api/zalo/create-poll`

**Risk**:
- Creates polls directly via `api.createPoll()` with NO dryRun check.
- If admin accesses this route (it has adminAuth), polls go live even in dryRun mode.
- No audit record for poll creation.

### 🟡 MODERATE — ZaloGateway dryRun scope mismatch

**File**: `packages/backend/src/services/zalo-gateway.service.ts`
- Line 175: `config.zalo.dryRun` (for login)
- Line 304: `config.zalo.dryRun` (for session restore)
- Line 404: `config.zalo.dryRun` (for saveCredentials)

**Risk**: Uses `config.zalo.dryRun` which is separate from `config.autoReply.dryRun`. Two different dryRun flags controlling different parts of the system — confusion risk.

### 🟢 LOW — Prompt echo guard text-only

**File**: `packages/backend/src/services/outbound-dispatcher.service.ts:195`  
```typescript
if (kind === "text" || !kind) {
    const echoBlock = checkPromptEcho(t.content);
```

**Risk**: Media and voice outbounds skip the prompt echo check. This is architecturally correct (media files can't contain prompt markers), but if a future media type carries text (e.g., captions), it would bypass.

### 🟢 LOW — Batch processing clears cooldown

**File**: `packages/backend/src/services/incoming-dispatcher.service.ts:702`  
```typescript
clearCooldown(threadId).catch(() => {});
```

**Risk**: Before processing a batch, the cooldown is cleared, allowing the batch reply to be sent immediately even if the thread was in cooldown. This is intentional to prevent the batch from being blocked, but could allow rapid-fire messages if abused.

### 🔵 INFO — `handleIncomingMessage` from internal route has weaker sender data

**File**: `packages/backend/src/routes/internal.ts:178-198`  
**Endpoint**: `POST /api/internal/messages/handle-batch`

**Risk**: Synthetic NormalizedMessage has empty `senderId` and no `mentions`. This means:
- Permission check (resolvePrincipal) receives empty senderId → likely resolves to default role
- Group mention check won't trigger (synthetic message has no mentions)
- This is by design for batch processing, but worth noting

---

## 4. Missing Guards

### 4.1 No permission check in outbound-dispatcher
- Permission is ONLY checked in `incoming-dispatcher.service.ts` (P1.1 gate).
- `sendOutbound()` does NOT enforce permission.
- Any code path that calls `sendOutbound()` directly (without going through `handleIncomingMessage`) bypasses permission checks.
- All current paths go through `handleIncomingMessage` FIRST, so this is mitigated.

### 4.2 No OutboundRecord for voice in the live path of ZaloMessageSender
- `ZaloMessageSender.sendVoice()` calls `saveOutboundRecord()` for dryRun and block cases, but the live send path at line 298-302 uses a different content string `"[voice sent]"` than the other paths.

### 4.3 Poll creation has no audit trail
- `zalo-poll.service.ts` creates polls with no OutboundRecord, no dryRun check, and no audit log.

### 4.4 No runtime dryRun check in zalo-reaction
- Uses `config.autoReply.dryRun` (env) instead of `getCurrentEffectiveDryRun()`.

---

## 5. Guard Coverage Matrix

| Path | autoReply enabled | allowed Threads | Permission | Prompt Echo | Cooldown | dryRun (runtime) | liveTest | Outbound Record |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Zalo → Hermes auto-reply | ✓ | ✓ | ✓ | ✓ (text) | ✓ | ✓ | ✓ | ✓ |
| Rule engine fixed_reply | ✓ | ✓ | ✓ | ✓ (text) | ✓ | ✓ | ✓ | ✓ |
| Image understanding | ✓ | ✓ | ✓ | ✓ (text) | ✓ | ✓ | ✓ | ✓ |
| File ingestion | ✓ | ✓ | ✓ | ✓ (text) | ✓ | ✓ | ✓ | ✓ |
| Create-reminder | ✓ | ✓ | ✓ | ✓ (text) | ✓ | ✓ | ✓ | ✓ |
| Worker scheduled job | — | — | — | ✓ (text) | ✓ | ✓ | ✓ | ✓ |
| Manual send-test/media/voice | — (admin) | — (admin) | — | ✓ (text) | ✓ | ✓ | ✓ | ✓ |
| **Attendance sendReminder** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (env) | ❌ | ❌ |
| **Zalo auto-react** | ✓ | ✓ | ❌* | N/A | ✓ (own) | ❌ (env) | ❌ | ❌ |
| **Zalo create-poll** | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ | ❌ |

\* Permission checked at reaction gate level but not via principal.service

---

## 6. DryRun Configuration Landscape

| Component | dryRun source | Function used |
|-----------|--------------|---------------|
| `incoming-dispatcher` | autoReply | `getCurrentEffectiveDryRun()` ✓ |
| `outbound-dispatcher` | autoReply | `getCurrentEffectiveDryRun()` ✓ |
| `zalo-message-sender` | autoReply | `getCurrentEffectiveDryRun()` ✓ |
| `worker/scheduler` | autoReply | `getCurrentEffectiveDryRun()` ✓ |
| `zalo-reaction` | autoReply | `config.autoReply.dryRun` ❌ |
| `zalo-gateway (login)` | zalo | `config.zalo.dryRun` |
| `zalo-gateway (session)` | zalo | `config.zalo.dryRun` |
| `attendance.sendReminder` | autoReply | `config.autoReply.dryRun` ❌ |
| `zalo-poll` | NONE | ❌ |

---

## 7. Recommendations

### Immediate (fix the CRITICAL bypass vector)

1. **R1: Route attendance sendReminder through sendOutbound()**  
   Replace `sender.sendMessage()` in `attendance.service.ts:113` with `sendOutbound()`. Remove the `MessageSender` dependency injection from the attendance route.  
   *Status: Currently safe (MockMessageSender). Risk is future code changes introducing ZaloMessageSender.*

2. **R2: Add dryRun check to zalo-poll.service.ts**  
   Add `getCurrentEffectiveDryRun()` check before calling `api.createPoll()`. When dryRun=true, return a fake poll ID instead of calling the real API.

3. **R3: Fix zalo-reaction dryRun to use runtime config**  
   Replace `config.autoReply.dryRun` on line 129 of `zalo-reaction.service.ts` with `getCurrentEffectiveDryRun()`. Add OutboundRecord for auto-reactions.

### Short-term (hardening)

4. **R4: Add permission check to sendOutbound()**  
   Currently permission is ONLY checked in incoming dispatcher. Consider adding `checkPermission()` guard inside `sendOutbound()` as defense-in-depth. At minimum, document that `sendOutbound()` callers must pre-verify permission.

5. **R5: Unify dryRun configuration**  
   Consolidate `config.zalo.dryRun` and `config.autoReply.dryRun` into a single source of truth, or clearly document when each applies. The current split creates confusion.

6. **R6: Add OutboundRecord to all Zalo outbound paths**  
   Auto-reactions and poll creation currently have no audit trail in the DB. Add OutboundRecord creation for these paths.

### Long-term (architecture)

7. **R7: Enforce sendOutbound as the ONLY Zalo send path**  
   Make `ZaloMessageSender` private/internal — not importable outside the outbound-dispatcher. Use dependency injection or a factory pattern to prevent direct instantiation.

8. **R8: Add compile-time enforcement**  
   Consider using TypeScript `@deprecated` or ESLint rules to flag direct `ZaloMessageSender` usage outside `outbound-dispatcher.service.ts`.

---

## 8. Conclusion

The core architecture is **sound** — the `IncomingDispatcher → sendOutbound()` pipeline is the primary message flow and applies all guards correctly. The worker path correctly routes through the internal API to `sendOutbound()`.

**Three bypass vectors exist**:
1. **Attendance sendReminder** — injectable MessageSender can be swapped to real sender (CRITICAL but currently safe)
2. **Zalo auto-react** — uses env dryRun instead of runtime dryRun (MODERATE)
3. **Zalo create-poll** — no dryRun check at all (MODERATE)

No code path currently sends to Zalo without going through `sendOutbound()` in production, but the attendance architecture leaves a dangerous injection point open.

**Overall risk**: MEDIUM — no active bypass in production, but several architectural weaknesses that could become critical with minor code changes.
