# Operations Runbook

## Daily Startup Checklist

- [ ] PM2 processes all online: `pm2 status`
- [ ] Backend health: `curl localhost:3002/api/health`
- [ ] Zalo connected: `/zalo-ops` page shows green
- [ ] Worker polling: `/system-health` shows heartbeat
- [ ] No critical errors: `/errors` page clean
- [ ] dryRun=tru

## Before Live Checklist

- [ ] `/production-readiness` shows READY_FOR_LIVE
- [ ] Allowed threads are correct in `/runtime-settings`
- [ ] Backup recent: `npm run backup:create`
- [ ] No duplicate backend processes: `pm2 status`
- [ ] Secret audit clean: `npm run secret:audit`
- [ ] Cooldown >= 5s: `/runtime-settings`

## During Live Monitoring

- [ ] `/messages` — verify replies are appropriate
- [ ] `/errors` — watch for new AgentTask failures
- [ ] `/system-health` — all heartbeats green
- [ ] Rate limits not exceeded

## After Live Review

- [ ] Verify sentCount matches expected
- [ ] No unexpected dryRun=false outbounds
- [ ] Review `/messages` for quality
- [ ] Create backup: `npm run backup:create`

## Backup

```bash
# Create backup (DB + session)
npm run backup:create

# List backups
npm run backup:list

# Verify backup integrity
npm run backup:verify

# Restore from backup
npm run backup:restore
```

## PM2 Process Management

```bash
# View all processes
pm2 status

# View logs
pm2 logs hermes-backend
pm2 logs hermes-worker

# Restart a service
pm2 restart hermes-backend --update-env

# Restart from ecosystem file
pm2 start ecosystem.config.cjs

# Save process list for auto-start
pm2 save
```

## Zalo Session Restore

If Zalo disconnects:
1. Check `/zalo-ops` — will show disconnected status
2. Session auto-restores on restart (if session file exists)
3. If session expired, scan QR from `/zalo-ops`
4. Backup session after login: `npm run backup:create`

## Troubleshooting

### Backend won't start
- Check process lock: `ls /tmp/hermes-backend.lock`
- Remove stale lock: `rm /tmp/hermes-backend.lock`
- Check port: `lsof -i :3002`

### Zalo not receiving messages
- Verify listener active: `/system-health`
- Check WebSocket connection: `/zalo-ops`
- Restart backend: `pm2 restart hermes-backend --update-env`

### Build errors
- Clear and rebuild: `npm run clean && npm install && npm run build`
- Check Node version: `node --version` (needs >=22)

### DB corruption
- Restore from backup: `npm run backup:restore`
- Check DB guard: `npm run db:guard`
