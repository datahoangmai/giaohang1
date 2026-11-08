import type { Env } from './env';
import { HttpError, assertUuid, json, randomPassword, readJson } from './http';
import { audit, getDefaultBranch, gotrue, requireAuth, svc, type AuthContext, type Profile, type Role } from './supabase';

const ROLES: Role[] = ['admin', 'dispatcher', 'driver', 'sale'];
const CODE_PREFIX: Record<Role, string> = { admin: 'HCH-ADM', dispatcher: 'HCH-DP', driver: 'HCH-TX', sale: 'HCH-KD' };

export async function profileDto(env: Env, p: Profile) {
  let driverId: string | null = null;
  let assignedVehicle: string | undefined;
  if (p.role === 'driver') {
    const d = await svc<any[]>(env, `drivers?profile_id=eq.${p.id}&select=id,default_vehicle_id,vehicles:default_vehicle_id(plate_number)`);
    driverId = d?.[0]?.id || null;
    assignedVehicle = d?.[0]?.vehicles?.plate_number || undefined;
  }
  return {
    id: p.id,
    employeeCode: p.employee_code || '',
    fullName: p.full_name,
    phone: p.phone || '',
    username: p.username || '',
    email: p.email || '',
    role: p.role,
    avatarUrl: p.avatar_url || undefined,
    isActive: p.is_active,
    driverId,
    assignedVehicle,
    mustChangePassword: p.must_change_password,
    odooEmployeeId: p.odoo_employee_id,
    odooUserId: p.odoo_user_id,
    createdAt: undefined as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Đăng nhập (giới hạn thử sai theo isolate — Supabase còn có rate limit riêng)
// ---------------------------------------------------------------------------
const fails = new Map<string, { n: number; until: number }>();

export async function login(req: Request, env: Env): Promise<Response> {
  const { identifier, password } = await readJson<{ identifier?: string; password?: string }>(req);
  const id = (identifier || '').trim();
  if (!id || !password) throw new HttpError(400, 'Vui lòng nhập tên đăng nhập và mật khẩu.');

  const ip = req.headers.get('CF-Connecting-IP') || 'ip';
  const key = `${ip}|${id.toLowerCase()}`;
  const f = fails.get(key);
  if (f && f.until > Date.now() && f.n >= 5) throw new HttpError(429, 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 10 phút.');

  const generic = new HttpError(401, 'Thông tin đăng nhập không đúng.');
  let email = '';
  if (id.includes('@')) {
    email = id.toLowerCase();
  } else {
    const phone = id.replace(/\s+/g, '');
    const safe = id.replace(/[(),*"\\]/g, '');
    const rows = await svc<Profile[]>(
      env,
      `profiles?or=(username.ilike.${encodeURIComponent(safe)},employee_code.ilike.${encodeURIComponent(safe)},phone.eq.${encodeURIComponent(phone)})&is_active=eq.true&select=email&limit=2`
    );
    if (!rows || rows.length !== 1 || !rows[0].email) throw generic; // không tồn tại hoặc trùng => chung thông báo
    email = rows[0].email;
  }

  const r = await gotrue(env, 'token?grant_type=password', { method: 'POST', body: { email, password } });
  if (!r.ok) {
    fails.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 10 * 60_000 });
    throw generic;
  }
  fails.delete(key);

  const rows = await svc<Profile[]>(env, `profiles?id=eq.${r.data.user.id}&select=*`);
  const profile = rows?.[0];
  if (!profile || !profile.is_active) throw new HttpError(403, 'Tài khoản đã bị khóa hoặc chưa được cấp quyền.');
  await audit(env, profile.id, 'auth.login', 'profile', profile.id, null, null, req);

  return json({
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (r.data.expires_in || 3600),
    user: await profileDto(env, profile),
  });
}

export async function refresh(req: Request, env: Env): Promise<Response> {
  const { refreshToken } = await readJson<{ refreshToken?: string }>(req);
  if (!refreshToken) throw new HttpError(400, 'Thiếu refresh token.');
  const r = await gotrue(env, 'token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } });
  if (!r.ok) throw new HttpError(401, 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  const rows = await svc<Profile[]>(env, `profiles?id=eq.${r.data.user.id}&select=*`);
  if (!rows?.[0]?.is_active) throw new HttpError(403, 'Tài khoản đã bị khóa.');
  return json({
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (r.data.expires_in || 3600),
    user: await profileDto(env, rows[0]),
  });
}

export async function me(req: Request, env: Env): Promise<Response> {
  const ctx = await requireAuth(req, env);
  return json({ user: await profileDto(env, ctx.profile) });
}

export async function changePassword(req: Request, env: Env): Promise<Response> {
  const ctx = await requireAuth(req, env);
  const { newPassword } = await readJson<{ newPassword?: string }>(req);
  if (!newPassword || newPassword.length < 8) throw new HttpError(400, 'Mật khẩu mới tối thiểu 8 ký tự.');
  const r = await gotrue(env, 'user', { method: 'PUT', token: ctx.token, body: { password: newPassword } });
  if (!r.ok) throw new HttpError(400, r.data?.msg || r.data?.message || 'Không đổi được mật khẩu.');
  await svc(env, `profiles?id=eq.${ctx.profile.id}`, { method: 'PATCH', body: { must_change_password: false }, prefer: 'return=minimal' });
  await audit(env, ctx.profile.id, 'auth.change_password', 'profile', ctx.profile.id, null, null, req);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Quản trị tài khoản (chỉ admin)
// ---------------------------------------------------------------------------
async function nextEmployeeCode(env: Env, role: Role): Promise<string> {
  const prefix = CODE_PREFIX[role];
  const rows = await svc<Array<{ employee_code: string }>>(env, `profiles?employee_code=ilike.${prefix}*&select=employee_code`);
  let max = 0;
  for (const r of rows || []) {
    const n = parseInt(r.employee_code.slice(prefix.length), 10);
    if (!Number.isNaN(n)) max = Math.max(max, n);
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

async function activeAdminCount(env: Env): Promise<number> {
  const rows = await svc<any[]>(env, 'profiles?role=eq.admin&is_active=eq.true&select=id');
  return rows?.length || 0;
}

export async function listUsers(req: Request, env: Env): Promise<Response> {
  await requireAuth(req, env, ['admin']);
  const rows = await svc<any[]>(
    env,
    'profiles?select=*,drivers(id,default_vehicle_id,vehicles:default_vehicle_id(plate_number))&order=created_at.desc'
  );
  return json({
    users: (rows || []).map((p) => ({
      id: p.id,
      employeeCode: p.employee_code || '',
      fullName: p.full_name,
      phone: p.phone || '',
      username: p.username || '',
      email: p.email || '',
      role: p.role,
      isActive: p.is_active,
      avatarUrl: p.avatar_url || undefined,
      driverId: p.drivers?.[0]?.id || null,
      assignedVehicle: p.drivers?.[0]?.vehicles?.plate_number || undefined,
      mustChangePassword: p.must_change_password,
      odooEmployeeId: p.odoo_employee_id,
      odooUserId: p.odoo_user_id,
      createdAt: p.created_at,
    })),
  });
}

interface CreateBody {
  fullName?: string;
  phone?: string;
  username?: string;
  email?: string;
  role?: Role;
  employeeCode?: string;
  password?: string;
  odooEmployeeId?: number | null;
  odooUserId?: number | null;
  defaultVehicleId?: string | null;
}

export async function createUser(req: Request, env: Env): Promise<Response> {
  const ctx = await requireAuth(req, env, ['admin']);
  const b = await readJson<CreateBody>(req);
  if (!b.fullName?.trim()) throw new HttpError(400, 'Thiếu họ tên.');
  if (!b.username?.trim() || !/^[a-z0-9._-]{3,32}$/i.test(b.username.trim())) throw new HttpError(400, 'Tên đăng nhập 3–32 ký tự (chữ, số, . _ -).');
  if (!b.role || !ROLES.includes(b.role)) throw new HttpError(400, 'Vai trò không hợp lệ.');

  const username = b.username.trim().toLowerCase();
  const email = (b.email?.trim() || `${username}@${env.EMAIL_DOMAIN || 'hachihi.local'}`).toLowerCase();
  const code = (b.employeeCode?.trim() || (await nextEmployeeCode(env, b.role))).toUpperCase();
  const tempPassword = b.password?.trim() || randomPassword(12);
  if (tempPassword.length < 8) throw new HttpError(400, 'Mật khẩu tối thiểu 8 ký tự.');

  const created = await gotrue(env, 'admin/users', {
    method: 'POST', admin: true,
    body: { email, password: tempPassword, email_confirm: true, user_metadata: { full_name: b.fullName.trim() } },
  });
  if (!created.ok) {
    const msg = String(created.data?.msg || created.data?.message || '');
    throw new HttpError(created.status === 422 ? 409 : 400, /already|registered/i.test(msg) ? 'Email này đã được dùng.' : `Không tạo được tài khoản: ${msg}`);
  }
  const uid = created.data.id as string;

  try {
    const branch = await getDefaultBranch(env);
    const profile = await svc<Profile[]>(env, 'profiles', {
      method: 'POST', prefer: 'return=representation',
      body: {
        id: uid, full_name: b.fullName.trim(), phone: b.phone?.trim() || null, role: b.role, email, username,
        employee_code: code, branch_id: branch.id, is_active: true, must_change_password: true,
        odoo_employee_id: b.odooEmployeeId ?? null, odoo_user_id: b.odooUserId ?? null,
      },
    });
    if (b.role === 'driver') {
      await svc(env, 'drivers', {
        method: 'POST', prefer: 'return=minimal',
        body: { profile_id: uid, employee_code: code, default_vehicle_id: b.defaultVehicleId || null },
      });
    }
    await audit(env, ctx.profile.id, 'user.create', 'profile', uid, null, { username, role: b.role, employee_code: code }, req);
    return json({ user: await profileDto(env, profile[0]), tempPassword }, 201);
  } catch (e) {
    await gotrue(env, `admin/users/${uid}`, { method: 'DELETE', admin: true }); // hoàn tác
    if (e instanceof HttpError && e.status === 409) throw new HttpError(409, 'Tên đăng nhập hoặc mã nhân viên đã tồn tại.');
    throw e;
  }
}

export async function updateUser(req: Request, env: Env, id: string): Promise<Response> {
  const ctx = await requireAuth(req, env, ['admin']);
  assertUuid(id);
  const b = await readJson<Partial<CreateBody> & { isActive?: boolean }>(req);
  const before = (await svc<Profile[]>(env, `profiles?id=eq.${id}&select=*`))?.[0];
  if (!before) throw new HttpError(404, 'Không tìm thấy tài khoản.');

  const patch: Record<string, unknown> = {};
  if (b.fullName !== undefined) patch.full_name = b.fullName.trim();
  if (b.phone !== undefined) patch.phone = b.phone.trim() || null;
  if (b.username !== undefined) {
    if (!/^[a-z0-9._-]{3,32}$/i.test(b.username.trim())) throw new HttpError(400, 'Tên đăng nhập không hợp lệ.');
    patch.username = b.username.trim().toLowerCase();
  }
  if (b.employeeCode !== undefined) patch.employee_code = b.employeeCode.trim().toUpperCase();
  if (b.odooEmployeeId !== undefined) patch.odoo_employee_id = b.odooEmployeeId;
  if (b.odooUserId !== undefined) patch.odoo_user_id = b.odooUserId;
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) throw new HttpError(400, 'Vai trò không hợp lệ.');
    patch.role = b.role;
  }
  if (b.isActive !== undefined) patch.is_active = b.isActive;

  // Không để mất admin cuối cùng
  const demoting = before.role === 'admin' && b.role !== undefined && b.role !== 'admin';
  const deactivating = before.role === 'admin' && b.isActive === false;
  if ((demoting || deactivating) && (await activeAdminCount(env)) <= 1) throw new HttpError(400, 'Không thể hạ quyền hoặc khóa admin cuối cùng.');
  if (id === ctx.profile.id && b.isActive === false) throw new HttpError(400, 'Bạn không thể tự khóa tài khoản của mình.');

  let after = before;
  if (Object.keys(patch).length) {
    const rows = await svc<Profile[]>(env, `profiles?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: patch });
    after = rows[0];
  }
  if (b.isActive !== undefined) {
    await gotrue(env, `admin/users/${id}`, { method: 'PUT', admin: true, body: { ban_duration: b.isActive ? 'none' : '876000h' } });
  }
  if (after.role === 'driver') {
    const d = await svc<any[]>(env, `drivers?profile_id=eq.${id}&select=id`);
    if (!d?.length) {
      await svc(env, 'drivers', { method: 'POST', prefer: 'return=minimal', body: { profile_id: id, employee_code: after.employee_code || id.slice(0, 8), default_vehicle_id: b.defaultVehicleId || null } });
    } else if (b.defaultVehicleId !== undefined) {
      await svc(env, `drivers?profile_id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: { default_vehicle_id: b.defaultVehicleId } });
    }
  }
  await audit(env, ctx.profile.id, 'user.update', 'profile', id, before, after, req);
  return json({ user: await profileDto(env, after) });
}

export async function resetPassword(req: Request, env: Env, id: string): Promise<Response> {
  const ctx = await requireAuth(req, env, ['admin']);
  assertUuid(id);
  const tempPassword = randomPassword(12);
  const r = await gotrue(env, `admin/users/${id}`, { method: 'PUT', admin: true, body: { password: tempPassword } });
  if (!r.ok) throw new HttpError(400, 'Không đặt lại được mật khẩu.');
  await svc(env, `profiles?id=eq.${id}`, { method: 'PATCH', body: { must_change_password: true }, prefer: 'return=minimal' });
  await audit(env, ctx.profile.id, 'user.reset_password', 'profile', id, null, null, req);
  return json({ tempPassword });
}

export type { AuthContext };
