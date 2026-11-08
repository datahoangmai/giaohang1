-- ============================================================================
-- Hachihi Delivery — Migration 01: bổ sung giá trị enum cần dùng
-- CHẠY RIÊNG (Run) và để hoàn tất, SAU ĐÓ mới chạy file 02.
-- (ALTER TYPE ... ADD VALUE không dùng được trong cùng transaction với câu
--  lệnh dùng giá trị mới.)
-- Schema thật của dự án: profiles.role dùng enum app_role, orders.status dùng
-- delivery_order_status, nên file này tự dò tên kiểu từ cột, không đoán tên.
-- ============================================================================
create or replace function pg_temp.add_enum_values(p_table text, p_column text, p_values text[])
returns void language plpgsql as $$
declare
  t text; v text;
begin
  select format('%I.%I', tn.nspname, ty.typname) into t
  from pg_attribute a
  join pg_class c      on c.oid = a.attrelid
  join pg_namespace n  on n.oid = c.relnamespace
  join pg_type ty      on ty.oid = a.atttypid
  join pg_namespace tn on tn.oid = ty.typnamespace
  where n.nspname = 'public' and c.relname = p_table
    and a.attname = p_column and not a.attisdropped and ty.typtype = 'e';

  if t is null then
    raise notice 'Bỏ qua: public.%.% không phải cột enum', p_table, p_column;
    return;
  end if;
  foreach v in array p_values loop
    execute format('alter type %s add value if not exists %L', t, v);
  end loop;
end $$;

select pg_temp.add_enum_values('profiles',        'role',             array['admin','dispatcher','driver','sale']);
select pg_temp.add_enum_values('orders',          'status',           array['unassigned','assigned','in_transit','delivered','failed','cancelled']);
select pg_temp.add_enum_values('delivery_routes', 'status',           array['draft','assigned','in_progress','completed','cancelled']);
select pg_temp.add_enum_values('route_stops',     'status',           array['pending','arrived','completed','failed','skipped']);
select pg_temp.add_enum_values('odoo_sync_jobs',  'status',           array['pending','synced','failed','conflict']);
select pg_temp.add_enum_values('cod_transactions','transaction_type', array['collection']);

-- Kiểm tra nhãn hiện có sau khi chạy:
-- select t.typname, e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
--  where t.typname in ('app_role','delivery_order_status','route_status','stop_status','sync_status','transaction_type')
--  order by 1, e.enumsortorder;
