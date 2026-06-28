# HERMES CLI Crash Investigation

> **Date:** 2026-06-25 23:09  
> **Trigger:** P0 Batch 1 dry-run verification — query "Hi sao bạn chưa nhắc"  
> **Status:** 🔴 Reproducible — TIMEOUT on reminder-related prompts

---

## Reproduction

### Command

```bash
/home/anhakvip777/ai-agents/hermes-agent/venv/bin/hermes chat -q "Hi sao bạn chưa nhắc" -Q
```

### Result

```
TIMEOUT after 45s — process does not exit
```

### Full prompt sent by adapter

```
Bạn là trợ lý Zalo. Trả lời ngắn gọn, thân thiện bằng tiếng Việt.
Không nhắc đến hệ thống nội bộ, token, API key, session hoặc cấu hình.
Bạn không được bịa rằng hệ thống đã đặt lịch, đã gửi nhắc nhở, bị lỗi gửi tin,
không gửi được, hoặc đã thực hiện tác vụ nếu không có dữ liệu thật từ schedule/execution.
Nếu người dùng hỏi về lịch/nhắc nhở mà bạn chưa có dữ liệu,
hãy nói cần kiểm tra hệ thống hoặc hỏi lại ngắn gọn.
Nếu không chắc, hãy hỏi lại ngắn gọn.

[Zalo user từ người dùng]
Hi sao bạn chưa nhắc
```

### Error from AgentTask

```
HERMES_CLI_FAILED exit=null: Traceback (most recent call last):
  File "/home/anhakvip777/ai-agents/hermes-agent/venv/bin/hermes", line 8, in <module>
    sys.exit(main())
  ... (truncated at 200 chars)
```

## Comparative Tests

| Query | Result | Time |
|-------|--------|------|
| `"xin chào"` | ✅ PASS (exit=0) | ~2s |
| `"Trả lời ngắn gọn: xin chào"` | ✅ PASS (exit=0) | ~2s |
| `"Hi sao bạn chưa nhắc"` | ❌ TIMEOUT | >45s |
| `"Hi sao bạn chưa nhắc"` (no `-Q`) | ❌ Interactive → tool calls | >26s |

## Root Cause

**Keyword "nhắc" (remind) triggers Hermes tool invocation chain:**

1. Hermes detects intent to check reminders → calls `session_search` tool
2. `session_search` scans past conversation sessions for "nhắc" / "reminder"
3. Hermes also calls `cronjob list` to check scheduled reminders
4. Combined tool execution exceeds 45s → adapter timeout (60s) or Python signal

**This is a Hermes Agent runtime issue, not Admin Center P0 code.**

### Why simple queries work

- "xin chào" → Hermes responds directly, no tools needed
- "Hi sao bạn chưa nhắc" → triggers tool chain (session_search + cronjob) → timeout

## Fix Options

### Option A: Hermes-level fix (recommended)
- Add timeout to `session_search` tool (currently unbounded)
- Limit tool call depth for reminder-related queries
- Or configure Hermes to skip tool calls for simple reminder questions

### Option B: Adapter-level workaround
- Reduce `HERMES_CHAT_CLI_TIMEOUT_MS` from 60s to 20s (faster failure)
- Add retry with simplified prompt (strip "nhắc" context)
- Fallback message: "Mình chưa có dữ liệu về lịch nhắc, bạn vui lòng kiểm tra Admin Center"

### Option C: Pre-filter in dispatcher
- Detect "nhắc" / "reminder" keywords in user message
- Query DB for schedules/executions first
- Inject schedule data as context instead of letting Hermes search
- This bypasses the Hermes tool chain entirely

## Recommendation

**Short-term:** Option B (adapter timeout + simple fallback message that doesn't fabricate claims)

**Long-term:** Option C (pre-fetch schedule data, inject as context) — aligns with P0 context bug fix #3 (schedule-aware reply)

---

## Hermes Version

```
Hermes Agent v0.12.0 (2026.4.30)
Python: 3.12.3
Model: deepseek-v4-pro via opencode-go
⚠ 5552 commits behind — run 'hermes update'
```

## Notes

- The prompt guard (P0 #2) works correctly — Hermes tries to search for real data instead of fabricating
- The crash proves the guard is needed — without it, Hermes might fabricate "đã gửi" claims
- The crash is safe — adapter catches it, task marked failed, no fake claims sent
