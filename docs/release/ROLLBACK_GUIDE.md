# Rollback Guide

## When to Rollback

- Unexpected real Zalo sends detected
- System error causing duplicate or spam sends
- Zalo connection conflicts
- DB corruption
- Configuration error exposing wrong threads

## Quick Rollback (Emergency)

```bash
# 1. Stop live test session
curl -X POST http://localhost:3002/api/system/live-test/stop

# 2. Force dryRun=true
# Via /safety-mode UI or API

# 3. Restart backend with dryRun enforced
pm2 restart hermes-backend --update-env

# 4. Verify dryRun is active
curl http://localhost:3002/api/zalo/status | grep dryRun
```

## Full Rollback (Restore from Backup)

```bash
# 1. Stop all services
pm2 stop all

# 2. Verify backup exists
npm run backup:list

# 3. Restore DB and Zalo session from backup
npm run backup:restore

# 4. Restart services
pm2 start ecosystem.config.cjs

# 5. Verify
curl http://localhost:3002/api/health
curl http://localhost:3002/api/zalo/status
npm run test
```

## Post-Rollback Verification

- [ ] **dryRun=true** confirmed
- [ ] **No dryRun=false outbound** after rollback timestamp
- [ ] **All tests pass:** `npm test`
- [ ] **Zalo connected** and listener active
- [ ] **Production readiness** shows READY_FOR_LIVE
- [ ] **Secret audit clean:** `npm run secret:audit`

## Configuration Rollback

If a runtime setting change caused the issue:

```bash
# Restore runtime settings to safe defaults
# Via /runtime-settings UI:
#   - autoReply.cooldownSeconds: reset to default
#   - autoReply.allowedThreads: remove risky threads
#   - messageBatching.enabled: false
```

## Preventing Recurrence

- Review what triggered the rollback
- Add to SAFETY_CHECKLIST.md
- Consider stricter allowed threads or longer cooldown
- Run `npm run backup:create` after fixing
