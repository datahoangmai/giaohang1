# Hachihi Delivery

PWA điều phối & giao hàng: lấy phiếu giao (`shipping.order`) từ Odoo 14, gợi ý tuyến cho điều phối, theo dõi tuyến/GPS, phân quyền 4 vai trò.

Kiến trúc: **React/Vite (client)** → **Cloudflare Worker (`worker-api/`)** → **Supabase (Auth + Postgres + RLS)** và **Odoo JSON-RPC**.
Khóa Odoo / service_role / geocode chỉ nằm trong Worker, client không bao giờ giữ.

## Vai trò

| Vai trò | Quyền |
|---|---|
| `admin` | Toàn quyền + tạo/khóa tài khoản, reset mật khẩu |
| `dispatcher` (điều phối) | Xem, xác nhận, đổi tuyến/thông tin, chạy gợi ý tuyến |
| `driver` (giao nhận) | Chỉ xem tuyến của mình, xác nhận đến/giao/thất bại, gửi GPS |
| `sale` | Chỉ xem đơn của mình (liên kết qua `profiles.odoo_employee_id`) |

## Triển khai

### 1. Supabase
1. Tạo project. **Authentication → tắt Sign-ups.**
2. SQL Editor: chạy `supabase/migrations/20261106_01_roles.sql` (riêng một lần), sau đó `20261106_02_phase1_rls_and_columns.sql`.
3. Tạo admin đầu tiên: Authentication → Add user (email + mật khẩu), rồi chạy SQL:
   `update public.profiles set role='admin', is_active=true where id='<uuid user>';`
   (nếu chưa có dòng profiles thì insert với cùng id).

### 2. Worker
```bash
cd worker-api
# sửa [vars] trong wrangler.toml (ODOO_URL, ODOO_DB, SUPABASE_URL, ALLOWED_ORIGINS...)
npx wrangler secret put ODOO_UID
npx wrangler secret put ODOO_API_KEY
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put GEOCODE_API_KEY     # Goong hoặc Google
npx wrangler deploy
```
Cron `*/5 * * * *` tự đồng bộ Odoo, ghi ngược, geocode, tính cảnh báo.

### 3. App
```bash
cp .env.example .env   # điền VITE_WORKER_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm install            # (repo không kèm bun.lock; nếu dùng bun: bun install rồi commit bun.lock mới)
bun run dev            # build: bun run build
```
Không còn chế độ demo/dữ liệu giả: app chỉ chạy với máy chủ thật. Thiếu 3 biến `VITE_*` thì màn đăng nhập báo chưa cấu hình.

### 4. Kiểm tra kết nối Odoo thật
Đăng nhập admin/điều phối → **Nạp Đơn Odoo** → tab **Kiểm Tra Kết Nối Odoo** → bấm kiểm tra. Worker gọi Odoo thật và báo từng bước: máy chủ, xác thực UID+API key, model `shipping.order` và các trường cần dùng, đọc dữ liệu. Lỗi nào báo đúng lỗi đó (không có "thành công giả"). Cũng có thể gọi `GET /api/odoo/test` với token đăng nhập.

## Ghi chú / giới hạn đã biết
- Ảnh POD chưa upload lên Supabase Storage (chế độ live bỏ `photoUrl`).
- "Realtime" hiện là polling REST (tuyến 10s, vị trí 5s), chưa dùng websocket.
- Giới hạn đăng nhập sai chỉ theo từng isolate của Worker.
- COD: `cod_amount = total_amount`; đơn có từ khóa đã thanh toán trong ghi chú bị gắn `cod_needs_review`.
- Cần kiểm tra trên DB thật: nhãn enum `transaction_type='collection'`, tên FK cho embed PostgREST (drivers→profiles, vehicles).
- Chưa chạy end-to-end với Odoo/Supabase thật.

Tài liệu schema gốc: `docs/aistudio/`. Spec cho dev: `hachihi-dev-spec.md`.
