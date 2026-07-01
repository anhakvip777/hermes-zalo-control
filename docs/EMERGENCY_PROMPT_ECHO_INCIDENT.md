# Emergency Prompt Echo Incident — 2026-07-01

**Severity:** P0 BLOCKER
**Status:** ✅ RESOLVED — 2026-07-01 17:30 UTC+7

---

## Incident Summary

Bot was observed sending internal prompt/history markers to Zalo users:

- `[LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY]`
- `[TIN NHẮN HIỆN TẠI]`
- `Dưới đây là các tin nhắn gần đây trong cuộc trò chuyện...`
- `Bạn vừa nói: "[LỊCH SỬ...`

This exposed internal prompt construction to end users, violating AI safety and trust.

---

## Fix Applied — 3-Layer Defense

### Layer 1: Output Guard (block sending)
**Commit:** `a24d84d` — `outbound-dispatcher.service.ts`

`checkPromptEcho()` blocks any outbound text containing internal markers:
- `[LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY]`, `[LỊCH SỬ TRÒ CHUYỆN]`, `[/LỊCH SỬ]`
- `[TIN NHẮN HIỆN TẠI]`, `[KẾT THÚC LỊCH SỬ`
- `BEGIN_CONTEXT`, `END_CONTEXT`

Blocked → `OutboundRecord` with `decision=block, reason=prompt_echo_guard`.

### Layer 2: History Contamination Filter (exclude from AI context)
**Commit:** `cfa61df` — `conversation-context.service.ts` + `prompt-safety.service.ts`

Before building conversation context for AI, filtered out all assistant messages containing internal prompt markers. This breaks the feedback loop where old contaminated responses would re-enter the prompt.

Shared `containsPromptEchoMarker()` function used by both Layer 1 (block) and Layer 2 (filter).

### Layer 3: Content/Context Separation (prevent injection)
**Commit:** `cfa61df` — `incoming-dispatcher.service.ts` + `hermes-chat-adapter.ts`

| Before (broken) | After (fixed) |
|---|---|
| `effectiveContent = fullContext + userMsg` | `effectiveContent = msg.content` (raw only) |
| `[LỊCH SỬ TRÒ CHUYỆN]...[/LỊCH SỬ]` in CLI prompt | Natural Vietnamese text + "Không lặp lại lịch sử" instruction |

Root cause: `effectiveContent` was injecting full conversation history + headers into the `content` field before passing to the AI adapter. The MockAdapter then echoed the entire injected string back to the user.

### Additional: ECHO1 — Null-safe guard
**Commit:** `f922e5d` — hardened `containsPromptEchoMarker()` against null/empty/non-string inputs.

---

## Runtime Verification

**DryRun "bạn là ai" test — 2026-07-01 17:39 UTC+7:**

| Metric | Result |
|---|---|
| decision | `allow` ✅ |
| reason | `dry_run` ✅ |
| dryRun | `true` ✅ |
| real send | `NO` ✅ |
| output | `"Xin chào! Tôi là trợ lý Zalo (chế độ test). Bạn đã nói: "bạn là ai""` ✅ SẠCH |
| leaked markers | **NONE** — no `[LỊCH SỬ]`, no `Dưới đây là`, no `Tin nhắn mới nhất` |

**Test gates:**
- backend: 819 tests PASS (49 files)
- typecheck: PASS
- backend build: PASS
- frontend build: PASS

---

## Remaining Risks

1. **History contamination (LOW):** Old assistant messages in DB may still contain markers from before fix. Layer 2 filter prevents them from re-entering AI context, but they remain in DB for audit.
2. **Provider echo (LOW):** If real AI provider (non-mock) echoes prompt markers, Layer 1 output guard catches it.
3. **Natural text echo (MEDIUM):** The `"Dưới đây là các tin nhắn gần đây"` header in `buildContextString` is natural Vietnamese — NOT in the echo guard list. But Layer 3 prevents it from reaching the adapter's content field, so it cannot be echoed.

---

## Incident Timeline

| Time (UTC+7) | Event |
|---|---|
| 15:43 | dryRun=false set via runtime override ("ENABLE LIVE MODE") |
| 15:50 | dryRun reverted to true |
| 16:00 | Full repo safety audit begins (Agents A-G) |
| 16:20 | Agent A discovers prompt echo P0 |
| 16:40 | ECHO1 fix: null-safe echo guard committed |
| 17:02 | HC1 fix: history contamination filter committed |
| 17:30 | PT2 fix: content/context separation committed |
| 17:39 | DryRun "bạn là ai" verified — output CLEAN ✅ |

**Risk window (dryRun=false):** ~7 minutes. No real sends detected in OutboundRecord.

---

## Lessons Learned

1. **Never inject context into content field.** The `content` field is what the AI treats as the user's message. Injecting history/headers there guarantees the AI will echo them.
2. **Mock adapters amplify bugs.** MockHermesChatAdapter mirrors `input.content` directly. Any bug that contaminates content becomes instantly visible in the output.
3. **Defense in depth.** Single guard (output filter) is not enough. Need: output guard + history filter + structural separation.
4. **Natural text also leaks.** Even without `[BRACKET]` markers, injecting `"Dưới đây là các tin nhắn..."` into content is still a leak — it changes the user's apparent message.
