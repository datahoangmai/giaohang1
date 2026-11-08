-- ============================================================================
-- Hachihi Delivery — Migration 02: cột mới, bảng mới, hàm vai trò, RLS
-- Yêu cầu: đã chạy file 01. Chạy lại nhiều lần vẫn an toàn (idempotent).
-- Vai trò dùng trong app: admin | dispatcher | driver | sale
-- Trạng thái đơn hàng dùng enum delivery_order_status (xem file 01).
-- (super_admin -> admin, manager -> dispatcher; accountant giữ nguyên nhưng
--  không có quyền nào trong ma trận mới — gán lại vai trò nếu cần).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Chuyển vai trò cũ sang vai trò mới
-- ---------------------------------------------------------------------------
update public.profiles set role = 'admin'      where role::text = 'super_admin';
update public.profiles set role = 'dispatcher' where role::text = 'manager';

-- ---------------------------------------------------------------------------
-- 1. Cột mới cho bảng hiện có
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists email text,
  add column if not exists odoo_user_id int,
  add column if not exists odoo_employee_id int,
  add column if not exists username text,
  add column if not exists employee_code text,
  add column if not exists avatar_url text,
  add column if not exists must_change_password boolean not null default false;
create unique index if not exists profiles_username_uq on public.profiles (lower(username)) where username is not null;
create unique index if not exists profiles_code_uq on public.profiles (upper(employee_code)) where employee_code is not null;
create unique index if not exists profiles_email_uq on public.profiles (lower(email)) where email is not null;
create index if not exists profiles_employee_idx on public.profiles (odoo_employee_id);

alter table public.orders
  add column if not exists odoo_shipping_order_id int,
  add column if not exists tracking_code text,
  add column if not exists carrier_service text,
  add column if not exists has_installation boolean not null default false,
  add column if not exists extra_amount numeric not null default 0,
  add column if not exists total_shipping_cost numeric not null default 0,
  add column if not exists scheduled_at timestamptz,
  add column if not exists odoo_state text,
  add column if not exists odoo_write_date timestamptz,
  add column if not exists odoo_raw jsonb,
  add column if not exists sale_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists shipper_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists geocode_status text not null default 'pending'
      check (geocode_status in ('pending','ok','low_confidence','failed','manual')),
  add column if not exists geocode_provider text,
  add column if not exists weight_kg numeric not null default 2,
  add column if not exists package_count int not null default 1,
  add column if not exists service_minutes int not null default 5,
  add column if not exists cod_needs_review boolean not null default false;

create unique index if not exists orders_source_uq
  on public.orders (source_system, source_model, source_record_id);
create index if not exists orders_status_date_idx on public.orders (status, requested_delivery_date);
create index if not exists orders_odoo_id_idx on public.orders (odoo_shipping_order_id);
create index if not exists orders_sale_idx on public.orders (sale_profile_id);
create index if not exists orders_shipper_idx on public.orders (shipper_profile_id);

alter table public.drivers
  add column if not exists default_vehicle_id uuid references public.vehicles(id) on delete set null;

alter table public.delivery_routes
  add column if not exists optimization_run_id uuid,
  add column if not exists confirmed_by uuid references public.profiles(id),
  add column if not exists confirmed_at timestamptz,
  add column if not exists route_geometry jsonb;

alter table public.route_stops
  add column if not exists eta_at timestamptz,
  add column if not exists time_window_start timestamptz,
  add column if not exists time_window_end timestamptz,
  add column if not exists late_risk boolean not null default false;
create index if not exists route_stops_route_seq_idx on public.route_stops (route_id, sequence_no);

-- driver_locations: chống trùng khi tài xế gửi bù dữ liệu offline
create unique index if not exists driver_locations_dedupe_uq
  on public.driver_locations (driver_id, recorded_at);
create index if not exists driver_locations_driver_time_idx
  on public.driver_locations (driver_id, recorded_at desc);
create index if not exists driver_locations_route_time_idx
  on public.driver_locations (route_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- 2. Bảng mới
-- ---------------------------------------------------------------------------
create table if not exists public.optimization_runs (
  id uuid primary key default gen_random_uuid(),
  planned_date date not null,
  status text not null default 'draft' check (status in ('draft','confirmed','discarded')),
  input_snapshot jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  route_id uuid references public.delivery_routes(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  type text not null check (type in
    ('no_signal','idle_too_long','off_route','late_risk','odoo_conflict','failed_delivery','geocode_failed')),
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  message text not null,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists alerts_open_idx on public.alerts (created_at desc) where resolved_at is null;

-- Trạng thái đồng bộ Odoo (chỉ Worker dùng service_role)
create table if not exists public.sync_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Hàm vai trò (KHÔNG đặt tên current_role vì trùng từ khoá SQL)
-- ---------------------------------------------------------------------------
create or replace function public.app_current_role() returns text
language sql stable security definer set search_path = public as $$
  select role::text from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.app_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() in ('admin','dispatcher'), false)
$$;

create or replace function public.app_my_driver_id() returns uuid
language sql stable security definer set search_path = public as $$
  select d.id from public.drivers d where d.profile_id = auth.uid() limit 1
$$;

-- Các hàm dưới đây là SECURITY DEFINER (bỏ qua RLS bên trong) để tránh
-- "infinite recursion detected in policy" giữa orders <-> route_stops <-> delivery_routes.
create or replace function public.app_order_in_my_route(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.route_stops rs
    join public.delivery_routes r on r.id = rs.route_id
    where rs.order_id = p_order and r.driver_id = public.app_my_driver_id())
$$;

create or replace function public.app_order_is_my_sale(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o where o.id = p_order and o.sale_profile_id = auth.uid())
$$;

create or replace function public.app_route_has_my_sale_order(p_route uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.route_stops rs
    join public.orders o on o.id = rs.order_id
    where rs.route_id = p_route and o.sale_profile_id = auth.uid())
$$;

-- Người dùng hiện tại có được thấy tuyến này không (theo vai trò)
create or replace function public.app_can_see_route(p_route uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.app_current_role()
    when 'admin' then true
    when 'dispatcher' then true
    when 'driver' then exists (select 1 from public.delivery_routes r where r.id = p_route and r.driver_id = public.app_my_driver_id())
    when 'sale' then public.app_route_has_my_sale_order(p_route)
    else false end
$$;

create or replace function public.app_vehicle_visible(p_vehicle uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.delivery_routes r where r.vehicle_id = p_vehicle and public.app_can_see_route(r.id))
$$;

create or replace function public.app_driver_visible(p_driver uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.delivery_routes r where r.driver_id = p_driver and public.app_can_see_route(r.id))
$$;

create or replace function public.app_profile_visible(p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.drivers d where d.profile_id = p_profile and public.app_driver_visible(d.id))
$$;

revoke all on function public.app_order_in_my_route(uuid), public.app_order_is_my_sale(uuid),
  public.app_route_has_my_sale_order(uuid), public.app_can_see_route(uuid),
  public.app_vehicle_visible(uuid), public.app_driver_visible(uuid), public.app_profile_visible(uuid) from public;
grant execute on function public.app_order_in_my_route(uuid), public.app_order_is_my_sale(uuid),
  public.app_route_has_my_sale_order(uuid), public.app_can_see_route(uuid),
  public.app_vehicle_visible(uuid), public.app_driver_visible(uuid), public.app_profile_visible(uuid) to authenticated;

revoke all on function public.app_current_role() from public;
revoke all on function public.app_is_staff() from public;
revoke all on function public.app_my_driver_id() from public;
grant execute on function public.app_current_role() to authenticated;
grant execute on function public.app_is_staff() to authenticated;
grant execute on function public.app_my_driver_id() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS — xoá mọi policy cũ rồi tạo lại theo ma trận quyền
--    (policy cũ nếu còn sẽ cộng dồn quyền theo kiểu OR → phải xoá sạch)
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in (
      'profiles','branches','drivers','vehicles','orders','order_items',
      'delivery_routes','route_stops','driver_locations','delivery_events',
      'delivery_photos','cod_transactions','cod_reconciliations',
      'system_audit_logs','odoo_sync_jobs','optimization_runs','alerts','sync_state')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

alter table public.profiles            enable row level security;
alter table public.branches            enable row level security;
alter table public.drivers             enable row level security;
alter table public.vehicles            enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.delivery_routes     enable row level security;
alter table public.route_stops         enable row level security;
alter table public.driver_locations    enable row level security;
alter table public.delivery_events     enable row level security;
alter table public.delivery_photos     enable row level security;
alter table public.cod_transactions    enable row level security;
alter table public.cod_reconciliations enable row level security;
alter table public.system_audit_logs   enable row level security;
alter table public.odoo_sync_jobs      enable row level security;
alter table public.optimization_runs   enable row level security;
alter table public.alerts              enable row level security;
alter table public.sync_state          enable row level security;
-- sync_state: không có policy nào => chỉ service_role truy cập được.

-- profiles --------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.app_is_staff() or public.app_profile_visible(id));
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');
-- insert/delete: chỉ Worker (service_role)

-- branches / vehicles / drivers ----------------------------------------------
create policy branches_select on public.branches for select to authenticated
  using (public.app_current_role() is not null);
create policy vehicles_select on public.vehicles for select to authenticated
  using (public.app_is_staff() or public.app_vehicle_visible(id));
create policy vehicles_write on public.vehicles for all to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());
create policy drivers_select on public.drivers for select to authenticated
  using (public.app_is_staff() or profile_id = auth.uid() or public.app_driver_visible(id));
create policy drivers_write on public.drivers for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');

-- orders -----------------------------------------------------------------------
create policy orders_select_staff on public.orders for select to authenticated
  using (public.app_is_staff());
create policy orders_select_driver on public.orders for select to authenticated
  using (public.app_current_role() = 'driver' and (shipper_profile_id = auth.uid() or public.app_order_in_my_route(id)));
create policy orders_select_sale on public.orders for select to authenticated
  using (public.app_current_role() = 'sale' and sale_profile_id = auth.uid());
create policy orders_update_staff on public.orders for update to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());

create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id));

-- delivery_routes ---------------------------------------------------------------
create policy routes_select on public.delivery_routes for select to authenticated
  using (public.app_can_see_route(id));
create policy routes_write_staff on public.delivery_routes for all to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());

-- route_stops -------------------------------------------------------------------
create policy stops_select_staff on public.route_stops for select to authenticated
  using (public.app_is_staff());
create policy stops_select_driver on public.route_stops for select to authenticated
  using (public.app_current_role() = 'driver' and public.app_can_see_route(route_id));
create policy stops_select_sale on public.route_stops for select to authenticated
  using (public.app_current_role() = 'sale' and public.app_order_is_my_sale(order_id));
create policy stops_write_staff on public.route_stops for all to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());
-- driver cập nhật điểm dừng: đi qua Worker (/api/stops/:id/events)

-- driver_locations --------------------------------------------------------------
create policy loc_insert_driver on public.driver_locations for insert to authenticated
  with check (public.app_current_role() = 'driver' and driver_id = public.app_my_driver_id());
create policy loc_select_staff on public.driver_locations for select to authenticated
  using (public.app_is_staff());
create policy loc_select_driver on public.driver_locations for select to authenticated
  using (public.app_current_role() = 'driver' and driver_id = public.app_my_driver_id());
create policy loc_select_sale on public.driver_locations for select to authenticated
  using (public.app_current_role() = 'sale' and route_id is not null and public.app_route_has_my_sale_order(route_id));

-- delivery_events / photos -----------------------------------------------------
create policy events_select on public.delivery_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = delivery_events.order_id));
create policy photos_select on public.delivery_photos for select to authenticated
  using (exists (select 1 from public.orders o where o.id = delivery_photos.order_id));

-- COD ---------------------------------------------------------------------------
create policy cod_tx_select on public.cod_transactions for select to authenticated
  using (public.app_is_staff() or driver_id = public.app_my_driver_id());
create policy cod_rec_select on public.cod_reconciliations for select to authenticated
  using (public.app_is_staff() or driver_id = public.app_my_driver_id());
create policy cod_rec_write on public.cod_reconciliations for all to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());

-- audit / sync / optimization / alerts ----------------------------------------
create policy audit_select on public.system_audit_logs for select to authenticated
  using (public.app_is_staff());
create policy sync_jobs_select on public.odoo_sync_jobs for select to authenticated
  using (public.app_is_staff());
create policy opt_runs_all on public.optimization_runs for select to authenticated
  using (public.app_is_staff());
create policy alerts_select on public.alerts for select to authenticated
  using (public.app_is_staff());
create policy alerts_update on public.alerts for update to authenticated
  using (public.app_is_staff()) with check (public.app_is_staff());

-- Nhật ký chỉ ghi thêm (append-only) cho vai trò người dùng
revoke insert, update, delete on public.system_audit_logs from authenticated, anon;
-- Chặn hẳn anon
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- 5. Realtime (bỏ qua lỗi nếu publication chưa có / bảng đã thêm)
-- ---------------------------------------------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table public.driver_locations; exception when others then null; end;
  begin alter publication supabase_realtime add table public.route_stops;      exception when others then null; end;
  begin alter publication supabase_realtime add table public.alerts;           exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Tạo admin đầu tiên (làm tay, 1 lần):
--   a) Supabase Dashboard > Authentication > Add user (email + mật khẩu mạnh)
--   b) insert into public.profiles (id, full_name, role, email, is_active)
--        values ('<uuid của user>', 'Quản trị', 'admin', '<email>', true);
--   c) Authentication > Providers > Email: TẮT "Allow new users to sign up".
-- ---------------------------------------------------------------------------
