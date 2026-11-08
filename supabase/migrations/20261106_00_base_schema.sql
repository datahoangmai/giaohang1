-- ============================================================================
-- Hachihi Delivery — Migration 00: SCHEMA NỀN (tạo mới trên Supabase trống)
-- Sinh từ docs/aistudio/deliver_tables_341ba9e8.txt. Chạy ĐẦU TIÊN, an toàn khi chạy lại
-- (create ... if not exists). Nếu DB đã có sẵn các bảng này thì bỏ qua file này.
-- Thứ tự: 00 -> 01 -> 02 (01 chạy riêng một mình).
-- ============================================================================

create extension if not exists pgcrypto;

do $$ begin create type public.app_role as enum ('admin', 'dispatcher', 'driver', 'sale'); exception when duplicate_object then null; end $$;
do $$ begin create type public.delivery_order_status as enum ('draft', 'unassigned', 'assigned', 'in_transit', 'delivered', 'failed', 'cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.route_status as enum ('draft', 'assigned', 'in_progress', 'completed', 'cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.stop_status as enum ('pending', 'arrived', 'completed', 'failed', 'skipped'); exception when duplicate_object then null; end $$;
do $$ begin create type public.sync_status as enum ('pending', 'synced', 'failed', 'conflict'); exception when duplicate_object then null; end $$;
do $$ begin create type public.transaction_type as enum ('collection', 'handover', 'adjustment'); exception when duplicate_object then null; end $$;
do $$ begin create type public.reconciliation_status as enum ('draft', 'confirmed', 'disputed'); exception when duplicate_object then null; end $$;

create table if not exists public.branches (
  "id" uuid primary key default gen_random_uuid(),
  "code" text not null,
  "name" text not null,
  "address" text,
  "latitude" numeric,
  "longitude" numeric,
  "is_active" boolean not null default true,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public.profiles (
  "id" uuid primary key references auth.users(id) on delete cascade,
  "full_name" text not null,
  "phone" text,
  "role" public.app_role not null default 'driver'::app_role,
  "branch_id" uuid references public.branches(id) on delete set null,
  "is_active" boolean not null default true,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public.drivers (
  "id" uuid primary key default gen_random_uuid(),
  "profile_id" uuid not null unique references public.profiles(id) on delete cascade,
  "employee_code" text not null,
  "license_number" text,
  "license_expiry" date,
  "status" text not null default 'active'::text,
  "note" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public.vehicles (
  "id" uuid primary key default gen_random_uuid(),
  "branch_id" uuid not null references public.branches(id) on delete set null,
  "plate_number" text not null unique,
  "vehicle_type" text,
  "brand" text,
  "model" text,
  "max_weight_kg" numeric,
  "max_volume_m3" numeric,
  "status" text not null default 'active'::text,
  "note" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public.orders (
  "id" uuid primary key default gen_random_uuid(),
  "branch_id" uuid not null references public.branches(id) on delete set null,
  "order_number" text not null,
  "source_system" text,
  "source_model" text,
  "source_record_id" text,
  "customer_name" text not null,
  "customer_phone" text,
  "customer_email" text,
  "delivery_address" text not null,
  "delivery_note" text,
  "latitude" numeric,
  "longitude" numeric,
  "status" public.delivery_order_status not null default 'draft'::delivery_order_status,
  "subtotal" numeric not null default 0,
  "shipping_fee" numeric not null default 0,
  "cod_amount" numeric not null default 0,
  "currency" text not null default 'VND'::bpchar,
  "requested_delivery_date" date,
  "created_by" uuid,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public.order_items (
  "id" uuid primary key default gen_random_uuid(),
  "order_id" uuid not null references public.orders(id) on delete cascade,
  "product_code" text,
  "product_name" text not null,
  "quantity" numeric not null,
  "unit" text,
  "unit_price" numeric not null default 0,
  "line_total" numeric not null default 0,
  "created_at" timestamptz not null default now()
);

create table if not exists public.delivery_routes (
  "id" uuid primary key default gen_random_uuid(),
  "branch_id" uuid not null references public.branches(id) on delete set null,
  "route_code" text not null unique,
  "driver_id" uuid references public.drivers(id),
  "vehicle_id" uuid references public.vehicles(id),
  "planned_date" date not null,
  "status" public.route_status not null default 'draft'::route_status,
  "planned_start_at" timestamptz,
  "actual_start_at" timestamptz,
  "actual_end_at" timestamptz,
  "planned_distance_km" numeric,
  "actual_distance_km" numeric,
  "note" text,
  "created_by" uuid references public.profiles(id),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public.route_stops (
  "id" uuid primary key default gen_random_uuid(),
  "route_id" uuid not null references public.delivery_routes(id) on delete cascade,
  "order_id" uuid not null references public.orders(id),
  "sequence_no" integer not null,
  "status" public.stop_status not null default 'pending'::stop_status,
  "planned_arrival_at" timestamptz,
  "arrived_at" timestamptz,
  "completed_at" timestamptz,
  "latitude" numeric,
  "longitude" numeric,
  "failure_reason" text,
  "note" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public.driver_locations (
  "id" uuid primary key default gen_random_uuid(),
  "driver_id" uuid not null references public.drivers(id) on delete cascade,
  "route_id" uuid references public.delivery_routes(id) on delete set null,
  "latitude" numeric not null,
  "longitude" numeric not null,
  "accuracy_m" numeric,
  "speed_kmh" numeric,
  "heading" numeric,
  "recorded_at" timestamptz not null,
  "received_at" timestamptz not null default now(),
  "source" text not null default 'pwa'::text,
  "created_at" timestamptz not null default now()
);

create table if not exists public.delivery_events (
  "id" uuid primary key default gen_random_uuid(),
  "idempotency_key" uuid not null default gen_random_uuid() unique,
  "order_id" uuid not null references public.orders(id),
  "route_id" uuid references public.delivery_routes(id),
  "route_stop_id" uuid references public.route_stops(id),
  "actor_id" uuid references public.profiles(id),
  "event_type" text not null,
  "event_time" timestamptz not null default now(),
  "latitude" numeric,
  "longitude" numeric,
  "description" text,
  "metadata" jsonb not null default '{}'::jsonb,
  "created_at" timestamptz not null default now()
);

create table if not exists public.delivery_photos (
  "id" uuid primary key default gen_random_uuid(),
  "order_id" uuid not null references public.orders(id) on delete cascade,
  "route_stop_id" uuid,
  "uploaded_by" uuid,
  "proof_type" text not null,
  "bucket_name" text not null default 'delivery-proof'::text,
  "storage_path" text not null,
  "file_name" text,
  "mime_type" text not null,
  "file_size_bytes" bigint,
  "checksum_sha256" text,
  "captured_at" timestamptz,
  "uploaded_at" timestamptz not null default now(),
  "note" text,
  "created_at" timestamptz not null default now()
);

create table if not exists public.cod_transactions (
  "id" uuid primary key default gen_random_uuid(),
  "idempotency_key" uuid not null default gen_random_uuid(),
  "order_id" uuid not null references public.orders(id),
  "driver_id" uuid not null references public.drivers(id),
  "route_id" uuid references public.delivery_routes(id),
  "reconciliation_id" uuid,
  "transaction_type" public.transaction_type not null,
  "amount" numeric not null,
  "currency" text not null default 'VND'::bpchar,
  "payment_method" text,
  "reference_number" text,
  "description" text not null,
  "created_by" uuid references public.profiles(id),
  "transaction_time" timestamptz not null default now(),
  "created_at" timestamptz not null default now()
);

create table if not exists public.cod_reconciliations (
  "id" uuid primary key default gen_random_uuid(),
  "reconciliation_code" text not null,
  "branch_id" uuid not null,
  "driver_id" uuid not null references public.drivers(id),
  "period_start" timestamptz not null,
  "period_end" timestamptz not null,
  "expected_amount" numeric not null default 0,
  "declared_amount" numeric not null default 0,
  "difference_amount" numeric,
  "status" public.reconciliation_status not null default 'draft'::reconciliation_status,
  "submitted_by" uuid,
  "reviewed_by" uuid,
  "submitted_at" timestamptz,
  "reviewed_at" timestamptz,
  "review_note" text,
  "note" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public.system_audit_logs (
  "id" uuid primary key default gen_random_uuid(),
  "actor_id" uuid references public.profiles(id) on delete set null,
  "action" text not null,
  "entity_type" text not null,
  "entity_id" text,
  "ip_address" inet,
  "user_agent" text,
  "before_data" jsonb,
  "after_data" jsonb,
  "metadata" jsonb not null default '{}'::jsonb,
  "created_at" timestamptz not null default now()
);

create table if not exists public.odoo_sync_jobs (
  "id" uuid primary key default gen_random_uuid(),
  "idempotency_key" text not null unique,
  "source_system" text not null default 'odoo'::text,
  "source_model" text not null,
  "source_record_id" text not null,
  "operation" text not null,
  "status" public.sync_status not null default 'pending'::sync_status,
  "attempts" integer not null default 0,
  "max_attempts" integer not null default 8,
  "next_retry_at" timestamptz,
  "locked_at" timestamptz,
  "completed_at" timestamptz,
  "payload" jsonb not null default '{}'::jsonb,
  "response_data" jsonb,
  "last_error" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Chi nhánh/kho mặc định (Worker cần ít nhất 1 chi nhánh đang hoạt động).
-- SỬA lại tên, địa chỉ và TỌA ĐỘ KHO THẬT sau khi chạy:
--   update public.branches set name='...', address='...', latitude=..., longitude=... where code='HQ';
-- ---------------------------------------------------------------------------
insert into public.branches (code, name, address, latitude, longitude)
select 'HQ', 'Kho Hachihi', '(cập nhật địa chỉ kho)', 10.7769, 106.7009
where not exists (select 1 from public.branches);
