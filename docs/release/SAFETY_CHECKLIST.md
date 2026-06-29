# Safety Checklist

> Use this checklist before any real Zalo send.

## Pre-Flight

- [ ] **dryRun=true** — verify at `/safety-mode`
- [ ] **Production readiness** — `/production-readiness` shows READY_FOR_LIVE
- [ ] **Allowed threads correct** — `/runtime-settings` → `autoReply.allowedThreads`
- [ ] **No duplicate backends** — `pm2 status` shows exactly 1 `hermes-backend`
- [ ] **Zalo listener active** — `/system-health` → `zaloListener` heartbeat OK
- [ ] **Backup recent** — `npm run backup:list` shows backup < 24h old
- [ ] **No critical errors** — `/errors` page clean (0 failed, 0 blocked)
- [ ] **Secret audit clean** — `npm run secret:audit` → no findings

## Live Test Setup

- [ ] **maxMessages** set to explicit count (e.g., 1 or 3)
- [ ] **ttlSeconds** reasonable (300–600s)
- [ ] **threadId** is correct (not a group, not wrong user)
- [ ] **Live test session active** — visible at `/safety-mode`
- [ ] **sentCount = 0** before first message

## During Live Test

- [ ] Messages arrive in `/messages`
- [ ] AgentTask status = `completed` (not `failed`)
- [ ] OutboundRecord created with `dryRun=false` and `sentMessageId`
- [ ] sentCount increments correctly
- [ ] No duplicate outbounds

## Post-Live Verification

- [ ] sentCount matches expected
- [ ] Session auto-completed if quota reached
- [ ] No unexpected `dryRun=false` outbound records after session end
- [ ] Post-quota messages use dryRun
- [ ] No Zalo connection conflicts (`NO_SESSION_FILE`, `another connection`)
- [ ] PM2 processes stable (no unexpected restarts)

## Emergency

If something goes wrong:
1. **Stop immediately:** `/safety-mode` → Emergency Stop
2. **Force dryRun:** `/safety-mode` → dryRun toggle → ON
3. **Remove risky threads:** `/runtime-settings` → clear allowedThreads
4. **Restart:** `pm2 restart hermes-backend --update-env`
5. **Audit:** Check `/errors` and `/messages` for unexpected sends
6. **Rollback if needed:** `npm run backup:restore`
