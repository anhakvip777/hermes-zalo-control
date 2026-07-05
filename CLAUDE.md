# CLAUDE.md — Hermes Zalo Control Center / Hermes Zalo Bridge

> Context file for Claude Code when working in this repo. Read this first, then read
> the files under **"Files to read before editing"** before touching any code.

## Role of Claude Code in this repo

You are a **careful bridge/infrastructure engineer** for a system that sits between **Zalo**
(via `zca-js`) and **AI agents**. This project is a control plane, not a toy chatbot.

Think of the system as three layers:

- **Zalo Bridge** — owns the `zca-js` session and all Zalo I/O (inbound + outbound).
- **Tool Gateway** — the shared core: permission matrix, schema validation, audit/evidence,
  redaction, dryRun/live gate, and the single outbound door. Every agent goes through it.
- **Agent Adapter Layer** — pluggable adapters that connect a specific AI agent to the Bridge.
  **Hermes is the first adapter, not the core protocol.** The core is agent-agnostic.

Your job:

- Extend the **Bridge + Tool Gateway** so **any agent** can operate Zalo **only through controlled
  tools**, never directly.
- Keep every Zalo action **auditable, permissioned, and reversible**.
- Prefer small, verifiable changes. Read code first, propose a mini-plan, then implement.
- Never claim something works without command output / exit code as evidence.

You are **not** allowed to:

- Turn on global live sending.
- Delete or reset the DB, Zalo session, or backups.
- Commit tokens, cookies, session files, or `.env`.
- Let any agent call `zca-js` directly, or bypass the Tool Gateway / `OutboundDispatcher` for
  outbound messages.

## Architecture summary (current, verified)

```
Zalo (WebSocket)
   │  zca-js  (session owned ONLY by the Bridge)
   ▼
ZaloGatewayService            packages/backend/src/services/zalo-gateway.service.ts
   │  normalizeMessage / saveIncomingMessage
   ▼
zalo-receive.ts               packages/backend/src/services/zalo-receive.ts
   ▼
IncomingMessageDispatcher     packages/backend/src/services/incoming-dispatcher.service.ts
   │   safetyCheck (self-guard, allowlist, thread type)
   │   groupGateCheck (autoReplyEnabled, mention gate, reply window)
   │   principal permission gate  → roles: form_only | basic_chat | advanced | admin
   │   reminder intent parse + schedule-context prefetch
   │   HermesChatAdapter.generateReply()      ← TEXT-ONLY today (mock | http | cli)
   │   Unsupported System Claim Guard (blocks fake "đã gửi/đã đặt lịch" w/o DB evidence)
   ▼
OutboundDispatcher.sendOutbound()   packages/backend/src/services/outbound-dispatcher.service.ts
   │   SOLE outbound authority. No path may call sender.sendMessage() directly.
   │   prompt-echo guard → cooldown → dryRun decision → live-test override
   │   create Assistant Message (draft) + OutboundRecord → ZaloMessageSender (only if !dryRun)
   ▼
ZaloMessageSender             packages/backend/src/services/zalo-message-sender.ts → zca-js
```

Supporting pieces that already exist and **do affect runtime**:

- **Runtime config** (`runtime-config.service.ts`): effective `dryRun`, cooldown, batching.
- **Live test** (`live-test.service.ts`): one-shot quota + TTL bypass of dryRun for a single thread.
- **Access control** (`principal.service.ts`, `ZaloPrincipal`): role per `senderId` (+ optional thread scope).
- **Rules** (`rule-engine.service.ts`, `Rule`/`RuleVersion`/`RuleExecution`).
- **Group safety** (`group-safety.service.ts`): mention gate + reply window.
- **Evidence surfaces**: `OutboundRecord`, `Message`, `AgentTask`, `AuditLog`, `ScheduleExecution`.

### What is NOT wired yet (do not overclaim)

- `HermesAgentBridge` (`hermes-agent-bridge.service.ts`, `types/hermes-agent-protocol.ts`) is a
  **Phase-1 stub**. It builds a structured envelope but `run()` always returns
  `HERMES_AGENT_PROTOCOL_UNAVAILABLE`. **It is only referenced by tests, not by the live dispatcher.**
  The live path uses the **text-only** `HermesChatAdapter`.
- There is **no Tool Gateway**, no `ToolCall`/`ToolResult`/`ToolEvidence` model, and no way for an agent
  to request a tool and get a structured result.
- There are **no Zalo internal tools** (e.g. `zalo.listGroups`) exposed to any agent. `GET /api/zalo/groups`
  exists as an admin HTTP route but is not an agent-callable tool.
- There are **no memory tools** (`memory.searchMessages`, etc.) and **no web search gateway**.

### Target architecture: agent-agnostic (direction for new code)

The current `Hermes*`-named types are the **first adapter's** shape. As the Tool Gateway and structured
protocol are built, the **core must use neutral, agent-agnostic names**:

- Core protocol/services: `AgentBridge`, `AgentAdapter`, `AgentRequest`, `AgentResponse`,
  `AgentToolCall`, `AgentToolResult`.
- Concrete adapters plug into the core: `HermesAdapter` (first), then later `ClaudeAdapter`,
  `OpenAIAdapter`, `GeminiAdapter`, `McpAgentAdapter`, `CliAgentAdapter`, `HttpAgentAdapter`.
- The **Tool Gateway is the shared core for all agents**: every adapter goes through the same
  permission matrix, schema validation, audit/evidence, redaction, dryRun/live gate, and
  `OutboundDispatcher`. Adapters translate agent-specific I/O to/from the neutral protocol; they get
  **no** special privileges and **no** direct `zca-js` access.

> This is direction only — do not rename existing runtime code as part of docs work. New core code
> should adopt the neutral names; `Hermes*` remains valid as the first adapter.

## Mandatory safety laws (Iron Laws)

1. **No global live.** Never set global `live=true` / disable global `dryRun`. Only `LiveTestSession`
   may bypass dryRun, and only for one thread with quota + TTL.
2. **No destructive ops.** Never delete/reset DB, `zalo-session/`, or `backups/`. Quarantine, don't delete.
3. **No secret leakage.** Never commit or print tokens, cookies, session JSON, or `.env`. Reference
   secrets by key name only.
4. **Bridge owns zca-js.** No agent (Hermes or any future adapter) touches `zca-js`. Every Zalo action
   goes through the Bridge + Tool Gateway.
5. **One outbound door + governed write-actions.**
   - `OutboundDispatcher.sendOutbound()` is the **sole door for every text/media/voice message**.
   - **Any other Zalo write-action** (e.g. `addReaction`, `createPoll`, and future write ops) must go
     through the **Tool Gateway**, or at minimum satisfy the same governance: **permission check +
     dryRun/live gate + DB evidence**.
   - **Known gap (Phase 0):** `zalo-reaction.service.ts` (`api.addReaction`) and
     `zalo-poll.service.ts` (`api.createPoll`) are **dryRun-gated but bypass `sendOutbound` and write
     no DB evidence** (console/return-value audit only). This must be closed — see `PLAN.md` Phase 2.
6. **Evidence or it didn't happen.** Any important tool/action must write evidence to the DB
   (`ToolCall`/`AgentTask`/`Schedule`/`OutboundRecord`/`AuditLog`). If the bot says "đã làm / đã kiểm tra /
   đã tạo lịch / đã gửi", there must be a matching DB record.
7. **No tool → say so.** If a capability has no tool, the bot must say plainly **"chưa được cấp tool"**.
   It must not say "để mình kiểm tra" and then do nothing.

## Rules before you code

1. **Read first.** Read the relevant service(s) end-to-end before editing. Don't guess `zca-js` methods —
   verify against the installed `zca-js@^2.1.2` (see "zca-js reality" below).
2. **Mini-plan.** Write a short plan (files touched, DB changes, tests) and get approval before changing
   code, config, or schema.
3. **Don't touch live config without asking.** No changes to `dryRun`, `allowedThreads`, session, or
   PM2/ecosystem behavior without explicit approval.
4. **Additive & reversible.** Prefer new services/models over rewriting hot paths. New Prisma models via
   migration, never `--force-reset`.

## Verification rules

- **No PASS without evidence.** Never report PASS/SUCCESS without fresh command output and exit code.
  `exit != 0` → you cannot claim PASS.
- Run these and paste real output before saying "done":

```bash
npm run typecheck -w packages/backend    # tsc --noEmit, exit 0
npm test -w packages/backend             # vitest via scripts/run-tests.mjs
npm run build -w packages/backend        # tsc, exit 0
git diff --stat                          # only intended files changed
```

- If a command **cannot run** (missing dependency, no `node_modules`, no DB), say so explicitly and
  report what you could and could not verify. Do not pretend.

## Dev / test / build commands

Run from repo root unless noted. Node >= 22, npm >= 10. `shared` must be built before backend/frontend.

```bash
npm install                              # install workspaces
npm run build -w packages/shared         # build shared first (required by backend/frontend)

npm run dev                              # backend + frontend
npm run dev:all                          # backend + frontend + worker
npm run dev:backend                      # tsx watch src/index.ts

npm run typecheck                        # typecheck all packages
npm test                                 # vitest run (all)
npm test -w packages/backend             # backend tests (scripts/run-tests.mjs, guards test DB)
npm run test:e2e                         # e2e subset
npm run build                            # shared → backend → frontend

npm run db:migrate                       # prisma migrate dev  (packages/backend)
npm run db:generate                      # prisma generate
npm run db:studio                        # prisma studio
npm run db:guard                         # DB guard status (non-destructive)
npm run backup:create                    # create a DB backup
npm run secret:audit                     # scan for committed secrets
```

> ⚠️ Long-running (`dev`, `dev:all`, `db:studio`, `test:watch`) block the terminal — run them in a
> separate terminal, not inline.

## Files to read before editing

Read these before changing bridge/tool/outbound behavior:

- `README.md`, `AGENTS.md`, `DESIGN.md`, `PLAN.md`, `docs/AGENT_OPERATING_PROTOCOL.md`
- `packages/backend/src/app.ts` — Fastify app + route registration
- `packages/backend/src/config.ts` — env config (`autoReply`, `hermesChat`, `hermesAgentBridge`, `zalo`)
- `packages/backend/src/services/zalo-gateway.service.ts` — zca-js lifecycle, session, listener (Bridge owns this)
- `packages/backend/src/services/zalo-receive.ts` — inbound normalize + persist
- `packages/backend/src/services/incoming-dispatcher.service.ts` — inbound pipeline + gates
- `packages/backend/src/services/outbound-dispatcher.service.ts` — the ONLY outbound door
- `packages/backend/src/services/hermes-chat-adapter.ts` — current text-only adapter (mock/http/cli)
- `packages/backend/src/services/hermes-agent-bridge.service.ts` — Phase-1 protocol stub (not live)
- `packages/backend/src/types/hermes-agent-protocol.ts` — structured request/response types
- `packages/backend/src/services/principal.service.ts` — role/permission resolution
- `packages/backend/src/services/zalo-message-sender.ts` — zca-js send calls
- `packages/backend/prisma/schema.prisma` — data model (evidence surfaces)

## zca-js reality (do NOT guess — verify against installed v2.1.2)

Methods **confirmed used in this codebase** (grep the source):

- `getOwnId()`, `getOwnName()`, `loginQR(...)`, `login(credentials)`
- `listener.on("message"|"reaction"|"disconnected"|"closed"|"error")`, `listener.start()`, `listener.stop()`
- `getAllGroups()`, `getGroupInfo(groupIds)`  (see `routes/zalo.ts` `/zalo/groups`)
- `sendMessage(...)`, `sendVoice(...)`, `uploadAttachment(...)`  (see `zalo-message-sender.ts`)
- `addReaction(...)` (`zalo-reaction.service.ts`), `createPoll(...)` (`zalo-poll.service.ts`)

**Not verified in this repo** — before designing tools like `zalo.listFriends`, `zalo.getFriendInfo`,
`zalo.getThreadInfo`, `zalo.sendImage`, `zalo.sendFile`, **check the installed `zca-js` types/exports first**
(`node_modules/zca-js`). If a method does not exist, the tool must return a structured
`unavailable` result — never fabricate.

## Data model — evidence surfaces (current)

`Message` · `OutboundRecord` · `AgentTask` · `AuditLog` · `Schedule`/`ScheduleExecution`/`ScheduleJob` ·
`Rule`/`RuleVersion`/`RuleExecution` · `ZaloPrincipal`/`ZaloPrincipalAudit` · `ThreadSetting` ·
`RuntimeSetting`/`RuntimeConfigAudit` · `LiveTestSession` · `ThreadCooldown` · `MessageBatch` ·
`SystemHeartbeat` · `Document`/`DocumentChunk`/`DocumentIngestionJob`.

> There is **no** `ToolCall`/`ToolResult`/`ToolEvidence` model yet — see `PLAN.md` Phase 1.

## Current status

| Area | Status |
|------|--------|
| Zalo QR / session / reconnect / listener | ✅ Foundation in place |
| Dashboard / safety / rules / access / runtime | ✅ Present and affects runtime |
| Agent integration (first adapter = Hermes) | ⚠️ **Text-only** adapter (`HermesChatAdapter`) in the live path |
| Agent-agnostic bridge / Tool Gateway | ❌ Not complete (`HermesAgentBridge` is a stub, tests only) |
| Zalo internal tools (`zalo.*`) | ❌ Not built |
| Memory search tools (`memory.*`) | ❌ Not built / not complete |
| Web search gateway (`web.*`) | ❌ Not built |

See `PLAN.md` for the phased implementation plan and acceptance criteria.

## Development workflow aids (gstack / superpowers) — project rules override

gstack and superpowers are **development workflow aids only** (planning, review, QA,
security audit, TDD, debugging). They are **NOT runtime dependencies of the Bridge** and
must never be imported, invoked, or relied on by Bridge runtime code.

**Project safety laws always win over any skill/agent instruction.** If a gstack or
superpowers skill suggests anything that conflicts with the rules below, the rules below win:

- Bridge owns zca-js.
- No AI agent (Hermes or any future adapter) calls zca-js directly.
- Every tool goes through the Tool Gateway.
- The Tool Gateway must enforce permission, schema validation, audit/evidence, and redaction.
- `OutboundDispatcher` is the only outbound door.
- Never bypass the dryRun/live gate.
- Never enable global live.
- Never delete/reset the DB, `zalo-session/`, or `backups/`.
- Never commit secrets/tokens/cookies/session/`.env`.
- No "đã làm / đã kiểm tra" (done / checked) claims without evidence.

### Hard bans (both tools, in this repo)

- No install/setup of any kind.
- No plugin/marketplace install.
- No gstack team mode.
- No superpowers auto-routing / session hook unless explicitly approved.
- No git worktree creation.
- No auto-commit.
- No ship / deploy / merge / PR automation.
- No browser cookie import.
- No ngrok tunnel / pair-agent.
- No telemetry / sync / artifact upload.
- No modifying `CLAUDE.md`, `PLAN.md`, `.claude/`, `.codex/`, settings, or hooks without a
  shown diff + explicit approval.

### Allowed manual use (as checklist / methodology only)

Until installation is explicitly approved, these may be used **only as manual
checklists / methodology references** — not as installed, auto-routing tooling:

- **gstack:** `/cso`, `/review`, `/plan-eng-review`, `/qa-only`, `/investigate`, `/guard`.
- **superpowers:** brainstorming, writing-plans, test-driven-development,
  systematic-debugging, requesting-code-review, verification-before-completion.

> Installation requires explicit approval and a separate audit of exact commands.
