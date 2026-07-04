# ARCH1 True Hermes Agent Bridge Audit

**Status:** FAIL — Phase 1 protocol foundation only.

## Current production status

- ZR2 Zalo reconnect/session restore: PASS
- Zalo online auto-restore: PASS
- dryRun: true
- live: false
- ControlledDM: not enabled
- GlobalLive: NO
- Group: NO
- ARCH1 true Hermes Agent bridge: FAIL / not implemented

## Current bridge is text-only

Current implementation is `HermesChatAdapter`.

It supports either:

1. CLI text mode:
   - builds one prompt string
   - runs `hermes chat -q <prompt> -Q`
   - parses stdout as one text reply

2. HTTP chat-completions mode from ARCH1-B work-in-progress:
   - sends OpenAI-compatible `/v1/chat/completions`
   - body shape is `{ model, messages, stream: false }`
   - parses `choices[0].message.content`

This is **not** a true Hermes Agent bridge. Do not call ARCH1-B PASS.

## Missing request envelope

Current `ChatContext` has only:

- `threadId`
- `threadType`
- `senderId`
- `senderName`
- `content`
- `recentMessages`
- `scheduleContext`

Missing ARCH1 true bridge fields:

- `platform`
- `message.id`
- `messageType`
- `mentions`
- `attachments`
- `sender.role`
- `sender.gender`
- `permissions`
- `runtime.dryRun`
- `runtime.live`
- `runtime.timezone`
- `runtime.timestamp`
- `runtimePolicy`
- `capabilities`
- `allowedTools`
- `metadata`

## Missing response schema

Current response is:

```ts
{
  reply: string,
  confidence?: number
}
```

Missing:

- `messages[]`
- `toolCalls[]`
- `toolResults[]`
- `actions[]`
- `media[]`
- `safety`
- `errors[]`
- `usage`
- action evidence contract

## Missing tools/capabilities/actions/media

Current bridge does not send or receive:

- web search capability
- TTS capability
- TTI capability
- embedding capability
- memory capability
- schedule capability
- image input/output
- audio output
- tool calls
- tool results
- action results
- media outputs
- safety metadata

Therefore Bridge cannot know whether Hermes actually searched web, created schedule, generated media, or refused action.

## Mock fallback risk

Current factory can silently return `MockHermesChatAdapter` when config is not `HERMES_CHAT_ADAPTER=real`.

Risk:

- config typo or missing env can make bot echo mock reply
- no explicit `HERMES_AGENT_PROTOCOL_UNAVAILABLE`
- tests must ensure true Agent bridge has no silent mock fallback

## Why web search does not run

Because current Bridge sends text-only chat payload, not an Agent protocol request.

HTTP mode sends:

```json
{
  "model": "hermes-agent",
  "messages": [],
  "stream": false
}
```

No fields tell Hermes runtime:

- platform context
- capabilities
- allowed tools
- permission to use web
- action/evidence contract
- tool result schema

If Hermes endpoint is only `/v1/chat/completions`, there is no guarantee tool runtime exists. Bot may answer “không có dữ liệu thời gian thực” because Bridge did not invoke real Agent tools.

## ARCH1-B uncommitted files found during audit

These files were uncommitted before ARCH1-C work and represent text-only adapter changes, not true bridge:

- `ecosystem.config.cjs`
- `packages/backend/src/config.ts`
- `packages/backend/src/services/hermes-chat-adapter.ts`
- `packages/backend/src/__tests__/hermes-chat-adapter.test.ts`

They were stashed separately as:

```txt
ARCH1-B text-only chat adapter (not true bridge)
```

Do not mix ARCH1-B text adapter changes into ARCH1-C protocol commit unless intentionally reviewed.

## Correct ARCH1-C direction

Phase 1:

- add `HermesAgentRequest` / `HermesAgentResponse` types
- add parallel `HermesAgentBridge` skeleton
- build full envelope
- default bridge OFF
- return `HERMES_AGENT_PROTOCOL_UNAVAILABLE` when endpoint/protocol missing
- do not fallback mock
- add tests for envelope, runtimePolicy, permissions, capabilities, attachments

Phase 2 only after true endpoint exists:

- call Hermes Agent HTTP/MCP/tool endpoint
- parse toolCalls/toolResults/actions/media/safety
- require action evidence for schedule/send/media
- runtime verify dryRun DM

## Non-goals

Do not:

- hardcode weather intent in Bridge
- hardcode group-list intent in Bridge
- turn Bridge into AI brain
- enable live
- enable group
- set dryRun=false
- commit backup/session/token/runtime files

## Expected final wording after Phase 1

ARCH1 True Hermes Bridge: FAIL, protocol foundation added, blocked by missing true Hermes Agent endpoint.
