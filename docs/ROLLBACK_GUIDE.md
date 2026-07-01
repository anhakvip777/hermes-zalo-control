# Rollback Guide — Hermes Zalo Admin Center

**Last Updated:** 2026-06-29 (S1 — Session Restart Investigation)

---

## Session Loss During Restart

### Detection

After PM2 restart, check:
```bash
curl -s -u "admin:<password>" http://127.0.0.1:3002/api/zalo/ops/status | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'session.exists={d[\"session\"][\"exists\"]}')
print(f'connected={d[\"connected\"]}')
print(f'lastError={d.get(\"lastError\", \"none\")}')
"
```

If `session.exists: false` or `lastError: NO_SESSION_FILE` → session file was deleted.

### Root Cause

`zalo-gateway.service.ts:320` contains `unlinkSync(sessionPath)` which deletes the session file when `restoreSession()` encounters a login error containing "expired", "invalid", or "SESSION". This happens intermittently during restart when Zalo API transiently rejects credentials.

### Recovery

See `docs/OPERATIONS_RUNBOOK.md` → "Zalo Session Restore SOP".

1. Find latest backup → restore session file → restart backend → verify

---

## Code Rollback

### Rollback a commit

```bash
cd ~/hermes-zalo-control

# View recent commits
git log --oneline -20

# Revert a specific commit (creates new revert commit)
git revert <commit-hash>

# Rebuild
npm run build -w packages/backend

# Restart
pm2 restart hermes-backend --update-env
pm2 restart hermes-worker --update-env
```

### Rollback to a specific commit (hard reset)

```bash
cd ~/hermes-zalo-control

# Backup DB first
cp packages/backend/prisma/dev.db "packages/backend/prisma/dev.db.backup-rollback-$(date +%Y%m%d-%H%M%S)"

# Hard reset
git reset --hard <commit-hash>

# Rebuild + restart
npm run build -w packages/backend
pm2 restart hermes-backend --update-env
pm2 restart hermes-worker --update-env
```

---

## DB Rollback

### Restore DB from backup

```bash
cd ~/hermes-zalo-control/packages/backend

# Stop backend first
pm2 stop hermes-backend

# Backup current DB (just in case)
cp prisma/dev.db "prisma/dev.db.pre-restore-$(date +%Y%m%d-%H%M%S)"

# Restore from backup
cp <backup-path>/dev.db prisma/dev.db

# Restart
pm2 restart hermes-backend --update-env
```

### Drop new table (manual, after confirming no data dependency)

```bash
cd ~/hermes-zalo-control/packages/backend

# Using Python sqlite3
python3 -c "
import sqlite3
conn = sqlite3.connect('prisma/dev.db')
conn.execute('DROP TABLE IF EXISTS ThreadCooldown')
conn.commit()
conn.close()
print('Dropped ThreadCooldown')
"
```

⚠️ Only drop tables introduced by a specific batch. Never reset entire DB.

---

## PM2 Process Recovery

### Process crashed with max_restarts exceeded

```bash
pm2 reset hermes-backend    # Reset restart counter
pm2 restart hermes-backend  # Try again
```

### Process in errored state

```bash
pm2 delete hermes-backend
pm2 start ecosystem.config.cjs --only hermes-backend
```

---

## Tunnel Recovery (Cloudflare)

```bash
pm2 restart hermes-zalo-tunnel
pm2 logs hermes-zalo-tunnel --lines 20 --nostream
```
