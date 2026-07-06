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

---

# SESSION HANDOFF — Retrieval Answer feature (3.5A → 3.5D) + Track 1 prep

> Appended as a session handoff summary. Repo synced at `origin/master = bb794f8`.
> Live NOT executed. All safety flags unchanged.

## 1. Session summary

### Track 1 — READY_FOR_LIMITED_LIVE_TEST_PREP
Completed:
- Phase 1: inbound secret redaction (content/rawMetadata/previews pre-persist).
- Phase 2: identity / threadId / senderId normalization (never senderId from displayName; identityConfidence).
- Phase 3: listener / session auto-recovery (watchdog + recovery status; recovery never toggles autoReply/live).
- Phase 5: AllowThreads verification + Access-Control-vs-AllowThreads UI clarity.
- Phase 7: trace exact inbound→outbound linking (shared sentMessageId).
- Phase 9: limited-live runbook (PLAN ONLY — 1 DM, TTL 5m, quota 1).

Status:
- READY_FOR_LIMITED_LIVE_TEST_PREP achieved (preparation only).
- Limited live has NOT been run. Running live requires separate explicit approval.

### Phase 4A — Persistent outbound idempotency
Completed:
- `OutboundRecord.idempotencyKey @unique` + `inboundMessageId`.
- Text reply path uses write-ahead reservation before provider send.
- Duplicate same-inbound / retry / restart / concurrent → skipped `duplicate_idempotency`.
- Works for dryRun and future live.

Deferred:
- Reminder/schedule idempotency.
- Persistent inbound fallback dedupe for messages with no `zaloMessageId`.
- Live-test quota atomicity.
- Explicit retry policy for a failed live send.

### Phase 3.5A — Media / Attachment Memory Indexing
Completed:
- `Attachment` model; additive migration `20260706010000_add_attachment_index`.
- Inbound image/file attachment metadata linked to `Message`.
- OCR / extractedText / description redacted before persist; sourceUrl token redacted.
- Vision metadata MERGE preserves `_identity`.
- `memory.searchMessages` supports `threadType`, `dateFrom`/`dateTo`, `includeAttachments`;
  finds OCR text by group + keyword + date with `attachmentId` evidence.
- No cross-thread leak; no user/group id collision.

Important correction (local DB-state only):
- dev.db initially missed the `Attachment` table because the shell had a lingering
  `DATABASE_URL=file:./test.db`. Fixed by an explicit dev.db `db push`.
- No code/schema/migration change, no data loss (test.db always had the table).

Deferred: original media resend · permanent media storage · historical media backfill ·
voice/video extraction. (Retrieval-answer automation was deferred here but later done in 3.5B.)

### Phase 3.5B-A — Retrieval Answer service
Completed:
- Added `retrieval-answer.service.ts`; `parseRetrievalQuery(text)`; `answerRetrieval(input, deps?)`.
- Composes evidence-backed answers from memory + attachment OCR search.
- Menu case works: "gửi tôi thực đơn cửa hàng B trong group A" → found + messageId/attachmentId evidence.
- Scope guard prevents cross-thread leak; non-admin cross-thread → `permission_denied` (no search runs).
- OCR unavailable → honest "chưa đọc được nội dung", no hallucination.
- Answer/snippets redacted again before return.
- Service-only: no sendOutbound, no autoReply, no provider AI, no live.

### Phase 3.5B-B — Read-only retrieval answer tool
Completed:
- `memory.retrievalAnswer` read-only tool wrapper; delegates to `answerRetrieval()`.
- `kind=read`, `minRole=basic_chat`, `dataScope=own_thread`.
- Input: query, targetThreadId?, targetThreadType?, dateFrom?, dateTo?, includeAttachments?.
- Output: status, answerText, evidence[], confidence.
- Preserves scope guard, role checks, redaction, no-hallucination.
- Registered in `buildMemoryTools()` but does NOT auto-run (registry not wired at startup). Bridge stays OFF.

### Phase 3.5C — Admin/test route
Completed:
- Admin-authenticated read-only route: `POST /api/agent/tools/retrieval-answer`.
- `RetrievalAnswerToolInput` Zod schema.
- Handler calls `answerRetrieval()` directly — no ToolGateway runtime wiring, no sendOutbound,
  no provider AI, no bridge, no Zalo send.
- Optional `role` simulation (default `admin`; can pass `basic_chat` to verify permission_denied).
- Output: status, answerText, evidence[], confidence.

### Phase 3.5D — Admin UI test panel
Completed:
- Read-only page `/retrieval-test`; api-client `retrievalAnswer(input)` → `POST /api/agent/tools/retrieval-answer`.
- Nav item "Retrieval Test" under System.
- Form: query, requesterThreadId/Type, targetThreadId/Type, dateFrom/dateTo, includeAttachments, role sim.
- Displays: status, confidence, answerText, evidence table
  (messageId/attachmentId/source/threadId/threadType/createdAt/extractionStatus/snippet).
- Safety banner: "Read-only test. Không gửi Zalo. Không bật autoReply. Không live." No send button anywhere.
- No sendOutbound, no provider AI, no bridge, no autoReply, no original-image resend, no live.

## 2. Important commits

- `417aa37` — Phase 1 inbound redaction
- `f2f7f31` — AllowThreads discovery + allowlist UI
- `e65ec87` — legacy memory harvest + pre-live fix plan docs
- `f23ab34` — legacy regression fixtures
- `042d57e` — identity normalization
- `b68655a` — listener watchdog/recovery
- `4bcd591` — UI clarity Access Control vs Allow Threads
- `de638e4` — trace exact linking
- `0903adf` — limited-live runbook
- `8426a6a` — persistent outbound idempotency
- `8d8263f` — docs Phase 4A done
- `1b69d74` — Attachment/OCR searchable memory
- `94f112a` — docs Phase 3.5A done
- `23ebc24` — retrieval-answer service
- `b393a87` — docs Phase 3.5B-A done
- `dc5255b` — memory.retrievalAnswer read-only tool
- `f9b60dc` — docs Phase 3.5B-B done
- `7f06b88` — admin retrieval answer route
- `f6955c3` — docs Phase 3.5C done
- `00565a2` — retrieval test UI
- `bb794f8` — docs Phase 3.5D done

Latest pushed remote: **origin/master = bb794f8**

## 3. Key decisions and reasons

1. **No live this session.** User not ready; safety-first; need trace/idempotency/recovery/allowlist/runbook ready first.
2. **Phase 4A used `OutboundRecord.idempotencyKey @unique`.** A DB unique constraint is the only
   restart/retry/concurrency-safe dedupe; a findFirst pre-check races.
3. **Phase 3.5A used a dedicated `Attachment` model, not temp metadata search.** metadata isn't
   searchable well, had an overwrite-`_identity` bug history, and we need durable attachmentId +
   extractionStatus evidence.
4. **Phase 3.5B-A service-only first.** Isolate the retrieval "brain" from runtime autoReply — easy to
   test, no Zalo send, no live.
5. **Phase 3.5B-B added a read-only tool but kept bridge OFF.** Prepares for future agent/tool calling
   while avoiding any auto-run.
6. **Phase 3.5C calls `answerRetrieval()` directly, not via ToolGateway.** ToolGateway/registry isn't
   wired to HTTP runtime; a direct read-only, admin-authed call is smaller and safer.
7. **Phase 3.5C allows optional role simulation.** Route is admin-only but needs to simulate basic_chat
   to test permission_denied — grants no privilege to normal users.
8. **Phase 3.5D uses the existing frontend auth pattern (no client-side Basic header).** All admin pages
   use the same `apiFetch`; avoids a broad auth change.

## 4. Current state by area

- Live: **NOT EXECUTED**
- AutoReply: **OFF**
- DryRun (autoReply): **ON**
- Structured bridge: **OFF**
- Zalo: **disconnected / local safe**
- Backend/frontend: running local at last check
- Repo: **clean + pushed to origin/master bb794f8**
- AllowThreads: implemented and verified
- Identity: implemented
- Recovery: implemented
- Trace exact linking: implemented
- Outbound idempotency: implemented (text replies)
- Attachment/OCR search: implemented
- Retrieval answer service: implemented
- Retrieval answer tool: implemented (not auto-run)
- Admin HTTP retrieval route: implemented
- Retrieval UI test panel: implemented
- Original image resend: not implemented
- Permanent media storage: not implemented
- Historical media backfill: not implemented
- Reminder/schedule idempotency: not implemented
- Live quota atomicity: not implemented

## 5. Known baseline issues

- `incoming-dispatcher.test.ts` — baseline Prisma-mock failures.
- `batch7` / `batch13` — Windows path-validation failures.
- The above were verified earlier as baseline/unrelated; skip and note them, don't chase.
- PSReadLine on Windows prints noisy `System.ArgumentOutOfRangeException` for long inline commands and
  git progress on stderr — this is NOT command failure (check the actual exit code / ref-update line).
- `run-verify.mjs` is a temp test runner — delete before commit; never commit it.

## 6. Next recommended steps

**Option A — Manual verify first (recommended):**
1. Open `/retrieval-test` in browser. 2. Verify the warning banner. 3. Seed/use dev data with Attachment
OCR. 4. Test found-menu / not_found / permission_denied (role basic_chat) / no raw secret in answer+evidence.
5. Confirm the Network tab only calls `POST /api/agent/tools/retrieval-answer`. 6. Confirm no
sendOutbound/Zalo/live endpoints are hit.

**Option B — Phase 3.5E dry-run-only dispatcher integration (only AFTER manual UI pass):**
Detect retrieval intent in an allowed dry-run thread → compose via `answerRetrieval` → send via
`sendOutbound` **dryRun only**. No live, no bridge. Tests must prove dryRun-only.

**Option C — Phase 4B reminder/schedule idempotency (if reminders are next):**
Persistent idempotency for ScheduleExecution/fire events; prevent duplicate reminders after restart/retry.

**Option D — Stop here.** Checkpoint is safe and pushed.

Recommended: manual-verify `/retrieval-test` first; do NOT start live; do NOT start 3.5E until the UI
route works manually.

## 7. Strict safety rules for next session

- Never enable live without explicit approval.
- Never set `ZALO_AUTO_REPLY_ENABLED=true` without explicit approval.
- Never set `ZALO_AUTO_REPLY_DRY_RUN=false` without explicit approval.
- Never enable `HERMES_AGENT_BRIDGE_ENABLED` without explicit approval.
- Never QR login / reconnect session unless approved.
- Never push / deploy unless approved.
- Never touch `.env` / session / token / cookie / `zalo-session` / backups / QR unless approved.
- Delete generated temp scripts (e.g. `run-verify.mjs`) before commit.
- Always stage explicit paths only; never `git add .`.
- Always report `git status` before commit/push.

---

# CHECKPOINT — /retrieval-test manual verification PASS

> Doc-only status note. No runtime code changed. Safety flags unchanged.

**Option A (manual browser verify of `/retrieval-test`) — PASS** (verified by user in browser):
- Read-only banner shown: "Read-only test. Không gửi Zalo. Không bật autoReply. Không live." — PASS.
- Found case (query `cửa hàng B`, requester=target `demo-group-shopB`/group, role admin, includeAttachments true):
  status=`found`, menu shown (Cơm gà 45k / Bún bò 50k / Trà đào 25k), send date 2026-07-06,
  fake secret shown as `[REDACTED]`, evidence has messageId `demo-msg-1` + attachmentId — PASS.
- Permission guard (role `basic_chat`, cross-thread `demo-group-other`): status=`permission_denied`,
  no other-thread content leaked — PASS.
- Not found (non-existent query): status=`not_found`, no hallucination — PASS.
- Network safety: only `POST /api/agent/tools/retrieval-answer` observed; no sendOutbound / Zalo send /
  live endpoint / bridge runtime endpoint — PASS.

**Also confirmed at API/service level (test.db, isolated dry-check):** same 4 outcomes PASS.

**Known behavior (not a bug, do not "fix" without scope approval):** the route does a **raw substring
search** on `query` — the parser `parseRetrievalQuery` is NOT wired into the route. Use a keyword
(`cửa hàng B`), not the full sentence. Wiring keyword parsing into retrieval is a candidate for a later phase.

**Demo data:** additive rows seeded in **dev.db** under `threadId = 'demo-group-shopB'`
(message `demo-msg-1` + one image attachment, OCR stored already redacted). To remove later:
delete rows in dev.db where `threadId = 'demo-group-shopB'`. dev.db is gitignored — not in version control.

**Project status: `READY_FOR_PHASE_3.5E_DRY_RUN_ONLY`.**
- Phase 3.5E (dry-run-only dispatcher integration) is **NOT started** — awaiting a separate explicit scope approval.
- Do NOT start 3.5E code until that approval. When approved: audit-first, dryRun-only, no live/bridge,
  tests must prove dryRun-only.

Safety at checkpoint: Live NOT executed · autoReply OFF · bridge OFF · autoReply dryRun ON ·
Zalo disconnected/local-safe. Flags: `ZALO_AUTO_REPLY_ENABLED=false`, `ZALO_AUTO_REPLY_DRY_RUN=true`,
`HERMES_AGENT_BRIDGE_ENABLED=false`, `ZALO_DRY_RUN=false`.

---

# CHECKPOINT — Phase 3.5E implemented (dryRun-only, default OFF)

> Doc-only status note. Retrieval-answer dispatcher integration is implemented but **inert by default**.

**Phase 3.5E — retrieval-answer dispatcher integration (dryRun-only):**
- Flag `RETRIEVAL_DISPATCHER_DRYRUN_ENABLED` (config `retrieval.dispatcherDryRunEnabled`), **default false**.
- `services/retrieval-intent.ts` — `detectRetrievalIntent(text)` (uses `parseRetrievalQuery`, derives a
  short search term; chit-chat ignored).
- `incoming-dispatcher.service.ts` — `tryRetrievalDispatch()` runs at the top of `handleIncomingMessage`
  **before** the `autoReply.enabled` gate; preserves self/threadId/allowlist/permission-scope/redaction/
  idempotency guards; calls only `answerRetrieval()` + `sendOutbound({source:"retrieval"})`.
- `outbound-dispatcher.service.ts` — added `"retrieval"` OutboundSource (maps to `auto_reply`).
- **Hard dryRun guards:** abort (no send) if flag≠true, effective dryRun≠true, or a live-test session is
  active for the thread. No live outbound is ever possible from 3.5E.
- **Status policy:** found→dryRun answer · not_found→dryRun truthful message · permission_denied→no send ·
  unavailable→no send.
- Tests: `retrieval-dispatch.test.ts` 11/11; retrieval/memory/outbound/inbound regression green; typecheck 0.
- **Enable locally (dry-run demo):** `RETRIEVAL_DISPATCHER_DRYRUN_ENABLED=true` + thread allowlisted +
  `ZALO_AUTO_REPLY_DRY_RUN=true`. Never sends real Zalo.

Safety at checkpoint: Live NOT executed · autoReply OFF · bridge OFF · dryRun ON · Zalo disconnected.
Flags unchanged: `ZALO_AUTO_REPLY_ENABLED=false`, `ZALO_AUTO_REPLY_DRY_RUN=true`,
`HERMES_AGENT_BRIDGE_ENABLED=false`, `ZALO_DRY_RUN=false`.
