import type { Env } from './env';
import { HttpError } from './http';
import { geocode } from './geocode';
import { getDefaultBranch, inList, svc, audit, type Profile } from './supabase';

export type Many2One = [number, string] | false;

export interface OdooShipping {
  id: number;
  name: string;
  sale_id: Many2One;
  partner_shipping_id: Many2One;
  phone?: string | false;
  from_address?: string | false;
  to_address?: string | false;
  state: 'draft' | 'ready' | 'assigned' | 'in_delivery' | 'done' | 'cancel';
  distance?: number;
  scheduled_date?: string | false;
  done_date?: string | false;
  total_amount?: number;
  amount_fee?: number;
  extra_amount?: number;
  shipper_id?: Many2One;
  x_shipper?: Many2One;
  x_mvd?: string | false;
  x_dvvt?: string | false;
  x_hotrolapdat?: boolean;
  x_cpvc?: number;
  x_tongchiphi?: number;
  x_nvkdso?: Many2One;
  note?: string | false;
  internal_note?: string | false;
  create_date?: string;
  write_date: string;
}

export const SHIPPING_FIELDS = [
  'name', 'sale_id', 'partner_shipping_id', 'partner_source_id', 'phone', 'from_address', 'to_address',
  'state', 'distance', 'scheduled_date', 'done_date', 'total_amount', 'amount_fee', 'extra_amount',
  'shipper_id', 'x_shipper', 'x_mvd', 'x_dvvt', 'x_hotrolapdat', 'x_cpvc', 'x_tongchiphi', 'x_nvkdso',
  'note', 'internal_note', 'create_date', 'write_date',
];

export async function odooExec<T = any>(
  env: Env,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {}
): Promise<T> {
  if (!env.ODOO_URL || !env.ODOO_API_KEY) throw new HttpError(503, 'Chưa cấu hình kết nối Odoo trên Worker.');
  const res = await fetch(`${env.ODOO_URL.replace(/\/$/, '')}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [env.ODOO_DB, Number(env.ODOO_UID), env.ODOO_API_KEY, model, method, args, kwargs],
      },
    }),
  });
  if (!res.ok) throw new HttpError(502, `Odoo trả về HTTP ${res.status}`);
  const data: any = await res.json();
  if (data.error) {
    throw new HttpError(502, `Odoo: ${data.error.data?.message || data.error.message || 'lỗi không rõ'}`);
  }
  return data.result as T;
}

// ---------------------------------------------------------------------------
// Kiểm tra kết nối thật tới Odoo (không giả lập: lỗi thế nào trả đúng thế đó)
// ---------------------------------------------------------------------------
export interface OdooHealth {
  ok: boolean;
  url: string;
  db: string;
  version?: string;
  user?: string;
  totalOrders?: number;
  missingFields: string[];
  steps: { step: string; ok: boolean; detail: string }[];
}

export async function odooHealth(env: Env): Promise<OdooHealth> {
  const out: OdooHealth = { ok: false, url: env.ODOO_URL || '', db: env.ODOO_DB || '', missingFields: [], steps: [] };
  const step = (name: string, ok: boolean, detail: string) => out.steps.push({ step: name, ok, detail });

  const missing = ['ODOO_URL', 'ODOO_DB', 'ODOO_UID', 'ODOO_API_KEY'].filter((k) => !(env as any)[k]);
  if (missing.length) {
    step('Cấu hình Worker', false, `Thiếu: ${missing.join(', ')}`);
    return out;
  }
  step('Cấu hình Worker', true, 'Đủ ODOO_URL, ODOO_DB, ODOO_UID, ODOO_API_KEY');

  // 1. Máy chủ Odoo có trả lời không (không cần đăng nhập)
  try {
    const r = await fetch(`${env.ODOO_URL.replace(/\/$/, '')}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service: 'common', method: 'version', args: [] } }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d: any = await r.json();
    if (d.error) throw new Error(d.error.data?.message || d.error.message);
    out.version = d.result?.server_version;
    step('Máy chủ Odoo', true, `Odoo ${out.version || '?'}`);
  } catch (e) {
    step('Máy chủ Odoo', false, `Không gọi được ${env.ODOO_URL}/jsonrpc: ${(e as Error).message}`);
    return out;
  }

  // 2. UID + API key có đúng và có quyền không
  try {
    const u: any[] = await odooExec(env, 'res.users', 'read', [[Number(env.ODOO_UID)]], { fields: ['name', 'login'] });
    if (!u?.length) throw new Error('Không đọc được user theo ODOO_UID');
    out.user = `${u[0].name} (${u[0].login})`;
    step('Xác thực (UID + API key)', true, out.user);
  } catch (e) {
    step('Xác thực (UID + API key)', false, (e as Error).message);
    return out;
  }

  // 3. Model shipping.order và các trường cần dùng
  try {
    const f: Record<string, unknown> = await odooExec(env, 'shipping.order', 'fields_get', [], { attributes: ['type'] });
    out.missingFields = SHIPPING_FIELDS.filter((x) => !(x in f));
    step(
      'Model shipping.order',
      out.missingFields.length === 0,
      out.missingFields.length ? `Thiếu trường: ${out.missingFields.join(', ')}` : `Đủ ${SHIPPING_FIELDS.length} trường cần dùng`
    );
  } catch (e) {
    step('Model shipping.order', false, (e as Error).message);
    return out;
  }

  // 4. Đọc được dữ liệu
  try {
    out.totalOrders = await odooExec<number>(env, 'shipping.order', 'search_count', [[]]);
    step('Đọc dữ liệu', true, `${out.totalOrders} phiếu giao trong Odoo`);
  } catch (e) {
    step('Đọc dữ liệu', false, (e as Error).message);
    return out;
  }

  out.ok = out.steps.every((x) => x.ok);
  return out;
}

// ---------------------------------------------------------------------------
// Ánh xạ
// ---------------------------------------------------------------------------
const odooIso = (s: string) => s.replace(' ', 'T') + 'Z';
const vnDate = (s: string) => new Date(new Date(odooIso(s)).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function mapStatus(odooState: string, current?: string): string {
  switch (odooState) {
    case 'done':
      return 'delivered';
    case 'cancel':
      return 'cancelled';
    case 'in_delivery':
      return 'in_transit';
    case 'assigned':
      return current === 'in_transit' ? current : 'assigned';
    default:
      return current && ['assigned', 'in_transit', 'failed'].includes(current) ? current : 'unassigned';
  }
}

interface PersonMaps {
  byEmployee: Map<number, string>;
  byCode: Map<string, string>;
  byName: Map<string, string>;
}

async function loadPersonMaps(env: Env): Promise<PersonMaps> {
  const rows = await svc<Profile[]>(env, 'profiles?is_active=eq.true&role=in.(driver,sale)&select=id,full_name,employee_code,odoo_employee_id');
  const m: PersonMaps = { byEmployee: new Map(), byCode: new Map(), byName: new Map() };
  for (const p of rows || []) {
    if (p.odoo_employee_id) m.byEmployee.set(p.odoo_employee_id, p.id);
    if (p.employee_code) m.byCode.set(p.employee_code.toLowerCase(), p.id);
    m.byName.set(p.full_name.trim().toLowerCase(), p.id);
  }
  return m;
}

function matchPerson(v: Many2One | undefined, maps: PersonMaps): string | null {
  if (!v) return null;
  const [id, name] = v;
  if (maps.byEmployee.has(id)) return maps.byEmployee.get(id)!;
  const code = /\(([^)]+)\)\s*$/.exec(name)?.[1]?.trim().toLowerCase();
  if (code && maps.byCode.has(code)) return maps.byCode.get(code)!;
  const plain = name.replace(/\([^)]*\)/g, '').trim().toLowerCase();
  return maps.byName.get(plain) || null;
}

const PREPAID_RE = /(đã thanh toán|da thanh toan|vnpay|chuyển khoản|chuyen khoan|0 đồng)/i;

// ---------------------------------------------------------------------------
// Đồng bộ Odoo -> Supabase (gia tăng)
// ---------------------------------------------------------------------------
export interface SyncStats {
  fetched: number;
  inserted: number;
  updated: number;
  geocoded: number;
  geocodePending: number;
  lastWriteDate: string | null;
  durationMs: number;
}

export async function syncOdoo(env: Env, opts: { full?: boolean; maxGeocode?: number } = {}): Promise<SyncStats> {
  const t0 = Date.now();
  const branch = await getDefaultBranch(env);
  const stateRows = await svc<any[]>(env, 'sync_state?key=eq.odoo_shipping&select=value');
  const lastWrite: string | null = opts.full ? null : stateRows?.[0]?.value?.last_write_date || null;

  const domain = lastWrite
    ? [['write_date', '>=', lastWrite]]
    : [['state', 'in', ['draft', 'ready', 'assigned', 'in_delivery']]];

  const records: OdooShipping[] = [];
  const PAGE = 200;
  for (let page = 0; page < 10; page++) {
    const batch = await odooExec<OdooShipping[]>(env, 'shipping.order', 'search_read', [domain], {
      fields: SHIPPING_FIELDS,
      limit: PAGE,
      offset: page * PAGE,
      order: 'write_date asc, id asc',
    });
    records.push(...batch);
    if (batch.length < PAGE) break;
  }

  const stats: SyncStats = {
    fetched: records.length, inserted: 0, updated: 0, geocoded: 0, geocodePending: 0,
    lastWriteDate: lastWrite, durationMs: 0,
  };

  if (records.length) {
    const maps = await loadPersonMaps(env);

    // Đọc bản ghi hiện có
    const existing = new Map<string, any>();
    for (let i = 0; i < records.length; i += 100) {
      const ids = records.slice(i, i + 100).map((r) => r.id);
      const rows = await svc<any[]>(
        env,
        `orders?source_system=eq.odoo&source_model=eq.shipping.order&source_record_id=${inList(ids)}` +
          `&select=id,source_record_id,status,delivery_address,geocode_status,branch_id`
      );
      for (const r of rows || []) existing.set(String(r.source_record_id), r);
    }

    const inserts: any[] = [];
    const updates: any[] = [];
    const conflictAlerts: any[] = [];

    for (const r of records) {
      const cur = existing.get(String(r.id));
      const address = str(r.to_address);
      const note = str(r.note);
      const total = Number(r.total_amount) || 0;
      const status = mapStatus(r.state, cur?.status);
      const addrChanged = cur ? cur.delivery_address !== address : true;
      const geocodeStatus = !cur ? 'pending' : addrChanged && cur.geocode_status !== 'manual' ? 'pending' : cur.geocode_status;

      const row: Record<string, unknown> = {
        source_system: 'odoo',
        source_model: 'shipping.order',
        source_record_id: String(r.id),
        odoo_shipping_order_id: r.id,
        order_number: r.name,
        customer_name: r.partner_shipping_id ? r.partner_shipping_id[1] : 'Khách hàng Odoo',
        customer_phone: str(r.phone) || null,
        delivery_address: address || '(chưa có địa chỉ)',
        delivery_note: note || null,
        status,
        subtotal: total,
        shipping_fee: Number(r.amount_fee) || Number(r.x_cpvc) || 0,
        cod_amount: total,
        currency: 'VND',
        requested_delivery_date: r.scheduled_date ? vnDate(r.scheduled_date) : null,
        scheduled_at: r.scheduled_date ? odooIso(r.scheduled_date) : null,
        tracking_code: str(r.x_mvd) || null,
        carrier_service: str(r.x_dvvt) || 'noi_bo',
        has_installation: Boolean(r.x_hotrolapdat),
        extra_amount: Number(r.extra_amount) || 0,
        total_shipping_cost: Number(r.x_tongchiphi) || 0,
        odoo_state: r.state,
        odoo_write_date: odooIso(r.write_date),
        odoo_raw: r,
        sale_profile_id: matchPerson(r.x_nvkdso, maps),
        shipper_profile_id: matchPerson(r.x_shipper, maps),
        service_minutes: r.x_hotrolapdat ? 20 : 5,
        // COD: tín hiệu mâu thuẫn (có số tiền nhưng ghi chú nói đã thanh toán) => buộc điều phối xem lại
        cod_needs_review: total > 0 && PREPAID_RE.test(note),
        geocode_status: geocodeStatus,
      };

      if (cur) {
        updates.push(row);
        if (['assigned', 'in_transit'].includes(cur.status) && (r.state === 'cancel' || (r.state === 'done' && cur.status !== 'delivered'))) {
          conflictAlerts.push({
            order_id: cur.id,
            type: 'odoo_conflict',
            severity: 'critical',
            message: `Phiếu ${r.name} đã ${r.state === 'cancel' ? 'bị hủy' : 'hoàn tất'} trên Odoo nhưng đang nằm trong tuyến giao.`,
            dedupe_key: `odoo_conflict:${cur.id}:${r.state}`,
          });
        }
      } else {
        inserts.push({ ...row, branch_id: branch.id });
      }
    }

    const upsert = (rows: any[]) =>
      svc(env, 'orders?on_conflict=source_system,source_model,source_record_id', {
        method: 'POST',
        body: rows,
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
    for (let i = 0; i < inserts.length; i += 200) await upsert(inserts.slice(i, i + 200));
    for (let i = 0; i < updates.length; i += 200) await upsert(updates.slice(i, i + 200));
    stats.inserted = inserts.length;
    stats.updated = updates.length;

    if (conflictAlerts.length) {
      await svc(env, 'alerts?on_conflict=dedupe_key', { method: 'POST', body: conflictAlerts, prefer: 'resolution=ignore-duplicates,return=minimal' });
    }

    stats.lastWriteDate = records.reduce((mx, r) => (r.write_date > mx ? r.write_date : mx), lastWrite || '');
    await svc(env, 'sync_state?on_conflict=key', {
      method: 'POST',
      body: { key: 'odoo_shipping', value: { last_write_date: stats.lastWriteDate, last_run_at: new Date().toISOString(), last_stats: { fetched: stats.fetched } }, updated_at: new Date().toISOString() },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  const g = await geocodePending(env, opts.maxGeocode ?? 20);
  stats.geocoded = g.done;
  stats.geocodePending = g.remaining;
  stats.durationMs = Date.now() - t0;
  return stats;
}

export async function geocodePending(env: Env, limit: number): Promise<{ done: number; remaining: number }> {
  const branch = await getDefaultBranch(env);
  const rows = await svc<any[]>(env, `orders?geocode_status=eq.pending&select=id,delivery_address&order=created_at.asc&limit=${limit}`);
  let done = 0;
  for (const o of rows || []) {
    const g = await geocode(env, o.delivery_address, branch);
    await svc(env, `orders?id=eq.${o.id}`, {
      method: 'PATCH',
      body: { latitude: g.lat, longitude: g.lng, geocode_status: g.status, geocode_provider: g.provider },
      prefer: 'return=minimal',
    });
    if (g.status === 'failed') {
      await svc(env, 'alerts?on_conflict=dedupe_key', {
        method: 'POST',
        prefer: 'resolution=ignore-duplicates,return=minimal',
        body: { order_id: o.id, type: 'geocode_failed', severity: 'warning', message: `Không xác định được tọa độ: ${o.delivery_address}`, dedupe_key: `geocode_failed:${o.id}:${(o.delivery_address || '').length}` },
      });
    }
    done++;
  }
  const left = await svc<any[]>(env, 'orders?geocode_status=eq.pending&select=id&limit=1');
  return { done, remaining: left?.length ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// Hàng đợi ghi ngược Odoo
// ---------------------------------------------------------------------------
export type OdooTargetState = 'in_delivery' | 'done' | 'ready';

export async function enqueueOdooState(
  env: Env,
  order: { id: string; odoo_shipping_order_id: number | null; order_number?: string },
  state: OdooTargetState,
  message: string,
  eventKey: string
): Promise<string | null> {
  if (!order.odoo_shipping_order_id) return null;
  const rows = await svc<any[]>(env, 'odoo_sync_jobs?on_conflict=idempotency_key', {
    method: 'POST',
    prefer: 'resolution=ignore-duplicates,return=representation',
    body: {
      idempotency_key: `odoo:${order.id}:${state}:${eventKey}`,
      source_system: 'odoo',
      source_model: 'shipping.order',
      source_record_id: String(order.odoo_shipping_order_id),
      operation: 'set_state',
      status: 'pending',
      payload: { order_id: order.id, odoo_id: order.odoo_shipping_order_id, state, message, done_date: state === 'done' ? new Date().toISOString() : null },
    },
  });
  return rows?.[0]?.id || null;
}

const odooDateTime = (iso: string) => iso.replace('T', ' ').slice(0, 19);

export async function processOdooQueue(env: Env, limit = 10): Promise<{ processed: number; synced: number; failed: number; conflict: number }> {
  const now = new Date().toISOString();
  const jobs = await svc<any[]>(
    env,
    `odoo_sync_jobs?status=eq.pending&operation=eq.set_state&or=(next_retry_at.is.null,next_retry_at.lte.${now})&order=created_at.asc&limit=${limit}`
  );
  const out = { processed: 0, synced: 0, failed: 0, conflict: 0 };

  for (const job of jobs || []) {
    out.processed++;
    const p = job.payload as { order_id: string; odoo_id: number; state: OdooTargetState; message: string; done_date: string | null };
    try {
      const cur = await odooExec<any[]>(env, 'shipping.order', 'read', [[p.odoo_id]], { fields: ['state'] });
      const curState = cur?.[0]?.state;
      if (!cur?.length) throw new HttpError(404, 'Phiếu Odoo không còn tồn tại.');

      if (curState === p.state) {
        await finishJob(env, job, 'synced', { note: 'Odoo đã ở trạng thái đích' });
        out.synced++;
        continue;
      }
      if ((curState === 'done' || curState === 'cancel') && p.state !== curState) {
        await finishJob(env, job, 'conflict', { odoo_state: curState }, `Odoo đang ở trạng thái "${curState}", không ghi đè thành "${p.state}".`);
        await svc(env, 'alerts?on_conflict=dedupe_key', {
          method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
          body: { order_id: p.order_id, type: 'odoo_conflict', severity: 'critical', message: `Xung đột ghi ngược Odoo: phiếu #${p.odoo_id} đang "${curState}", app muốn đặt "${p.state}".`, dedupe_key: `odoo_conflict:${job.id}` },
        });
        out.conflict++;
        continue;
      }

      if (p.state === 'done' && env.ODOO_DONE_METHOD) {
        await odooExec(env, 'shipping.order', env.ODOO_DONE_METHOD, [[p.odoo_id]]);
      } else {
        const vals: Record<string, unknown> = { state: p.state };
        if (p.state === 'done') vals.done_date = odooDateTime(p.done_date || new Date().toISOString());
        await odooExec(env, 'shipping.order', 'write', [[p.odoo_id], vals]);
      }
      // Ghi chú vào chatter (không ghi đè internal_note). Bỏ qua nếu model không có mail.thread.
      if (p.message) {
        try {
          await odooExec(env, 'shipping.order', 'message_post', [[p.odoo_id]], { body: p.message });
        } catch (e) {
          console.warn('message_post bỏ qua:', (e as Error).message);
        }
      }
      await finishJob(env, job, 'synced', { written_state: p.state });
      await svc(env, `orders?id=eq.${p.order_id}`, { method: 'PATCH', body: { odoo_state: p.state }, prefer: 'return=minimal' });
      out.synced++;
    } catch (e) {
      const attempts = (job.attempts || 0) + 1;
      const max = job.max_attempts || 8;
      const terminal = attempts >= max;
      await svc(env, `odoo_sync_jobs?id=eq.${job.id}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: {
          attempts,
          status: terminal ? 'failed' : 'pending',
          last_error: (e as Error).message.slice(0, 500),
          next_retry_at: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString(),
        },
      });
      if (terminal) out.failed++;
    }
  }
  return out;
}

async function finishJob(env: Env, job: any, status: 'synced' | 'conflict', response: unknown, error?: string) {
  await svc(env, `odoo_sync_jobs?id=eq.${job.id}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: { status, attempts: (job.attempts || 0) + 1, completed_at: new Date().toISOString(), response_data: response, last_error: error || null },
  });
}

export { audit };
