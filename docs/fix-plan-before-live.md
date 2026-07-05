# Hermes Zalo Bridge — Fix Plan Before Live

Status: **AUDIT + PLAN ONLY. No code changed. No live. No commit.**
Author pass: evidence-grounded from the legacy `zalo-bot-2` memory harvest + current bridge code.
Target: move from **READY_FOR_DRYRUN_ONLY** → **READY_FOR_LIMITED_LIVE_TEST** → (later) expanded live.

Safety state asserted for the whole plan (unchanged):
- `ZALO_AUTO_REPLY_ENABLED=false`
- `ZALO_AUTO_REPLY_DRY_RUN=true`
- `HERMES_AGENT_BRIDGE_ENABLED=false`
- `ZALO_DRY_RUN=false` (connection realism only; outbound still simulated by the auto-reply dryRun flag)
- No live send · no push/deploy · no QR re-login · no touching session/token/cookie/.env/zalo-session/backups · no secrets/PII/raw chatlog printed.

---

## Executive summary

The legacy bot was an AI **secretary** (per-user task capture, timed reminders, follow-ups, polls,
attendance, group announcements). Reading the real memory content surfaced concrete, repeatable
failure modes that map directly to work items here. The bridge already closes the biggest structural
risks (dry-run default, single outbound door, threadType-scoped allowlist with default-deny, governed
tools + evidence + Decision Trace, unsupported-claim guard). What remains before a **single-DM limited
live test** is a small, ordered set of correctness/safety fixes, dominated by one **new BLOCKER**:
inbound secret redaction on the `Message.content` save path.

Recommended first action: **Phase 0 (checkpoint) then Phase 1 (KI-B4 inbound redaction).** These are
the only items that strictly block *any* handling of real inbound. Identity resolution (Phase 2) and
session auto-recovery (Phase 3) are the remaining hard gates for a limited live DM.

**Beyond text replies — information retrieval from old messages, including media.** The bridge is not
just a text auto-responder; a core real-world expectation is to **retrieve information from prior
group/DM history**, including **images, files, and other media**. Concretely: if on 10 May someone posts
a photo of shop B's menu in group A, then on 20 May a user asks *"gửi cho tôi thực đơn của cửa hàng B
trong group A"*, the bridge must locate the old message by **thread + keyword + time + attachment**,
read what the attachment contained (via OCR/extraction), and answer with evidence (or resend the
original image through the governed outbound path). The legacy memory confirms this is a **real need**,
not hypothetical: 323 inbound records carried media (voice/mp4/pdf/images). **Without OCR/attachment
indexing, the bot cannot know what a menu photo contains** and cannot honestly answer such a request.
This capability is scoped as the new **Phase 3.5 — Media / Attachment Memory Indexing** below. It is
**not** required for the first text-only limited-live DM, but **is required** before advertising or
enabling any "find old images/menus/files" retrieval.

## Current readiness

- **READY_FOR_DRYRUN_ONLY** (confirmed by prior Steps 5A/5B/5C: inbound saved, no live send, trace present).
- Blocking limited-live: **KI-B4** (inbound secret redaction) → BLOCKER; **KI-H1** (identity/threadId) and
  **KI-H2** (session/listener auto-recovery) → HIGH gates for a bounded DM test.
- Not blocking limited-live but must be tracked: KI-H3 (persistent dedupe), KI-M1 (dashboard 429),
  KI-M2 (trace exact linking), KI-H6/H4 (task/reminder engine — needed before *reminders* go live, not before a manual DM test).

## New blockers found during this audit

1. **Redaction gap (sharpens KI-B4):** the existing `redact()` in
   `services/tool-gateway/redaction.ts` has **no `sk-` API-key pattern**. It masks JWT, `Bearer …`,
   32+ char hex, and phones. OpenAI-style `sk-...` keys are alphanumeric (not pure hex) and typically
   won't be fully caught by `LONG_HEX_PATTERN`. The harvest's assumption that `sk-…` is "already masked"
   is **only partially true**. Phase 1 must add an explicit `sk-`/high-entropy token pattern.
2. **Inbound persist path is not redacted at all:** `services/zalo-receive.ts` does
   `prisma.message.upsert({ create: { content: msg.content, metadata: msg.rawMetadata, … } })` with
   **no redaction**. Both `content` and `metadata` (rawMetadata) are written verbatim. This is the exact
   leak the legacy `raw-inbound` demonstrated. Confirmed BLOCKER, precise location identified.
3. **Multiple message-write sites** persist content and must be considered for consistency:
   `services/zalo-receive.ts` (inbound), `services/outbound-dispatcher.service.ts` (assistant/outbound),
   `services/conversation-context.service.ts` (synthetic/context). Redaction policy should be applied at
   the inbound door primarily; outbound content is bot-generated but may echo a user-pasted secret.

---

## Phase-by-phase plan

### PHASE 0 — Baseline / commit checkpoint
**Goal:** freeze a clean, reviewed repo state before touching any blocker. Do not go live with a
working tree full of mixed unreviewed changes.

Current working tree (from `git status`):
- **Modified (tracked):** `packages/backend/src/index.ts`, `packages/backend/src/routes/access.ts`,
  `packages/backend/src/services/incoming-dispatcher.service.ts`,
  `packages/frontend/src/app/layout.tsx`, `packages/frontend/src/lib/api-client.ts`.
- **Untracked (new):** `docs/known-issues-and-fixes.md`, `docs/legacy-bot-casebook.md`,
  `docs/legacy-memory-harvest.md`, `docs/legacy-memory-inventory.md`,
  `docs/project-development-roadmap.md`, `docs/fix-plan-before-live.md` (this file),
  `packages/backend/src/__tests__/access-threads.test.ts`,
  `packages/backend/src/__tests__/fixtures/` (legacy-bridge-cases.json, legacy-memory-cases.json),
  `packages/backend/src/__tests__/legacy-memory-regression.test.ts`,
  `packages/backend/src/__tests__/legacy-regression.test.ts`,
  `packages/backend/src/services/allowlist.service.ts`,
  `packages/backend/src/services/threads-access.service.ts`,
  `packages/frontend/src/app/allow-threads/`.

Plan:
1. `git status` + `git diff --stat` — reviewed above.
2. **Commit group A (feature: AllowThreads):** `routes/access.ts`, `services/allowlist.service.ts`,
   `services/threads-access.service.ts`, `services/incoming-dispatcher.service.ts` (gate wiring only),
   `index.ts`, `frontend/app/allow-threads/`, `frontend/lib/api-client.ts`, `frontend/app/layout.tsx`,
   `__tests__/access-threads.test.ts`.
3. **Commit group B (docs: legacy audit + roadmap):** all `docs/*.md` above (harvest, known-issues,
   roadmap, casebook, inventory, this fix-plan).
4. **Commit group C (test: legacy regression + fixtures):** `__tests__/fixtures/*`,
   `__tests__/legacy-regression.test.ts`, `__tests__/legacy-memory-regression.test.ts`.
5. **NEVER stage:** `packages/backend/.env`, anything under `zalo-session/`, `backups/`, `prisma/*.db`,
   `*.db.empty-*`, any QR `*.png`, any token/cookie/session file, temp/debug scripts. Verify with a
   targeted `git status` before each `git add` (stage explicit paths, never `git add .`).
6. **Tests before commit:** `access-threads` (10/10), `legacy-regression` (23), `legacy-memory-regression`
   (23), `app-auth`; backend + frontend typecheck. Do **not** run the full suite (known baseline failures).
7. **Proposed messages** (repo-local identity `Viet Anh <vietanh@example.local>`):
   - A: `feat(access): AllowThreads allowlist gate + admin UI (default-deny, threadType-scoped)`
   - B: `docs: legacy memory harvest, known issues, roadmap, pre-live fix plan`
   - C: `test: legacy + memory regression fixtures and suites`

**Acceptance:** clean `git status` after the three commits; no secret/PII/session/db files staged;
targeted tests green; typecheck 0.
**Blocks live:** no — but it is a prerequisite for a clean live-test baseline.
**Requires explicit approval before running any `git commit`.**

---

### PHASE 1 — KI-B4 inbound secret redaction (BLOCKER)
**Goal:** never persist user-sent secrets in cleartext. Redact inbound `Message.content` (+ raw metadata)
before it hits the DB, and everywhere content is surfaced (trace, memory output, sent-context).

Evidence: `raw-inbound/2026-05-21.jsonl` (user pasted 3 `sk-…` keys, stored raw); `ctn-crm-login.md`
(plaintext CRM password). `docs/known-issues-and-fixes.md` KI-B4; `docs/legacy-memory-harvest.md` §9,§15.

1. **Current inbound save path:** `packages/backend/src/services/zalo-receive.ts` —
   `prisma.message.upsert({ create: { content: msg.content, metadata: msg.rawMetadata, senderName, … } })`
   (~line 284). **No redaction today.** This is the primary fix site.
2. **Where to put the helper:** reuse `services/tool-gateway/redaction.ts` (`redact` / `maskString`).
   Add a thin `redactInboundText(content: string): string` (or extend `maskString`) so the same masking
   rules are shared by tool-gateway, trace, and the inbound door — single source of truth.
3. **Reuse + extend:** keep JWT / Bearer / long-hex / phone patterns. **Add** missing patterns:
   - `sk-` API keys: `\bsk-[A-Za-z0-9_-]{16,}\b` (OpenAI-style; also `sk-proj-`, `sk-ant-`).
   - Generic bearer/api tokens embedded in text: `(api[-_ ]?key|token|secret)\s*[:=]\s*\S+`.
   - Long high-entropy alphanumeric blobs (base64/url-safe), not only pure hex: `\b[A-Za-z0-9_-]{40,}\b`
     (tune threshold to avoid masking normal URLs/IDs; test against real chat samples).
   - Keep existing phone masking (policy: mask by default; role may un-mask via `allowPhone`).
4. **Minimum redaction targets (must all be covered):**
   - inbound `Message.content` (save path — `zalo-receive.ts`).
   - inbound raw logging / `metadata` (`msg.rawMetadata`) if it can contain the same text.
   - Decision Trace content fields (already uses redaction — verify the inbound preview uses it).
   - memory-tools output / sent-context (verify redaction applied on read/emit).
5. **Apply order:** redact **before** dedup-key hashing? No — dedup on raw id/hash is fine; redact only the
   **stored `content`/`metadata`**. Keep `zaloMessageId`, `senderId`, timestamps intact.
6. **Tests to add** (DB-free where possible, use fixtures in `legacy-memory-cases.json`):
   - `sk-...` key in inbound → stored content contains `[REDACTED]`, not the key.
   - JWT (`eyJ...`) → redacted.
   - `Bearer <token>` → redacted.
   - Normal Vietnamese text (`"Tỷ ơi nhắc em 9h họp"`) → unchanged.
   - Idempotent: `redact(redact(x)) === redact(x)`.
   - Trace + memory output never expose a raw secret that was in the inbound.
   - Phone number → masked to `[REDACTED]NN` per existing rule.

**Acceptance:** a saved inbound containing `sk-…`/JWT/Bearer/long-token shows `[REDACTED]` in DB, trace,
and memory output; normal text is preserved; redaction is idempotent; no secret value ever printed in logs.
**Risk & rollback:** over-redaction could mask legitimate IDs/URLs → mitigate with tuned thresholds +
real-sample tests; helper is pure/isolated, so rollback = revert the one helper + call site. No schema change.
**Blocks live:** **YES.** Must land before any real inbound is handled beyond the current dry-run smoke.

---

### PHASE 2 — KI-H1 identity / threadId / senderId resolution (HIGH)
**Goal:** eliminate `unknown-thread-type` / `threadId:null` / blank `senderId`; make permission/RBAC/memory
scope default-safe on ambiguity.

Evidence: 128 `unknown-thread-type` outbound blocks; `raw-inbound` `threadId:null`; 571 blank-senderId
chat-log records (12.7%); `.dreams` identity lookups dominated by name→id. KI-H1; harvest §8,§12,§15.

1. **Current normalize path:** inbound normalization feeding `NormalizedMessage` (upstream of
   `zalo-receive.ts` / `incoming-dispatcher.handleIncomingMessage`). Principal resolution already
   fail-safes to `form_only` on error (`incoming-dispatcher` P1.1 gate) — keep that.
2. **Derivation rules:**
   - group: `threadId = raw.threadId || raw.groupId || raw.to`; `threadType = "group"` when `isGroup`/groupId present.
   - user: `threadId = raw.threadId || raw.senderId || raw.from || raw.to`; `threadType = "user"` otherwise.
   - `senderId = raw.senderId || raw.from || raw.uid` (never fall back to displayName).
3. **Add `identityConfidence`:** `exact` (explicit ids) · `derived` (inferred from to/groupId/isGroup) ·
   `unknown` (blank sender / undecidable). Store on the normalized message + surface in trace.
4. **Safety on ambiguity:** `unknown`/blank sender → lowest role (`form_only`), **never** elevated;
   memory scope restricted to the resolved thread only; no cross-thread read.
5. **Sync with AllowThreads:** the gate and the discover/list source must use the same threadId/threadType
   derivation so a thread allowed in the UI matches the runtime-resolved id (no user/group id collision).
6. **Tests:**
   - `threadId:null` + `groupId` → resolved as group, correct threadId.
   - DM with `threadId:null` → resolved as user from senderId/from.
   - blank `senderId` → role stays `form_only`, no elevation.
   - same numeric id as user vs group → no collision (threadType disambiguates).
   - trace records `identityConfidence`.

**Acceptance:** no `unknown-thread-type` for resolvable inputs; blank/unknown sender never elevated;
group vs DM always resolved; AllowThreads id matches runtime id.
**Blocks live:** **YES** for a bounded DM (identity must be trustworthy before any real reply).

---

### PHASE 3 — KI-H2 listener / session auto-recovery (HIGH)
**Goal:** a dead listener or dropped session is never silent; auto-reconnect with backoff + dashboard alert.

Evidence: 62 login/session `send_failed`; observed ~20-min silent listener drop during Step 5. KI-H2.

1. **Current heartbeats:** `heartbeat.service.ts` tracks `connection`, `listener`, `messagePipeline`
   (dispatcher already calls `heartbeatOk("messagePipeline", …)`). WS handlers + `scheduleReconnect` +
   `/ops/reconnect` exist but recovery is not fully automatic.
2. **Gaps:** no stale-heartbeat watchdog that *acts*; reconnect not automatic on WS drop when idle; no alert.
3. **Watchdog / reconnect strategy:**
   - detect stale heartbeat (no `messagePipeline`/`listener` beat within N minutes while "connected").
   - exponential backoff reconnect (e.g. 5s→10s→…→cap), bounded `maxAttempts`.
   - on exhaustion → status `error` + dashboard alert (log/telegram per `errorAlert` config, dryRun-safe).
4. **Safety:** reconnect must **not** enable autoReply or live; it only restores inbound listening.
   Outbound stays dry-run and gated.
5. **Tests (stubbed, DB-free):**
   - stale heartbeat → reconnect scheduled.
   - reconnect fails repeatedly → status `error`, alert emitted (dryRun).
   - reconnect success → `listenerActive=true`, heartbeat resumes.
   - disconnected → outbound blocked / no live send (already true; assert it).

**Acceptance:** listener recovers automatically after a WS drop; status flips to `error` + alert on
exhausted retries; no autoReply/live toggled by recovery.
**Blocks live:** **YES** (a live DM test needs a listener that won't silently die).

---

### PHASE 3.5 — Media / Attachment Memory Indexing (NEW)

> **STATUS: Phase 3.5A DONE ✅ (commit `1b69d74`).** Indexing + search foundation:
> - Added `Attachment` model + additive migration `20260706010000_add_attachment_index`
>   (CREATE TABLE + indexes only; no destructive ops).
> - Inbound image/file attachment metadata is now persisted and linked to its `Message`.
> - OCR / `extractedText` / `description` are **redacted** (shared `redact()`) before persist;
>   `redactionApplied=true`; source URL tokens redacted.
> - Vision metadata is **merged** into `Message.metadata` (preserves Phase 2 `_identity`) instead of overwriting.
> - `memory.searchMessages` supports `threadType`, `dateFrom`/`dateTo`, `includeAttachments`, and keyword
>   search over `Message.content` + `Attachment.extractedText`/`description`, returning `attachmentId`
>   evidence. Thread-scope guard preserved (no cross-thread leak; user/group same-id no collision).
> - Menu case works: an image OCR'd in group A is findable later by group + keyword + date.
> - Tests: **99/99 passed**; backend typecheck 0. Backend dev server restarted safely after `prisma generate`.
> - **Correction (local DB state only):** dev.db initially missed the `Attachment` table because an earlier
>   push ran with a lingering `DATABASE_URL=file:./test.db`; fixed by an explicit dev.db `db push`. No
>   code/schema/migration/commit change, no data loss (test.db always had the table → tests were valid).
>
> **Deferred (Phase 3.5B and beyond):** retrieval-answer automation · original media resend ·
> permanent media storage · historical media backfill · voice/video extraction.

> **STATUS: Phase 3.5B-A DONE ✅ (commit `23ebc24`).** Retrieval-answer automation, **service-only**:
> - Added `services/retrieval-answer.service.ts`.
> - Added `parseRetrievalQuery(text)` — Vietnamese retrieval-intent parser for menu/search-style queries
>   (`tìm`, `lục lại`, `gửi tôi`, `cho tôi xem`, `thực đơn`, `menu`, `cửa hàng`, `quán`, `group`, `ngày`);
>   extracts keywords, an optional single-day date range, and an **advisory** group hint (never used for permission).
> - Added `answerRetrieval(input, deps?)` — composes an **evidence-backed** answer from memory +
>   attachment OCR search (reuses the Phase 3.5A `searchAttachments` + memory deps).
> - Menu case works: *"gửi tôi thực đơn cửa hàng B trong group A"* → `found` answer carrying
>   `messageId` / `attachmentId` evidence + the send date + a redacted OCR snippet.
> - **Scope guard** via `resolveThreadScope` prevents cross-thread leak (group A data never leaks into group B).
> - A **non-admin targeting another thread** returns `permission_denied` and **no search is executed**.
> - **OCR unavailable/pending/failed** → honest *"chưa đọc được nội dung"*, **no hallucination** of a menu.
> - Answer text + every snippet are **redacted again** (`redact()`) before return; service-generated dates
>   are intentionally not re-redacted (avoids masking ISO dates as phone numbers).
> - Status enum: `found | not_found | permission_denied | unavailable`; evidence capped to top 3
>   (readable-attachment > unreadable-attachment > message, newest first).
> - Tests: **83/83 passed** (incl. new `retrieval-answer.test.ts`, 14 cases: parser, scope/permission,
>   menu case, group-B no-leak, date range, OCR-unavailable, secret redaction, top-3 ordering, infra→unavailable,
>   no-live, DB-backed menu case); backend typecheck **0**.
> - **Still service-only — deferred:** no tool wrapper yet · no autoReply integration · no `sendOutbound` ·
>   no provider AI · no original-image resend · no live.

> **STATUS: Phase 3.5B-B DONE ✅ (commit `dc5255b`).** Read-only tool wrapper:
> - Added `memory.retrievalAnswer` (in `tools/memory/retrieval-tools.ts`) — a thin ToolGateway wrapper
>   that **delegates to `answerRetrieval()`** (3.5B-A).
> - Tool metadata: `kind=read`, `minRole=basic_chat`, `dataScope=own_thread` (mirrors `memory.searchMessages`).
> - Input: `query`, `targetThreadId?`, `targetThreadType?`, `dateFrom?`, `dateTo?`, `includeAttachments?`.
> - Output: `{ status, answerText, evidence[], confidence }` (validated by the tool `resultSchema`).
> - Preserves the 3.5B-A guarantees inherited from the service: **own-thread scope guard**
>   (non-admin cross-thread → `permission_denied`, no search runs), role checks, **redaction**, and
>   **no hallucination** on unreadable OCR. Pure `read` — never throws for expected outcomes.
> - **Registered in `buildMemoryTools()`** with the real search by default, but **does not auto-run at
>   runtime** (the registry is not wired into app startup; runtime dispatch is a later phase). A test
>   asserts registration invokes nothing.
> - Tests: **91 passed** (incl. new `retrieval-answer-tool.test.ts`, 8 cases: metadata, inclusion in
>   `buildMemoryTools`, registration-does-not-auto-run, menu case, cross-thread permission_denied,
>   OCR-unavailable, redaction, resultSchema validation); backend typecheck **0**.
> - **Still deferred:** no autoReply integration · no `sendOutbound` · no provider AI · no bridge
>   enablement · no original-image resend · no live.

> **STATUS: Phase 3.5C DONE ✅ (commit `7f06b88`).** Admin/test HTTP route:
> - Added an **admin-authenticated, read-only** route: `POST /api/agent/tools/retrieval-answer`
>   (registered under `agentRoutes` → inherits `adminAuth` + rate limit).
> - Added `RetrievalAnswerToolInput` Zod schema (`agent/tool-schemas.ts`).
> - Handler calls **`answerRetrieval()` directly** — **no ToolGateway runtime wiring**, no `sendOutbound`,
>   no provider AI, no bridge enablement, no Zalo send. Pure read.
> - Supports optional **role simulation** for admin testing: `role` defaults to `admin`; an admin can pass
>   `basic_chat` to verify `permission_denied` on a cross-thread request.
> - Output returns verbatim from the service: `{ status, answerText, evidence[], confidence }`.
> - Tests: first `fastify.inject` route harness — **auth required (401)**, menu retrieval with
>   `attachmentId` evidence, `permission_denied` (role simulation), redaction preserved, and read-only
>   (no `OutboundRecord` written). Full required set passed; backend typecheck **0**.
> - **Still deferred:** no autoReply integration · no live · no original-image resend.

**Goal:** the bridge can store, understand, index, and retrieve information from inbound
image/file/media by **thread / date / keyword**, safely and with evidence.

**Motivating example (the use case that drives this phase):**
- **10 May:** a user posts a photo of shop B's menu in **group A**.
- Bridge saves the message **+ the attachment** (image), linked to the message/thread/sender/date.
- Bridge runs **OCR / image understanding** to extract text, e.g.
  *"Menu cửa hàng B: cơm gà 45k, bún bò 50k…"* (extracted text is redacted before indexing).
- **20 May:** an authorized user asks *"gửi tôi thực đơn cửa hàng B trong group A"*.
- Bridge searches **group A only**, by keyword (*cửa hàng B / menu / thực đơn*), optionally by date range.
- Bridge answers **with evidence**: *"Tôi tìm thấy ảnh menu được gửi trong group A ngày 10/5…"*.
- If it must **resend the original image**, that goes through **OutboundDispatcher + permission +
  dryRun/live gate** (never a direct send).

**Required capabilities**
1. **Inbound attachment capture:** image · file/pdf · voice/audio · video (if present); persist
   `mimeType`, `fileName`, `size`, `hash`, `storageKey`, and links to
   `messageId / threadId / threadType / senderId / createdAt`.
2. **Safe storage:** never store raw secrets even if OCR/file content contains them (apply redaction
   **after** OCR/extract); hash files for dedupe; enforce size limit + allowed MIME types; quarantine
   unsupported/unsafe files (no unsafe execution/opening).
3. **OCR / image understanding:** image menu → text; screenshot → text; PDF menu → text when possible;
   Vietnamese-language support; if OCR is unavailable → mark `extractionStatus=unavailable` and
   **never hallucinate** the image's contents.
4. **Attachment index fields:** `extractedText`, `caption/summary`, `keywords`, `sourceMessageId`,
   `sourceThreadId`, `sourceThreadType`, `sourceDate`,
   `extractionStatus: pending|success|failed|unavailable`, `redactionApplied=true`.
5. **Memory search extension:** search by `threadId/threadType`, by keyword, by date range, with
   `includeAttachments=true`; results carry evidence (`messageId`, `attachmentId`, `createdAt`,
   redacted sender, `confidence`); **no cross-thread leak**.
6. **Permission (RBAC on retrieval too):** a user may only search threads they are permitted to; admin
   searches per admin scope; a not-yet-allowed thread cannot be auto-replied/written; **read retrieval
   is also RBAC-gated** for sensitive data; **group A data must never leak into group B**.
7. **Reply behavior (evidence-first, no fabrication):**
   - OCR text found → reply with a text summary of the menu + the date sent + the source.
   - Attachment found but not yet OCR'd → say plainly *"tôi tìm thấy ảnh liên quan nhưng chưa đọc được nội dung"*.
   - Nothing found → say so plainly; do not invent.
   - If resending the image → via governed outbound/media path, dryRun/live gate, with evidence.
   - **No evidence → never claim "tôi tìm thấy".**

**Tests**
- image attachment saved with message link;
- OCR text redacted before index;
- search "cửa hàng B" finds the OCR result in the **same** group;
- same keyword in a **different** group does **not** leak;
- date-range filter narrows results;
- OCR unavailable → no hallucination (status surfaced, no invented menu);
- user without permission cannot search a group's attachments;
- resending the image uses OutboundDispatcher and produces a dryRun synthetic id (no live send);
- attachment **hash dedupe** works;
- a secret inside OCR text is redacted.

**Files likely affected**
- prisma schema / models: `Attachment` (or `MessageAttachment`), `AttachmentExtraction` (or `MemoryIndex`);
- `services/zalo-receive.ts` (attachment capture on inbound);
- `services/attachment-ingest.service.ts` (new), `services/attachment-index.service.ts` (new);
- `services/ocr-provider/*` (new; pluggable, default OFF/unavailable-safe);
- `services/tools/memory/*` (search extension: date/keyword/includeAttachments);
- `services/outbound-dispatcher.service.ts` (governed media resend, if needed);
- `services/trace.service.ts` (attachment evidence in trace);
- `routes/access.ts` or a `routes/memory` (if an admin search endpoint/UI is added);
- frontend (later): trace page attachment evidence, memory-search UI, AllowThreads/thread-detail may show
  attachments if safe.

**Acceptance criteria**
- If a menu image was posted in group A on 10 May and OCR/index succeeded, a 20 May query finds it by
  keyword + group scope.
- The answer is **evidence-backed** and not fabricated.
- **No other-group leak.**
- **No secret stored** in OCR text (redaction applied post-extraction).
- **No live image resend** without permission + governed outbound.
- If OCR is pending/failed → the bot says it could not read the content; it does not guess.

**Readiness impact**
- **Not required** for the first text-only limited-live DM.
- **Required** before advertising that the bot can "find old images/menus/files".
- **Required** before enabling any media/attachment retrieval live.
- Should land **before advanced task/reminder work** if those workflows depend on images/files/menus/docs.
**Blocks live:** no for text-only DM; **yes** for any media-retrieval live.

---

### PHASE 4 — KI-H3 persistent dedupe / idempotency (HIGH, gate for expanded live)

> **STATUS: Phase 4A DONE ✅ (commit `8426a6a`).** The text reply path now has persistent,
> restart/retry-safe idempotency:
> - `OutboundRecord` gained `idempotencyKey String? @unique` + `inboundMessageId String?`
>   (additive, nullable migration `20260706000000_add_outbound_idempotency`).
> - Keyed text replies **write-ahead reserve** an `OutboundRecord` (reason `reserved`) **before** the
>   provider send, then update the same row after send — one row per keyed send (sender `skipRecord`).
> - A repeat of the same inbound (or identical content) — including after **restart/retry** or a
>   **concurrent** duplicate (P2002 unique violation) — is **skipped** with `reason=duplicate_idempotency`
>   and the provider is **not** called.
> - Works identically for **dry-run** and **future live**.
> - Key format: `reply:<inboundMessageId>:<threadId>:<threadType>`; fallback (no inbound id):
>   `reply:unknown:<threadId>:<threadType>:<contentHash16>`. (Tools/reactions/polls already had
>   `@unique` idempotency keys — unchanged.)
> - Tests: **87/87 passed** (incl. new `outbound-idempotency.test.ts`, 6 cases); backend typecheck 0.
>
> **Deferred (not in 4A):**
> - **Phase 4B** — reminder/schedule fire idempotency (`reminder:<scheduleId>:<fireAt>:<threadId>:<threadType>`).
> - Persistent inbound fallback dedupe for messages with **no `zaloMessageId`** (currently in-memory only).
> - Live-test quota **atomicity** (check→increment race on `LiveTestSession.sentCount`).
> - **Explicit retry policy** for a failed live send (a failed reservation currently blocks accidental
>   auto-retry by design — a deliberate retry needs an explicit mechanism).

**Goal:** no duplicate send after a restart or cache reset.

Evidence: legacy `outbound-dedupe/` (218 hits, in-memory/file, not restart-proof); bridge has
`OutboundRecord` + `idempotencyKey` but consumption not wired. KI-H3; harvest §9.

1. **Current:** `OutboundDispatcher` writes `OutboundRecord`; `zalo-receive.ts` dedups inbound via an
   in-memory `recentDedupKeys` set + DB `zaloMessageId` unique check. Outbound idempotency **not consumed**.
2. **OutboundRecord fields:** confirm presence of `idempotencyKey` (`@@unique`) + `contentHash` (added in
   the evidence migration). If missing on the send path, wire it.
3. **Idempotency key scheme:**
   - reply: `reply:{inboundMessageId}:{threadId}`
   - schedule/reminder: `schedule:{scheduleId}:{fireAtISO}`
   - tool: `tool:{toolName}:{threadId}:{sha256(args)}`
4. **Before send:** look up existing `OutboundRecord`/`ToolCallRecord` by idempotencyKey; if present →
   `decision=skip`, `reason=duplicate_idempotency`, trace links the existing record. Persist the key
   **before** the live/dry send completes (write-ahead) so a crash mid-send still dedups on retry.
5. **Tests:**
   - same inbound processed twice → exactly one `OutboundRecord`.
   - simulate restart (clear in-memory cache) → still one record (DB-backed).
   - same content, different thread → two separate records.

**Acceptance:** duplicate suppression survives restart; trace shows skip+link on duplicates.
**Blocks live:** partial — not strictly required for a single manual DM (quota=1), but **required before
expanded live** and before enabling reminders (which auto-fire).

---

### PHASE 5 — AllowThreads UI final verification + Access Control clarity (M1 finish)
**Goal:** the thread-granting UI is reliable before live.

Evidence: KI-H5 (initial Friends tab empty; fixed via per-tab state + request-seq guard — needs browser confirm).

1. **Hard-refresh `/allow-threads` checks:** Friends renders immediately on first load (no tab-switch);
   Groups renders on tab open; Allowed tab authoritative; Search works (debounced); toggle persists.
2. **If initial-tab-empty recurs:** verify initial `useEffect` fires the default-tab fetch on mount,
   `loading=true` precedes fetch, empty state only when `loaded && !loading && !failure && items.length===0`,
   and the request-seq/AbortController guard prevents a stale empty response overwriting fresh state.
3. **Access-Control vs AllowThreads copy (UI text):** Access Control = principal/RBAC (who a sender *is*,
   what role/permissions); AllowThreads = per-thread allowlist (which threads the bot may act in).
   Add a one-line explainer on each page to prevent operator confusion.
4. **Frontend tests (where feasible):** initial fetch renders rows; 401/403 → auth error; 429 → rate-limited;
   503 → "Zalo not connected"; toggle failure → rollback + error (not silent).
5. **Live verify (browser, no send):** initial load, tab switch back-and-forth, refresh, search, toggle.

**Acceptance:** Friends visible on first load without tab-switch; states explicit; toggle persists/rolls back.
**Blocks live:** no (operability, not safety) — but strongly recommended before granting live threads.

---

### PHASE 6 — Dashboard polling 429 (KI-M1)
**Goal:** the dashboard's own polling never trips the rate limiter.

Evidence: KI-M1 — `/api/zalo/login/status` polled faster than `strictRateLimit` (20/min).

1. **Endpoints polled:** zalo ops/status endpoints (some already public via `zaloPublicOpsRoutes`).
2. **Current limiter:** `strictRateLimit` (write-grade) applied broadly to protected zalo routes.
3. **Fix:** separate a lenient limiter (or exempt) for **read-only status/polling** endpoints; keep
   `strictRateLimit` on write/action endpoints. Do not remove auth from anything protected.
4. **Frontend polling:** sane interval (e.g. 5–10s), pause when tab hidden (`visibilitychange`),
   exponential backoff on 429.
5. **Tests:** no-auth still 401 on protected routes; admin status polling within window → no 429;
   write endpoints remain strict.

**Acceptance:** normal dashboard polling never 429s; writes still throttled; auth unchanged.
**Blocks live:** no.

---

### PHASE 7 — Trace exact linking (KI-M2)
**Goal:** Decision Trace links inbound → outbound/tool/action exactly, not best-effort.

Evidence: KI-M2 — `trace.service.ts` links outbound best-effort (no `messageId` on `OutboundRecord`).

1. **Current:** trace correlates by thread + time window (best_effort) because the outbound record lacks a
   direct back-reference to the inbound message.
2. **Add links:** `inboundMessageId`, `relatedMessageId`, `outboundRecordId`, `agentTaskId`,
   `toolCallRecordId` on the relevant records / trace entries.
3. **On create:** when an outbound (dryRun or live) or tool/action record is created, populate the exact
   inbound/agent-task linkage instead of relying on time proximity.
4. **Tests:**
   - inbound reply (dryRun) → trace links the exact `OutboundRecord`.
   - blocked inbound → trace shows no outbound (and the block reason).
   - governed tool action → trace links the exact `ZaloActionRecord`/`ToolCallRecord`.

**Acceptance:** trace confidence is `exact` for linked records; no cross-thread mislink.
**Blocks live:** no (observability), but improves live-test auditability — do before/with Phase 9.

---

### PHASE 8 — Agent Bridge dry-run re-test (M3, stays OFF by default)
**Goal:** confirm the structured bridge is safe when exercised locally in dry-run — without enabling it by default.

1. **Enable conditions (local only, temporary):** `HERMES_AGENT_BRIDGE_ENABLED=true` **local only**,
   auto-reply scoped to exactly one allowed DM, `ZALO_AUTO_REPLY_DRY_RUN=true`. Revert all flags after.
2. **Tests / checks:**
   - AI provider unavailable → text-only fail-safe fallback (no crash, no fabricated claim).
   - bounded tool loop (max rounds) → terminates.
   - unsupported-claim guard blocks "đã gửi/đã kiểm tra" without evidence.
   - no direct `zca-js` import in agent/tools (Bridge owns the provider).
   - no live send (dryRun synthetic outbound only).
3. Note: without a real `CHIASEGPU_API_KEY`, replies are canned fail-safe — acceptable; do not fabricate a key.

**Acceptance:** bridge OFF by default; when locally enabled in dry-run it never sends live, never fabricates,
and always falls back safely.
**Blocks live:** no (bridge stays off for the first limited live test — reply can be canned/manual).

---

### PHASE 9 — Limited live test PLAN (M7) — PLAN ONLY, do not run
**Goal:** define (not execute) the first real send, maximally bounded.

Constraints:
- **Exactly one** allowed DM thread (the known test DM), group threads **blocked**.
- `LiveTestSession` with **TTL 5 minutes** and **quota = 1 reply**.
- Trace **required** for the send (exact linking from Phase 7).
- **Kill switch:** cancel session / flip dryRun on → instant stop.
- **No global live:** autoReply stays off by default; only enabled *inside* the bounded session if truly needed.
- **Abort conditions (any → stop + revert to dryRun):**
  - listener heartbeat stale,
  - trace missing/incomplete for the send,
  - any outbound duplicate detected,
  - any unexpected group event,
  - any secret-redaction failure on inbound.

**Acceptance (of the plan):** documented session parameters, abort matrix, and rollback; no code run;
no flags flipped. Execution happens only after explicit approval and after Phases 1–3 land (+ Phase 4/7 recommended).

---

### PHASE 10 — Product feature roadmap after live (post limited-live)
Only after limited-live passes, rebuild the legacy bot's core features — all governed via OutboundDispatcher
+ dryRun + allowlist + trace, with no-reply → human escalation baked in (never resurrect the nagging loop):

1. **Task / checklist manager** (per-user NL capture, status, report-on-`.`) — KI-H6, harvest §2,§6.
2. **Reminder / timer engine** (one-shot + recurring, ack detection, expiry) — followup-archive evidence.
3. **Follow-up: no-reply → human escalation** (capped re-nudges + handoff) — KI-H4.
4. **Poll create + vote tracking + non-voter nudge** — `checkpoint` evidence.
5. **Attendance / điểm danh** helper.
6. **Meeting-notes** helper.
7. **Rich-card / template messages.**
8. **Group @mention gate + human approval** for group announcements/broadcasts — group-dominant traffic.
9. **Identity roster / pháp-danh lookup** (PII-safe, redacted) — `.dreams` evidence.
10. **Media / voice / image safe handling** (never trigger unsafe live send on unknown media) — KI-L3.
11. **Attachment-aware memory** (see Phase 3.5) — index and recall inbound media by thread/date/keyword.
12. **Menu / document retrieval** — answer "gửi tôi thực đơn cửa hàng B trong group A" from indexed OCR text.
13. **Thread-scoped file search** — search attachments within a permitted thread only (no cross-thread leak).
14. **OCR / image understanding for Vietnamese** — extract text from menu photos, screenshots, PDFs.
15. **Evidence-backed answer with source message/attachment** — every retrieval cites messageId/attachmentId/date.
16. **Governed attachment resend** — resending an original image/file goes through OutboundDispatcher + dryRun/live gate.

---

## Cross-phase summary

### Priority order (recommended sequence)

**Track 1 — limited live, text-only (the fastest safe path to a first real reply):**
`Phase 0 (checkpoint)` → `Phase 1 (KI-B4 redaction, BLOCKER)` → `Phase 2 (KI-H1 identity)` →
`Phase 3 (KI-H2 session recovery)` → `Phase 5 (AllowThreads verify)` → `Phase 7 (trace linking)` →
`Phase 9 (limited-live plan → approval → run)`.
(Phase 6 / dashboard 429 and Phase 8 / bridge dry-run re-test can run in parallel; neither blocks a
text-only DM.)

**Track 2 — media retrieval / reminder / expanded live (after Track 1):**
`Phase 3.5 (media/attachment indexing)` → `Phase 4 (persistent dedupe)` → `Phase 10 (feature rebuild)`.

Notes:
- **Limited live text-only does NOT need Phase 3.5.**
- But the use case *"lục lại menu ảnh trong group"* (find an old menu image in a group) **needs Phase 3.5.**
- **Expanded live** or any **group / media retrieval** should have **Phase 3.5 + Phase 4** in place first.

Minimum gate set for **READY_FOR_LIMITED_LIVE_TEST** (text-only): Phases **1, 2, 3** done; Phase **5**
verified; Phase **7** recommended; Phase **9** plan approved. (Phase 4 is a gate for *expanded* live,
not the first DM; Phase 3.5 is a gate for *attachment retrieval*, not the first DM.)

### Files likely affected (by phase)
- **P1:** `services/tool-gateway/redaction.ts` (extend), `services/zalo-receive.ts` (inbound save),
  `services/trace.service.ts` (verify), memory tools (`services/tools/memory/*`), + tests/fixtures.
- **P2:** inbound normalize (upstream of `zalo-receive.ts`), `services/incoming-dispatcher.service.ts`,
  `services/principal.service.ts`, `services/trace.service.ts`, allowlist/discover source.
- **P3:** `services/heartbeat.service.ts`, `services/zalo-gateway.service.ts` (WS/reconnect), status route.
- **P3.5:** prisma schema (`Attachment`/`MessageAttachment`, `AttachmentExtraction`/`MemoryIndex`),
  `services/zalo-receive.ts` (attachment capture), new `services/attachment-ingest.service.ts` +
  `services/attachment-index.service.ts` + `services/ocr-provider/*`, `services/tools/memory/*`
  (search extension), `services/outbound-dispatcher.service.ts` (media resend), `services/trace.service.ts`,
  `routes/access.ts` or a new `routes/memory`, frontend (trace attachment evidence + memory-search UI).
- **P4:** `services/outbound-dispatcher.service.ts`, `OutboundRecord`/`ToolCallRecord` usage, prisma schema (idempotency fields).
- **P5:** `frontend/src/app/allow-threads/page.tsx`, `routes/access.ts`, `services/threads-access.service.ts`.
- **P6:** `middleware/rate-limit.ts`, `routes/zalo.ts`, frontend polling hooks.
- **P7:** `services/trace.service.ts`, `services/outbound-dispatcher.service.ts`, record schemas.
- **P8:** `services/agent-bridge/*`, `services/unsupported-claim-guard.service.ts` (tests only).

### Tests required (rollup)
Inbound redaction (sk-/JWT/Bearer/phone/idempotent/normal-text preserved); identity resolution
(null-threadId group/DM, blank sender no-elevation, id collision, confidence in trace); reconnect
(stale→schedule, fail→error+alert, success→active, disconnected→no live); persistent dedupe
(twice→one, restart→one, cross-thread→two); AllowThreads UI states (initial render, 401/429/503, toggle
rollback); rate-limit (no-auth 401, polling no-429, writes strict); trace exact-link (reply/blocked/tool);
agent-bridge dry-run (fallback, bounded loop, claim-guard, no zca-js, no live).

### Blockers
- **KI-B4** inbound secret redaction — BLOCKER before any real inbound (Phase 1).
- **KI-H1** identity/threadId — HIGH gate for a trustworthy DM reply (Phase 2).
- **KI-H2** session/listener auto-recovery — HIGH gate for live stability (Phase 3).

### Warnings
- Stale Prisma migrations vs `schema.prisma` (dev built via `db push`) — do **not** `migrate deploy`
  blindly; reconcile before prod (KI-M3 / M10). Local schema changes for P4/P7 should use `db push` in dev.
- Do not enable autoReply/bridge/live globally; any live is session-scoped, quota/TTL-bounded, kill-switched.
- Redaction tuning risk: high-entropy pattern must be tested against real chat samples to avoid masking
  legitimate IDs/URLs.

### Definition of Done — READY_FOR_LIMITED_LIVE_TEST
1. Inbound `Message.content` + metadata redacted before persist; trace/memory never expose raw secrets;
   redaction idempotent; normal Vietnamese text preserved. (Phase 1 tests green.)
2. threadId/threadType/senderId resolved deterministically; `identityConfidence` recorded; blank/unknown
   sender never elevated; no `unknown-thread-type` for resolvable inputs. (Phase 2 tests green.)
3. Listener auto-recovers on WS drop with bounded backoff; status→error + alert on exhaustion; recovery
   never enables autoReply/live. (Phase 3 tests green.)
4. AllowThreads UI shows Friends on first load; states explicit; toggle persists/rolls back. (Phase 5 verified.)
5. Trace links inbound→outbound/tool exactly for the test path (Phase 7, recommended).
6. Safety flags still `autoReply=false`, `dryRun=true`, `bridge=false`; a `LiveTestSession` mechanism exists
   with TTL/quota/kill-switch and an abort matrix (Phase 9 plan approved).
7. Targeted test suites + typecheck green; clean git checkpoint (Phase 0) with no secrets/session/db staged.

### Definition of Done — READY_FOR_ATTACHMENT_RETRIEVAL
1. Inbound **attachments saved and linked** to their `Message` (mimeType/fileName/size/hash/storageKey +
   thread/sender/date).
2. **OCR/extraction pipeline works** or cleanly marks `extractionStatus=unavailable` (never hallucinates).
3. **Extracted text is redacted** before indexing (no secret persisted from OCR/file content).
4. **Memory search** supports thread / date / keyword / `includeAttachments`.
5. **Results include evidence** (messageId, attachmentId, createdAt, redacted sender, confidence).
6. **No cross-thread leak** (group A never surfaces in a group B query).
7. **Resending an attachment** goes through the governed outbound dryRun/live gate (with permission + evidence).
