# Limited Live Test Runbook — Text-Only, 1 DM (Phase 9)

**STATUS: PLAN ONLY. Not executed. No live send performed by writing this document.**

Scope: the first real Zalo send, maximally bounded — **one DM thread, one reply, 5-minute window**.
Execution happens **only after a separate explicit approval** and only after the preflight + dry-run
rehearsal below both PASS.

Track 1 prerequisites (all committed, `master`):
- `417aa37` inbound secret redaction (KI-B4)
- `042d57e` identity normalization (KI-H1)
- `b68655a` listener/session recovery watchdog (KI-H2)
- `4bcd591` AllowThreads clarity + verified
- `de638e4` exact trace linking (KI-M2 / Phase 7)

Default safety posture (must be TRUE before and after the test; only relaxed *inside* the approved window):
- `ZALO_AUTO_REPLY_ENABLED=false`
- `ZALO_AUTO_REPLY_DRY_RUN=true`
- `HERMES_AGENT_BRIDGE_ENABLED=false`
- `ZALO_DRY_RUN=false` (connection realism only; outbound simulated by the auto-reply dryRun flag)

Hard limits for the whole test: 1 DM thread only · groups blocked · structured bridge OFF · text reply
only (no media / reminder / poll / broadcast / tools) · quota 1 real reply · TTL 5 minutes · trace
required · kill switch ready.

> Placeholders used throughout — never write real secrets/tokens/threadIds into logs or this file:
> `<TARGET_DM_THREAD_ID>`, `<ADMIN_USER>`, `<ADMIN_PASS>`, `<BACKEND_URL>` (e.g. http://localhost:3002).

---

## PART 1 — Preflight checklist (must all PASS)

### 1.1 Git
- [ ] `git status` clean (no uncommitted changes).
- [ ] `git log` HEAD includes the 5 Track-1 commits above.
- [ ] No stray debug/temp files in the tree.

### 1.2 Safety flags (read `.env`, do not print secrets)
- [ ] `ZALO_AUTO_REPLY_ENABLED=false`
- [ ] `ZALO_AUTO_REPLY_DRY_RUN=true`
- [ ] `HERMES_AGENT_BRIDGE_ENABLED=false`
- [ ] `ZALO_DRY_RUN=false`

### 1.3 Zalo status (`GET <BACKEND_URL>/api/zalo/ops/status`, public)
- [ ] backend healthy (`GET /api/health` → 200)
- [ ] `connected = true`
- [ ] `listenerActive = true`
- [ ] `recovery.recoveryState = "idle"`
- [ ] `recovery.reconnectAttempts = 0` (or a low, explained value)
- [ ] `recovery.lastReconnectError = null`
> If disconnected: connecting requires operator QR/restore — **out of scope for the agent**; a human
> must connect. Do NOT auto-QR.

### 1.4 AllowThreads (admin Basic auth)
- [ ] **Snapshot** current allowlist: `GET /api/access/threads/allowed` → save `data` verbatim.
- [ ] Allowlist contains **only** `<TARGET_DM_THREAD_ID>` as `threadType: "user"`.
- [ ] **No** group is allowed (`threadType: "group"` count = 0).
- [ ] Verify no user/group same-id collision (target allowed as `user` does NOT allow same id as `group`).

### 1.5 Trace
- [ ] `GET /api/trace` (admin) responds.
- [ ] In the dry-run rehearsal (Part 2), `link.linkMode = "exact"` for the reply.
- [ ] Trace content shows `[REDACTED]` for any secret-like input (no raw secret).
- [ ] `identityResolution.confidence` present and **not** `"unknown"` for the target DM.

### 1.6 Outbound
- [ ] OutboundDispatcher is the sole send door (no direct zca-js send in agent/tools).
- [ ] Dry-run rehearsal (Part 2) passed with `dryRun=true` outbound records only.
- [ ] No stuck/pending jobs if a queue is in use.

### 1.7 Kill switch ready (know these BEFORE starting)
- [ ] Command to disable instantly: set `ZALO_AUTO_REPLY_ENABLED=false` + `ZALO_AUTO_REPLY_DRY_RUN=true`.
- [ ] How to restart backend/worker for env changes to take effect.
- [ ] How to disallow the target thread immediately (PATCH `/allow` with `allowed:false`).

---

## PART 2 — Dry-run rehearsal (MANDATORY before live)

Goal: prove the full inbound→decision→outbound→trace chain works with **zero live send**.

Setup:
- Allow only `<TARGET_DM_THREAD_ID>` (user).
- If needed to exercise the reply path: `ZALO_AUTO_REPLY_ENABLED=true` **with** `ZALO_AUTO_REPLY_DRY_RUN=true`
  (still no live send). Bridge stays OFF.

Action: from the target DM, send one test message, e.g. `test dryrun 1`.

Expected (all must hold):
- [ ] inbound Message saved.
- [ ] secret redaction active (paste an `sk-…`-shaped fake in a second test msg → stored `[REDACTED]`).
- [ ] `identityResolution.confidence` = `exact`/`derived` (not `unknown`); sender not elevated if blank.
- [ ] safety decision = allow (thread is allow-listed).
- [ ] OutboundRecord `dryRun=true`, `decision=allow`.
- [ ] **no live send** (deliveryStatus dry_run / synthetic sent id).
- [ ] trace `link.linkMode = "exact"`, links inbound→reply→outboundRecord.
- [ ] a group message (from any non-allowed group) → **blocked**, no outbound.

After rehearsal:
- [ ] Revert `ZALO_AUTO_REPLY_ENABLED=false`, `ZALO_AUTO_REPLY_DRY_RUN=true` (restart if env-based).
- [ ] Confirm no live outbound was produced.
- [ ] Confirm trace was exact.

**Do not proceed to Part 3 unless every box above is checked.**

---

## PART 3 — Limited-live execution plan (PLAN ONLY — run only after separate approval)

When approved, open a **single** 5-minute window with a quota of **1 real reply**.

### 3.1 Snapshot (record before touching anything)
- `git status` (expect clean)
- env flags (before)
- allowlist (`GET /allowed`)
- Zalo status (`connected`, `listenerActive`, `recovery`)
- last 10 outbound records (`GET /api/zalo/ops/recent-events` or trace list) for a baseline count

### 3.2 Configure the window
- Allow **only** the target DM (`<TARGET_DM_THREAD_ID>`, user). Groups remain blocked.
- If a `LiveTestSession` mechanism exists: create it with **TTL=5m, quota=1**, target = the DM.
- Relax flags **for the window only**:
  - `ZALO_AUTO_REPLY_ENABLED=true`
  - `ZALO_AUTO_REPLY_DRY_RUN=false`
  - `HERMES_AGENT_BRIDGE_ENABLED=false` (unchanged — bridge stays OFF)
- Start a stopwatch (5 minutes).

### 3.3 Trigger (exactly one)
- From the target DM, send one simple message: `test live limited 1`.
- Do not send more; do not trigger from any other thread.

### 3.4 Observe (live)
- [ ] inbound saved for the target DM.
- [ ] reply sent **exactly once**.
- [ ] exactly **one** OutboundRecord with `dryRun=false` for the target thread.
- [ ] trace `link.linkMode = "exact"`.
- [ ] **no** group outbound.
- [ ] **no** duplicate send.
- [ ] `listenerActive` still true; `recovery.recoveryState = idle`.

### 3.5 Stop immediately (end of window or on success)
- `ZALO_AUTO_REPLY_ENABLED=false`
- `ZALO_AUTO_REPLY_DRY_RUN=true`
- Optionally disallow the target thread.
- Restart backend/worker if flags are env-based.
- Confirm no further outbound after stop.

---

## PART 4 — Abort conditions (ABORT + run Part 5 rollback immediately if ANY occur)

- more than 1 outbound
- any group outbound
- trace missing or `linkMode` not exact for the reply
- `identityResolution.confidence = unknown` for the target
- any secret appears **unredacted** in DB / trace / logs
- `listenerActive = false`
- `recovery.recoveryState = error` (or unexpectedly `reconnecting`) during the window
- duplicate send detected
- Zalo disconnected mid-window
- queue stuck / jobs piling up
- any unexpected bridge or tool call
- allowlist changed unexpectedly (differs from snapshot)
- any live send to a **non-target** thread

---

## PART 5 — Rollback commands (placeholders only — never echo real secrets)

Order of operations:
1. **Disable auto-reply + force dry-run** (kill switch):
   - `ZALO_AUTO_REPLY_ENABLED=false`
   - `ZALO_AUTO_REPLY_DRY_RUN=true`
2. **Disallow the target thread**: PATCH `<BACKEND_URL>/api/access/threads/allow`
   body `{ "changes": [{ "threadId": "<TARGET_DM_THREAD_ID>", "threadType": "user", "allowed": false }] }`
   (or restore the exact Part 3.1 allowlist snapshot).
3. **Restart backend/worker** if flags are read from env at boot (so the change takes effect).
4. **Verify no further outbound**: recheck outbound records; count of new `dryRun=false` records must stop increasing.
5. **Capture logs** (redacted) + the trace for the window for the evidence report.
6. **Leave git unchanged** — no commit of env/session; `.env` stays gitignored.

Safety invariants after rollback (re-verify):
- `ZALO_AUTO_REPLY_ENABLED=false` · `ZALO_AUTO_REPLY_DRY_RUN=true` · `HERMES_AGENT_BRIDGE_ENABLED=false` · `ZALO_DRY_RUN=false`
- allowlist matches the pre-test snapshot (target disallowed again unless intentionally kept)

---

## PART 6 — Evidence report template (fill after the test)

```
# Limited Live Test — Evidence Report

Time window:            <start ISO> .. <end ISO>  (<= 5 min)
Target threadId:        <MASKED …last4>
Bridge enabled:         false (expected)

Auto-reply flags:
  before:  enabled=false dryRun=true
  during:  enabled=true  dryRun=false
  after:   enabled=false dryRun=true

Allowlist:
  before:  [target user only]  (snapshot hash/count)
  after:   [restored]           (matches before? yes/no)

Inbound message id:     <cuid>
Outbound record id:     <cuid>
Trace linkMode:         exact | best_effort | none
identityConfidence:     exact | derived | unknown
dryRun=false count:     <n>   (expected: 1)
duplicate count:        <n>   (expected: 0)
group outbound count:   <n>   (expected: 0)
non-target outbound:    <n>   (expected: 0)

Recovery status:        recoveryState=<...> listenerActive=<...> reconnectAttempts=<...>
Secret redaction:       no raw secret in DB/trace/log? yes/no

Final status:           PASS | FAIL
Abort triggered:        none | <condition>
Rollback performed:     yes/no  (details)
Notes:                  <...>
```

PASS criteria: exactly 1 `dryRun=false` outbound to the target, 0 duplicates, 0 group/non-target
outbound, trace `linkMode=exact`, identity not unknown, no unredacted secret, listener healthy,
flags restored to safe defaults afterward.

---

## Definition of Done (Phase 9)
- This runbook exists and is reviewed.
- Preflight + dry-run rehearsal checklists are actionable and bounded.
- Execution plan is quota/TTL-bounded with a kill switch, abort matrix, and rollback.
- **No live executed** by this phase; safety flags unchanged.
