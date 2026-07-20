# HANDOVER — BridgeZalo

> Trích xuất ngày 2026-07-15 từ phiên bị khóa `df933f69-0441-464e-98d7-cb87e9ca6646`.
>
> Bản ghi nguồn: `C:\Users\VA\.claude\projects\e--BridgeZalo\df933f69-0441-464e-98d7-cb87e9ca6646.jsonl` — 6.661.253 byte — 1.820/1.820 dòng JSONL hợp lệ — từ `2026-07-14T16:40:23Z` đến `2026-07-15T02:38:04Z` — sửa lần cuối 09:38:04 UTC+7.
>
> Dấu hiệu xác nhận đúng phiên: có đầy đủ `user`, `assistant`, `content`, `tool_use`, `tool_result`; nhiều phản hồi cuối là `Request too large (max 32MB). Try with a smaller file.`. Đây là JSONL văn bản, không phải SQLite/LevelDB/nhị phân.
>
> Phiên tiếp nối ngắn chứa bản bàn giao cũ và lần kiểm tra cuối: `C:\Users\VA\.claude\projects\e--BridgeZalo\157c2ac5-2303-4d5d-a18c-7e406803fbd5.jsonl` — 43.634 byte — sửa lúc 09:38:07 UTC+7. Phiên này không tiếp tục được task nền cũ và bị người dùng ngắt sau khi xem Git diff.

## 1. Tổng quan dự án

### Dự án là gì

BridgeZalo/Hermes Zalo Bridge là một control plane nằm giữa Zalo (`zca-js`) và các AI agent. Kiến trúc được giữ như sau:

1. **Zalo Bridge** sở hữu duy nhất session và toàn bộ Zalo I/O.
2. **Tool Gateway** là lõi dùng chung dự kiến: permission matrix, schema validation, audit/evidence, redaction, dry-run/live gate và outbound governance.
3. **Agent Adapter Layer** chứa các adapter có thể thay thế; Hermes là adapter đầu tiên chứ không phải giao thức lõi.
4. `OutboundDispatcher.sendOutbound()` là cửa duy nhất cho outbound text/media/voice. Không agent nào được gọi `zca-js` trực tiếp.

Luồng runtime hiện tại vẫn chủ yếu là text-only:

`ZaloGatewayService` → normalize/persist inbound → `IncomingMessageDispatcher` → safety/permission/group gates → `HermesChatAdapter` → `OutboundDispatcher` → `ZaloMessageSender` chỉ khi không dry-run.

Các evidence/data model quan trọng đã có gồm `Message`, `OutboundRecord`, `AgentTask`, `AuditLog`, `Schedule*`, `Rule*`, `ZaloPrincipal*`, `ThreadSetting`, `RuntimeSetting`, `RuntimeConfigAudit`, `LiveTestSession`, `ThreadCooldown`, `MessageBatch`, `SystemHeartbeat`, `Document*`, `Attachment`. Không có schema/migration/data change nào được thực hiện trong đợt dashboard remediation đang dang dở.

### Trạng thái sản phẩm trước đợt remediation này

Các checkpoint mới nhất được ghi trong `CLAUDE.md` cho biết:

- Retrieval Answer 3.5A–3.5E đã được triển khai, gồm attachment/OCR search, evidence-backed answer, read-only HTTP/UI và dispatcher integration dry-run-only.
- Dispatcher retrieval mặc định tắt, chỉ chạy khi `RETRIEVAL_DISPATCHER_DRYRUN_ENABLED=true`, và có hard guard không cho live.
- Runtime synthetic dry-run đã PASS trước đây; không Zalo send, không QR/reconnect, không live.
- Safety checkpoint: autoReply OFF, dry-run ON, bridge OFF, Zalo disconnected/local-safe.
- Các checkpoint này là lịch sử trước remediation; cần kiểm tra code và trạng thái runtime hiện tại trước khi dựa vào chúng.

### Mục tiêu của phiên bị khóa

Phiên bắt đầu bằng việc tiếp tục browser QA read-only cho tám route:

- `/`
- `/production-readiness`
- `/messages`
- `/retrieval-test`
- `/safety-mode`
- `/zalo-ops`
- `/thread-settings`
- `/media-send`

Browser QA đã kết luận:

- Next.js route/bundle/hydration hoạt động sau khi dùng build hiện hành và profile sạch.
- Dashboard vẫn **FAIL về khả năng sử dụng** vì backend yêu cầu HTTP Basic Auth nhưng frontend không có auth flow thống nhất.
- API protected trả 401 khi không có credentials và trả 200/có dữ liệu khi có credentials hợp lệ.
- Nhiều trang nuốt lỗi hoặc biến lỗi/unknown thành `0`, empty, `DRY RUN`, disconnected hoặc pass giả.
- `/thread-settings` và `/media-send` dùng `localStorage.admin_pass`, hard-code username `admin` và có contract sai.
- `/media-send` gọi upload endpoint không tồn tại, dùng browser `blob:` URL không hợp lệ ở backend và gửi payload không đúng contract.
- Không có QR/login/reconnect/disconnect, send text/media, live, dry-run change hay DB mutation trong QA.

Sau QA, người dùng yêu cầu lên plan, duyệt plan và cuối cùng yêu cầu: **“bắt đầu triển khai plan đi”**, sau đó **“tiếp tục đi”** và **“làm tiếp cho xong các bước cuối cùng đi”**.

Kế hoạch đã duyệt nằm tại:

`C:\Users\VA\.claude\plans\mossy-moseying-pnueli.md`

Mục tiêu plan là làm dashboard **authenticated, truthful và fail-closed**, đồng thời biến các bề mặt live/Zalo/media/mutation thành status-only hoặc disabled trong remediation đầu tiên.

---

## 2. Các tập tin được truy cập

### 2.1. Được tạo mới trong phiên

Các file dưới đây là file mới thực tế theo Git status hiện tại hoặc được tạo ngoài repo trong transcript:

- `E:\BridgeZalo\repo\packages\backend\src\http\api-error.ts`
- `E:\BridgeZalo\repo\packages\frontend\src\lib\admin-auth.ts`
- `E:\BridgeZalo\repo\packages\frontend\src\components\auth-provider.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\components\auth-gate.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\components\dashboard-shell.tsx`
- `C:\Users\VA\.claude\plans\mossy-moseying-pnueli.md`
- `C:\Users\VA\AppData\Local\Temp\bridge-route-qa.cjs` — script QA tạm thời; từng được chỉnh nhiều lần. Cần kiểm tra còn tồn tại hay không trước khi dọn, không xóa nếu chưa xác nhận.

### 2.2. Được sửa hoặc ghi đè trong phiên

Git status hiện tại xác nhận 18 file tracked đã đổi:

- `E:\BridgeZalo\repo\CLAUDE.md`
- `E:\BridgeZalo\repo\packages\backend\src\middleware\auth.ts`
- `E:\BridgeZalo\repo\packages\backend\src\routes\admin.ts`
- `E:\BridgeZalo\repo\packages\backend\src\routes\thread-settings.ts`
- `E:\BridgeZalo\repo\packages\backend\src\routes\zalo.ts`
- `E:\BridgeZalo\repo\packages\backend\src\services\live-test.service.ts`
- `E:\BridgeZalo\repo\packages\backend\src\services\runtime-config.service.ts`
- `E:\BridgeZalo\repo\packages\backend\src\services\thread-settings.service.ts`
- `E:\BridgeZalo\repo\packages\backend\src\services\zalo-ops.service.ts`
- `E:\BridgeZalo\repo\packages\frontend\src\app\documents\page.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\app\layout.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\app\media-send\page.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\app\production-readiness\page.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\app\safety-mode\page.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\app\thread-settings\page.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\app\zalo-ops\page.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\components\providers.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\lib\api-client.ts`
- `E:\BridgeZalo\repo\packages\frontend\src\lib\api.ts`

Các file hiện bị Git coi là untracked chính xác là năm file mới trong repo đã liệt kê ở mục 2.1.

### 2.3. Chỉ đọc/tham chiếu trong tool calls

#### Hướng dẫn, package, build và cấu hình

- `C:\Users\VA\.claude\settings.json`
- `C:\Users\VA\.claude\projects\e--BridgeZalo\memory\MEMORY.md` — Read trả “file does not exist”.
- `E:\BridgeZalo\repo\package.json`
- `E:\BridgeZalo\repo\packages\backend\package.json`
- `E:\BridgeZalo\repo\packages\frontend\package.json`
- `E:\BridgeZalo\repo\packages\shared\package.json`
- `E:\BridgeZalo\repo\packages\backend\tsconfig.json`
- `E:\BridgeZalo\repo\packages\frontend\tsconfig.json`
- `E:\BridgeZalo\repo\packages\frontend\next.config.ts`
- `E:\BridgeZalo\repo\vitest.config.ts`
- `E:\BridgeZalo\repo\packages\backend\prisma\schema.prisma`

#### Backend source chỉ đọc hoặc dùng để đối chiếu

- `E:\BridgeZalo\repo\packages\backend\src\app.ts`
- `E:\BridgeZalo\repo\packages\backend\src\config.ts`
- `E:\BridgeZalo\repo\packages\backend\src\middleware\error-handler.ts`
- `E:\BridgeZalo\repo\packages\backend\src\middleware\rate-limit.ts`
- `E:\BridgeZalo\repo\packages\backend\src\process-lock.ts`
- `E:\BridgeZalo\repo\packages\backend\src\routes\agent.ts`
- `E:\BridgeZalo\repo\packages\backend\src\routes\system.ts`
- `E:\BridgeZalo\repo\packages\backend\src\services\production-readiness.service.ts`
- `E:\BridgeZalo\repo\packages\backend\src\services\settings.service.ts`
- `E:\BridgeZalo\repo\packages\backend\src\services\zalo-gateway.service.ts`
- `E:\BridgeZalo\repo\packages\backend\src\services\zalo-receive.ts`

#### Frontend source chỉ đọc hoặc dùng để đối chiếu

- `E:\BridgeZalo\repo\packages\frontend\src\app\page.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\app\messages\page.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\app\retrieval-test\page.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\components\toast.tsx`
- `E:\BridgeZalo\repo\packages\frontend\src\components\zalo-login-card.tsx`

#### Test files được đọc/tham chiếu

- `E:\BridgeZalo\repo\packages\backend\src\__tests__\app-auth.test.ts`
- `E:\BridgeZalo\repo\packages\backend\src\__tests__\batch17-production-readiness.test.ts`
- `E:\BridgeZalo\repo\packages\backend\src\__tests__\batch3-thread-settings-media.test.ts`
- `E:\BridgeZalo\repo\packages\backend\src\__tests__\zalo-media-send.test.ts`
- Workflow còn tham chiếu các test: `batch18-live-test.test.ts`, `batch16-zalo-ops.test.ts`, `batch-r4a-send-test-route.test.ts`, `batch-r4b-media-voice.test.ts`, `retrieval-answer-route.test.ts`, `incoming-dispatcher.test.ts`, `batch7-image-ocr.test.ts`, `batch13-document-ui.test.ts` và các test retrieval/idempotency. Không có test file nào được tạo/sửa trong implementation trước khi phiên lỗi.

#### Artifact browser QA tạm thời

Các file sau được tạo bởi lệnh QA và sau đó đọc/phân tích; chúng không thuộc repo:

- `C:\Users\VA\AppData\Local\Temp\bridge-qa-root.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa-readiness.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa-messages.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa-retrieval.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa-safety.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa-zalo.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa-thread.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa-media.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa2-root.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa2-readiness.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa2-messages.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa2-retrieval.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa2-safety.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa2-zalo.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa2-thread.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa2-media.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa3-root.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa3-readiness.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa3-messages.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa3-retrieval.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa3-safety.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa3-zalo.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa3-thread.json`
- `C:\Users\VA\AppData\Local\Temp\bridge-qa3-media.json`

#### Workflow/session artifacts được tham chiếu

- `C:\Users\VA\.claude\projects\e--BridgeZalo\df933f69-0441-464e-98d7-cb87e9ca6646\workflows\wf_446daba8-9a1.json`
- `C:\Users\VA\.claude\projects\e--BridgeZalo\df933f69-0441-464e-98d7-cb87e9ca6646\workflows\scripts\dashboard-remediation-implementation-map-wf_446daba8-9a1.js`
- `C:\Users\VA\.claude\projects\e--BridgeZalo\df933f69-0441-464e-98d7-cb87e9ca6646\subagents\workflows\wf_446daba8-9a1\journal.jsonl`
- `C:\Users\VA\.claude\projects\e--BridgeZalo\df933f69-0441-464e-98d7-cb87e9ca6646\workflows\wf_a2f8a623-13b.json`
- `C:\Users\VA\.claude\projects\E--BridgeZalo-repo\df933f69-0441-464e-98d7-cb87e9ca6646\workflows\scripts\dashboard-remediation-diff-audit-wf_a2f8a623-13b.js`
- `C:\Users\VA\.claude\projects\e--BridgeZalo\df933f69-0441-464e-98d7-cb87e9ca6646\subagents\workflows\wf_a2f8a623-13b\journal.jsonl`

Không tìm thấy `spaces/<...>/memory/` nào trong phiên và project memory `MEMORY.md` không tồn tại, nên không có memory file nào cần sao chép sang phiên mới.

---

## 3. Các quyết định đã được đưa ra

### Kiến trúc/auth

- **Giữ stateless HTTP Basic Auth ở backend**, không chuyển sang JWT/cookie/server session trong remediation này.
- Thêm protected `GET /api/admin/session` để frontend probe credentials.
- Frontend giữ Basic Authorization **chỉ trong module/provider memory**; không lưu password/header vào `localStorage`, `sessionStorage`, cookie, URL hoặc log. Reload sẽ yêu cầu login lại.
- API chỉ được gọi bằng relative same-origin `/api/...`; không gửi credentials tới absolute/cross-origin URL.
- Login gate phải mount trước dashboard shell và page effects, để fresh profile chưa login không phát protected API request.
- `apiFetch()` là transport tập trung, gắn auth, parse canonical/legacy error, xử lý 204/non-JSON và invalidation khi 401.

### Truth model và safety

- Dữ liệu không tải được phải là `UNKNOWN`/error, không được suy ra `false`, `true`, `[]`, `0`, disconnected, DRY RUN hoặc PASS.
- Các route nguy hiểm được chuyển sang **status-only/read-only** trong remediation đầu tiên.
- **Global live bị vô hiệu hóa ở backend**; `dryRun=false` trả `GLOBAL_LIVE_DISABLED`. `LiveTestSession` có thread/quota/TTL là cơ chế bypass dry-run duy nhất.
- Không QR login/check, reconnect, disconnect, test DM, test alert, start/stop live test, send media hoặc thay đổi thread settings từ dashboard remediation.
- `/media-send` bị thay bằng notice disabled; không thêm `/api/upload`, không dùng browser object URL, không gọi outbound.
- `/thread-settings` trở thành bảng read-only và phải hiểu envelope `{ data, total, page, pageSize, totalPages }`; type thiếu/conflict phải là `unknown`.
- Readiness phải fail-closed; chỉ complete và explicit `READY_FOR_LIVE` mới có thể cho controlled live test đi tiếp.

### HTTP contract

- Tạo canonical error shape `{ error: { code, message, details? } }` qua helper `sendApiError()`.
- Harden Basic parser: không dev bypass, malformed Base64 an toàn, UTF-8, split ở dấu `:` đầu tiên, cùng một 401/challenge cho mọi lỗi.
- `registerProtected()` tiếp tục là auth owner duy nhất; xóa auth hooks/check thủ công trùng trong Zalo routes.
- Không sweep toàn bộ API ngoài scope; parser frontend tạm hiểu cả canonical lẫn legacy để rollout/rollback độc lập.

### Những cách đã bác bỏ rõ ràng

- Không dùng `localStorage.admin_pass` hoặc hard-coded `admin` để tạo Basic header.
- Không dùng `NEXT_PUBLIC_API_URL` để gửi Basic credentials cross-origin.
- Không biến 401/network/malformed payload thành empty hoặc “safe”.
- Không thêm upload endpoint/browser blob workaround trong task này.
- Không mở lại mutation UI cho live/Zalo/media/thread settings trước capability review riêng.
- Không sửa schema/migration/data để giải quyết dashboard.
- Không gọi trực tiếp `zca-js`; không tạo outbound door mới.
- Không commit, push, deploy hoặc restart production trong task.

### Quyết định về compact

Người dùng yêu cầu khi context gần đầy phải ưu tiên giữ kiến trúc, database design, danh sách file, quyết định, QA và blocker. Một mục `Compact Instructions` 15 dòng đã được thêm vào `E:\BridgeZalo\repo\CLAUDE.md`. Đây là thay đổi tracked đang còn trong working tree.

---

## 4. Trạng thái cuối cùng được biết

### Git/worktree

Trạng thái mới nhất được kiểm tra:

- Repo: `E:\BridgeZalo\repo`
- Branch: `master`
- Upstream: `origin/master`
- Branch đang **ahead 2 commit**.
- 18 file tracked modified và 5 file untracked như mục 2.
- Không có commit/push/deploy trong remediation.
- Không có schema/data/session/secret file được thay đổi theo transcript.
- Lần `git diff --check` cuối có output rõ ràng trong phiên tiếp nối báo:
  `packages/backend/src/services/thread-settings.service.ts:165: new blank line at EOF.`
  Chưa có bằng chứng lỗi whitespace này đã được sửa.

### Các phần implementation đã làm

#### Backend

- `adminAuth` đã được viết lại theo Basic UTF-8 strict hơn, bỏ development bypass, dùng canonical 401 và challenge có charset.
- `GET /api/admin/session` đã thêm vào admin routes, trả username metadata và no-store/Vary headers.
- Tạo `sendApiError()` helper.
- Zalo route-local auth hooks/check thủ công đã được gỡ; app-level protected scope vẫn là owner.
- Một số Zalo/media/thread-setting error đã chuyển sang canonical envelope.
- `getZaloOpsStatus()` không còn ghi heartbeat trong GET; dùng `isListenerActive()`.
- Live-test status GET không persist expiry khi chỉ đọc.
- Thêm `peekThreadSettings()` không create default row cho GET.
- Thread-settings list thêm `threadType` từ batched `ZaloThread`/`Message` evidence; conflict dự kiến thành `unknown`.
- Global `dryRun=false` bị backend từ chối.
- `startLiveTest()` đã được siết để cần verdict `READY_FOR_LIVE`, `dataQuality=complete`, summary/checks hợp lệ.

#### Frontend

- Tạo in-memory credential store UTF-8.
- Tạo `AuthProvider`, `AuthGate`, login form, `DashboardShell`, login/logout và shared shell polling.
- `Providers` mount `ToastProvider -> AuthProvider -> AuthGate -> DashboardShell`.
- Root layout được rút gọn để dùng Providers.
- `apiFetch` chuyển sang same-origin `/api/`, gắn in-memory Authorization, parse nested/legacy errors và kiểm tra generation cho response success.
- Lỗi login form bị disable vĩnh viễn sau failed login đã được sửa bằng `finally`.
- Document jobs raw fetch đã chuyển qua typed `apiFetch`, có error state.
- `/thread-settings` được viết lại read-only.
- `/media-send` được thay bằng disabled notice.
- `/safety-mode` đã thêm error/unknown state và gỡ global live/Test Alert controls; vẫn có luồng “khôi phục Dry Run”.
- `/zalo-ops` chuyển sang status-only và gỡ QR/reconnect/disconnect/test-DM controls.
- `/production-readiness` được viết lại status-only và gỡ Start/Stop Live Test UI.

### Verification đã có nhưng không đủ để kết luận hoàn tất

- Sau batch auth/core ban đầu, backend và frontend TypeScript từng chạy từ đúng repo root và đều `EXIT:0`.
- Persisted diff-audit workflow ghi nhận tại thời điểm audit: backend/frontend typecheck pass, frontend build pass, app-auth 5 test pass và media/voice 12 test pass.
- **Nhưng nhiều file route đã được chỉnh tiếp sau các kết quả đó.** Không được dùng các PASS cũ để tuyên bố current working tree pass.
- Lệnh validate cuối sau các edit mới chạy từ `E:\BridgeZalo` thay vì `E:\BridgeZalo\repo`; `npx tsc` tải nhầm package placeholder và thất bại với “This is not the tsc command you are looking for”. Đây là lỗi working directory/tool invocation, không phải bằng chứng compile fail hay pass.
- Không có full focused tests, backend test suite, build cuối hoặc browser QA cuối sau toàn bộ edit.

### 10–20 trao đổi cuối trước khi bị khóa

1. Assistant đang sửa ba route cuối: Safety Mode, Zalo Ops và Production Readiness.
2. Assistant đọc lại `production-readiness/page.tsx` sau khi ghi đè.
3. Assistant grep root Dashboard và Messages để tìm các fallback `dryRun/live/sentMessageId/role/outboundDecision` còn sai.
4. Assistant đọc `/retrieval-test` và grep Safety Mode để kiểm tra các mutation/fallback còn sót.
5. Ngay sau các tool results lớn, request vượt 32MB và assistant không thể tiếp tục.
6. Người dùng gửi “sao rồi”; chỉ nhận cùng lỗi 32MB.
7. Workflow cũ báo task implementation-map không có completion record trong process cũ; metadata trên disk hiện cho thấy workflow đó đã hoàn tất, nhưng main session không còn quản lý task ID.
8. Người dùng gửi “hi”; vẫn chỉ nhận lỗi 32MB.
9. Trong phiên tiếp nối năm phút, bản handover cũ được dán vào; assistant thử `TaskOutput wbtpyjfpz` nhưng task ID không còn trong process, rồi chạy Git status/diff.
10. Phiên tiếp nối bị người dùng ngắt trước khi sửa thêm hoặc verify.

### Hướng dẫn cuối của người dùng

Hướng dẫn có hiệu lực cuối về công việc là tiếp tục triển khai plan đã duyệt và hoàn thành các bước cuối, nhưng phải giữ toàn bộ safety invariants. Hai tin nhắn cuối chỉ là hỏi tiến độ: **“sao rồi”** và **“hi”**; phiên bị lỗi nên chưa trả lời được.

---

## 5. Các luồng thảo luận/nhiệm vụ chưa giải quyết

### P0/P1 kỹ thuật còn mở

- Hoàn thiện backend readiness contract trong `production-readiness.service.ts`:
  - `unknown` status;
  - `summary.unknown`;
  - `dataQuality: complete | incomplete`;
  - `score: number | null`;
  - required checks xuất hiện đúng một lần;
  - dependency/missing evidence phải thành unknown/NOT_READY.
- `startLiveTest()` vẫn cần fail-closed verification của thread:
  - yêu cầu `ZaloThread` tồn tại và type=`user`;
  - DB lookup error/missing/conflicting evidence phải reject;
  - không được tạo session cho arbitrary/unverified thread ID.
- `apiFetch()` còn finding stale-401: request cũ nhận 401 có thể clear credentials mới. Cần chỉ clear nếu request generation vẫn là current generation.
- `AuthProvider` có race hardening chưa làm: out-of-order login probe phải không clear/ghi đè auth attempt mới; `STALE_RESPONSE` không được biến thành backend unavailable.
- `/zalo/send-media` có thể vẫn dereference body `null` sau `Object.keys(body ?? {})`; cần guard non-null object trước field access.
- Kiểm tra việc remove legacy `localStorage.admin_pass`; code mới không dùng nó, nhưng plan đề xuất cleanup one-time có guard.

### Route remediation còn dở

- `/` chưa được sửa theo truth model; vẫn cần bỏ `.catch(() => null)`, `dryRun ?? true`, safe-looking fallback và hardcoded proof.
- `/messages` chưa được sửa:
  - bỏ unsupported filters `role`, `isFromBot`, `outboundDecision`;
  - fetch fail phải là persistent error, không empty;
  - dry-run synthetic `sentMessageId` không được gắn nhãn SENT;
  - contradictory combinations phải là UNKNOWN.
- `/retrieval-test` chưa được rà soát cuối với central auth/error; giữ nguyên semantic read-only và không click submit trong browser QA cuối.
- `/safety-mode`, `/zalo-ops`, `/production-readiness` vừa được edit lớn nhưng chưa typecheck/build/browser verify. Cần đọc lại toàn file để tìm import/state/dead-code/JSX errors.
- Shared operational polling chưa đúng toàn bộ plan: cần in-flight guard, AbortController, dừng khi logout/unmount, tránh request overlap/rate-limit.
- Chưa tạo `dashboard-state.ts` hoặc pure truth classifiers/tests.

### Error contract/test coverage còn dở

- `middleware/error-handler.ts` chưa được chuyển sang helper chung theo plan.
- Canonicalization mới chỉ chạm một số branches; cần kiểm tra touched endpoint mà không sweep ngoài scope.
- Không có test file mới/sửa nào trong current diff.
- Cần bổ sung focused tests cho:
  - malformed/wrong/Unicode/colon Basic và `/admin/session`;
  - stale generation/401;
  - read-only GET không ghi DB;
  - readiness unknown/incomplete;
  - live-test thread evidence fail-closed;
  - thread DTO conflict→unknown;
  - media legacy/null payload reject trước dispatcher;
  - frontend Basic encoder/error parser/truth classifiers.

### Verification bắt buộc còn dở

Chạy từ `E:\BridgeZalo\repo`, không phải thư mục cha:

1. Sửa EOF whitespace và chạy `git diff --check`.
2. `npm run build -w packages/shared`.
3. `npm run typecheck -w packages/backend`.
4. Focused Vitest an toàn/DB-isolated theo project guard.
5. `npm run build -w packages/backend`.
6. `npm run typecheck -w packages/frontend`.
7. `npm run build -w packages/frontend`.
8. `npm run typecheck`.
9. Browser QA fresh profile cho đúng tám route:
   - trước login chỉ có login gate, zero protected request;
   - wrong/valid credential behavior;
   - backend down/401/malformed → UNKNOWN/error;
   - không QR/reconnect/disconnect/send/live/runtime mutation request;
   - browser storage không có password/header;
   - media page không có picker/upload/send;
   - thread settings read-only;
   - messages truth labels đúng.
10. Báo rõ mọi baseline failure, không gọi PASS khi exit code khác 0.

### Task/workflow

- `dashboard-remediation-diff-audit` (`wf_a2f8a623-13b`, task cũ `wbtpyjfpz`) đã có metadata status `completed` trên disk. Main session cũ không còn task handle.
- Coverage agent trong workflow đó bị `Request too large`; backend/frontend audits và verifiers đã hoàn tất. Audit không phải coverage toàn bộ.
- `dashboard-remediation-implementation-map` (`wf_446daba8-9a1`, task cũ `wxk5ibqdw`) cũng có metadata completed, dù notification trong process mới nói không tìm thấy completion record.
- Không có task nền nào cần chờ trong phiên mới; đọc artifact nếu cần, không poll các task ID cũ.

---

## 6. Ngữ cảnh cần chuyển tiếp

### Thư mục, branch và service

- Workspace ngoài repo: `E:\BridgeZalo`
- Repo chính: `E:\BridgeZalo\repo`
- Branch: `master`, ahead `origin/master` 2 commit.
- Frontend từng chạy tại `http://127.0.0.1:3001`.
- Backend từng chạy tại `http://127.0.0.1:3002`.
- Chrome DevTools QA đã dùng các cổng `9223`, `9231–9238`, `9331–9338`, `9341–9348`, `9351–9358` với isolated profiles. Đây là trạng thái lịch sử; kiểm tra process/ports mới trước khi tái sử dụng hoặc dọn.

### Plugins/kết nối/công cụ đã dùng

- Skills: `run` cho browser QA; `update-config` để xử lý yêu cầu compact instructions.
- `codegraph_context` được dùng để lập context auth/dashboard và context implementation.
- Nhiều Explore/Plan agents và hai workflows nêu trên.
- Chrome headless + Chrome DevTools Protocol qua PowerShell/Node script.
- Git, npm workspace, TypeScript, Vitest.
- Không có MCP/tool nào gọi Zalo live, không QR/reconnect/send.

### Chỉ dẫn repository đang hoạt động

Đọc `E:\BridgeZalo\repo\CLAUDE.md` trước khi code. Các luật quan trọng:

- Không global live; không disable global dry-run.
- Không xóa/reset DB, `zalo-session/` hoặc backups.
- Không in/commit secrets, cookies, session hoặc `.env`.
- Bridge sở hữu `zca-js`; agent không được gọi trực tiếp.
- `OutboundDispatcher.sendOutbound()` là outbound door duy nhất.
- Evidence hoặc coi như chưa xảy ra.
- Không tool thì phải nói chưa được cấp tool.
- Không commit/push/deploy nếu chưa được yêu cầu riêng.
- Không claim PASS nếu không có fresh output và exit code 0.
- Compact phải giữ kiến trúc, DB design, file list, quyết định, QA, blocker và safety invariants.

### Memory/handoff

- Không có `C:\Users\VA\.claude\projects\e--BridgeZalo\memory\MEMORY.md`.
- Không thấy `spaces/<...>/memory/` trong bản ghi bị khóa.
- Không có memory file riêng cần copy.
- `CLAUDE.md` chứa nhiều checkpoint/handoff lịch sử; dùng checkpoint mới nhất phù hợp và source hiện tại, vì các phần cũ có thể mâu thuẫn với implementation mới.

### Cách tiếp tục an toàn được đề xuất

1. Đọc plan đã duyệt và `CLAUDE.md`.
2. Chụp fresh `git status`, `git diff --stat`, `git diff --check`; không reset/stash/clean.
3. Đọc toàn bộ 23 file modified/untracked hiện tại trước khi sửa tiếp, ưu tiên các file cuối vừa edit.
4. Sửa compile/whitespace trước, rồi xử lý các P0/P1 còn mở.
5. Hoàn thiện `/` và `/messages`; rà soát lại ba route vừa rewrite.
6. Bổ sung focused tests trước khi browser QA.
7. Không thực hiện bất kỳ live/Zalo/DB mutation nào trong verification.
8. Chỉ khi mọi gate có fresh exit 0 mới báo hoàn tất.

---

## 7. Current verification checkpoint — 2026-07-20

This section is authoritative for the current working tree. Earlier sections are
historical handovers and must not be used as current verification.

### Implementation status

- Batch 1 safety guards and Batch 2 auth/polling lifecycle changes are present.
- Batch 3 read-only/status-only dashboard remediation is present.
- Batch 4 fail-closed changes are present for `/errors` and `/system-health`:
  remote data is validated, failed/malformed requests render unknown/error state,
  polling is abortable and single-flight, and `/errors` has no Test Alert mutation
  wiring.
- `config:check:strict` now uses `packages/backend/scripts/config-check-strict.mjs`.
  The wrapper invokes the workspace-local tsx CLI through `process.execPath` with
  `shell:false`, sets `STRICT_CONFIG_CHECK=true`, forwards stdio, and forwards the
  child exit status. The npm script is portable on Windows and POSIX.
- No Prisma schema/migration, runtime DB, Zalo session, backup, secret, or live
  configuration was changed by this remediation. No commit/push/deploy was made.

### Fresh verification evidence

| Gate | Evidence | Result |
|---|---|---|
| Backend focused config/path tests | `npx vitest run --config ./vitest.config.ts src/__tests__/config-check-script.test.ts` | 3 tests passed, exit 0 |
| Backend full suite | `npm test -w packages/backend` | 82 files / 1200 tests passed, exit 0 |
| Root full suite | `npm test` | backend 1200 + shared 6 + frontend 90 passed, exit 0 |
| Monorepo typecheck | `npm run typecheck` | shared/backend/frontend exit 0 |
| Monorepo build | `npm run build` | shared/backend and Next build exit 0; Next static generation 24/24 |
| DB guard | `npm run db:guard -w packages/backend` | runtime `dev.db` exists (688 KB), guard PASS, exit 0 |
| Strict config (safe synthetic env) | `npm run config:check:strict -w packages/backend` from PowerShell | `CONFIG_WARN`, PASS=8/WARN=1/ERROR=0, exit 0 |
| Strict config negative case | focused placeholder fixture | `CONFIG_ERROR` and exit 1 as expected |
| Isolated backend-up HTTP smoke | temp DB/session, `ZALO_DRY_RUN=true`, auto-reply disabled; health/admin/system/errors/heartbeats/zalo GETs | 7/7 endpoints returned HTTP 200 with valid JSON; no live/Zalo action |
| Runtime DB integrity | SHA-256 of `packages/backend/prisma/dev.db` before/after isolated smoke | unchanged: `36216E4786EF437833D2BFBF398BFD1F53B4BB4A0F49EF5155DF8286A30736E9` |

The repeated `9router\\mitm\\rootCA.crt` warning and expected negative-path Prisma
logs are environmental/test diagnostics; they did not produce a failed test or
non-zero gate.

### Browser QA status — PASS (isolated)

- Browser QA used a fresh in-app Browser tab against a production Next server
  (`next start`) on `http://localhost:3001`, with a separate backend on `3002`, a
  temporary Prisma database/session directory, `ZALO_DRY_RUN=true`, and
  `ZALO_AUTO_REPLY_ENABLED=false`.
- Fresh-profile login gate was visible before authentication. Wrong synthetic
  credentials produced the rejected-login message; valid synthetic credentials
  opened the dashboard shell. No password or cookie was observed in browser
  storage; the credential implementation remains in-memory and is covered by the
  frontend auth tests. (The browser evaluation sandbox does not expose the
  storage objects for direct key enumeration.)
- Authenticated read-only route checks covered `/`, `/messages`, `/retrieval-test`,
  `/safety-mode`, `/zalo-ops`, `/production-readiness`, `/thread-settings`,
  `/system-health`, `/errors`, and `/media-send`.
- `/errors` showed API-backed totals and only logout/refresh controls; no Test
  Alert. `/system-health` showed sectioned evidence and degraded status. Safety,
  Zalo Ops, Readiness, and Thread Settings were status/read-only. Media Send had
  no file input, form, upload/object-URL, or send control.
- With the backend stopped, both `/system-health` and `/errors` rendered explicit
  `UNKNOWN`/error states (`Internal Server Error`) without green/zero fallbacks.
- A temporary malformed-response backend returned incomplete `{data:{}}`
  payloads. Both pages rendered explicit invalid-response/unknown states and did
  not show Test Alert or success counters.
- The temporary request logger recorded only `GET` requests during auth/status QA
  (`/api/admin/session`, `/api/system/*`, `/api/zalo/ops/status`); no POST/PATCH/
  DELETE/mutation request was emitted. The Browser DOM snapshot helper itself had
  a plugin error, so documented `get_visible_dom` was used for locator evidence.
- No external browser/CDP substitute was used. Historical `bridge-qa*` artifacts
  remain stale and were not used as evidence.

### Artifact and process cleanup

- Removed known temporary artifacts: `batch4-test.patch`, `review-diff.txt`,
  `tmp-patch-test.txt`, and `packages/frontend/src/lib/batch4-test-temp.ts`.
- Isolated backend/frontend processes were stopped; ports 3001/3002 are closed.
- Build outputs (`packages/frontend/.next/` and `tsconfig.tsbuildinfo`) remain
  ignored/generated and are not part of the handover.
- Registered `.claude/worktrees/` entries were preserved because several contain
  uncommitted changes; they require an explicit cleanup decision and were not
  deleted blindly.

### Post-completion notes

- Registered `.claude/worktrees/` entries were preserved because several contain
  uncommitted changes; deleting them requires a separate explicit cleanup choice.
- Keep all live, schema, session, backup, secret, commit, and push restrictions
  unchanged for any subsequent work.

---

## 8. Independent final verification — 2026-07-20 00:45–00:58 UTC+7

This section supersedes Section 7 as the latest verification checkpoint. It was
re-run against the same current working tree instead of relying on the earlier
handover prose.

### Final gates

| Gate | Fresh evidence | Result |
|---|---|---|
| Whitespace | `git diff --check` | Exit 0; only Git LF/CRLF conversion warnings |
| Schema/migration guard | `git diff --name-only -- packages/backend/prisma packages/backend/prisma/schema.prisma` | No output |
| Root test suite | `npm test` | Backend 82 files / 1200 tests, shared 6 tests, frontend 90 tests; all groups passed, exit 0 |
| Monorepo typecheck | `npm run typecheck` | shared/backend/frontend exit 0 |
| Monorepo build | `npm run build` | shared/backend/frontend exit 0; Next compiled and generated 24/24 pages |
| Strict config positive | safe synthetic env + `npm run config:check:strict -w packages/backend` | `CONFIG_WARN`, PASS=8/WARN=1/ERROR=0, exit 0 |
| Strict config negative | placeholder secrets + the same npm command | `CONFIG_ERROR`; startup blocked, exit 1 as expected |
| Runtime DB integrity | SHA-256 of `packages/backend/prisma/dev.db` after all QA/smoke work | `36216E4786EF437833D2BFBF398BFD1F53B4BB4A0F49EF5155DF8286A30736E9`, unchanged |

The first in-sandbox `npm test` attempt stopped before tests because Windows denied
spawning the Prisma schema engine (`spawn EPERM`) and left a zero-byte isolated
test DB. The exact command was re-run with permission to execute the local Prisma
engine; it passed all suites, and the zero-byte artifact was removed. This was an
environmental execution failure, not a failing test.

### Independent isolated Browser QA

- Used the in-app Browser against a production Next server on `3001` and an
  isolated backend on `3002`, with a copied temporary test DB, temporary session
  directory, synthetic admin credentials, `ZALO_DRY_RUN=true`, and
  `ZALO_AUTO_REPLY_ENABLED=false`.
- A fresh tab showed only the login gate. Wrong credentials rendered the explicit
  rejected-login message; valid credentials opened the authenticated dashboard.
- Fresh authenticated checks covered `/`, `/messages`, `/retrieval-test`,
  `/safety-mode`, `/zalo-ops`, `/production-readiness`, `/thread-settings`,
  `/system-health`, `/errors`, and `/media-send`.
- `/errors` exposed only logout/refresh controls and no Test Alert. `/system-health`
  rendered real sectioned evidence. Safety, Zalo Ops, Readiness, and Thread
  Settings remained status/read-only. `/media-send` had no file input, form,
  upload, object URL, or send control.
- A repeated hard-navigation loop eventually received the expected admin rate
  limit on its last routes; `/errors` and `/media-send` were then verified in
  separate fresh isolated runs after restarting only the QA backend. The recorded
  route verdicts do not rely on the rate-limited responses.
- After stopping the backend while authenticated, client-side refresh made
  `/errors` render `ERROR SUMMARY UNKNOWN` and `/system-health` render unknown
  state for health, detail, config, and heartbeat sections. No green/zero fallback
  remained.
- A temporary malformed-response backend returned incomplete `{data:{}}` payloads.
  Both Batch 4 pages rendered explicit `Invalid response ...`/unknown states.
- Backend request logs during authenticated route QA contained only `GET` methods;
  no POST/PATCH/DELETE or other mutation request was emitted. No Zalo action or
  live send occurred.
- The Browser DOM snapshot helper failed in the plugin, so the documented visible
  DOM API plus scoped `<main>` text/locator checks were used. No external browser
  or CDP substitute was used.

### Full isolated backend startup smoke

- Ran the actual built entrypoint `node packages/backend/dist/index.js` with the
  temporary DB/session and the same fail-safe environment.
- Startup DB guard passed. Strict config reported PASS=8/WARN=1/ERROR=0. Runtime
  config stayed `dryRun=true`; auto-reply was disabled; the process lock was
  acquired and released normally; the disconnected watchdog started without a
  Zalo restore/send path.
- Eight read-only endpoints returned HTTP 200 with valid JSON:
  `/api/health`, `/api/admin/session`, `/api/system/health/detail`,
  `/api/system/config-check`, `/api/system/heartbeats`,
  `/api/system/errors/summary?hours=24`, `/api/zalo/ops/status`, and
  `/api/system/live-test/status`.
- After shutdown, ports `3001`/`3002` were closed and the backend lock file was
  absent.

### Cleanup and preserved quarantine

- Removed only artifacts created by this verification: temporary Browser QA DBs,
  temporary session directories, the failed zero-byte test DB, and the empty
  `.qa` directory.
- Preserved generated build outputs until handoff; they remain ignored.
- Preserved `.claude/worktrees/` and the pre-existing nested
  `packages/backend/packages/backend/{zalo-session,backups,prisma}` tree. These
  contain uncommitted or runtime-sensitive material and must not be staged or
  deleted without a separate explicit decision.
- No commit, push, deploy, live toggle, Prisma schema/migration edit, runtime DB
  edit, real session edit, backup edit, or secret edit was performed.

---

## 9. Batch 4.5 and Batch 5 completion checkpoint — 2026-07-20 20:05 UTC+7

This section supersedes Section 8 for the current working tree. The exact
review/rollback inventory is recorded in
`docs/batch5-checkpoint-manifest-2026-07-20.md`.

### Implementation and architecture

- Batch 4.5 review found no remaining local/isolated blocker after the full
  diff, CodeGraph call-path, secret, schema and regression audits.
- Batch 5 now provides a provider-neutral `AgentBridge` with strict response
  parsing, an exact Bridge-owned read grant, a bounded fail-closed tool loop,
  redacted/persisted tool evidence, internal inbound/task linkage and a real
  structured Hermes HTTP adapter.
- `HERMES_AGENT_BRIDGE_ENABLED` remains default OFF. OFF preserves the existing
  text-only path. ON never falls back to text after a structured failure.
- The enabled Batch 5 path grants only `memory.getRecentMessages`, executes it
  through `ToolGateway`, performs the second adapter round, and sends the final
  answer only through `OutboundDispatcher.sendOutbound()` with
  `deliveryPolicy: "dry_run_only"`.
- No adapter or agent tool can call `zca-js` directly. The structured dry-run
  branch returns before `ZaloMessageSender` construction even when a live-test
  override exists.

### Fresh gates

| Gate | Result |
|---|---|
| Focused implementation review | 4 files / 172 tests passed, exit 0; spec and standards reviews approved |
| Focused structured E2E | 1 file / 1 test passed, exit 0 |
| Root test suite | backend 84 files / 1336 tests, shared 6, frontend 106; exit 0 |
| Typecheck | shared/backend/frontend exit 0 |
| Build | shared/backend/frontend exit 0; Next 24/24 pages |
| Strict config positive | `CONFIG_WARN`, PASS=8/WARN=1/ERROR=0, exit 0 |
| Strict config negative | `CONFIG_ERROR`, PASS=5/WARN=1/ERROR=3, exit 1 as expected |
| DB guard | 688 KB runtime DB, health PASS |
| Schema/migration guard | no diff |
| Secret audit | 573 files scanned, 0 findings; 110 pre-existing quarantined runtime-path warnings |
| Whitespace | `git diff --check` exit 0; line-ending warnings only |

The 20:05 final gate refresh first reproduced the Windows sandbox limitation:
`npm test` was blocked before Vitest by Prisma `spawn EPERM`, and the sandbox
left one zero-byte isolated test DB. The exact test command then passed outside
the sandbox and the zero-byte artifact was removed. An in-sandbox `npm run
build` also stalled inside Next after the shared/backend builds; its
goal-created Next process was stopped, and the exact command completed outside
the sandbox with exit 0 and 24/24 pages. No goal-created build/test process or
temporary test DB remained. These were execution-environment limits, not source
test or build failures.

### Isolated runtime and Browser QA

- The actual built backend started against a pre-created, clean temporary SQLite
  DB and an empty temporary session directory with strict config, dry-run ON,
  auto-reply OFF and structured mode OFF. Eight semantic read-only endpoint
  checks returned HTTP 200 JSON. Zalo was disconnected, the listener was
  inactive and live-test was inactive. The corrected one-shot port-3402 smoke
  completed with exit 0 after all eight checks and performed its own cleanup;
  its temporary root and backend lock were absent and port 3402 was closed
  afterward. The earlier wrapper-only exit 1 is superseded and is not gate
  evidence.
- The structured dry-run E2E passed through synthetic persisted inbound ->
  `AgentBridge` -> `ToolGateway` -> `memory.getRecentMessages` -> second agent
  round -> `OutboundDispatcher`, with one successful read evidence row, linked
  internal IDs, dry-run outbound, replay suppression and zero provider send.
- Fresh in-app Browser QA covered `/`, `/zalo-ops`, `/production-readiness`,
  `/thread-settings`, `/system-health`, `/errors` and `/media-send`. Wrong
  synthetic credentials were rejected; valid synthetic credentials opened the
  dashboard.
- Status-only surfaces exposed only refresh/logout or read-only query controls.
  Media Send had no file input/form/send control; Errors had no Test Alert;
  Zalo Ops had no QR/reconnect/disconnect/test-DM action; Readiness had no live
  control; Thread Settings remained read-only.
- With the backend down, `/errors` and `/system-health` rendered explicit
  `UNKNOWN`/`Internal Server Error` states. With incomplete `{data:{}}` responses,
  both rendered explicit invalid-response/unknown states. No green/zero fallback
  was used.
- The actual backend request log contained 24 GET requests and zero mutations;
  the malformed server log contained 14 GET requests and zero mutations. No
  POST/PUT/PATCH/DELETE request was emitted.
- The Browser evaluation sandbox did not expose local/session storage objects;
  memory-only credential behavior is additionally covered by the passing
  frontend auth/session tests.

### Cleanup, inventory and safety state

- Runtime `dev.db` SHA-256 remained unchanged at
  `36216E4786EF437833D2BFBF398BFD1F53B4BB4A0F49EF5155DF8286A30736E9`.
- All goal-created QA/test DBs, session directories, `.qa`, stale goal lock and
  orphaned QA processes were removed. Ports 3001/3002/3402 are closed.
- Final inventory: 83 tracked modified files, 0 staged files, 38 untracked input
  files outside quarantine and 10 top-level `.claude/worktrees/**` quarantine
  entries (48 logical untracked entries under the manifest convention). The
  quarantine entries are excluded from checkpoint groups and were not recursed.
- Generated `dist/`, `.next/` and frontend `tsconfig.tsbuildinfo` outputs remain
  ignored. They are not checkpoint inputs.
- No commit, push, merge, deploy, global live, real Zalo send, QR/login,
  reconnect/disconnect, Prisma schema/migration, runtime DB/session/backup or
  secret mutation occurred.
- No blocker remains inside the local/isolated goal. A production/live pilot is
  deliberately excluded and still requires separate explicit approval.

### Pre-publish refresh — 2026-07-20 21:40 UTC+7

- Git credential access was verified with `git push --dry-run origin master`;
  the dry-run reported that `6399e6d..ec7ebe2` can be pushed and did not update
  the remote.
- Fresh `npm test` exited 0: backend 84 files / 1336 tests, shared 6 tests and
  frontend 106 tests. Fresh `npm run typecheck` and `npm run build` both exited
  0; Next generated 24/24 pages.
- Fresh isolated built-backend smoke used only a temporary DB/session/backup
  root under `C:\tmp`, strict synthetic credentials, auto-reply OFF, dry-run
  ON and structured mode OFF. Eight read-only GET endpoints returned HTTP 200
  JSON; Zalo remained disconnected and the listener remained inactive. The
  process, port 3402, lock and smoke root were cleaned up.
- Secret audit and DB guard exited 0; `git diff --check` exited 0 with only the
  existing Windows line-ending warnings; no schema/migration diff exists.
- Runtime `dev.db` SHA-256 is still
  `36216E4786EF437833D2BFBF398BFD1F53B4BB4A0F49EF5155DF8286A30736E9` and no
  `test-*.db` remains.
- The actual host `.env` still lacks `CHIASEGPU_API_KEY`, so an unmodified
  strict config check returns `CONFIG_ERROR`/exit 1. This was not bypassed or
  repaired with a fabricated secret. A strict VPS deployment must provide that
  operator credential; isolated verification used a synthetic value only.
- External QA artifacts are inventoried separately in
  `docs/batch5-checkpoint-manifest-2026-07-20.md`. They remain outside Git,
  including sensitive session backup copies under
  `C:\tmp\bridgezalo-manual-qa-20260720-201326\`.
