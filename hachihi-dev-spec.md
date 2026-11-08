# Hachihi Delivery — Đặc tả cải tiến cho đội Dev

Phiên bản: 1.0 · Ngày: 06/11/2026
Phạm vi: nâng cấp bản prototype hiện tại (React + Vite PWA, Leaflet, Cloudflare Worker, Supabase, Odoo 14) lên bản vận hành thật.

---

## 0. Tóm tắt

Bản hiện tại có giao diện và luồng nghiệp vụ khá đủ, nhưng phần lõi là demo:

- Tài khoản, mật khẩu, phiên đăng nhập, đơn hàng đều lưu trong `localStorage`.
- Phân quyền chỉ ẩn/hiện nút trên giao diện, server không kiểm tra.
- Tọa độ khách hàng bị gán giả khi địa chỉ không nằm trong từ điển 8 địa chỉ mẫu.
- Vị trí tài xế chỉ nằm trong bộ nhớ trình duyệt, điều phối không xem được trực tiếp.
- Khóa Odoo nằm trong mã client.

Mục tiêu bản mới:

1. Đăng nhập và phân quyền thật, kiểm tra ở server (Supabase Auth + RLS).
2. Đồng bộ phiếu giao hàng từ Odoo (`shipping.order`) vào DB, có tọa độ thật.
3. Gợi ý và sắp xếp tuyến cho điều phối, điều phối xác nhận mới giao việc.
4. Theo dõi tuyến và vị trí tài xế theo thời gian thực.
5. 4 nhóm quyền: Admin, Điều phối, Giao nhận, Sale.

---

## 1. Hiện trạng và lỗi cần xử lý

| # | Vị trí trong mã | Vấn đề | Mức |
|---|---|---|---|
| 1 | `src/services/auth/AuthService.ts` | Mật khẩu lưu dạng text trong `localStorage`; có sẵn `admin/admin123`; người dùng tự sửa `role` trong DevTools là thành admin | Nghiêm trọng |
| 2 | `src/App.tsx`, `DeliveryOrderListPanel.tsx`, `OdooIntegrationModal.tsx` | Phân quyền chỉ ở UI (`currentUser.role === ...`) | Nghiêm trọng |
| 3 | `worker-api/src/index.ts` | Không xác thực người gọi; CORS `*`; `uid` Odoo gán cứng `2`; có endpoint PATCH ghi Odoo công khai | Nghiêm trọng |
| 4 | `OdooShippingService.ts` (`DEFAULT_ODOO_CONFIG`) | `apiKey` mặc định nằm trong bundle; client gọi thẳng `/web/session/authenticate` của Odoo | Nghiêm trọng |
| 5 | `OdooShippingService.ts` (~dòng 498–520) | Địa chỉ ngoài từ điển → tọa độ ngẫu nhiên quanh kho | Cao |
| 6 | `DriverTrackingService.ts` | Vị trí không gửi lên server; khi GPS lỗi tự chuyển sang giả lập mà không báo | Cao |
| 7 | `worker-api` | Lấy tối đa 50 phiếu, không phân trang, không đồng bộ gia tăng; ghi đè `internal_note` Odoo | Trung bình |
| 8 | `types/auth.ts` vs `types/delivery.ts` vs schema DB | 3 bộ tên vai trò khác nhau (`admin/dispatcher/staff` — `super_admin/manager/dispatcher/driver/accountant` — enum `app_role`); chưa có `sale` | Trung bình |
| 9 | `RouteOptimizer.ts` | Haversine × 1,35 + 2-opt; không xét khung giờ, tải trọng, loại xe, nhiều xe | Trung bình |
| 10 | COD suy ra từ chữ trong ghi chú ("đã thanh toán", "vnpay") | Dễ sai tiền | Trung bình |
| 11 | Repo | 3 file worker (`worker.js`, `public/worker.js`, `worker-api/`), `express` và `@google/genai` không dùng, README là mẫu AI Studio, `public/assets/aistudio/*` là tài liệu thô | Thấp |

---

## 2. Kiến trúc mục tiêu

```
Odoo 14 (shipping.order, sale.order)
        ▲ ▼  JSON-RPC (khóa chỉ ở Worker)
Cloudflare Worker  — xác thực JWT, kiểm tra quyền, đồng bộ Odoo, geocode, tối ưu tuyến
        ▲ ▼
Supabase — Auth, Postgres + RLS, Realtime, Storage (ảnh POD)
        ▲ ▼
 ┌──────────────┬───────────────────┬───────────────┐
 │ PWA Tài xế   │ Web Điều phối     │ Web Sale/Admin│
 └──────────────┴───────────────────┴───────────────┘
```

Nguyên tắc:

- Client chỉ giữ `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `WORKER_URL`. Không có khóa Odoo hay `service_role` ở client.
- Quyền được chốt ở RLS (đọc/ghi dữ liệu) và Worker (gọi Odoo, thao tác nhạy cảm). Giao diện chỉ ẩn/hiện cho gọn.
- Mọi thao tác ghi quan trọng có `idempotency_key` và ghi `system_audit_logs`.

Schema Supabase đã có sẵn trong `public/assets/aistudio/deliver_tables_341ba9e8.txt`: `profiles`, `drivers`, `vehicles`, `branches`, `orders`, `order_items`, `delivery_routes`, `route_stops`, `driver_locations`, `delivery_events`, `delivery_photos`, `cod_transactions`, `cod_reconciliations`, `odoo_sync_jobs`, `system_audit_logs`. Dùng lại và bổ sung theo mục 4, không tạo lại từ đầu.

---

## 3. Phân quyền

### 3.1 Vai trò (thống nhất một bộ duy nhất)

Enum `app_role`: `admin`, `dispatcher`, `driver`, `sale`. Xóa các giá trị cũ (`super_admin`, `manager`, `accountant`, `staff`) khỏi mã client; nếu DB đã có thì ánh xạ lại (`super_admin→admin`, `manager→dispatcher`, `staff→driver`).

### 3.2 Ma trận quyền

| Chức năng | admin | dispatcher | driver | sale |
|---|:-:|:-:|:-:|:-:|
| Xem danh sách đơn | tất cả | tất cả | đơn thuộc tuyến của mình | đơn do mình bán (`x_nvkdso` khớp) |
| Xem bản đồ, vị trí tài xế | ✅ | ✅ | chỉ tuyến mình | ✅ chỉ xem, chỉ đơn của mình |
| Xem tiến độ tuyến | ✅ | ✅ | tuyến mình | ✅ chỉ xem |
| Xác nhận đến điểm, giao thành công/thất bại, chụp ảnh, ký nhận, thu COD | ✅ | ✅ | ✅ điểm dừng của mình | ❌ |
| Tạo tuyến, gán tài xế/xe, đổi thứ tự điểm dừng, chuyển đơn sang tuyến khác | ✅ | ✅ | ❌ | ❌ |
| Sửa thông tin đơn (địa chỉ, tọa độ, ghi chú, giờ hẹn) | ✅ | ✅ | ❌ | ❌ |
| Xác nhận gợi ý tuyến | ✅ | ✅ | ❌ | ❌ |
| Đồng bộ Odoo ngay | ✅ | ✅ | ❌ | ❌ |
| Cấu hình kết nối Odoo | ✅ | ❌ | ❌ | ❌ |
| Tạo/khóa/đổi vai trò tài khoản, đặt lại mật khẩu | ✅ | ❌ | ❌ | ❌ |
| Xem nhật ký thao tác (`system_audit_logs`) | ✅ | ✅ | ❌ | ❌ |
| Đối soát COD | ✅ | ✅ | xem phần của mình | ❌ |

Ghi chú: Admin không được tự hạ quyền hoặc khóa chính mình nếu đó là admin cuối cùng.

### 3.3 Triển khai

- Đăng nhập bằng Supabase Auth (email hoặc số điện thoại + mật khẩu). Giữ nhập bằng mã nhân viên bằng cách tra `profiles` ra email nội bộ (ví dụ `hch-tx01@hachihi.local`) trong Worker.
- `profiles.role` là nguồn sự thật. Đưa `role` vào JWT claim (`app_metadata.role`) bằng Auth Hook hoặc trigger để RLS đọc nhanh.
- Tạo tài khoản chỉ qua endpoint Worker `POST /api/admin/users` (dùng `service_role`, kiểm tra caller là admin). Không cho client tự đăng ký (tắt Sign-ups trong Supabase).
- Hàm hỗ trợ RLS:

```sql
create or replace function public.current_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and is_active
$$;
```

### 3.4 RLS mẫu (cần viết đủ cho từng bảng)

```sql
alter table orders enable row level security;

-- admin, dispatcher: xem tất cả
create policy orders_read_staff on orders for select
  using (current_role() in ('admin','dispatcher'));

-- driver: chỉ đơn nằm trong tuyến của mình
create policy orders_read_driver on orders for select
  using (current_role() = 'driver' and exists (
    select 1 from route_stops rs
    join delivery_routes r on r.id = rs.route_id
    join drivers d on d.id = r.driver_id
    where rs.order_id = orders.id and d.profile_id = auth.uid()));

-- sale: chỉ đơn mình bán
create policy orders_read_sale on orders for select
  using (current_role() = 'sale' and sale_profile_id = auth.uid());

-- ghi: admin, dispatcher
create policy orders_write_staff on orders for update
  using (current_role() in ('admin','dispatcher'));
```

Yêu cầu tương tự cho `delivery_routes`, `route_stops` (driver chỉ `update` các cột trạng thái/ảnh/ký nhận của điểm dừng mình), `driver_locations` (driver `insert` vị trí của chính mình; admin/dispatcher đọc tất cả; sale đọc vị trí tài xế của tuyến chứa đơn mình), `delivery_events`, `delivery_photos`, `cod_*`, `system_audit_logs` (chỉ admin/dispatcher đọc, không ai sửa/xóa).

Kiểm thử bắt buộc: viết bộ test SQL/pgTAP hoặc script gọi API bằng JWT của từng vai trò, xác nhận mỗi ô ❌ trong ma trận trả về 403/rỗng.

---

## 4. Thay đổi cơ sở dữ liệu

1. `app_role` thêm `sale`.
2. `orders` thêm:
   - `odoo_shipping_order_id int` (unique với `source_system='odoo'`), `tracking_code text` (`x_mvd`), `carrier_service text` (`x_dvvt`), `has_installation bool` (`x_hotrolapdat`), `shipping_fee numeric`, `extra_amount numeric`, `total_shipping_cost numeric`, `scheduled_at timestamptz` (`scheduled_date`), `odoo_state text`, `odoo_write_date timestamptz`,
   - `sale_profile_id uuid` (liên kết người bán; ánh xạ từ `x_nvkdso`),
   - `geocode_status text` (`ok | low_confidence | failed | manual`), `geocode_provider text`, `geocode_raw jsonb`,
   - `weight_kg numeric`, `package_count int`, `service_minutes int` (thời gian dừng; mặc định 5, đơn lắp đặt 20).
3. `profiles` thêm `odoo_user_id int` (khớp `shipper_id`/`x_nvkdso`), `email`.
4. `delivery_routes` thêm `optimization_run_id uuid`, `confirmed_by`, `confirmed_at`, `route_geometry jsonb` (đường đi dự kiến).
5. `route_stops` thêm `eta_at`, `time_window_start`, `time_window_end`, `late_risk bool`.
6. Bảng mới `optimization_runs` (`id`, `planned_date`, `input_snapshot jsonb`, `result jsonb`, `status draft|confirmed|discarded`, `created_by`, `created_at`) để lưu gợi ý trước khi điều phối xác nhận.
7. Bảng mới `alerts` (`id`, `route_id`, `driver_id`, `type`, `message`, `severity`, `created_at`, `resolved_at`).
8. Chỉ mục: `driver_locations(driver_id, recorded_at desc)`, `route_stops(route_id, sequence_no)`, `orders(status, requested_delivery_date)`, `orders(odoo_shipping_order_id)`.
9. `driver_locations`: partition theo tháng hoặc job xóa dữ liệu quá 90 ngày, giữ bản rút gọn cho tuyến đã xong.

---

## 5. Đồng bộ Odoo

### 5.1 Lấy phiếu về (Odoo → DB)

- Model: `shipping.order`. Trường cần đọc (khớp file `shipping.order_ir.model.fields_*.csv`): `name, sale_id, partner_shipping_id, phone, from_address, to_address, state, distance, scheduled_date, done_date, total_amount, amount_fee, extra_amount, shipper_id, x_shipper, x_mvd, x_dvvt, x_hotrolapdat, x_cpvc, x_tongchiphi, x_nvkdso, note, internal_note, write_date`.
- Chạy theo cron Worker mỗi 5–10 phút và nút "Đồng bộ ngay" (admin, dispatcher).
- **Đồng bộ gia tăng:** lưu `last_sync_write_date`; domain `[('write_date','>', last_sync)]`; phân trang `limit=200, offset`. Không giới hạn cứng 50 phiếu.
- Upsert theo `(source_system='odoo', source_model='shipping.order', source_record_id)`.
- Phiếu bị hủy hoặc đã done trong Odoo → cập nhật trạng thái; nếu phiếu đang nằm trong tuyến đang chạy thì tạo `alerts` cho điều phối, không tự xóa khỏi tuyến.
- Mỗi lần chạy ghi một dòng vào `odoo_sync_jobs` (số phiếu mới/sửa/lỗi, thời gian, lỗi cuối).
- Bảng ánh xạ người: `x_nvkdso` → `profiles.odoo_user_id` (sale), `shipper_id`/`x_shipper` → `drivers`. Nếu không khớp, để trống và đánh dấu để admin ánh xạ thủ công.
- Giá trị `x_dvvt`: `noi_bo` là giao nội bộ (vào hệ thống điều phối); `ahamove`, `grab`… là bên ngoài (hiển thị, không xếp tuyến).

### 5.2 COD

- Không suy ra COD từ ghi chú. Xác định theo thứ tự: trường tiền phải thu trên `shipping.order` (`total_amount`) → trạng thái thanh toán của `sale.order` liên kết (`sale_id`). Nếu không xác định được, đánh dấu `cod_status='needs_review'` để điều phối xác nhận.
- Bổ sung đọc `sale.order` (`amount_total`, trạng thái hóa đơn/thanh toán) nếu `shipping.order` không đủ.

### 5.3 Ghi ngược (DB → Odoo)

- Chỉ Worker được ghi Odoo, qua hàng đợi `odoo_sync_jobs` (`operation`, `payload`, `attempts`, `next_retry_at`, backoff tăng dần, tối đa `max_attempts`).
- Sự kiện cần ghi ngược: đang giao (`in_delivery`), giao xong (`done` + `done_date`), thất bại. Ghi chú giao hàng đưa vào chatter (`message_post`), **không ghi đè `internal_note`**.
- Mỗi job có `idempotency_key` = `odoo:{order_id}:{event_type}:{event_id}`.
- Trước khi ghi, đọc `write_date` hiện tại; nếu Odoo đã đổi sau lần đồng bộ cuối và trạng thái xung đột → đặt `status='CONFLICT'`, báo điều phối xử lý, không ghi đè.
- Dùng một tài khoản Odoo riêng cho tích hợp (không phải admin), quyền tối thiểu trên `shipping.order`. `ODOO_UID` và `ODOO_API_KEY` chỉ ở Worker secrets.

### 5.4 Geocode địa chỉ

- Provider: Goong hoặc Google Geocoding (chọn một, có cache).
- Khi nhận phiếu: chuẩn hóa địa chỉ (`to_address`) → geocode → lưu `latitude, longitude, geocode_status`.
- Độ tin cậy thấp hoặc lỗi → `geocode_status='low_confidence'|'failed'`, hiển thị cờ trên danh sách; điều phối kéo ghim trên bản đồ để sửa (`manual`). Đơn chưa có tọa độ hợp lệ **không** được đưa vào gợi ý tuyến.
- Xóa hoàn toàn đoạn sinh tọa độ giả và `KNOWN_GEO_COORDS` khỏi code production (giữ trong `mockDeliveryData` cho chế độ demo).

---

## 6. Sắp xếp và gợi ý tuyến cho điều phối

### 6.1 Luồng

1. Điều phối chọn ngày giao và nhóm đơn cần xếp (mặc định: đơn nội bộ, chưa gán, trạng thái sẵn sàng).
2. Hệ thống chọn tài xế/xe khả dụng (trạng thái `idle`, xe `active`, có tải trọng).
3. Worker gọi bộ giải tuyến → tạo bản ghi `optimization_runs` trạng thái `draft` kèm các tuyến đề xuất.
4. Điều phối xem trên bản đồ: tổng km, thời gian, COD, tải trọng, cảnh báo trễ giờ. Có thể kéo thả đổi thứ tự, chuyển đơn giữa tuyến, đổi tài xế, loại đơn ra.
5. Bấm **Xác nhận** → tạo/cập nhật `delivery_routes` + `route_stops`, đổi đơn sang `assigned`, gửi thông báo cho tài xế. Bấm **Hủy** → `discarded`. Hệ thống không tự giao việc.

### 6.2 Bộ giải

- Khoảng cách/thời gian: OSRM (tự host hoặc dịch vụ) hoặc Google Distance Matrix; dùng ma trận thời gian đường thật, không dùng Haversine × 1,35 (giữ làm phương án dự phòng khi dịch vụ lỗi, có gắn nhãn "ước tính").
- Giải tuyến: VROOM hoặc OR-Tools (chạy ngoài Worker vì giới hạn CPU, ví dụ một service nhỏ trên VPS/Cloud Run, Worker gọi qua HTTPS). Với ≤ 15 điểm/xe có thể giữ 2-opt phía Worker làm dự phòng.
- Ràng buộc:
  - Tải trọng và thể tích theo `vehicles.max_weight_kg`, `max_volume_m3`.
  - Khung giờ (`time_window_*`, từ `scheduled_at`): vi phạm → `late_risk=true` và hiển thị cảnh báo.
  - Thời gian dừng theo `service_minutes` (đơn lắp đặt dài hơn).
  - Điểm xuất phát/kết thúc: kho (`branches.latitude/longitude`).
  - Giới hạn số điểm/xe và giờ làm tối đa (cấu hình).
  - Ưu tiên: đơn có COD lớn hoặc giờ hẹn sớm.
- Kết quả mỗi tuyến: thứ tự điểm, ETA từng điểm, quãng đường, thời gian, hình học đường đi (polyline), điểm cảnh báo.
- Đơn phát sinh giữa ngày: gợi ý tài xế phù hợp nhất (gần điểm kế tiếp, còn tải, ít làm trễ các điểm còn lại) và vị trí chèn tốt nhất; điều phối xác nhận.

### 6.3 Giao diện điều phối

- Danh sách đơn chờ: lọc theo quận, khung giờ, loại giao, trạng thái geocode.
- Cột tuyến: thẻ mỗi tuyến (tài xế, xe, số điểm, km, giờ, COD, % tải).
- Bản đồ tuyến: màu theo tuyến, số thứ tự điểm, kéo thả.
- Hiển thị so sánh "phương án hiện tại" và "phương án gợi ý" (km, thời gian tiết kiệm).

---

## 7. Theo dõi tuyến và tài xế thời gian thực

### 7.1 Phía tài xế (PWA)

- Chỉ gửi vị trí khi tuyến ở trạng thái `in_progress`. Chu kỳ 10–15 giây khi di chuyển, thưa hơn khi đứng yên.
- Gửi `insert` vào `driver_locations` (`driver_id`, `route_id`, lat/lng, `accuracy_m`, `speed_kmh`, `heading`, `recorded_at`, `source='gps'`).
- Mất mạng: lưu hàng đợi IndexedDB, gửi lại theo thứ tự khi có mạng (đã có `OfflineActionQueueItem`, chuyển từ `localStorage` sang IndexedDB).
- Bỏ chế độ giả lập khỏi production. Nếu GPS bị từ chối hoặc lỗi, hiện cảnh báo đỏ rõ ràng cho tài xế và gửi `alert` mất GPS cho điều phối. Giữ giả lập chỉ khi bật cờ `?demo=1` hoặc môi trường dev.
- Giữ màn hình sáng (Wake Lock, đã có). Ghi rõ giới hạn: PWA không chạy GPS ổn định khi tắt màn hình; hướng dẫn tài xế để app mở, sạc xe. Nếu cần ổn định hơn, đánh giá app gốc ở giai đoạn sau.

### 7.2 Phía điều phối, sale

- Subscribe Supabase Realtime vào `driver_locations` (lọc theo `route_id`) và `route_stops`, `delivery_events`.
- Bản đồ: marker tài xế (xoay theo `heading`), màu theo trạng thái: `idle` xám, `delivering` xanh, `late` cam, `no_signal` đỏ (không có vị trí > 2 phút).
- Panel tuyến: x/y điểm đã giao, ETA từng điểm, chênh lệch ETA với kế hoạch, COD đã thu/dự kiến.
- Xem lại hành trình: vẽ polyline từ `driver_locations` theo tuyến và ngày.
- Sale: chỉ thấy đơn của mình và vị trí/tiến độ của tuyến chứa đơn đó, không thấy tuyến khác.

### 7.3 Cảnh báo (bảng `alerts`)

| Loại | Điều kiện |
|---|---|
| `no_signal` | không có vị trí mới > 2 phút khi tuyến đang chạy |
| `idle_too_long` | đứng yên > 15 phút ngoài khoảng cách 100 m quanh điểm dừng |
| `off_route` | cách polyline kế hoạch > 500 m trong > 2 phút |
| `late_risk` | ETA vượt `time_window_end` |
| `odoo_conflict` | phiếu Odoo đổi/hủy khi đang giao |
| `failed_delivery` | điểm dừng đánh dấu thất bại |

Tính cảnh báo bằng cron Worker mỗi phút hoặc Postgres function/pg_cron. Hiển thị trong `NotificationDrawer` (đã có UI) và đẩy Web Push cho điều phối.

---

## 8. Quản lý tài khoản (Admin)

- Màn hình `AccountManagementModal` hiện có: giữ UI, đổi nguồn dữ liệu sang `profiles` + Worker `/api/admin/users`.
- Chức năng: tạo tài khoản (họ tên, SĐT, email, vai trò, mã nhân viên tự sinh theo vai trò `HCH-ADM/DP/TX/SL`, xe mặc định cho tài xế, liên kết `odoo_user_id`), sửa, khóa/mở khóa (`is_active`), đổi vai trò, đặt lại mật khẩu (gửi link hoặc mật khẩu tạm buộc đổi lần đầu).
- Bắt buộc đổi mật khẩu tạm ở lần đăng nhập đầu; chính sách mật khẩu tối thiểu 8 ký tự.
- Mọi thay đổi ghi `system_audit_logs` (ai, lúc nào, giá trị cũ/mới, không ghi mật khẩu).
- Xóa `INITIAL_USERS`, mọi mật khẩu mặc định và `STORAGE_KEY_USERS/SESSION` khỏi code.

---

## 9. API Worker (tham chiếu)

Tất cả yêu cầu header `Authorization: Bearer <Supabase JWT>`; Worker xác minh chữ ký, đọc `role`, từ chối khi sai quyền. CORS chỉ cho phép domain app.

| Method & path | Quyền | Mô tả |
|---|---|---|
| `POST /api/odoo/sync` | admin, dispatcher | đồng bộ gia tăng ngay |
| `GET /api/odoo/sync-status` | admin, dispatcher | trạng thái lần chạy gần nhất, số lỗi |
| `POST /api/orders/:id/geocode` | admin, dispatcher | geocode lại hoặc đặt tọa độ thủ công |
| `POST /api/optimization/run` | admin, dispatcher | tạo gợi ý tuyến (`planned_date`, `order_ids`, `vehicle_ids`) |
| `POST /api/optimization/:id/confirm` | admin, dispatcher | xác nhận → tạo tuyến, giao việc |
| `POST /api/optimization/:id/discard` | admin, dispatcher | hủy gợi ý |
| `PATCH /api/routes/:id` | admin, dispatcher | đổi tài xế, xe, thứ tự điểm dừng |
| `POST /api/stops/:id/events` | driver (điểm của mình), admin, dispatcher | đến nơi, giao xong, thất bại; có `client_event_id` idempotent |
| `POST /api/admin/users` | admin | tạo tài khoản |
| `PATCH /api/admin/users/:id` | admin | sửa, khóa, đổi vai trò |
| `POST /api/admin/users/:id/reset-password` | admin | đặt lại mật khẩu |
| `GET /api/health` | công khai | kiểm tra dịch vụ |

Ảnh POD tải lên Supabase Storage bucket riêng tư, đường dẫn `pod/{order_id}/{stop_id}/{uuid}.jpg`, policy theo vai trò như ma trận; nén ảnh phía client (≤ 300 KB).

Secrets (Worker): `ODOO_API_KEY`, `ODOO_UID`, `SUPABASE_SERVICE_ROLE_KEY`, `GEOCODE_API_KEY`, `ROUTING_API_KEY`/URL. Biến không bí mật (`ODOO_URL`, `ODOO_DB`) để trong `wrangler.toml`.

---

## 10. Dọn mã và chất lượng

- Giữ một Worker duy nhất ở `worker-api/`; xóa `worker.js`, `public/worker.js`. `public/sw.js` giữ cho PWA, kiểm tra lại chiến lược cache (không cache API có dữ liệu riêng tư).
- Gỡ `express`, `@google/genai`, `dotenv` nếu không dùng; cập nhật README (cách chạy, biến môi trường, triển khai).
- Chuyển `public/assets/aistudio/*` sang thư mục `docs/` (không phục vụ công khai).
- Tách `App.tsx` (951 dòng) và `LeafletMap.tsx` (1132 dòng), `OdooIntegrationModal.tsx` (1002 dòng) thành module nhỏ; thêm hook `useAuth`, `usePermission(permission)`, lớp `api/` gọi Supabase/Worker.
- Thay các service singleton dùng `localStorage` bằng truy vấn Supabase (dùng TanStack Query hoặc tương đương cho cache + Realtime).
- Bật `tsc --noEmit` và ESLint trong CI; thêm test cho mapper Odoo → `orders`, logic gợi ý tuyến, và bộ test RLS.
- Giữ `mockDeliveryData` làm chế độ demo (`?demo=1`), tách riêng khỏi đường chạy production.
- Giám sát: log lỗi Worker (Logpush hoặc Sentry), cảnh báo khi cron đồng bộ Odoo lỗi liên tiếp 3 lần.

---

## 11. Lộ trình và tiêu chí nghiệm thu

### Giai đoạn 1 — Bảo mật và nền tảng (ưu tiên cao nhất)

- Supabase Auth, bảng `profiles`, enum vai trò mới, RLS đầy đủ, tắt Sign-ups.
- Worker có xác thực JWT, ẩn khóa Odoo, CORS giới hạn; gỡ khóa mặc định khỏi client.
- Màn hình quản lý tài khoản dùng DB thật.
- Dọn repo (mục 10).

Nghiệm thu: không còn mật khẩu/khóa trong bundle (`grep` bundle sạch); mỗi ô ❌ trong ma trận quyền trả về 403 hoặc rỗng khi gọi API bằng JWT vai trò đó; sửa `localStorage` không nâng được quyền.

### Giai đoạn 2 — Dữ liệu thật từ Odoo

- Đồng bộ gia tăng, upsert vào `orders`, geocode thật, cờ `geocode_status`, sửa tọa độ thủ công.
- Hàng đợi ghi ngược Odoo (đang giao, giao xong, thất bại) có retry, idempotent, phát hiện xung đột.
- COD xác định theo dữ liệu Odoo, không theo ghi chú.

Nghiệm thu: đồng bộ 500 phiếu không bỏ sót (so khớp số lượng với Odoo); chạy lại không tạo trùng; giao xong một đơn thì Odoo đổi trạng thái đúng và `internal_note` không bị ghi đè; ngắt Odoo 10 phút rồi bật lại, hàng đợi tự gửi đủ.

### Giai đoạn 3 — Điều phối

- Bộ giải tuyến, `optimization_runs`, giao diện gợi ý, kéo thả, xác nhận → giao việc cho tài xế.

Nghiệm thu: với 30 đơn và 3 xe, có kết quả trong ≤ 30 giây; không tuyến nào vượt tải trọng; đơn vi phạm khung giờ có cờ cảnh báo; chỉ sau khi bấm xác nhận tài xế mới thấy tuyến.

### Giai đoạn 4 — Theo dõi realtime

- Gửi vị trí, hàng đợi offline, Realtime cho điều phối/sale, cảnh báo, xem lại hành trình.

Nghiệm thu: điều phối thấy vị trí tài xế trễ ≤ 15 giây; tài xế mất mạng 3 phút rồi có lại thì vị trí được bù đủ theo thứ tự; sale chỉ thấy tuyến chứa đơn của mình; cảnh báo `no_signal` xuất hiện trong 2–3 phút.

---

## 12. Câu hỏi cần chốt với khách hàng/PM trước khi làm

1. Chọn dịch vụ geocode (Goong hay Google) và dịch vụ bản đồ đường (OSRM tự host hay Google).
2. Số xe, số đơn mỗi ngày, số tài xế (để chọn giải pháp bộ giải và gói Supabase/Cloudflare).
3. Sale xem theo tiêu chí nào: đơn do mình bán (`x_nvkdso`) hay theo chi nhánh/nhóm?
4. Tài khoản Odoo dành cho tích hợp: ai cấp, quyền tối thiểu nào trên `shipping.order`, `sale.order`?
5. Quy tắc COD chính thức: trường nào của Odoo là số tiền phải thu?
6. Có cần Web Push/Zalo/SMS thông báo cho khách hàng không (ngoài phạm vi tài liệu này)?
7. Khung giờ hẹn khách hiện lưu ở đâu trong Odoo (chỉ có `scheduled_date` hay có khung từ–đến)?
