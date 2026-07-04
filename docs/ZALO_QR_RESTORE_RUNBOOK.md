# Zalo Session Restore Runbook (ZR2)

**Last Updated:** 2026-07-04 — ZR2 (restore session from backup before requiring QR)
**Related commit:** `3c66b31` fix(zalo): restore session from backup before requiring QR
**Bot:** Bot1 Nhà Chung Nam — uid `621835795753666607`

Bot Zalo giữ đăng nhập bằng một **session file** (`packages/backend/zalo-session/zalo-session.json`).
Mỗi lần lưu session thành công, hệ thống tự ghi thêm một **backup copy** vào
`packages/backend/backups/db/zalo-session-<timestamp>/zalo-session.json` (ZR2 backup-copy-on-save).
Khi khởi động, backend tự restore từ primary; nếu primary mất, tự copy backup mới nhất rồi restore.
Chỉ khi không còn session/backup hợp lệ mới cần quét QR.

---

## 1. Khi nào dùng runbook này

- Zalo `connected=false` / `connectionStatus=error`
- Session file mất (`session.exists=false`, `warning=NO_SESSION_FILE`)
- `connectionDetail=qr_required` hoặc `restore_failed`
- Sau `pm2 restart hermes-backend` mà bot chưa online lại
- Listener dừng (`listenerActive=false`) dù đáng lẽ đang connected
- Zalo tự đăng xuất phía server (đổi mật khẩu, kick thiết bị) → session/backup hết hạn

---

## 2. Quy trình an toàn (LÀM TRƯỚC khi tạo QR)

> Nguyên tắc: **luôn thử reconnect/restore trước, chỉ tạo QR khi restore fail hoặc session expired.**

1. **Kiểm dryRun=true** (không gửi tin thật):
   ```bash
   curl -s -u "admin:<password>" http://127.0.0.1:3002/api/system/runtime-config \
     | python3 -c "import sys,json; print('dryRun=',json.load(sys.stdin)['effective']['dryRun'])"
   ```
   Phải `dryRun= True`.

2. **Kiểm live=false** (auto-reply live tắt):
   ```bash
   curl -s http://127.0.0.1:3002/api/system/live-test/status \
     | python3 -c "import sys,json; d=json.load(sys.stdin); print(d)"
   ```
   Live phải `active=false`.

3. **KHÔNG bật group.** Giữ ControlledDM=NO, GlobalLive=NO, Group=NO trong suốt quá trình restore.

4. **Kiểm trạng thái Zalo** (ops/status PUBLIC — không cần auth):
   ```bash
   curl -s http://127.0.0.1:3002/api/zalo/ops/status \
     | python3 -c "import sys,json; d=json.load(sys.stdin); print({k:d.get(k) for k in ['connected','connectionStatus','connectionDetail','listenerActive','dryRun']}); print('session',d['session'])"
   ```
   Đọc `connectionDetail`:
   - `connected` → xong, không cần làm gì
   - `session_present` / `backup_available` → **thử reconnect trước** (bước 5)
   - `qr_required` / `restore_failed` → nhảy sang mục 3 (tạo QR)

5. **Nếu có session/backup → thử reconnect trước (không cần QR):**
   ```bash
   curl -s -u "admin:<password>" -X POST http://127.0.0.1:3002/api/zalo/ops/reconnect \
     | python3 -c "import sys,json; print(json.load(sys.stdin))"
   ```
   Kết quả mong đợi:
   - `restored` — restore từ primary thành công
   - `restored_from_backup` — primary mất, restore từ backup thành công → **KHÔNG cần QR**
   - `reconnect_in_progress` — đang có reconnect chạy, chờ (mutex chống double-submit)
   - `restore_failed` / `qr_required` → session + backup đều hết hạn → sang mục 3

---

## 3. Quy trình QR (chỉ khi restore fail / session expired)

1. Mở web **`/zalo-ops`** (đã đăng nhập admin — browser tự inject Basic auth).
2. Bấm **"Tạo QR đăng nhập Zalo"** (nút hiện label này khi `connectionDetail=qr_required`).
   - Hoặc gọi endpoint (lưu ý: gửi body rỗng KHÔNG kèm `Content-Type: application/json`, tránh `FST_ERR_CTP_EMPTY_JSON_BODY` 400):
     ```bash
     curl -s -u "admin:<password>" -X POST http://127.0.0.1:3002/api/zalo/login/start
     ```
     Trả `{"data":{"status":"connecting"}}`.
3. Lấy QR về (base64 dataURL) nếu cần gửi qua kênh khác:
   ```bash
   curl -s -u "admin:<password>" http://127.0.0.1:3002/api/zalo/login/qr \
     | python3 -c "import sys,json,base64; d=json.load(sys.stdin); open('/tmp/hermes/zalo-qr.png','wb').write(base64.b64decode(d['qrDataURL'].split(',')[1])); print('saved',d['updatedAt'])"
   ```
   QR cũng lưu tại `packages/backend/zalo-session/qr-current.png`. Tự làm mới ~2s.
4. **Quét QR** bằng app Zalo → biểu tượng QR → quét.
5. **Verify sau khi quét** (ops/status):
   - `connected=true`
   - `connectionStatus=connected`, `connectionDetail=connected`
   - `listenerActive=true`
   - `session.exists=true`
6. **Lưu session** để ghi primary + backup:
   ```bash
   curl -s -u "admin:<password>" -X POST http://127.0.0.1:3002/api/zalo/session/save \
     | python3 -c "import sys,json; print(json.load(sys.stdin))"
   ```
   Verify:
   - primary `session.json` size > 0 (bình thường ~2815 bytes)
   - **backup-copy-on-save** có bản mới:
     ```bash
     ls -t packages/backend/backups/db/ | grep zalo-session- | head -3
     ```
     Phải thấy `zalo-session-<timestamp hôm nay>`.

---

## 4. Verify auto-restore sau restart (BẮT BUỘC để đóng PASS)

```bash
cd ~/hermes-zalo-control
PM2=$(command -v pm2 || echo ~/.nvm/versions/node/*/bin/pm2)
$PM2 restart hermes-backend --update-env
sleep 15
curl -s http://127.0.0.1:3002/api/zalo/ops/status \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('connected',d['connected'],'listener',d['listenerActive'],'detail',d['connectionDetail'])"
```

Kết quả mong đợi: `connected True listener True detail connected` — **không cần QR lại**.

**Xác nhận listener KHÔNG phải stale flag** — grep log để thấy listener thật sự khởi động:
```bash
grep -E "auto-restore: (success|restored=true)|listener.*started successfully" logs/backend-out.log | tail -5
```
Phải thấy: `Zalo auto-restore: success, connected=true listener=started` + `[listener] zca-js listener started successfully` với timestamp SAU lúc restart.

---

## 5. Các lệnh check nhanh

```bash
# Trạng thái Zalo (PUBLIC)
curl -s http://127.0.0.1:3002/api/zalo/ops/status | python3 -m json.tool

# Runtime config (admin) — dryRun
curl -s -u "admin:<password>" http://127.0.0.1:3002/api/system/runtime-config | python3 -m json.tool

# Live-test status (admin)
curl -s http://127.0.0.1:3002/api/system/live-test/status | python3 -m json.tool

# Log restore/session/listener
grep -E "restore|session|listener" logs/backend-out.log | tail -30
grep -E "restore|session|listener" logs/backend-error.log | tail -30
```

> Lưu ý env: `pm2` nằm trong nvm (`~/.nvm/versions/node/*/bin/pm2`), thường KHÔNG trong PATH của shell non-login. Backend logs ở `~/hermes-zalo-control/logs/backend-{out,error}.log` (KHÔNG phải `~/.pm2/logs/`). Admin creds: `.env` `ADMIN_USERNAME` / `ADMIN_PASSWORD` (không nằm trong PM2 env).

---

## 6. TUYỆT ĐỐI KHÔNG

- ❌ Commit `backups/` (root hoặc `packages/backend/backups/`) — chứa session creds + dev.db
- ❌ Commit `zalo-session.json` (session token)
- ❌ Commit `qr-current.png`
- ❌ Commit `.env` / token / cookie
- ❌ Xóa session file khi CHƯA chắc có backup hợp lệ
- ❌ Bật live (`AUTO_REPLY_DRY_RUN=false`) khi đang restore
- ❌ Bật group
- ❌ Báo PASS khi `listenerActive` chỉ là stale flag — phải verify bằng log listener started

`.gitignore` đã chặn: `backups/`, `packages/backend/backups/`, `zalo-session/`, `zalo-session.json`, `*.cookie`, `.env` (commit `fe1113e`).

---

## 7. Expected final state (điều kiện đóng PASS)

- `dryRun=true`
- `live=false` (auto-reply live inactive)
- `connected=true`
- `listenerActive=true` (verify bằng log, không phải stale flag)
- session persisted (primary size > 0)
- backup exists (bản mới sau save)
- **auto-restore after restart PASS** (restart → connected, không cần QR)
- ControlledDM=NO, GlobalLive=NO, Group=NO

---

## 8. Root cause lịch sử (ZR2)

- Session bị **quarantine sau disconnect/logout** (`POST /ops/disconnect` → `gw.logout()`), không có cơ chế tự restore từ backup → kẹt ở QR.
- **Path bug:** `findLatestSessionBackup()` + `writeSessionBackupCopy()` dùng `process.cwd()` → dưới PM2 (cwd=project root) trỏ sai `./backups/db` thay vì `packages/backend/backups/db` → bỏ sót backup thật. Đã fix: neo theo `config.zalo.sessionDir/../backups/db` (hàm `sessionBackupRoot()`).
- Fix ZR2: restore fallback sang backup trước khi đòi QR + mutex chống double-submit reconnect + backup-copy-on-save + `connectionDetail` để UI/ops phân biệt trạng thái.
