import type { AppUser, AuthSession } from '../../types/auth';

const env = ((import.meta as any).env || {}) as Record<string, any>;

/** Để trống = API cùng địa chỉ với web (Worker gộp). Chỉ điền khi API nằm ở địa chỉ khác. */
export const WORKER_URL: string = String(env.VITE_WORKER_URL || env.VITE_CLOUDFLARE_WORKER_URL || '').replace(/\/$/, '');
export const SUPABASE_URL: string = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
export const SUPABASE_ANON_KEY: string = String(env.VITE_SUPABASE_ANON_KEY || '');

/** Danh sách biến VITE_* đang thiếu (để báo lỗi rõ ràng) */
export const missingConfig: string[] = [
  ...(SUPABASE_URL ? [] : ['VITE_SUPABASE_URL']),
  ...(SUPABASE_ANON_KEY ? [] : ['VITE_SUPABASE_ANON_KEY']),
];

export const isLiveConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const SESSION_KEY = 'hachihi_session_v4';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let session: AuthSession | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<(s: AuthSession | null) => void>();

function load() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    session = raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    session = null;
  }
}
load();

export const SessionStore = {
  get: () => session,
  set(s: AuthSession | null) {
    session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* bỏ qua */
    }
    listeners.forEach((fn) => fn(s));
  },
  patchUser(user: AppUser) {
    if (session) SessionStore.set({ ...session, user });
  },
  subscribe(fn: (s: AuthSession | null) => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

async function parse(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function refreshSession(): Promise<boolean> {
  if (!session) return false;
  if (!refreshing) {
    const rt = session.refreshToken;
    refreshing = (async () => {
      try {
        const res = await fetch(`${WORKER_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (!res.ok) throw new Error('refresh failed');
        SessionStore.set((await res.json()) as AuthSession);
        return true;
      } catch {
        SessionStore.set(null);
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

async function ensureFresh() {
  if (session && session.expiresAt - 60 < Math.floor(Date.now() / 1000)) await refreshSession();
}

/** Gọi Worker API kèm JWT; tự làm mới token khi gần hết hạn hoặc gặp 401 */
export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  if (!isLiveConfigured) throw new ApiError(0, 'Chưa cấu hình VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.');
  await ensureFresh();
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: init.method || (init.body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401 && retry && session && (await refreshSession())) return api<T>(path, init, false);
  const data = await parse(res);
  if (!res.ok) throw new ApiError(res.status, data?.error || `Lỗi ${res.status}`);
  return data as T;
}

/** Truy vấn thẳng PostgREST bằng JWT người dùng — RLS ở server quyết định thấy gì */
export async function db<T = any>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}, retry = true): Promise<T> {
  if (!isLiveConfigured) throw new ApiError(0, 'Chưa cấu hình Supabase.');
  await ensureFresh();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.accessToken || SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401 && retry && session && (await refreshSession())) return db<T>(path, init, false);
  const data = res.status === 204 ? null : await parse(res);
  if (!res.ok) throw new ApiError(res.status, data?.message || `Lỗi ${res.status}`);
  return data as T;
}

export async function rawLogin(identifier: string, password: string): Promise<AuthSession> {
  const res = await fetch(`${WORKER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const data = await parse(res);
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Đăng nhập không thành công.');
  return data as AuthSession;
}
