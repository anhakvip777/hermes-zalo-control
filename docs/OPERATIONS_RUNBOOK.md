# Operations Runbook — Hermes Zalo Admin Center

**Last Updated:** 2026-06-30 (H1 — Session Persistence / Heartbeat Polish)

---

## Safe PM2 Restart SOP

### Pre-restart Checklist

1. **Verify dryRun=true**
   ```bash
   curl -s -u "admin:<password>" http://127.0.0.1:3002/api/system/runtime-config | python3 -c "import sys,json; print(json.load(sys.stdin)['effective']['dryRun'])"
   ```
   Must return `True`.

2. **Backup Zalo session (recommended, not required — H1 session survives restart)**
   ```bash
   cd ~/hermes-zalo-control
   TS="$(date +%Y%m%d-%H%M%S)"
   BACKUP_DIR="backups/session-pre-restart-$TS"
   mkdir -p "$BACKUP_DIR"
   cp -av packages/backend/zalo-session/zalo-session.json "$BACKUP_DIR/" 2>/dev/null || echo "(no session file — OK for fresh deploy)"
   echo "Session backed up to $BACKUP_DIR"
   ```

3. **Restart backend first**
   ```bash
   pm2 restart hermes-backend --update-env
   sleep 5
   ```

4. **Verify Zalo session and listener**
   ```bash
   curl -s -u "admin:<password>" http://127.0.0.1:3002/api/zalo/ops/status | python3 -c "
   import sys, json
   d = json.load(sys.stdin)
   print(f'connected={d[\"connected\"]}')
   print(f'listener={d[\"listenerActive\"]}')
   "
   ```
   Expected: `connected=True`, `listener=True`

5. **Check session file still exists** (H1: should survive restart automatically)
   ```bash
   ls -lah /home/anhakvip777/hermes-zalo-control/packages/backend/zalo-session/zalo-session.json
   ```
   Must exist with non-zero size.

6. **Restart worker**
   ```bash
   pm2 restart hermes-worker --update-env
   ```

7. **Verify health**
   ```bash
   curl -s -u "admin:<password>" http://127.0.0.1:3002/api/system/health
   ```

8. **If session lost**: Restore from backup (see Zalo Session Restore SOP below). Do NOT delete session directory.

### ⚠️ Session Loss Alert

If `connected: false` after restart:
1. **DO NOT restart again** — each restart may compound the problem
2. Check if session file still exists on disk:
   ```bash
   ls -lah packages/backend/zalo-session/zalo-session.json
   ```
3. If file is missing: follow Zalo Session Restore SOP below
4. If file exists but Zalo won't connect: check `pm2 logs hermes-backend --lines 50` for errors
   - `NO_SESSION_FILE` → restore from backup
   - `CREDENTIALS_EXPIRED` or `SESSION_QUARANTINED` → session expired, need QR login: `POST /api/zalo/login`
   - `RESTORE_FAILED` → check zca-js compatibility

---

## Zalo Session Restore SOP

### When to Use
- Session file deleted (NO_SESSION_FILE error)
- Session file corrupted (CREDENTIALS_EXPIRED error)
- Zalo disconnected after restart with no auto-recovery
- Fresh deploy with no prior session

### Canonical Paths

| Type | Path |
|------|------|
| **Session directory** | `/home/anhakvip777/hermes-zalo-control/packages/backend/zalo-session/` |
| **Session file** | `/home/anhakvip777/hermes-zalo-control/packages/backend/zalo-session/zalo-session.json` |
| **Auto-backups** | `~/hermes-zalo-control/packages/backend/backups/db/zalo-session-*/` |

### Restore Procedure

1. **Locate backup**
   ```bash
   # Auto-backups from PM2 restarts (most recent first)
   ls -lt ~/hermes-zalo-control/packages/backend/backups/db/zalo-session-*/
   
   # Manual pre-restart backups
   ls -lt ~/hermes-zalo-control/backups/session-pre-restart-*/
   ```

2. **Stop backend (optional, for safety)**
   ```bash
   pm2 stop hermes-backend
   ```

3. **Restore session file to canonical path**
   ```bash
   # Replace <BACKUP_DIR> with actual path from step 1
   cp <BACKUP_DIR>/zalo-session.json /home/anhakvip777/hermes-zalo-control/packages/backend/zalo-session/zalo-session.json
   ```

4. **Start/restart backend**
   ```bash
   pm2 restart hermes-backend --update-env
   sleep 5
   ```

5. **Verify connection**
   ```bash
   curl -s -u "admin:<password>" http://127.0.0.1:3002/api/zalo/ops/status | python3 -c "
   import sys, json
   d = json.load(sys.stdin)
   print(f'connected={d[\"connected\"]}')
   print(f'listenerActive={d[\"listenerActive\"]}')
   "
   ```

6. **DO NOT restart worker with session env** — worker must never hold `ZALO_SESSION_DIR`
   ```bash
   pm2 env hermes-worker | grep ZALO_SESSION_DIR
   # Must return empty
   ```

### H1 Improvements (2026-06-30)

- **Session dir auto-created** on startup — no manual `mkdir` needed on fresh deploy
- **Session file survives restart** — `saveCredentials()` logs success explicitly
- **No destructive session delete** — `logout()` now quarantines instead of deleting
- **Backup path fixed** — auto-backups use canonical path, not relative `cwd/zalo-session`
- **Health degraded signal** — `NO_SESSION_FILE` triggers heartbeat alert + console guidance
- **Stale dir cleanup** — `./zalo-session/` and `./packages/zalo-session/` quarantined as `.stale-*` (backups preserved)

---

## Stale Session Directory Cleanup

Old session directories may exist from previous versions:

```
./zalo-session/                  → quarantined to zalo-session.stale-20260630-*
./packages/zalo-session/         → quarantined to packages/zalo-session.stale-20260630-*
```

To inspect before removal:
```bash
ls -lah zalo-session.stale-*
ls -lah packages/zalo-session.stale-*
```

Backups saved at:
```bash
ls -lah backups/session-stale-dirs-*/
```

---

## Emergency Stop

```bash
# Stop all bot-related processes
pm2 stop hermes-backend hermes-worker

# Verify stopped
pm2 status
```

---

## Cloudflare Tunnel Recovery

**Public URL:** https://hermes.nhachungkhuduong.pro.vn  
> Note: domain is `nhachungkhudong`, not `nhachungkhuduong`.

### Symptom
Cloudflare Error 1033 — `hermes.nhachungkhuduong.pro.vn` not accessible.  
Local services (3000, 3002) healthy but public URL unreachable.

### Diagnosis
```bash
pm2 status | grep tunnel        # Should show hermes-tunnel. If missing → root cause.
curl -I http://127.0.0.1:3000   # Must return 200
curl -I http://127.0.0.1:3002/api/system/health  # Must return 200
```

### Fix
```bash
pm2 start cloudflared --name hermes-tunnel -- tunnel run --token <TOKEN>
pm2 save
```

### Verify
```bash
pm2 status                              # 5 processes including hermes-tunnel
curl -I http://127.0.0.1:3000           # HTTP 200
curl -I http://127.0.0.1:3002/api/system/health  # HTTP 200
curl -I https://hermes.nhachungkhuduong.pro.vn   # HTTP 200
curl -I https://hermes.nhachungkhuduong.pro.vn/messages       # HTTP 200
curl -I https://hermes.nhachungkhuduong.pro.vn/access-control # HTTP 200
```

### Safety
No code changes. No DB reset. No session delete. No global live. No group rollout.

---

## Log Inspection

```bash
# Backend logs (last 100 lines)
pm2 logs hermes-backend --lines 100 --nostream

# Worker logs (last 100 lines)
pm2 logs hermes-worker --lines 100 --nostream

# Error logs
tail -100 ~/hermes-zalo-control/logs/backend-error.log
tail -100 ~/hermes-zalo-control/logs/worker-error.log
```

---

## Schedule Execution (SCHED1)

**Feature:** Scheduled DM reminders via zaloAdminCenter scheduleJob worker.

**Live Proof:** 2026-07-02 — SCHED1-LIVE PASS

| Field | Value |
|---|---|
| Schedule ID | `cmr2xjj7u001hhmlskhutf10c` |
| Trigger time | `2026-07-02T03:14:54Z` |
| Execution | `03:15:00Z` |
| dryRun | `0` (controlled live) |
| sentMessageId | `sent-1782962100086` |
| content | `"họp"` |
| maxMessages | 1 |
| Result | ✅ PASS |
| Post-state | live `active=false`, global `dryRun=true` |

**Admin endpoint:** `GET /api/schedules` (admin auth required)

**Notes:**
- Schedule runs via `hermes-worker` PM2 process
- After execution: live auto-stops, global dryRun reverts to `true`
- Controlled DM handoff: READY
- Group schedule: NOT READY (pending group rollout approval)

---

## Zalo Session Restore (ZR2)

**Feature:** Auto-restore Zalo session from backup before requiring QR.
**Commit:** `3c66b31` fix(zalo): restore session from backup before requiring QR
**Full runbook:** [`docs/ZALO_QR_RESTORE_RUNBOOK.md`](./ZALO_QR_RESTORE_RUNBOOK.md)
**Skill:** `zalo-session-restore`

**TL;DR flow when Zalo disconnected / session missing / after restart:**

1. Safety pre-check: `dryRun=true`, live `active=false`, group OFF.
2. Check `GET /api/zalo/ops/status` → read `connectionDetail`.
3. If `session_present` / `backup_available` → **try `POST /api/zalo/ops/reconnect` first** (restores from primary or backup, no QR).
4. Only if `qr_required` / `restore_failed` → `/zalo-ops` → "Tạo QR đăng nhập Zalo" → scan.
5. After connect: `POST /api/zalo/session/save` (writes primary + backup copy).
6. Verify auto-restore: `pm2 restart hermes-backend --update-env`, wait 15s, expect `connected=true` + `listenerActive=true` (confirm via log `zca-js listener started successfully`, not stale flag) — no QR needed.

**Backup mechanism:** every successful session save writes a copy to
`packages/backend/backups/db/zalo-session-<timestamp>/zalo-session.json`.
On boot, backend restores from primary; if missing, copies the newest backup then restores.

**Never commit:** `backups/`, `zalo-session.json`, `qr-current.png`, `.env` (all gitignored — commit `fe1113e`).

**Last verified:** 2026-07-04 — ZALO-RESTORE-AFTER-ZR2 PASS (connected=true, listenerActive=true, auto-restore after restart PASS, dryRun=true, live=false).
