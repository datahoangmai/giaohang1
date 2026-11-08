import { AppUser, Permission, ROLE_PERMISSIONS, UserRole } from '../../types/auth';
import { DeliveryOrder } from '../../types/delivery';
import { api, ApiError, isLiveConfigured, rawLogin, SessionStore } from '../api/ApiClient';

const CODE_PREFIX: Record<UserRole, string> = { admin: 'HCH-ADM', dispatcher: 'HCH-DP', driver: 'HCH-TX', sale: 'HCH-KD' };

type Result<T = unknown> = { success: boolean; message?: string } & T;

class AuthServiceClass {
  private users: AppUser[] = [];

  public isLive() {
    return isLiveConfigured;
  }

  public getCurrentUser(): AppUser | null {
    return SessionStore.get()?.user ?? null;
  }

  public subscribe(fn: (u: AppUser | null) => void) {
    return SessionStore.subscribe((s) => fn(s?.user ?? null));
  }

  public getUsers(): AppUser[] {
    return [...this.users];
  }

  public can(permission: Permission): boolean {
    const u = this.getCurrentUser();
    return !!u && ROLE_PERMISSIONS[u.role].includes(permission);
  }

  // -------------------------------------------------------------------------
  public async login(identifier: string, password?: string): Promise<Result<{ user?: AppUser }>> {
    const id = identifier.trim();
    if (!password) return { success: false, message: 'Vui lòng nhập mật khẩu.' };
    try {
      const s = await rawLogin(id, password);
      SessionStore.set(s);
      return { success: true, user: s.user };
    } catch (e) {
      return { success: false, message: (e as Error).message };
    }
  }

  public logout() {
    SessionStore.set(null);
  }

  public async changePassword(newPassword: string): Promise<Result> {
    try {
      await api('/api/auth/change-password', { body: { newPassword } });
      const s = SessionStore.get();
      if (s) SessionStore.patchUser({ ...s.user, mustChangePassword: false });
      return { success: true };
    } catch (e) {
      return { success: false, message: (e as Error).message };
    }
  }

  // -------------------------------------------------------------------------
  // Quản trị tài khoản (admin) — gọi Worker, server kiểm tra quyền
  // -------------------------------------------------------------------------
  public async loadUsers(): Promise<AppUser[]> {
    const r = await api<{ users: AppUser[] }>('/api/admin/users');
    this.users = r.users;
    return this.getUsers();
  }

  public generateNextEmployeeCode(role: UserRole = 'driver'): string {
    const prefix = CODE_PREFIX[role];
    let max = 0;
    for (const u of this.users) {
      if (u.employeeCode.toUpperCase().startsWith(prefix)) {
        const n = parseInt(u.employeeCode.slice(prefix.length), 10);
        if (!Number.isNaN(n)) max = Math.max(max, n);
      }
    }
    return `${prefix}${String(max + 1).padStart(2, '0')}`;
  }

  public async createUser(
    input: Omit<AppUser, 'id' | 'createdAt'>
  ): Promise<Result<{ user?: AppUser; tempPassword?: string }>> {
    try {
      const r = await api<{ user: AppUser; tempPassword: string }>('/api/admin/users', {
        body: {
          fullName: input.fullName, phone: input.phone, username: input.username, email: input.email,
          role: input.role, employeeCode: input.employeeCode, password: input.password || undefined,
          odooEmployeeId: input.odooEmployeeId ?? null,
        },
      });
      return { success: true, user: r.user, tempPassword: r.tempPassword };
    } catch (e) {
      return { success: false, message: (e as Error).message };
    }
  }

  public async updateUser(userId: string, updates: Partial<AppUser>): Promise<boolean> {
    try {
      await api(`/api/admin/users/${userId}`, { method: 'PATCH', body: updates });
      return true;
    } catch (e) {
      throw e instanceof ApiError ? e : new Error('Không cập nhật được tài khoản.');
    }
  }

  /** "Xóa" = khóa tài khoản (giữ lịch sử giao hàng và nhật ký) */
  public async deleteUser(userId: string): Promise<Result> {
    const me = this.getCurrentUser();
    if (me?.id === userId) return { success: false, message: 'Bạn không thể tự khóa tài khoản đang đăng nhập.' };
    try {
      await api(`/api/admin/users/${userId}`, { method: 'PATCH', body: { isActive: false } });
      return { success: true };
    } catch (e) {
      return { success: false, message: (e as Error).message };
    }
  }

  public async resetPassword(userId: string): Promise<Result<{ tempPassword?: string }>> {
    try {
      const r = await api<{ tempPassword: string }>(`/api/admin/users/${userId}/reset-password`, { method: 'POST', body: {} });
      return { success: true, tempPassword: r.tempPassword };
    } catch (e) {
      return { success: false, message: (e as Error).message };
    }
  }

  // -------------------------------------------------------------------------
  /**
   * Kiểm tra trên giao diện (chỉ để ẩn/hiện nút — server mới là nơi chặn thật):
   *  - admin, điều phối: được xác nhận
   *  - sale: chỉ xem
   *  - giao nhận: chỉ đơn của mình (RLS chỉ trả tuyến của họ)
   */
  public canConfirmOrder(order: DeliveryOrder, activeRouteDriverName?: string): { allowed: boolean; reason?: string } {
    const u = this.getCurrentUser();
    if (!u) return { allowed: false, reason: 'Vui lòng đăng nhập để thực hiện xác nhận đơn.' };
    if (u.role === 'admin' || u.role === 'dispatcher') return { allowed: true };
    if (u.role === 'sale') return { allowed: false, reason: 'Tài khoản Sale chỉ được xem, không xác nhận giao hàng.' };

    // RLS chỉ trả tuyến của chính giao nhận nên mặc định được phép; server mới là nơi chặn thật.
    return { allowed: true };
  }
}

export const AuthService = new AuthServiceClass();
