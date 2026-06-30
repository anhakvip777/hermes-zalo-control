# H1 Session Persistence / Heartbeat Report

**Status:** ✅ PASS  
**Date:** 2026-06-30  
**Scope:** Session file survival across PM2 restarts, canonical path enforcement, non-destructive logout

---

## Root Cause

| # | Issue | File:Line | Impact |
|---|-------|-----------|--------|
| 1 | `logout()` dùng `unlinkSync(sessionPath)` — xóa session thay vì quarantine | `zalo-gateway.service.ts:512` | Mất session file nếu logout trigger |
| 2 | Session directory không pre-create trên startup | `index.ts:63` | Fresh deploy → NO_SESSION_FILE mỗi lần |
| 3 | Backup path dùng `resolve(cwd, "zalo-session")` thay vì canonical | `runtime-config.service.ts:358` | Tạo thư mục ma `./zalo-session/` |
| 4 | `saveCredentials()` catch rỗng → fail silently | `zalo-gateway.service.ts:389` | Không biết session có được save không |

---

## Changes Made

### F1: Pre-create canonical session dir on startup
- **File:** `index.ts`
- **Change:** `mkdirSync(config.zalo.sessionDir, { recursive: true })` before `restoreSession()`
- **Effect:** Dir always exists; NO_SESSION_FILE → health degraded with guidance

### F2: logout() → quarantine, not unlinkSync
- **File:** `zalo-gateway.service.ts` (logout method)
- **Change:** `unlinkSync(sessionPath)` → `quarantineSessionFile(sessionPath, "logout")`
- **Effect:** Session files preserved for forensic/debug on explicit logout

### F3: Backup uses canonical config.zalo.sessionDir
- **File:** `runtime-config.service.ts:358`
- **Change:** `resolve(cwd, "zalo-session", ...)` → `resolve(config.zalo.sessionDir, ...)`
- **Effect:** No more stale dirs created at project root

### F4: Health guidance when NO_SESSION_FILE
- **File:** `zalo-gateway.service.ts` (restoreSession)
- **Change:** Added guidance log lines + `heartbeatOk("zaloSession", { file: "missing" })`
- **Effect:** Clear restore instructions in logs; health dashboard shows degraded

### F5: Stale dir cleanup (backup + rename, no delete)
- `./zalo-session/` → `zalo-session.stale-20260630-042912`
- `./packages/zalo-session/` → `packages/zalo-session.stale-20260630-042912`
- Backups at `backups/session-stale-dirs-20260630-042912/`

### Additional
- `quarantineSessionFile()` regex: added `logout` to recognized reasons
- `saveCredentials()`: added success/failure logging
- Tests: +8 H1 test cases in `zalo.test.ts`

---

## Canonical Session Path

```
/home/anhakvip777/hermes-zalo-control/packages/backend/zalo-session/zalo-session.json
```

Set via PM2 env: `ZALO_SESSION_DIR=/home/anhakvip777/hermes-zalo-control/packages/backend/zalo-session`

---

## Restart Verification

### Restart 1 (fresh restore)
- Session restored from backup → Zalo connected ✅
- `saveCredentials()` logged: "Session saved" ✅
- Session file exists after restart ✅

### Restart 2 (no manual restore)
- Session file survived restart ✅
- Zalo auto-restored: restored=true, connected=true ✅
- Listener active ✅
- No manual intervention needed ✅

---

## Zalo Ops Status (after both restarts)

```json
{
  "connected": true,
  "listenerActive": true,
  "dryRun": true
}
```

---

## Tests/Build

| Check | Result |
|--------|--------|
| Backend tests | 42 files, 700/700 PASS |
| Typecheck | Clean |
| Build | Clean |
| H1-specific tests | 8/8 PASS |

---

## Safety Verification

| Check | Result |
|--------|--------|
| No `unlinkSync(sessionPath)` in production code | ✅ |
| No `process.cwd()/zalo-session` in production code | ✅ |
| No session delete on logout | ✅ (quarantine) |
| No session delete on restart | ✅ |
| Stale dirs handled non-destructively | ✅ (backup + rename) |
| dryRun=true | ✅ |
| Live test not active | ✅ |

---

## Remaining Risks

1. **Zalo session expiry**: Session hết hạn sau vài ngày → auto-restore fail → "SESSION_QUARANTINED" → cần QR login mới
2. **PM2 SIGKILL**: Nếu process không exit trong 10s, PM2 gửi SIGKILL — file vẫn an toàn vì `fs.writeFileSync` là atomic trên Linux
3. **Power loss mid-write**: File có thể corrupt → backup sẵn trong `backups/db/zalo-session-*/`

---

## Next Step

- Commit H1
- P1/RBAC (nếu cần)
