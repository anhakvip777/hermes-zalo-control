# Hermes Zalo Admin Center — Customer Handoff

**Date:** 2026-07-01  
**Status:** Controlled DM pilot ready

---

## Ready

- Zalo connected through backend
- Backend is the only Zalo sender
- Worker sends through backend internal API
- Access Control UI ready
- Permission roles ready: `form_only`, `basic_chat`, `advanced`, `admin`
- Message status UI ready: SENT, DRY RUN, FAILED, BLOCKED, PERM DENIED, COOLDOWN
- Controlled Live Test ready
- Global dryRun safety remains enabled
- Test DB isolation fixed (TDB1)
- UI polished — DESIGN.md created, sidebar grouped, VN time (UTC+7) on all pages, zalo-ops light theme
- Status badges follow DESIGN.md color system (SENT=green, DRY RUN=info, FAILED=danger, etc.)

---

## Verified Live Pilots

### Pilot 1
- **Thread:** `6792540503378312397`
- **Role:** `basic_chat`
- **Result:** 3/3 real sends PASS

### Pilot 2
- **Thread:** `5189400998311849354`
- **Role:** `basic_chat`
- **Result:** 3/3 real sends PASS

### Pilot 3
- **Thread:** `6906520402993817174`
- **Name:** Tiny
- **Role:** `basic_chat`
- **Result:** 1/1 real send PASS
- **R3 DM fallback verified:** senderId null → threadId principal lookup

---

## Safety Status

| Control | State |
|---------|-------|
| Global dryRun | `true` |
| Global live | disabled |
| Group auto-reply | not enabled |
| Unknown users | not enabled |
| Controlled live only | by thread + quota |

---

## Do Not Enable Yet

- Global live
- Group auto-reply
- Unknown users
- Bulk user rollout
- Advanced/RAG tools for normal users

---

## Known Limitations

- Session persistence still needs final hardening
- If Zalo disconnects and session file is invalid/missing, QR login may be required
- INTERNAL_API_TOKEN should be moved to final secret management
- AI answer reliability scoring not fully built yet
- Group mention-only pilot not done yet
- zaloConnection heartbeat shows "stale" (2.5h) even though Zalo IS connected — monitoring gap, not a functional issue

## Production Readiness Scope

**Current production-readiness page may show NOT_READY. This gates full global production, not controlled DM pilot.**

| Scope | Status |
|-------|--------|
| Controlled DM Pilot | ✅ READY — 3/3 pilots PASS, 7 real sends, zero errors |
| Global Production Live | ❌ NOT READY — session persistence + heartbeat monitoring needed |
| Group Rollout | ❌ NOT READY — no group mention pilot yet |

**Remaining readiness issues (do NOT block controlled DM):**

1. **backup.session (FAIL, high):** No session file persisted on disk. Zalo is connected via in-memory credentials. If disconnected, QR re-login required.
2. **errors.heartbeats (WARN, high):** zaloConnection heartbeat is stale (recorded at connection time, not updated periodically). Zalo IS connected and listener IS active — purely a monitoring gap.

---

## Admin Pages

| Page | Path |
|------|------|
| Messages | `/messages` |
| Access Control | `/access-control` |
| Zalo Ops | `/zalo-ops` |
| Runtime Settings | `/runtime-settings` |
| Production Readiness | `/production-readiness` |
| System Health | `/system-health` |

---

## Cloudflare Tunnel / Public URL

**Public URL:** https://hermes.nhachungkhuduong.pro.vn

> Note: domain is `nhachungkhudong`, not `nhachungkhuduong`.

### Incident: Cloudflare 1033 (2026-07-01)

**Root cause:**
- Frontend `localhost:3000` was online ✅
- Backend `localhost:3002` was online ✅
- Cloudflare tunnel PM2 process was missing ❌

**Fix:**
```bash
pm2 start cloudflared --name hermes-tunnel -- tunnel run --token <TOKEN>
pm2 save
```

**Verify:**
```bash
pm2 status                              # must show 5 processes including hermes-tunnel
curl -I http://127.0.0.1:3000           # HTTP 200
curl -I http://127.0.0.1:3002/api/system/health  # HTTP 200
curl -I https://hermes.nhachungkhuduong.pro.vn   # HTTP 200
curl -I https://hermes.nhachungkhuduong.pro.vn/messages       # HTTP 200
curl -I https://hermes.nhachungkhuduong.pro.vn/access-control # HTTP 200
```

**Safety:** No code changes, no DB reset, no session delete, no global live, no group rollout.

---

## Emergency Stop

1. Keep global `dryRun=true`
2. Stop active live test
3. Do not enable group/global live
4. Restart backend only if listener is stuck
5. QR login again if Zalo session expires
6. Restore latest DB/session backup if needed

---

## Final Recommendation

Ready for controlled DM handoff.  
Not ready for global live or group rollout.
