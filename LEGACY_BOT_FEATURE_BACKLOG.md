# LEGACY BOT FEATURE BACKLOG

> **Created:** 2026-06-25  
> **Source:** Bot 1 cũ (openzca/openzalo, UID 621835795753666607)  
> **Target:** Hermes Zalo Admin Center (zca-js, monorepo)  
> **Strategy:** Admin Center primary — Bot 1 cũ retired, migrate features not revive

---

## Tổng Quan Bot 1 Cũ

| Thuộc tính | Giá trị |
|------------|---------|
| **Framework** | OpenClaw + openzca (Node.js) |
| **UID Zalo** | 621835795753666607 |
| **Cùng UID với** | ✅ Admin Center (xung đột) |
| **Trạng thái** | ⛔ Offline (session bị Admin Center chiếm) |
| **Tổng chức năng** | 52 |
| **Đang chạy được** | 0 (không có Zalo session) |
| **Code còn** | ✅ Có (local backup) |
| **Dùng lại code** | ❌ KHÔNG — phải review security/license trước |

---

## Nút Thắt Session UID

```
┌─────────────────────────────────────────────────┐
│           Zalo Server (1 session/UID)            │
│                                                   │
│  ┌──────────────────────┐  ┌──────────────────┐ │
│  │ Bot 1 cũ (openzca)   │  │ Admin Center     │ │
│  │ • Session expired    │  │ • Active session │ │
│  │ • Không login được   │  │ • Listener ON    │ │
│  │ • Code vẫn còn       │  │ • zca-js         │ │
│  └──────────────────────┘  └──────────────────┘ │
│          ⛔ OFFLINE              ✅ PRIMARY       │
└─────────────────────────────────────────────────┘
```

**Quyết định:** Admin Center là chính. Bot 1 không được revive cùng UID.  
Nếu cần song song → phải dùng **UID Zalo khác**.

---

## Bảng 52 Chức Năng — Feature Mapping

**Legend:** ✅=Có sẵn | 🟡=Có một phần | ❌=Chưa có | ⬚=Không áp dụng | 🔒=Code cũ chưa review

### A. Zalo Session & Connection (7 features)

| # | Feature | Bot cũ code | Bot cũ chạy | Admin Center | Migrate? | Priority | Risk |
|---|---------|:-----------:|:-----------:|:------------:|:--------:|:--------:|:----:|
| 1 | QR Login | ✅ | ❌ | ✅ | ✅ Done | — | — |
| 2 | Session save/restore | ✅ | ❌ | ✅ | ✅ Done | — | — |
| 3 | Auto-reconnect (exponential backoff) | ✅ | ❌ | ✅ | ✅ Done | — | — |
| 4 | Cookie encryption (SecretsService) | ✅ | ❌ | 🟡 Stub | ✅ | P0 | Low |
| 5 | Session ownership lock | ✅ | ❌ | ❌ | ✅ | P0 | Low |
| 6 | Multi-profile (multiple UID) | ✅ | ❌ | ❌ | ⬚ | P2 | Med |
| 7 | Session health check (heartbeat) | ✅ | ❌ | ❌ | ✅ | P1 | Low |

### B. Message Receive & Processing (10 features)

| # | Feature | Bot cũ code | Bot cũ chạy | Admin Center | Migrate? | Priority | Risk |
|---|---------|:-----------:|:-----------:|:------------:|:--------:|:--------:|:----:|
| 8 | Message listener (WebSocket) | ✅ | ❌ | ✅ | ✅ Done | — | — |
| 9 | Message normalize & save to DB | ✅ | ❌ | ✅ subscribers.ts | ✅ Done | — | — |
| 10 | Anti-loop guard (isSelf) | ✅ | ❌ | ✅ subscribers.ts:24 | ✅ Done | — | — |
| 11 | Inbound dedup (message ID) | ✅ | ❌ | ✅ deduplication.ts | ✅ Done | — | — |
| 12 | Thread auto-create/upsert | ✅ | ❌ | ✅ subscribers.ts:43 | ✅ Done | — | — |
| 13 | System message filter (skip admin/event) | ✅ | ❌ | ❌ | ✅ | P1 | Low |
| 14 | Message type detection (text/image/sticker) | ✅ | ❌ | 🟡 text only | ✅ | P1 | Low |
| 15 | Emoji-only message gate | ❌ | — | ❌ | ✅ | P1 | Low |
| 16 | Unicode content sanitizer | ✅ | ❌ | ❌ | ✅ | P1 | Low |
| 17 | Quote/reply extraction | ✅ | ❌ | ❌ | ✅ | P1 | Med |

### C. Auto-Reply / AI Pipeline (10 features)

| # | Feature | Bot cũ code | Bot cũ chạy | Admin Center | Migrate? | Priority | Risk |
|---|---------|:-----------:|:-----------:|:------------:|:--------:|:--------:|:----:|
| 18 | Auto-reply toggle (master switch) | ✅ | ❌ | ✅ auto-reply.service.ts | ✅ Done | — | — |
| 19 | Per-thread enable (allowlist) | ✅ | ❌ | ✅ whitelistJson | ✅ Done | — | — |
| 20 | Cooldown per-thread | ✅ | ❌ | ✅ lastAutoReplyAt | ✅ Done | — | — |
| 21 | Dry-run mode | ✅ | ❌ | ❌ (env var only) | ✅ | P0 | Low |
| 22 | AI reply via Hermes/Claude | ✅ | ❌ | ✅ AgentBridge CLI | ✅ Done | — | — |
| 23 | Confidence gate (skip low confidence) | ✅ | ❌ | ❌ | ✅ | P1 | Low |
| 24 | Empty/truncated reply guard | ✅ | ❌ | ❌ | ✅ | P1 | Low |
| 25 | Prompt builder with safety prefix | ✅ | ❌ | 🟡 AgentBridge prompt | 🔒 | P0 | Low |
| 26 | Thread-scoped context (recent messages) | ✅ | ❌ | ❌ | ✅ | P0 | Med |
| 27 | AgentTask audit (create/complete/fail) | ✅ | ❌ | ❌ | ✅ | P0 | Low |

### D. Outbound / Send Pipeline (8 features)

| # | Feature | Bot cũ code | Bot cũ chạy | Admin Center | Migrate? | Priority | Risk |
|---|---------|:-----------:|:-----------:|:------------:|:--------:|:--------:|:----:|
| 28 | Message sender (Zalo API) | ✅ | ❌ | ✅ outboxService | ✅ Done | — | — |
| 29 | Send confirmation (sentMessageId) | ✅ | ❌ | ❌ | ✅ | P1 | Low |
| 30 | Outbound dedup (same content, 5-60s) | ✅ | ❌ | ❌ | ✅ | P1 | Low |
| 31 | Split-send (>1800 chars) | ✅ | ❌ | ❌ | ✅ | P1 | Low |
| 32 | Rich text formatting (emoji, bold) | ✅ | ❌ | ❌ | ✅ | P1 | Low |
| 33 | Sent-context memory (save after send) | ✅ | ❌ | 🟡 message:sent event only | ✅ | P1 | Low |
| 34 | Outbound audit log (JSONL every decision) | ✅ | ❌ | ❌ | ✅ | P1 | Low |
| 35 | Rate limit per-user/per-thread | ✅ | ❌ | ❌ | ✅ | P2 | Low |

### E. Group Chat Handling (5 features)

| # | Feature | Bot cũ code | Bot cũ chạy | Admin Center | Migrate? | Priority | Risk |
|---|---------|:-----------:|:-----------:|:------------:|:--------:|:--------:|:----:|
| 36 | Group mention gate (@mentioned only) | ✅ | ❌ | ❌ | ✅ | P1 | Med |
| 37 | Group outbound gate (TTL 600s) | ✅ | ❌ | ❌ | ✅ | P1 | Med |
| 38 | Group system message block | ✅ | ❌ | ❌ | ✅ | P1 | Low |
| 39 | Group thread create vs DM routing | ✅ | ❌ | ✅ threadType | ✅ Done | — | — |
| 40 | Group member list/role | ✅ | ❌ | ❌ | ⬚ | P2 | Low |

### F. Scheduled / Cron Messages (4 features)

| # | Feature | Bot cũ code | Bot cũ chạy | Admin Center | Migrate? | Priority | Risk |
|---|---------|:-----------:|:-----------:|:------------:|:--------:|:--------:|:----:|
| 41 | Schedule message (one-time) | ✅ | ❌ | ✅ scheduler.service.ts | ✅ Done | — | — |
| 42 | Cron repeat (daily/weekly) | ✅ | ❌ | ✅ repeatCron | ✅ Done | — | — |
| 43 | Stuck job recovery (active→queued) | ✅ | ❌ | ❌ | ✅ | P0 | Med |
| 44 | Reminder silence pattern (honest fail) | ✅ | ❌ | ❌ | ✅ | P1 | Low |

### G. Hermes Integration & Context (4 features)

| # | Feature | Bot cũ code | Bot cũ chạy | Admin Center | Migrate? | Priority | Risk |
|---|---------|:-----------:|:-----------:|:------------:|:--------:|:--------:|:----:|
| 45 | Real-time Hermes live chat | ✅ | ❌ | ✅ AgentBridge CLI | ✅ Done | — | — |
| 46 | Prompt guard (no system claims) | ❌ | — | ❌ | ✅ | P0 | Med |
| 47 | Schedule-aware reply (query DB) | ❌ | — | ❌ | ✅ | P0 | Med |
| 48 | User/thread block list | ✅ | ❌ | 🟡 blacklistJson | ✅ | P2 | Low |

### H. Platform & Extras (4 features)

| # | Feature | Bot cũ code | Bot cũ chạy | Admin Center | Migrate? | Priority | Risk |
|---|---------|:-----------:|:-----------:|:------------:|:--------:|:--------:|:----:|
| 49 | Telegram fallback (cross-platform) | ✅ | ❌ | ❌ | ✅ | P2 | High |
| 50 | Voice message / TTS | ✅ | ❌ | ❌ | ✅ | P2 | Med |
| 51 | Vision / OCR (image understanding) | ✅ | ❌ | ❌ | ✅ | P2 | Med |
| 52 | Reaction detection (emoji on bot msg) | ✅ | ❌ | ❌ | ✅ | P2 | Med |

---

## Priority Breakdown

### Priority 0 — Fix Ngay Trước Demo (7 items)

| # | Gap | File | Status | Effort |
|---|-----|------|--------|--------|
| **P0.1** | Session ownership lock | NEW | ❌ Missing | 2h |
| **P0.2** | DB persistence guard | NEW | ❌ Missing | 1h |
| **P0.3** | API auth on all endpoints | `routes/zalo.ts:65`, `routes/agent-bridge.ts` | 🟡 Partial | 2h |
| **P0.4** | Backup secrets cleanup | `.env.backup.*`, `backup-*/` | ❌ Leaking | 1h |
| **P0.5** | Dry-run toggle (DB + API) | `auto-reply.service.ts` | 🟡 Env var only | 2h |
| **P0.6** | Prompt guard (no system claims) | NEW | ❌ Missing | 2h |
| **P0.7** | AgentTask audit service | NEW | ❌ Missing | 4h |

**P0.1 — Session Ownership Lock**
```typescript
// Goal: Prevent multiple processes from using same UID
// When Admin Center holds session → write lock file
// On startup → check lock file → refuse if owned by other process
// Status API: { owner: "admin-center", uid: "...", listener: "started", lastRestoreAt: "..." }
```

**P0.2 — DB Persistence Guard**
```typescript
// Goal: Prevent silent DB reset
// 1. Auto-backup before any prisma db push / migration
// 2. Startup check: if schema exists but 0 threads/messages/tasks → WARNING
// 3. Document restore procedure
```

**P0.3 — API Auth**
```
No auth endpoints found:
  GET  /api/zalo/status (line 65 — NO preHandler)
  GET  /api/agent/auto-reply/status (route may not exist yet)
  
Must add requirePermission() to ALL admin endpoints.
Do NOT bypass auth for demo.
```

**P0.6 — Prompt Guard**
```
Add to AgentBridge prompt builder:
  "Bạn KHÔNG được bịa rằng hệ thống đã đặt lịch, đã gửi nhắc nhở,
   bị lỗi gửi tin, hay đã thực hiện tác vụ nếu không có dữ liệu thật.
   Nếu user hỏi về lịch/nhắc nhở, hãy nói cần kiểm tra hệ thống."
```

**P0.7 — AgentTask Audit**
```typescript
// Create AgentTask for every auto-reply attempt:
interface AgentTask {
  id: string;
  taskType: 'zalo_auto_reply' | 'scheduled_send';
  threadId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  result?: {
    dryRun: boolean;
    skipped: boolean;
    reason?: 'cooldown' | 'thread_not_allowed' | 'empty_content' | 'non_text' | 'unsupported_system_claim';
    reply?: string;
    sentMessageId?: string;
    confidence?: number;
    needsReview?: boolean;
  };
  createdAt: Date;
  completedAt?: Date;
}
```

### Priority 1 — Migrate Sau P0 (12 items)

| # | Feature | Code Source | Dependencies |
|---|---------|-------------|--------------|
| **P1.1** | Group mention gate | Bot 1 cũ 🔒 | Group enable first |
| **P1.2** | Group outbound gate (TTL 600s) | Bot 1 cũ 🔒 | Mention gate |
| **P1.3** | Outbound dedup (MD5 content+thread, 60s) | Bot 1 cũ 🔒 | None |
| **P1.4** | Sent-context memory (save + retrieve) | Bot 1 cũ 🔒 | AgentTask audit |
| **P1.5** | Outbound audit log (JSONL) | Bot 1 cũ 🔒 | AgentTask audit |
| **P1.6** | System message filter | Bot 1 cũ 🔒 | None |
| **P1.7** | Split-send (>1800 chars) | Bot 1 cũ 🔒 | None |
| **P1.8** | Unicode text sanitizer | Bot 1 cũ 🔒 | None |
| **P1.9** | Rich message formatting (emoji detect) | Bot 1 cũ 🔒 | Split-send |
| **P1.10** | Quote handling (extract + prompt) | NEW | subscribers.ts |
| **P1.11** | Reminder silence pattern | Bot 1 cũ 🔒 | Scheduler |
| **P1.12** | Session health heartbeat | Bot 1 cũ 🔒 | None |

### Priority 2 — After Pilot (10 items)

| # | Feature | Notes |
|---|---------|-------|
| **P2.1** | Telegram fallback | Cross-platform, messaging provider interface ready |
| **P2.2** | Voice message / TTS | Hermes TTS already available |
| **P2.3** | Vision / OCR | Image understanding in Zalo |
| **P2.4** | Image generation | Flux via ChiaseGPU |
| **P2.5** | Reaction detection | Zalo emoji on bot messages |
| **P2.6** | Message recall/undo | Zalo API support |
| **P2.7** | Cron watchdog | Health monitoring |
| **P2.8** | Follow-up reminders | Stateful reminders |
| **P2.9** | Rate limit per-user | Per-user throttle |
| **P2.10** | Multi-profile (multi UID) | Multiple Zalo accounts |

---

## Context Bug Fix Plan — Hermes Reply Sai Ngữ Cảnh

**Vấn đề:** Bot trả lời sai ngữ cảnh, bịa trạng thái hệ thống.

**Root causes identified:**

### 1. Thread-Scoped Context (P0)

```
Current: AgentBridge sends single message to Hermes
Fix:     Query last 5-10 messages for threadId from DB
         Pass as "recentMessages" in AgentBridge payload
         Hermes prompt: context + current message = better reply
```

**File:** `subscribers.ts:111` (agentBridgeService.sendMessageToAgent)  
**Action:** Add `getRecentMessages(threadId, limit=10)` call before AgentBridge

### 2. Prompt Guard — No Unsupported System Claims (P0)

```
Current: Prompt lacks instruction to prevent fabricated system claims
Fix:     Add explicit guard to AgentBridge prompt
         "Bạn không được bịa rằng đã gửi nhắc nhở, đã đặt lịch,
          bị lỗi gửi tin, hay đã thực hiện tác vụ hệ thống
          nếu không có dữ liệu xác nhận."
```

**File:** `agent-bridge.service.ts` — `buildPrompt()` method

### 3. Schedule/Execution-Aware Reply (P0)

```
Current: When user asks "đã nhắc chưa?", Hermes has no schedule data
Fix:     Before AgentBridge call, query:
         - schedules for this threadId
         - recent executions
         - sentMessageId
         Inject as context: "Lịch sử lịch nhắc: ..."
         If no data → tell user honestly "cần kiểm tra"
```

**File:** `subscribers.ts:111` — `sendMessageToAgent()`  
**Action:** Query DB for schedule data, inject into AgentBridge payload

### 4. Quote Handling (P1)

```
Current: If Zalo message has quote, it's mixed with current content
Fix:     Extract quote content separately in normalizeMessage
         Prompt format:
           "Tin nhắn hiện tại: {content}
            Tin nhắn được quote: {quoteContent}"
         Only if quote exists
```

**File:** `services/messaging/zalo.service.ts` — `normalizeMessage()`  
**Schema:** Add `quotedContent?: string` to IncomingMessage type

### 5. Unsupported System Claim Guard (P1)

```
Current: No check if Hermes reply contains fabricated system claims
Fix:     Post-reply check:
         Keywords: "đã gửi", "đã đặt lịch", "bị lỗi gửi", "đã nhắc"
         If keywords found AND no matching DB evidence:
           - Do NOT send to Zalo
           - Mark AgentTask needsReview=true
           - reason="unsupported_system_claim"
           - Log warning
```

**File:** `subscribers.ts` — after AgentBridge returns, before outbox  
**Action:** Add `validateReplyClaims()` function

---

## Implementation Strategy

### Phase 1: P0 Fixes + Context Bugs (Week 1)

```
Day 1-2:
  ├── P0.7 AgentTask audit service (foundation)
  ├── P0.5 Dry-run toggle (DB + API)
  └── P0.6 Prompt guard

Day 3-4:
  ├── P0.1 Session ownership lock
  ├── P0.2 DB persistence guard
  ├── P0.3 API auth on all endpoints
  └── P0.4 Backup secrets cleanup

Day 5:
  ├── Context fix #1: Thread-scoped history
  ├── Context fix #2: Prompt guard (enhanced)
  ├── Context fix #3: Schedule-aware reply
  └── Context fix #5: System claim guard
```

### Phase 2: P1 Migrations (Week 2-3)

```
  ├── P1.6 System message filter (simple, standalone)
  ├── P1.3 Outbound dedup (simple, standalone)
  ├── P1.1 + P1.2 Group mention + outbound gate
  ├── P1.4 Sent-context memory
  ├── P1.5 Outbound audit log
  ├── P1.7 + P1.8 + P1.9 Split-send + sanitizer + formatting
  ├── P1.10 Quote handling
  ├── P1.11 Reminder silence pattern
  └── P1.12 Session health heartbeat
```

### Phase 3: P2 Advanced (After Pilot Stable)

```
  ├── P2.9 Rate limit per-user
  ├── P2.8 Follow-up reminders
  ├── P2.7 Cron watchdog
  ├── P2.2 Voice/TTS
  ├── P2.3 Vision/OCR
  ├── P2.4 Image generation
  ├── P2.5 Reaction detection
  ├── P2.6 Message recall
  ├── P2.1 Telegram fallback
  └── P2.10 Multi-profile
```

---

## Production Recommendation

### Current State: Ready for SINGLE-THREAD Pilot

✅ Zalo connected, auto-restore works  
✅ Message receive + save + dedup  
✅ Auto-reply with allowlist + cooldown  
✅ AgentBridge to Hermes CLI  
✅ Outbox + Zalo send  
✅ Web UI via Cloudflare Tunnel  
✅ Backend + Worker stable  

### Before Multi-Thread Production:

1. **Complete ALL P0 fixes** (especially API auth + DB guard)
2. **Fix ALL context bugs** (thread-scoped history + prompt guard)
3. **Add AgentTask audit** (for debugging + compliance)
4. **Deploy rate limit** (per-user, to prevent spam)
5. **Add monitoring** (cron watchdog, session health)

### Safety Rules (NEVER VIOLATE):

- 🔒 Không copy code Bot 1 cũ trực tiếp (chưa review security)
- 🔒 Không bỏ allowlist để test
- 🔒 Không gửi group thật khi chưa có group gate
- 🔒 Không dùng chung UID cho 2 system
- 🔒 Không bỏ auth để demo
- 🔒 Không quét QR nếu session đang active
- 🔒 Không xóa session file

---

## Owner Decision Required

| Question | Recommendation |
|----------|---------------|
| **Keep Admin Center primary?** | ✅ YES — bắt buộc |
| **Use separate Zalo account for Bot 1?** | ⬚ Nếu cần song song, dùng UID khác |
| **When to enable group auto-reply?** | ⬚ Sau khi có P1.1 + P1.2 (group gates) |
| **Enable live reply for all allowed threads?** | ⬚ Chỉ sau P0 fixes complete |
| **Migrate which P2 features first?** | ⬚ Owner decides based on demand |

---

## Appendix: Bot 1 Source Code Reference

**Location:** `~/openclaw-bots/bot-zalo-1/` (backup)  
**Status:** 🔒 Code preserved, KHÔNG chạy, KHÔNG copy trực tiếp  
**Review needed:** Security audit (API keys, secrets, license) before any reuse  

---

*Document maintained in `~/zalo-admin-center/LEGACY_BOT_FEATURE_BACKLOG.md`*
