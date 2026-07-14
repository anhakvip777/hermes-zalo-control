# HANDOFF — Checklist An toàn & Vận hành (Hermes Zalo Control Center)

> Tài liệu bàn giao cho khách. Hệ thống này là **control plane** đứng giữa Zalo và AI agent,
> không phải chatbot đồ chơi. Mọi hành động tới Zalo phải **kiểm soát được, có quyền, và
> hồi phục được**. Đọc kỹ trước khi vận hành, đặc biệt trước khi bật bất kỳ chế độ live nào.

## 1. Trạng thái an toàn mặc định (KHÔNG tự ý đổi)

Hệ thống xuất xưởng ở trạng thái an toàn. Các cờ sau trong `packages/backend/.env` phải giữ nguyên
cho tới khi khách chủ động quyết định bật live và đã hiểu rủi ro:

| Cờ | Mặc định an toàn | Ý nghĩa |
|----|------------------|---------|
| `ZALO_AUTO_REPLY_ENABLED`   | `false` | Bot KHÔNG tự trả lời |
| `ZALO_AUTO_REPLY_DRY_RUN`   | `true`  | Nếu có trả lời cũng chỉ mô phỏng, không gửi thật |
| `ZALO_DRY_RUN`              | `true`  | Chặn gửi thật ở tầng gửi |
| `HERMES_AGENT_BRIDGE_ENABLED` | `false` | Cầu nối agent có cấu trúc chưa dùng cho production |
| `RETRIEVAL_DISPATCHER_DRYRUN_ENABLED` | `false` | Trả lời từ trí nhớ, chỉ dry-run |
| `ZALO_VISION_ENABLED`       | `false` | OCR ảnh |
| `ZALO_VOICE_ENABLED`        | `false` | TTS giọng nói |

> **dryRun = chỉ ghi bản nháp + bằng chứng vào DB, KHÔNG gửi tin Zalo thật.**
> Đây là chế độ chạy an toàn để kiểm thử toàn bộ luồng mà không chạm người dùng thật.

## 2. Bảy Luật Sắt (Iron Laws) — không được vi phạm

1. **Không bật live toàn cục.** Không đặt `live=true` / tắt `dryRun` toàn cục. Chỉ một
   `LiveTestSession` mới được vượt dryRun, cho **một thread**, có hạn mức (quota) + hạn giờ (TTL).
2. **Không thao tác phá hủy.** Không xóa/reset DB, thư mục `zalo-session/`, hay `backups/`.
   Nếu cần loại bỏ: **cách ly (quarantine), không xóa.**
3. **Không lộ bí mật.** Không commit/in token, cookie, file session, hay `.env`. Chỉ nhắc theo **tên biến**.
4. **Bridge sở hữu zca-js.** Không agent nào gọi thẳng thư viện Zalo. Mọi hành động Zalo đi qua Bridge + Tool Gateway.
5. **Một cửa gửi duy nhất.** `OutboundDispatcher.sendOutbound()` là cửa duy nhất cho mọi tin nhắn.
6. **Có bằng chứng mới tính là đã làm.** Mọi hành động quan trọng phải ghi bằng chứng vào DB
   (`OutboundRecord` / `AgentTask` / `Schedule` / `AuditLog`). Bot nói "đã gửi / đã đặt lịch" thì phải có bản ghi tương ứng.
7. **Không có tool thì nói thẳng.** Nếu chưa có công cụ cho một việc, bot phải nói **"chưa được cấp tool"**, không giả vờ đã làm.

## 3. Kiểm tra trạng thái an toàn (chạy bất cứ lúc nào — không phá hủy)

```bash
# Trạng thái DB guard (đang trỏ DB nào, có an toàn không)
npm run db:guard

# Quét lộ secret trước khi giao / commit
npm run secret:audit

# Kiểm tra tính nhất quán config (đặt STRICT để chặn khởi động nếu lỗi)
npm run config:check
```

Khi backend đang chạy, kiểm tra trạng thái Zalo (phải là disconnected khi chưa chủ động kết nối):

```bash
curl -s http://localhost:3000/api/zalo/status
```

## 4. Sao lưu & phục hồi

```bash
npm run backup:create      # tạo bản sao lưu DB
npm run backup:list        # liệt kê các bản sao lưu
npm run backup:verify      # kiểm tra tính toàn vẹn bản sao lưu
npm run backup:restore     # phục hồi từ bản sao lưu
npm run restart:safe       # tạo backup trước khi restart
```

> Nên `backup:create` trước mọi thay đổi lớn (migration, restart, thử live).

## 5. Quy trình thử LIVE (chỉ khi khách chủ động yêu cầu)

Live = gửi tin Zalo thật tới người dùng thật. **Mặc định cấm.** Nếu khách quyết định thử:

1. **Sao lưu trước:** `npm run backup:create`.
2. **KHÔNG** bật live toàn cục. Dùng cơ chế **Live Test Session** trên dashboard (mục Safety Mode):
   giới hạn **một thread**, **quota** nhỏ (vd 1 tin), **TTL** ngắn (vd 5 phút).
3. Thread mục tiêu phải nằm trong **allowlist** (`ZALO_AUTO_REPLY_ALLOWED_THREADS` / trang Allow Threads).
4. Theo dõi bằng chứng ở trang **Trace** / **Messages** / **Errors** sau mỗi lần gửi.
5. Hết quota/TTL → tự trở lại dryRun. Không nới rộng quota để "gửi thêm".

## 6. Việc TUYỆT ĐỐI KHÔNG làm khi vận hành

- ❌ Đặt `ZALO_AUTO_REPLY_ENABLED=true` hoặc `ZALO_AUTO_REPLY_DRY_RUN=false` để "cho nhanh".
- ❌ Đặt `ZALO_DRY_RUN=false` toàn cục.
- ❌ Bật `HERMES_AGENT_BRIDGE_ENABLED=true` (chưa sẵn sàng production).
- ❌ Xóa/reset DB, `zalo-session/`, `backups/`; hay chạy `db:reset`/`--force-reset` trên dữ liệu thật.
- ❌ Commit/gửi đi `.env`, token, cookie, file session.
- ❌ Cho agent gọi thẳng Zalo, hoặc gửi tin không qua `sendOutbound`.
- ❌ QR login / reconnect session / deploy khi chưa được đồng ý.

## 7. Đăng nhập & phân quyền

- Dashboard dùng `ADMIN_USERNAME` / `ADMIN_PASSWORD` (Basic auth). **Đổi mật khẩu mặc định trước khi giao.**
- Phân quyền theo `senderId` trên Zalo (model `ZaloPrincipal`): `form_only` → `basic_chat` → `advanced` → `admin`.
  Cấu hình ở trang **Access Control**.

## 8. Bằng chứng vận hành (nơi kiểm tra khi có sự cố)

| Cần xem | Nơi xem |
|---------|---------|
| Tin gửi ra (thật/dry-run) | `OutboundRecord` — trang Messages / Trace |
| Tin nhận vào | `Message` |
| Tác vụ agent | `AgentTask` |
| Nhật ký kiểm toán | `AuditLog` — trang Errors |
| Lịch & lần chạy | `Schedule` / `ScheduleExecution` — trang Schedules |
| Sức khỏe hệ thống | `SystemHeartbeat` — trang System Health |

## 9. Tóm tắt trạng thái khi bàn giao

- Live: **CHƯA chạy**
- AutoReply: **OFF** · DryRun: **ON** · Bridge: **OFF**
- Zalo: **chưa kết nối** (local an toàn)
- Build: **exit 0** (shared → backend → frontend, 24 route)
- Typecheck: **exit 0**
- Test backend: **77 files / 1102 tests passed** (ổn định qua 3 lần chạy)
