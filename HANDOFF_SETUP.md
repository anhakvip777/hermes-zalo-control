# HANDOFF — Cài đặt & Chạy (Hermes Zalo Control Center)

> Tài liệu bàn giao cho khách. Hướng dẫn cài, cấu hình, build và chạy hệ thống.
> Mọi biến bí mật chỉ nêu **tên biến** — điền giá trị thật vào `.env`, không commit.

## 1. Yêu cầu môi trường

| Thành phần | Phiên bản |
|------------|-----------|
| Node.js    | >= 22.0.0 |
| npm        | >= 10.0.0 |
| Hệ điều hành | Windows / Linux / macOS |

Kiểm tra:

```bash
node -v      # phải >= 22
npm -v       # phải >= 10
```

## 2. Cấu trúc dự án

Monorepo dùng npm workspaces, 3 package:

| Package | Vai trò | Cổng mặc định |
|---------|---------|---------------|
| `packages/shared`   | Kiểu/tiện ích dùng chung. **Phải build trước.** | — |
| `packages/backend`  | API + Bridge Zalo + Tool Gateway (Fastify) | 3000 |
| `packages/frontend` | Dashboard quản trị (Next.js) | 3001 |

> Thứ tự build bắt buộc: **shared → backend → frontend**. Backend/frontend phụ thuộc vào `shared/dist`.

## 3. Cài đặt

```bash
# Từ thư mục gốc repo
npm install                          # cài toàn bộ workspaces
npm run build -w packages/shared     # build shared trước (bắt buộc)
```

## 4. Cấu hình môi trường

Backend cần file `packages/backend/.env`. Copy từ mẫu và điền giá trị:

```bash
cp packages/backend/.env.example packages/backend/.env
```

Các biến **bắt buộc phải đổi** trước khi chạy (không dùng giá trị `changeme`):

| Biến | Ý nghĩa |
|------|---------|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Đăng nhập dashboard admin |
| `JWT_SECRET`     | Ký JWT — đặt chuỗi ngẫu nhiên đủ dài |
| `COOKIE_SECRET`  | Ký cookie — đặt chuỗi ngẫu nhiên đủ dài |
| `CHIASEGPU_API_KEY` | Khóa nhà cung cấp AI (nếu dùng) |
| `DATABASE_URL`   | Đường dẫn SQLite, mặc định `file:./dev.db` |

Các biến **an toàn — giữ nguyên mặc định** (xem chi tiết ở `HANDOFF_SAFETY.md`):

```
ZALO_AUTO_REPLY_ENABLED=false
ZALO_AUTO_REPLY_DRY_RUN=true
ZALO_DRY_RUN=true
HERMES_AGENT_BRIDGE_ENABLED=false
RETRIEVAL_DISPATCHER_DRYRUN_ENABLED=false
```

Biến cổng/CORS:

| Biến | Mặc định | Ghi chú |
|------|----------|---------|
| `PORT` | 3000 (code) / 3002 (`.env.example`) | ⚠️ Xem cảnh báo bên dưới |
| `HOST` | 0.0.0.0 | |
| `CORS_ORIGIN` | http://localhost:3001 | phải trỏ đúng origin frontend |
| `FRONTEND_URL` | http://localhost:3001 | |

> ⚠️ **Lưu ý cổng backend:** code mặc định `3000` (khi `PORT` không đặt), nhưng file `.env.example` lại đặt `PORT=3002`. Nếu bạn copy `.env.example` nguyên xi, backend sẽ chạy ở **3002** — khi đó mọi lệnh `curl`/`smoke` trong tài liệu này (đang trỏ `3000`) phải đổi sang cổng bạn thực dùng. Khuyến nghị: chọn một cổng thống nhất trong `.env` rồi dùng đúng cổng đó ở mọi nơi.

## 5. Chuẩn bị database

Database là SQLite (một file). Lần đầu chạy cần tạo schema:

```bash
npm run db:generate                  # sinh Prisma client
npm run db:push:safe                 # tạo bảng (có guard chống ghi nhầm DB)
```

> Không bao giờ chạy reset DB (`--force-reset`) trên dữ liệu thật. Dùng `npm run db:guard` để kiểm tra trạng thái.

## 6. Chạy ở chế độ phát triển (dev)

```bash
npm run dev            # backend + frontend cùng lúc
# hoặc tách riêng:
npm run dev:backend    # chỉ backend (tsx watch)
npm run dev:frontend   # chỉ frontend (Next dev, cổng 3001)
```

Dashboard: http://localhost:3001 — đăng nhập bằng `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

## 7. Build & chạy production

```bash
# Từ gốc repo — build cả 3 theo đúng thứ tự:
npm run build          # shared → backend → frontend

# Chạy backend đã build:
node packages/backend/dist/index.js

# Chạy frontend đã build (terminal khác):
npm run start -w packages/frontend
```

Kết quả build gần nhất đã xác minh: **exit 0**, frontend sinh **24 route**, backend có `packages/backend/dist/index.js`.

## 8. Kiểm tra sức khỏe (smoke test)

Khi backend đang chạy:

```bash
curl -s http://localhost:3000/api/health
curl -s http://localhost:3000/api/zalo/status
```

Hoặc chạy gộp (lưu ý: script `smoke` mặc định trỏ cổng 3000 và dùng thông tin admin demo — chỉnh lại cho đúng môi trường của bạn):

```bash
npm run smoke
```

## 9. Lệnh kiểm thử & chất lượng

```bash
npm run typecheck                    # tsc --noEmit toàn bộ (exit 0)
npm test -w packages/backend         # bộ test backend (có guard test DB)
npm run build                        # build lại toàn bộ
npm run secret:audit                 # quét lộ secret trước khi giao/commit
```

Trạng thái đã xác minh gần nhất: typecheck **exit 0**; test backend **77 files / 1102 tests passed** (chạy 3 lần liên tiếp đều xanh).

## 10. Kết nối Zalo (chỉ khi khách chủ động bật)

Kết nối Zalo qua QR/session là bước **live**, mặc định KHÔNG tự chạy. Chỉ thực hiện khi khách đã đọc và chấp nhận `HANDOFF_SAFETY.md`. Xem mục vận hành an toàn ở tài liệu đó.
