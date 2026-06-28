# Agency Agents Review Report — zalo-admin-center

**Date:** 2026-06-28
**Reviewers:** backend-engineer, security-engineer, database-engineer, qa-test-engineer, devops-sre
**Scope:** Full repository review after Batch 1–10 completion

---

## Summary

- **Overall verdict:** ⚠️ CONDITIONAL PASS — 10 Critical/High findings need resolution before production
- **Typecheck:** PASS (shared + backend + frontend)
- **Tests:** 425/430 PASS (5 pre-existing failures)
- **Backend build:** PASS
- **Frontend build:** PASS (15 pages)
- **Secret audit:** PASS (0 secrets leaked)
- **Config check:** PASS (existing checks functional, gaps noted below)

---

## Critical Findings

### 🔴 Critical 1 — Dual Dry-Run Flags with Opposite Defaults

- **File:** `config.ts:58,71` / `zalo-message-sender.ts:24` / `runtime-config.service.ts:76`
- **Issue:** Two independent dryRun flags exist: `config.zalo.dryRun` (env: `ZALO_DRY_RUN`, default `false`→LIVE) and `config.autoReply.dryRun` (env: `ZALO_AUTO_REPLY_DRY_RUN`, default `true`→SAFE). The auto-reply dispatcher uses the runtime-aware `getCurrentEffectiveDryRun()`, but ZaloMessageSender checks `config.zalo.dryRun`. Runtime toggle API only affects `autoReply.dryRun`. Direct send APIs (send-test, send-media, send-voice) bypass the dispatcher and use the sender's flag, potentially sending real messages even when dryRun is enabled.
- **Impact:** API routes `POST /api/zalo/send-test`, `/send-media`, `/send-voice` could send real Zalo messages with `ZALO_DRY_RUN` unset (default `false`), regardless of auto-reply dryRun setting.
- **Suggested fix:** Unify to single dryRun source. Have `ZaloMessageSender` consume `getCurrentEffectiveDryRun()`. Remove global `(config.zalo as any).dryRun` mutation at `zalo.ts:359-362`.
- **Test needed:** Integration test verifying all send paths (auto-reply, schedule, API send-test, media, voice) honor the same dryRun toggle.
- **Risk if ignored:** Accidental live Zalo sends from admin API while thinking dryRun is active.

---

### 🔴 Critical 2 — `executeRunNow` Hardcodes `"group"` ThreadType + Missing AI DryRun Guard

- **File:** `workers/scheduler.ts:349, 318-371`
- **Issue:** (a) `executeRunNow` passes hardcoded `"group"` threadType to sender, ignoring actual thread type. DMs get sent as group messages. (b) `executeRunNow` lacks the AI dryRun guard that `executeJob` has at line 109-123. Admin "Run Now" on AI-created schedules bypasses the safety barrier.
- **Impact:** DM messages fail due to wrong threadType. AI schedules run live even when auto-reply dryRun is enabled.
- **Suggested fix:** Add `threadType = await resolveThreadType(schedule)` before send. Add AI dryRun guard mirroring `executeJob` lines 109-123.
- **Test needed:** Test `executeRunNow` with DM threads and with AI-created schedules under dryRun=true.
- **Risk if ignored:** Silently broken DM sends + dryRun safety bypass for admin-executed schedules.

---

### 🔴 Critical 3 — Cooldown Race Condition: Duplicate Replies Possible

- **File:** `incoming-dispatcher.service.ts:88` (check) vs `1177` (set)
- **Issue:** Cooldown is checked at `safetyCheck` (line 88) but `setCooldown` is only called AFTER all async work completes (~line 1177). Between these points, the function performs DB reads, agent task creation, Hermes chat (seconds of network), and send. A second incoming message from the same thread can arrive, pass the cooldown check (since cooldown hasn't been set yet), and trigger a duplicate reply.
- **Impact:** Duplicate auto-replies sent to users, potential Zalo rate-limiting.
- **Suggested fix:** Call `setCooldown(msg.threadId)` immediately after `groupGateCheck` succeeds (~after safetyCheck), not at the end of processing.
- **Test needed:** Test sending two rapid messages to the same thread and verifying only one reply is generated.
- **Risk if ignored:** Users receive duplicate replies; Zalo may rate-limit/ban the bot.

---

## High Findings

### 🟡 High 1 — Unauthenticated Config-Check Endpoint

- **File:** `system.ts:15-18` / `app.ts:55`
- **Issue:** `/api/system/config-check` is registered under `systemRoutes` without `adminAuth` preHandler. It returns secret metadata (key lengths, partial prefixes), DB path, backup paths — all unauthenticated.
- **Impact:** Any network-accessible scanner can enumerate system config, API key presence, and file paths.
- **Suggested fix:** Add `{ preHandler: [adminAuth] }` to the route, or register it under the protected group in `app.ts`.
- **Test needed:** Verify endpoint returns 401 without auth.
- **Risk if ignored:** Information disclosure to unauthenticated attackers.

---

### 🟡 High 2 — Worker Health Always Reports `active: true`

- **File:** `system-health.service.ts:210-225`
- **Issue:** `collectWorker()` returns `{ active: true }` by default — only sets `false` on DB error. Never checks if the worker process is actually running. The health degrade rule `!snapshot.worker.active → degraded` will **never trigger** for worker death.
- **Impact:** Worker crash goes completely undetected; health endpoint reports `healthy` while schedules aren't executing.
- **Suggested fix:** Check `schedulerWorker` heartbeat status. If heartbeat is stale/down, set `active: false`.
- **Test needed:** Mock worker heartbeat as stale, verify health status becomes `degraded`.
- **Risk if ignored:** Blind spot in monitoring — schedules silently fail without detection.

---

### 🟡 High 3 — Backend Heartbeat Fires Once, Goes Stale Permanently

- **File:** `index.ts:20-25`
- **Issue:** `heartbeatOk("backend")` is called once at startup. No periodic refresh. After 90 seconds, the backend heartbeat is permanently `stale` — the heartbeat system cannot detect a backend crash.
- **Impact:** Backend crash detection non-functional after 90 seconds of uptime.
- **Suggested fix:** Add `setInterval` calling `heartbeatOk("backend")` every 30-60 seconds.
- **Test needed:** Verify heartbeat remains `ok` after 5+ minutes of uptime.
- **Risk if ignored:** Backend death goes undetected by heartbeat monitoring.

---

### 🟡 High 4 — Zalo Disconnect Classified as `low` Severity

- **File:** `error-summary.service.ts:64-86, 197`
- **Issue:** `classifySeverity()` checks for `ZALO_NOT_CONNECTED` as "high", but heartbeat errors are formatted as `zaloConnection:down` — which doesn't match. Zalo disconnection falls through to default "low" severity.
- **Impact:** Zalo disconnect alerts won't trigger high-severity notifications.
- **Suggested fix:** Add `"zaloConnection:down"` and `"zaloConnection:stale"` as high-severity patterns.
- **Test needed:** Verify Zalo disconnect heartbeat produces high-severity error group.
- **Risk if ignored:** Zalo disconnection won't escalate to high-priority alert.

---

### 🟡 High 5 — No PM2/Systemd/Docker Auto-Restart Config

- **File:** Missing — no `ecosystem.config.js`, `Dockerfile`, or systemd unit
- **Issue:** No process manager config exists. If backend or worker crashes, they stay dead until manually restarted. The `restart:safe` script only creates a backup — doesn't restart.
- **Impact:** Production outages require manual intervention.
- **Suggested fix:** Create `ecosystem.config.js` with PM2 `autorestart: true`, `max_restarts`, `min_uptime`.
- **Test needed:** Verify PM2 restarts both processes on crash.
- **Risk if ignored:** Manual restart dependency increases downtime.

---

### 🟡 High 6 — `Message.role` Uses `"assistant"` While All Other Models Use `"ai"`

- **File:** `prisma/schema.prisma` (Message model)
- **Issue:** `Message.role` uses `"assistant"` (OpenAI convention), but `Schedule.createdBy`, `ScheduleRevision.changedBy`, `AuditLog.actor` all use `"ai"`. Cross-model queries silently miss records.
- **Impact:** Any correlation query joining Message with Schedule/AuditLog on actor field returns incomplete results.
- **Suggested fix:** Standardize on one convention. Either migrate `Message.role` to `"ai"` or update other models to `"assistant"`.
- **Test needed:** Verify cross-model queries return correct results after standardization.
- **Risk if ignored:** Data inconsistency — analytics and audit queries silently broken.

---

### 🟡 High 7 — Lock Overwrite in Multi-Instance Mode Defeats Zalo Listener Guard

- **File:** `process-lock.ts:88-101` / `index.ts:33-49`
- **Issue:** When `ALLOW_MULTIPLE_BACKEND_INSTANCES=true`, `acquireProcessLock()` warns about existing lock then **overwrites** it. `isLockOwner()` then passes because the lock now has the new PID. Both instances start Zalo listeners → dual WebSocket sessions → Zalo bans.
- **Impact:** Multi-instance mode silently creates dual Zalo sessions, risking account ban.
- **Suggested fix:** In multi-instance mode, skip lock write entirely. Guard the Zalo listener start with a direct check of `ALLOW_MULTIPLE_BACKEND_INSTANCES`.
- **Test needed:** Test multi-instance scenario — verify only one Zalo listener starts.
- **Risk if ignored:** Zalo account ban from dual WebSocket connections.

---

### 🟡 High 8 — DB Guard Missing 10 of 18 Models from Critical Tables List

- **File:** `scripts/db-guard.mjs`
- **Issue:** `CRITICAL_TABLES` lists only 8 of 18 models. Missing: `ScheduleExecution`, `ScheduleRevision`, `AttendanceSession`, `AttendanceRecord`, `AppSetting`, `RuntimeSetting`, `RuntimeConfigAudit`, `SystemHeartbeat`, `SystemAlert`, `AuditLog`. The guard also has no restore command and no backup integrity verification.
- **Impact:** `--before-reset` mode won't warn about missing critical tables. Backups may be silently corrupted.
- **Suggested fix:** Add all 18 models to `CRITICAL_TABLES`. Add `PRAGMA integrity_check` after backup. Add `--restore` mode.
- **Test needed:** Test backup→verify→restore cycle with integrity check.
- **Risk if ignored:** DB reset may proceed without protecting all critical data.

---

## Medium Findings

### 🟢 Medium 1 — Dispatcher Double-Writes Agent Task on Error (Completed + Failed)

- **File:** `incoming-dispatcher.service.ts:1187-1189`
- **Issue:** On failure, marks task as both `completed` (with failure metadata) AND `failed` (with raw error). Second call may overwrite first, losing failure reason.
- **Suggested fix:** Choose one status — either `markAgentTaskFailed` with rich data, or extend `markAgentTaskCompleted` to accept error.

---

### 🟢 Medium 2 — Worker AI DryRun Guard Reads Static Config

- **File:** `workers/scheduler.ts:109`
- **Issue:** Worker's `executeJob` checks `config.autoReply.dryRun` (static env) instead of `getCurrentEffectiveDryRun()`. Runtime toggle changes won't affect the worker's guard.
- **Suggested fix:** Use `getCurrentEffectiveDryRun()` instead of `config.autoReply.dryRun`.

---

### 🟢 Medium 3 — Sender DryRun Path Skips Guardrails + Misleading Audit

- **File:** `zalo-message-sender.ts:24-32`
- **Issue:** In dryRun mode, `sendMessage` skips `applyOutboundGuardrails`, `checkGroupOutboundGate`, dedup, and sanitization. Records `decision: "allow"` without determining if message would actually pass gates.
- **Suggested fix:** Run guardrails in dryRun mode but skip actual API call.

---

### 🟢 Medium 4 — Scheduled Sends Mislabeled as `auto_reply` Source

- **File:** `workers/scheduler.ts:181, 349`
- **Issue:** `sendMessage` defaults `source` to `"auto_reply"`. Worker's `executeJob` and `executeRunNow` don't override it. All scheduled sends appear as auto-replies in audit.
- **Suggested fix:** Pass `source: "schedule"` and `source: "run_now"` explicitly.

---

### 🟢 Medium 5 — Security: API Key Prefix/Length Exposed in Config Check

- **File:** `config-consistency.ts:147, 279`
- **Issue:** `mask()` reveals API key first 4 + last 4 characters. `checkSecret()` reports key length. Combined with Finding 1 (no auth on endpoint), this leaks actionable metadata.
- **Suggested fix:** Replace mask with "present"/"missing". Replace length with "(set)".

---

### 🟢 Medium 6 — Security: Race Condition on Global DryRun Mutable Config

- **File:** `zalo.ts:359-362`
- **Issue:** `send-voice` handler temporarily mutates `config.zalo.dryRun` globally. Concurrent requests see wrong value — TOCTOU race.
- **Suggested fix:** Pass `dryRun` as parameter to sender methods instead of mutating global.

---

### 🟢 Medium 7 — Worker Poll Loop Swallows Unhandled Promise Rejections

- **File:** `workers/index.ts:132-135`
- **Issue:** `setInterval` callback has no try/catch. If `poll()` throws (DB lost), the error is silently swallowed. Worker stays alive but non-functional.
- **Suggested fix:** Wrap interval body in try/catch with error logging and heartbeat update.

---

### 🟢 Medium 8 — Heartbeats Not Used in Overall Health Status

- **File:** `system-health.service.ts:380-405`
- **Issue:** `computeOverallStatus()` collects heartbeat data but never checks it. Stale/down heartbeats have zero impact on health status.
- **Suggested fix:** Add heartbeat checks: critical heartbeat down → unhealthy; stale → degraded.

---

### 🟢 Medium 9 — Missing Indexes on FK-Like Fields (N+1 Risk)

- **File:** `prisma/schema.prisma`
- **Issue:** `AgentTask.scheduleId`, `AgentTask.messageId`, `ScheduleExecution.scheduleJobId`, `Message.relatedMessageId`, `Message.role`, `Schedule.targetId`, `ScheduleExecution.targetId` all lack indexes.
- **Suggested fix:** Add `@@index` declarations for frequently queried foreign key columns.

---

### 🟢 Medium 10 — Missing Prisma `@relation` Attributes on Logical FKs

- **File:** `prisma/schema.prisma`
- **Issue:** `Message.relatedMessageId`, `ScheduleExecution.scheduleJobId`, `AgentTask.scheduleId`, `AgentTask.messageId`, `AttendanceRecord.messageId` lack `@relation` → no typed Prisma accessors.
- **Suggested fix:** Add `@relation` attributes for proper TypeScript client accessors.

---

### 🟢 Medium 11 — Port Conflict Check Always Returns `false`

- **File:** `process-lock.ts:192-201`
- **Issue:** `checkPortInUse()` unconditionally returns false with comment "Fastify will handle EADDRINUSE". Second instance claims lock, then crashes on bind → lock points to dead process.
- **Suggested fix:** Use `node:net` to attempt connection, or test-bind before writing lock file.

---

## Low Findings

### ⚪ Low 1 — `restart:safe` Name Misleading

- **File:** `package.json:26`
- **Issue:** Script only creates backup, doesn't restart. Name implies restart.
- **Suggested fix:** Rename to `backup:pre-restart` or extend to actually restart.

---

### ⚪ Low 2 — Missing HERMES_CHAT and ERROR_ALERT Config Validation

- **File:** `config-consistency.ts`
- **Issue:** Config checker doesn't validate HERMES_CHAT (empty endpoint when adapter=real) or ERROR_ALERT (missing Telegram token when channel=telegram).
- **Suggested fix:** Add checks for these config sections.

---

### ⚪ Low 3 — No Log Rotation

- **File:** `config.ts:128` / `app.ts:22-26`
- **Issue:** Pino logger outputs to stdout only. No file transport or rotation configured.
- **Suggested fix:** Add pino file transport with daily rotation via `pino-roll` or external logrotate.

---

### ⚪ Low 4 — `getCurrentEffectiveDryRun()` Called 20+ Times in Dispatcher

- **File:** `incoming-dispatcher.service.ts` (multiple lines)
- **Issue:** Function called repeatedly throughout long async handler. Mid-execution toggle could cause inconsistent state.
- **Suggested fix:** Capture once at top of `handleIncomingMessage()`.

---

## 5 Pre-existing Test Failures Analysis

| # | Test | Classification | Root Cause | Blocking? | Suggested Fix |
|---|------|---------------|------------|-----------|---------------|
| 1 | agent — targetName diacritics | **A (Real Bug)** | `recoverTargetFromOriginal()` can't normalize Vietnamese diacritics in original text | Yes | Apply `removeDiacritics()` before `indexOf` lookup, then slice original |
| 2 | agent — messageContent diacritics | **A (Real Bug)** | Same as #1 | Yes | Same fix as #1 |
| 3 | hardening — config.zalo.dryRun | **B (Test/Env)** | No `ZALO_DRY_RUN=true` in vitest env; code has no dev default | Yes | Set `env: { ZALO_DRY_RUN: "true" }` in vitest config |
| 4 | hardening — ZaloMessageSender dryRun | **C (Cascading)** | Cascades from #3 | Fix #3 | Resolves automatically when #3 fixed |
| 5 | zalo — dry-run returns success | **C (Cascading)** | Cascades from #3 | Fix #3 | Resolves automatically when #3 fixed |

**Effective fix count: 2 changes fix all 5 failures.**

---

## Security Review

### Auth
- ✅ All write endpoints require admin auth (HTTP Basic)
- ⚠️ `GET /api/system/config-check` lacks auth → exposes config metadata
- ⚠️ `GET /api/system/health` is intentionally public but reveals PID, uptime, node version

### Secret Handling
- ✅ `.env` gitignored, `.env.example` uses placeholders
- ✅ API responses mask secrets (prefix only)
- ⚠️ Config check reveals key lengths and partial prefixes
- ✅ Zalo session credentials NOT exposed via any API

### Runtime Live Toggle
- ✅ Requires admin auth + confirm text match
- ✅ Auto-backup before toggle
- ⚠️ No cooldown between toggles → rapid flapping possible
- ⚠️ Dual dryRun flags (see Critical #1)

### Zalo Session
- ✅ Session stored in private field, not exposed
- ✅ Session path not leaked in any API response
- ✅ Media path validation blocks session directory access

### Backup
- ✅ Backup script creates timestamped copies
- ⚠️ No backup integrity verification (PRAGMA integrity_check)
- ⚠️ No restore command in db-guard

### Logs
- ✅ No secrets appear in stdout/stderr from normal operation
- ⚠️ No log rotation configured

---

## DB Review

### Schema
- 18 models, SQLite via Prisma
- ✅ All models have `@id` and relevant status indexes
- ⚠️ 8 FK-like fields lack indexes (see Medium #9)
- ⚠️ 5 logical FKs lack `@relation` (see Medium #10)
- ⚠️ `Message.role` convention mismatch (see High #6)

### Indexes
- ✅ Core tables indexed on status, createdAt
- ⚠️ `ScheduleExecution.targetId`, `Schedule.targetId`, `AgentTask.messageId` unindexed → full scans on reminder queries

### Migration Risk
- ✅ `db push` used for dev (safe)
- ⚠️ Future `migrate` for production would need careful planning for non-nullable columns

### Backup/Restore
- ✅ Backup script creates copies
- ⚠️ No WAL checkpoint before backup → incomplete backup risk
- ⚠️ No restore command in guard
- ⚠️ No integrity check on backup files

### Query Risk
- ⚠️ `updateSchedule` creates revisions one-by-one (N INSERTs) → should use `createMany`
- ⚠️ `fetchScheduleContext` fires 3 sequential queries instead of parallel

---

## SRE Review

### Process Lock
- ✅ File-based lock with PID + port + timestamp
- ✅ Stale lock detection (dead PID)
- ⚠️ Port conflict check is a no-op (see Medium #11)
- ⚠️ Multi-instance lock overwrite (see High #7)
- ✅ `isLockOwner` + `tryAcquireProcessLock` pattern in startup

### PM2/Restart
- ❌ No PM2 config, Dockerfile, or systemd unit
- ⚠️ Worker has no auto-restart mechanism
- ⚠️ `restart:safe` only creates backup — doesn't restart

### Health
- ✅ Comprehensive health snapshot with 12 sections
- ⚠️ Worker health always reports `active: true` (see High #2)
- ⚠️ Heartbeats not used in overall status (see Medium #8)
- ⚠️ Backend heartbeat fires once → goes stale (see High #3)
- ✅ Health degrade rules for DB, config, errors, thread review

### Heartbeat
- ✅ 5 heartbeat keys defined (backend, schedulerWorker, zaloConnection, zaloListener, messagePipeline)
- ⚠️ `backend` heartbeat only fires once at startup
- ⚠️ `zaloConnection` and `zaloListener` only fire once
- ✅ `schedulerWorker` and `messagePipeline` updated periodically
- ⚠️ Heartbeats not factored into health status

### Worker
- ✅ Poll loop with heartbeat updates
- ✅ `EXECUTION_WINDOW_SECONDS` with early abort for stale jobs
- ⚠️ Unhandled promise rejection risk in poll loop (see Medium #7)
- ⚠️ No auto-restart on crash

### Zalo Listener
- ✅ Auto-connect on startup with retry mechanism
- ✅ Gateway status exposed via health endpoint
- ⚠️ Dual session risk in multi-instance (see High #7)

---

## Recommended Fix Batches

### Fix Batch A — Critical/High (Before Production)

1. **Unify dual dryRun flags** — single source of truth for dryRun across all send paths
2. **Fix `executeRunNow`** — correct threadType + add AI dryRun guard
3. **Fix cooldown race condition** — set cooldown immediately after gate check
4. **Add auth to config-check endpoint**
5. **Fix worker health detection** — use heartbeat to detect worker death
6. **Add periodic backend heartbeat** — fix one-shot heartbeat
7. **Fix Zalo disconnect severity** — classify as high in error-summary
8. **Add PM2 ecosystem config** — auto-restart for both processes
9. **Standardize `Message.role` convention** — `"ai"` vs `"assistant"`
10. **Fix multi-instance lock overwrite** — prevent dual Zalo sessions

### Fix Batch B — Medium (Post-Production)

1. Fix dispatcher double-write on agent task error
2. Worker AI dryRun guard → use runtime-aware function
3. Sender dryRun path → run guardrails, record actual decision
4. Scheduled sends → pass correct `source` to sender
5. Add missing DB indexes on FK columns
6. Add `@relation` attributes for typed Prisma accessors
7. Fix port conflict check in process lock
8. Integrate heartbeats into overall health status
9. Add DB guard missing tables + restore command
10. Webhook worker poll loop with try/catch

### Fix Batch C — Low / Polish

1. Rename `restart:safe` to `backup:pre-restart`
2. Add HERMES_CHAT and ERROR_ALERT config validation
3. Add log rotation configuration
4. Capture `getCurrentEffectiveDryRun()` once in dispatcher
5. Fix Vietnamese diacritics in `recoverTargetFromOriginal()`
6. Set `ZALO_DRY_RUN=true` in vitest test environment

---

## Final Recommendation

- **Ready for Batch 10 Admin UI Completion:** ✅ YES (already completed)
- **Ready for Rule Engine UI:** ⚠️ CONDITIONAL — Fix Critical #1–#3 first (affects all send paths)
- **Ready for Docling Document Understanding:** ⚠️ CONDITIONAL — Fix Critical #1–#3 first

### Priority Order
1. Critical #1 (dual dryRun) — affects EVERY message send path
2. Critical #2 (executeRunNow bugs) — broken DM sends + dryRun bypass
3. Critical #3 (cooldown race) — duplicate messages to users
4. High #1 (unauth endpoint) — information disclosure
5. High #2 + #3 + #4 (health/heartbeat blind spots) — monitoring gap
