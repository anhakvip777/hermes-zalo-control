# PRODUCTION PILOT RUNBOOK — Hermes Zalo Control Center

**Version**: Batch 19
**Date**: 2026-06-29
**Status**: ✅ Ready (based on Batch 18 Controlled Live Test PASS)
**Audience**: Operator (Anh Việt / Hermes Agent)

---

## 1. Pilot Objective

Verify that the Zalo auto-reply system operates safely in a live production environment with real Zalo messages. The pilot is **controlled, limited in scope, and reversible at any time.**

### Success Criteria

- ✅ No unauthorized real sends
- ✅ No duplicate sends
- ✅ No sends outside allowedThreads
- ✅ No group reply without `@mention`
- ✅ Rollback works within seconds
- ✅ Backend/worker stable throughout
- ✅ All heartbeats green

---

## 2. Pilot Scope

### Phase 1 — Controlled Live Test (Current)

| Parameter | Value |
|-----------|-------|
| Threads | 1 DM test thread (`6792540503378312397`) |
| Max real replies | 1–3 |
| TTL | 300s (5 min) |
| Method | `POST /api/system/live-test/start` |
| Safety | Auto-completes after quota reached |

**Decision Gate**: Phase 1 must PASS before Phase 2.

### Phase 2 — Trusted DM Pilot

| Parameter | Value |
|-----------|-------|
| Threads | 1 DM with trusted user |
| Duration | 30–60 minutes |
| allowedThreads | Only that DM |
| Batching | Enabled |
| Rule engine | Enabled |
| Document ingestion | Optional |
| Groups | **Disabled** |

**Decision Gate**: Phase 2 must PASS before Phase 3.

### Phase 3 — Small Group Pilot

| Parameter | Value |
|-----------|-------|
| Threads | 1 small group |
| groupMentionRequired | `true` |
| Reply condition | Only when `@mention`-ed |
| Max runtime | 1–2 hours |
| Monitoring | Continuous |

---

## 3. Pre-Live Checklist

> **⚠️ EVERY item must be ✅ before proceeding.**

### System State

- [ ] `git status` — clean, no uncommitted changes
- [ ] Latest commit recorded in runbook log
- [ ] Backup created (`cp prisma/dev.db backup-$(date +%Y%m%d-%H%M%S).db`)
- [ ] Session backup exists (`zalo-session/`)

### Verification

- [ ] `npm test` — all tests PASS (586/586)
- [ ] `npm run typecheck` — all packages PASS
- [ ] `npm run build -w packages/backend` — PASS
- [ ] `npm run build -w packages/frontend` — PASS
- [ ] Secret audit — no hardcoded secrets found

### Runtime State

- [ ] Production readiness checks: no `NOT_READY` (`/production-readiness`)
- [ ] Backend running: `pm2 status` shows `hermes-backend` online
- [ ] Worker running: `pm2 status` shows `hermes-worker` online
- [ ] Document worker running (if needed)
- [ ] Frontend serving: port 3001 accessible
- [ ] Zalo connected: `/api/zalo/ops/status` → `connected: true`
- [ ] Listener active: messages being received
- [ ] `allowedThreads` correct: only intended threads
- [ ] `dryRun: true` — safe default before starting live session
- [ ] No active stale live session: `/api/system/live-test/status` → `active: false`
- [ ] No duplicate backend processes: `ss -tlnp | grep 3002` shows 1 PID
- [ ] Process lock owner matches running PID
- [ ] Recent errors reviewed: `/errors` page, last 24h → no critical

### Config

- [ ] `ZALO_AUTO_REPLY_DRY_RUN=true` (env)
- [ ] `ZALO_AUTO_REPLY_ENABLED=true`
- [ ] `ZALO_AUTO_REPLY_COOLDOWN_SECONDS=10`
- [ ] `MESSAGE_BATCHING_ENABLED=true` (Phase 2+)

---

## 4. How to Start Live Test

### Phase 1: Controlled Live Test (via API)

```bash
# Start live test session (1 real DM, 5 min TTL)
curl -X POST http://127.0.0.1:3002/api/system/live-test/start \
  -H "Content-Type: application/json" \
  -u "admin:<ADMIN_PASSWORD>" \
  -d '{
    "threadId": "6792540503378312397",
    "maxMessages": 1,
    "ttlSeconds": 300,
    "reason": "Phase 1 controlled live test"
  }'

# Or via Admin Center UI: /zalo-ops → "Start Live Test"
```

### Phase 2+: Enable Auto-Reply for Specific Thread

```bash
# 1. Verify allowedThreads via /thread-settings
# 2. Ensure dryRun=true (safety net)
# 3. Create LiveTestSession for controlled burst
# 4. OR: carefully set ZALO_AUTO_REPLY_DRY_RUN=false for trusted thread only
```

> **⚠️ NEVER** set `ZALO_AUTO_REPLY_DRY_RUN=false` globally. Always use LiveTestSession or thread-level control.

---

## 5. Live Monitoring Checklist

> **Monitor continuously during pilot. Check every 5 minutes.**

### Dashboards

| Dashboard | URL | What to check |
|-----------|-----|---------------|
| Production Readiness | `/production-readiness` | All green, no NOT_READY |
| Zalo Ops | `/zalo-ops` | Connected, listener active, heartbeats |
| System Health | `/system-health` | All services OK |
| Errors | `/errors` | No new critical errors |
| Messages | `/messages` | Correct thread, no spam |
| Safety Mode | `/safety-mode` | dryRun status, cooldown, batching |

### Process

```bash
pm2 status                    # All online, 0 restarts
pm2 logs hermes-backend --lines 20 --nostream
pm2 logs hermes-worker --lines 10 --nostream
```

### Key Metrics (via API)

```bash
# Heartbeats
curl -u "admin:<PASS>" http://127.0.0.1:3002/api/system/heartbeats

# Zalo status
curl -u "admin:<PASS>" http://127.0.0.1:3002/api/zalo/ops/status

# Live test status
curl -u "admin:<PASS>" http://127.0.0.1:3002/api/system/live-test/status
```

### Critical Checks

- [ ] `OutboundRecord` dryRun=0 count: only expected sends
- [ ] No duplicate sends (check `Message` table for identical content)
- [ ] No failed `AgentTask` (`failedTasks24h` in Zalo ops)
- [ ] Cooldown working (no rapid-fire replies)
- [ ] Batching working (no duplicate Hermes calls)

### DB Quick Check

```sql
-- Real sends since pilot start
SELECT COUNT(*) FROM OutboundRecord WHERE dryRun = 0 AND createdAt > <PILOT_START>;

-- Active live sessions
SELECT * FROM LiveTestSession WHERE status = 'active';

-- Failed tasks
SELECT COUNT(*) FROM AgentTask WHERE status = 'failed' AND createdAt > <PILOT_START>;
```

---

## 6. Rollback Plan

> **If ANYTHING goes wrong, execute IMMEDIATELY.**

### Step 1: Stop Active Live Test

```bash
curl -X POST http://127.0.0.1:3002/api/system/live-test/stop \
  -u "admin:<ADMIN_PASSWORD>"
```

### Step 2: Force Dry Run

```bash
# Via Safety Mode UI: /safety-mode → ENABLE DRY RUN
# OR via runtime config:
curl -X PUT http://127.0.0.1:3002/api/runtime-settings \
  -H "Content-Type: application/json" \
  -u "admin:<ADMIN_PASSWORD>" \
  -d '{"key": "autoReply.dryRun", "value": "true", "reason": "EMERGENCY ROLLBACK"}'
```

### Step 3: Restrict allowedThreads

```bash
# Remove all threads except test thread (or empty)
# Via /thread-settings UI or API
```

### Step 4: Restart If Unstable

```bash
pm2 restart hermes-backend
pm2 restart hermes-worker
```

### Step 5: Kill Duplicate Processes

```bash
# If Zalo "Another connection" error appears:
pkill -9 -f "tsx.*src/index" 2>/dev/null
pkill -9 -f "node.*packages/backend" 2>/dev/null
pm2 restart hermes-backend
```

### Step 6: Verify Rollback

```bash
# Must return:
# - active: false
# - dryRun: true
curl -u "admin:<PASS>" http://127.0.0.1:3002/api/system/live-test/status

# Must show connected + no new dryRun=0
curl -u "admin:<PASS>" http://127.0.0.1:3002/api/zalo/ops/status
```

### Emergency Contacts

| Role | Contact |
|------|---------|
| Operator | Anh Việt (Telegram DM) |
| Hermes Agent | This session |

---

## 7. Pilot PASS/FAIL Criteria

### ✅ PASS

- [ ] No duplicate real send
- [ ] No message sent outside `allowedThreads`
- [ ] No group reply without `@mention` (Phase 3)
- [ ] No `dryRun` bypass except approved live test
- [ ] No backend crash
- [ ] No Zalo session conflict
- [ ] No critical errors
- [ ] Rollback verified (tested during pilot)
- [ ] Live test session auto-completes

### ❌ FAIL (immediate rollback)

- [ ] Any unauthorized real send
- [ ] Duplicate real send detected
- [ ] Send to wrong thread detected
- [ ] Backend crash or restart loop
- [ ] Zalo listener conflict ("Another connection")
- [ ] Live test session fails to expire/complete
- [ ] `dryRun` cannot be restored

---

## 8. Post-Live Checklist

- [ ] All live test sessions completed/expired
- [ ] `dryRun: true` confirmed
- [ ] `allowedThreads` reviewed and restricted
- [ ] No unexpected `OutboundRecord` with `dryRun=0`
- [ ] All heartbeats back to normal
- [ ] Pilot log updated with timeline
- [ ] PASS/FAIL verdict recorded
- [ ] Lessons learned documented
- [ ] Next phase decision documented

---

## 9. Pilot Log

| Date | Phase | Action | Result | Operator |
|------|-------|--------|--------|----------|
| 2026-06-29 | Batch 18 | Live test hello (1 DM) | ✅ PASS | Hermes Agent |
| 2026-06-29 | Batch 18 | Post-quota dryRun test | ✅ PASS | Hermes Agent |
| TBD | Phase 1 | — | — | — |
| TBD | Phase 2 | — | — | — |
| TBD | Phase 3 | — | — | — |

---

## 10. Related Documents

| Document | Path |
|----------|------|
| CLAUDE.md | `CLAUDE.md` |
| Final Scenario Test Report | `docs/FINAL_SCENARIO_TEST_REPORT.md` |
| Customer Readiness Audit | `docs/CUSTOMER_READINESS_AUDIT.md` |
| Stability Audit | `docs/STABILITY_AUDIT.md` |
| Customer Demo Summary | `docs/CUSTOMER_DEMO_SUMMARY.md` |
