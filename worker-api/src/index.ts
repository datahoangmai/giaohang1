/**
 * Hachihi Delivery — Cloudflare Worker API
 * Chỉ Worker được giữ khóa Odoo và service_role của Supabase.
 * Mọi route (trừ /api/health, /api/auth/login, /api/auth/refresh) đều yêu cầu JWT Supabase hợp lệ và kiểm tra vai trò ở server.
 */
import { computeAlerts } from './alerts';
import { type Env, type ExecutionContext, type ScheduledEvent } from './env';
import { HttpError, corsHeaders, json } from './http';
import { listOdooShaped, patchRoute, setOrderLocation, startRoute, stopEvent } from './delivery';
import { ODOO_STATES, geocodePending, odooHealth, odooPreview, processOdooQueue, syncOdoo } from './odoo';
import { confirmOptimization, discardOptimization, runOptimization } from './planning';
import { audit, requireAuth, svc } from './supabase';
import { changePassword, createUser, listUsers, login, me, refresh, resetPassword, updateUser } from './users';

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;
  let g: RegExpMatchArray | null;

  if (p === '/' || p === '/api/health') {
    // Chỉ liệt kê TÊN cấu hình còn thiếu (không lộ giá trị) để dễ chẩn đoán sau khi deploy.
    const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ODOO_URL', 'ODOO_DB', 'ODOO_UID', 'ODOO_API_KEY'].filter((k) => !(env as any)[k]);
    return json({ status: 'online', service: 'hachihi-delivery-worker', time: new Date().toISOString(), missingConfig: missing });
  }

  // Thiếu cấu hình bắt buộc thì báo rõ thay vì "Lỗi máy chủ nội bộ"
  if (p.startsWith('/api/auth/') || p.startsWith('/api/admin/') || p.startsWith('/api/odoo/')) {
    const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !(env as any)[k]);
    if (need.length) throw new HttpError(500, `Máy chủ chưa cấu hình: ${need.join(', ')} (đặt trong Cloudflare → Settings → Variables and Secrets).`);
  }

  // Xác thực
  if (p === '/api/auth/login' && m === 'POST') return login(req, env);
  if (p === '/api/auth/refresh' && m === 'POST') return refresh(req, env);
  if (p === '/api/auth/me' && m === 'GET') return me(req, env);
  if (p === '/api/auth/change-password' && m === 'POST') return changePassword(req, env);

  // Quản trị tài khoản
  if (p === '/api/admin/users' && m === 'GET') return listUsers(req, env);
  if (p === '/api/admin/users' && m === 'POST') return createUser(req, env);
  if ((g = p.match(/^\/api\/admin\/users\/([^/]+)$/)) && m === 'PATCH') return updateUser(req, env, g[1]);
  if ((g = p.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/)) && m === 'POST') return resetPassword(req, env, g[1]);

  // Odoo
  if (p === '/api/odoo/sync' && m === 'POST') {
    const a = await requireAuth(req, env, ['admin', 'dispatcher']);
    const full = url.searchParams.get('full') === '1' && a.profile.role === 'admin';
    // Nạp chọn lọc: body { ids?: number[], states?: string[] } (tối đa 500 phiếu / lần)
    let body: { ids?: unknown; states?: unknown } = {};
    try { body = await req.json(); } catch { /* không có body = đồng bộ mặc định */ }
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500) : [];
    const states = Array.isArray(body.states) ? body.states.map(String).filter((x) => (ODOO_STATES as readonly string[]).includes(x)) : [];
    const stats = await syncOdoo(env, { full, ids, states });
    await audit(env, a.profile.id, 'odoo.sync', 'odoo', null, null, stats, req);
    return json({ ok: true, stats });
  }
  if (p === '/api/odoo/sync-status' && m === 'GET') {
    await requireAuth(req, env, ['admin', 'dispatcher']);
    const [state, jobs] = await Promise.all([
      svc<any[]>(env, 'sync_state?key=eq.odoo_shipping&select=value,updated_at'),
      svc<any[]>(env, 'odoo_sync_jobs?status=in.(pending,failed,conflict)&select=id,status,attempts,last_error,source_record_id,created_at&order=created_at.desc&limit=50'),
    ]);
    return json({ state: state?.[0] || null, queue: jobs || [] });
  }
  if (p === '/api/odoo/preview' && m === 'GET') {
    await requireAuth(req, env, ['admin', 'dispatcher']);
    const states = (url.searchParams.get('states') || '').split(',').filter((x) => (ODOO_STATES as readonly string[]).includes(x));
    const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    return json(await odooPreview(env, { states, q, offset, limit }));
  }
  if (p === '/api/odoo/test' && m === 'GET') {
    await requireAuth(req, env, ['admin', 'dispatcher']);
    return json(await odooHealth(env));
  }
  if (p === '/api/odoo/shipping-orders' && m === 'GET') return listOdooShaped(req, env);

  // Đơn hàng
  if ((g = p.match(/^\/api\/orders\/([^/]+)\/location$/)) && m === 'POST') return setOrderLocation(req, env, g[1]);

  // Gợi ý tuyến
  if (p === '/api/optimization/run' && m === 'POST') return runOptimization(req, env);
  if ((g = p.match(/^\/api\/optimization\/([^/]+)\/confirm$/)) && m === 'POST') return confirmOptimization(req, env, g[1]);
  if ((g = p.match(/^\/api\/optimization\/([^/]+)\/discard$/)) && m === 'POST') return discardOptimization(req, env, g[1]);

  // Tuyến và điểm dừng
  if ((g = p.match(/^\/api\/routes\/([^/]+)\/start$/)) && m === 'POST') return startRoute(req, env, ctx, g[1]);
  if ((g = p.match(/^\/api\/routes\/([^/]+)$/)) && m === 'PATCH') return patchRoute(req, env, g[1]);
  if ((g = p.match(/^\/api\/stops\/([^/]+)\/events$/)) && m === 'POST') return stopEvent(req, env, ctx, g[1]);

  throw new HttpError(404, 'Không tìm thấy API.');
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env, ctx);
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) h.set(k, v);
      return new Response(res.body, { status: res.status, headers: h });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      console.error('Lỗi không mong đợi', e);
      return json({ error: 'Lỗi máy chủ nội bộ.' }, 500, cors);
    }
  },

  /** Cron: đồng bộ Odoo, xử lý hàng đợi ghi ngược, geocode còn tồn, tính cảnh báo */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const steps: Array<[string, () => Promise<unknown>]> = [
          ['syncOdoo', () => syncOdoo(env, { maxGeocode: 15 })],
          ['processOdooQueue', () => processOdooQueue(env, 20)],
          ['geocodePending', () => geocodePending(env, 15)],
          ['computeAlerts', () => computeAlerts(env)],
        ];
        for (const [name, fn] of steps) {
          try {
            console.log(name, JSON.stringify(await fn()));
          } catch (e) {
            console.error(`cron ${name} lỗi:`, (e as Error).message);
          }
        }
      })()
    );
  },
};
