# Emergency Prompt Echo Incident — 2026-07-01

**Severity:** P0 BLOCKER
**Status:** 🔴 FIXING

---

## Incident Summary

Bot was observed sending internal prompt/history markers to Zalo users:

- `[LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY]`
- `[TIN NHẮN HIỆN TẠI]`
- `Bạn vừa nói: ...`

This exposes internal prompt construction to end users, violating AI safety and trust.

## Root Cause

1. **No output guard for prompt markers.** The `sendOutbound()` function in `outbound-dispatcher.service.ts` had no check for internal prompt/history markers in AI responses before sending.

2. **Prompt markers in AI context.** The `conversation-context.service.ts` and `hermes-chat-adapter.ts` inject markers like `[LỊCH SỬ TRÒ CHUYỆN]` into the AI prompt. If the AI echoes these back, or if the model hallucinates them, they are sent to users unfiltered.

3. **Mock adapter echo.** `MockHermesChatAdapter` echoes `Bạn vừa nói: "${input.content}"` — direct prompt reflection.

4. **History contamination.** Assistant responses containing markers are saved to conversation history, creating a feedback loop where future prompts contain markers the AI might echo again.

## Additional Finding: dryRun Override

During investigation, discovered `autoReply.dryRun` was set to `false` via runtime override at `2026-07-01T15:43:52` with reason "ENABLE LIVE MODE" by "admin". This was reverted at `15:50:35`.

**Risk window:** ~7 minutes where bot could have sent real messages. No real sends detected in OutboundRecord during this window.

## Fix Applied

### P0.1 — Prompt Echo Guard (outbound-dispatcher.service.ts)

Added `checkPromptEcho()` function that blocks any outbound text response containing:

- `[LỊCH SỬ TRÒ CHUYỆN GẦN ĐÂY]`
- `[LỊCH SỬ TRÒ CHUYỆN]`
- `[/LỊCH SỬ]`
- `[TIN NHẮN HIỆN TẠI]`
- `[KẾT THÚC LỊCH SỬ`
- `BEGIN_CONTEXT`
- `END_CONTEXT`

Blocked responses create `OutboundRecord` with `decision=block, reason=prompt_echo_guard`.

### P0.2 — Mock Adapter Sanitization

Changed `MockHermesChatAdapter` from raw echo to sanitized response with length limit (60 chars).

### P0.3 — dryRun Re-enabled

Reverted runtime override to `dryRun=true` immediately upon discovery.

## Remaining Risks

1. History contamination: assistant messages already in DB may contain markers — need cleanup
2. No automated test for prompt echo guard yet
3. Need to prevent `dryRun=false` from being set without explicit safety confirmation
4. Mock adapter still echoes user content (albeit truncated) — should consider removing echo entirely

## Next Steps

- [ ] Add automated tests for prompt echo guard
- [ ] Clean contaminated messages from history
- [ ] Add dryRun change alert/notification
- [ ] Full repo safety audit (Agent A-G)
