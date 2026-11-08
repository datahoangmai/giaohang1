import type { Env } from './env';
import { HttpError } from './http';

export type Role = 'admin' | 'dispatcher' | 'driver' | 'sale';

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
  email: string | null;
  username: string | null;
  employee_code: string | null;
  avatar_url: string | null;
  branch_id: string | null;
  odoo_employee_id: number | null;
  odoo_user_id: number | null;
  must_change_password: boolean;
}

export interface AuthContext {
  token: string;
  profile: Profile;
}

type RestInit = Omit<RequestInit, 'body'> & { body?: unknown; prefer?: string };

/**
 * Gọi PostgREST. token = JWT người dùng (RLS áp dụng); bỏ trống = service_role (bỏ qua RLS).
 */
export async function rest<T = any>(env: Env, token: string | null, path: string, init: RestInit = {}): Promise<T> {
  const { body, prefer, headers, ...rest } = init;
  const key = token ? env.SUPABASE_ANON_KEY : env.SUPABASE_SERVICE_ROLE_KEY;
  const h: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${token || env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...((headers as Record<string, string>) || {}),
  };
  if (prefer) h.Prefer = prefer;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...rest,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null as T;
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const code = data?.code as string | undefined;
    const status = code === '23505' ? 409 : res.status === 401 || res.status === 403 ? res.status : res.status >= 500 ? 502 : 400;
    throw new HttpError(status, data?.message || `Lỗi cơ sở dữ liệu (${res.status})`, data);
  }
  return data as T;
}

export const svc = <T = any>(env: Env, path: string, init: RestInit = {}) => rest<T>(env, null, path, init);

export async function gotrue(env: Env, path: string, init: { method?: string; body?: unknown; token?: string; admin?: boolean } = {}) {
  const key = init.admin ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/${path}`, {
    method: init.method || 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${init.token || key}`,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

const tokenCache = new Map<string, { uid: string; exp: number }>();

export async function requireAuth(req: Request, env: Env, roles?: Role[]): Promise<AuthContext> {
  const header = req.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Thiếu thông tin đăng nhập.');

  const now = Date.now();
  let uid = tokenCache.get(token)?.uid;
  if (!uid || (tokenCache.get(token)?.exp || 0) < now) {
    const r = await gotrue(env, 'user', { token });
    if (!r.ok || !r.data?.id) throw new HttpError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    uid = r.data.id as string;
    tokenCache.set(token, { uid, exp: now + 30_000 });
    if (tokenCache.size > 500) tokenCache.clear();
  }

  const rows = await svc<Profile[]>(env, `profiles?id=eq.${uid}&select=*`);
  const profile = rows?.[0];
  if (!profile || !profile.is_active) throw new HttpError(403, 'Tài khoản đã bị khóa hoặc chưa được cấp quyền.');
  if (roles && !roles.includes(profile.role)) throw new HttpError(403, 'Bạn không có quyền thực hiện thao tác này.');
  return { token, profile };
}

export async function audit(
  env: Env,
  actor: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
  req?: Request,
  metadata: Record<string, unknown> = {}
) {
  try {
    await svc(env, 'system_audit_logs', {
      method: 'POST',
      body: {
        actor_id: actor,
        action,
        entity_type: entityType,
        entity_id: entityId,
        ip_address: req?.headers.get('CF-Connecting-IP') || null,
        user_agent: req?.headers.get('User-Agent')?.slice(0, 300) || null,
        before_data: before ?? null,
        after_data: after ?? null,
        metadata,
      },
    });
  } catch (e) {
    console.error('audit failed', e);
  }
}

export async function getDefaultBranch(env: Env): Promise<{ id: string; lat: number; lng: number }> {
  const q = env.DEFAULT_BRANCH_ID
    ? `branches?id=eq.${env.DEFAULT_BRANCH_ID}&select=id,latitude,longitude`
    : 'branches?is_active=eq.true&select=id,latitude,longitude&order=created_at.asc&limit=1';
  const rows = await svc<any[]>(env, q);
  const b = rows?.[0];
  if (!b) throw new HttpError(500, 'Chưa có chi nhánh (branches) nào đang hoạt động.');
  return { id: b.id, lat: Number(b.latitude) || 10.7825, lng: Number(b.longitude) || 106.698 };
}

export function inList(values: Array<string | number>): string {
  return `in.(${values.map((v) => String(v).replace(/[(),"]/g, '')).join(',')})`;
}
