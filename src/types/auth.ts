export type UserRole = 'admin' | 'dispatcher' | 'driver' | 'sale';

export interface AppUser {
  id: string;
  employeeCode: string; // Mã nhân viên (HCH-ADM01, HCH-DP01, HCH-TX01, HCH-KD01)
  fullName: string;
  phone: string;
  username: string;
  email?: string;
  role: UserRole;
  avatarUrl?: string;
  assignedVehicle?: string; // Biển số xe mặc định (tài xế)
  driverId?: string | null; // drivers.id (chỉ tài xế)
  isActive?: boolean;
  mustChangePassword?: boolean;
  odooEmployeeId?: number | null;
  createdAt?: string;
  /** Chỉ dùng khi admin nhập mật khẩu lúc tạo; KHÔNG bao giờ được lưu hay trả về từ server */
  password?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch giây
  user: AppUser;
}

export type Permission =
  | 'orders.view_all'
  | 'orders.edit'
  | 'route.manage'
  | 'stop.confirm'
  | 'odoo.sync'
  | 'odoo.config'
  | 'users.manage'
  | 'audit.view'
  | 'fleet.view';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: ['orders.view_all', 'orders.edit', 'route.manage', 'stop.confirm', 'odoo.sync', 'odoo.config', 'users.manage', 'audit.view', 'fleet.view'],
  dispatcher: ['orders.view_all', 'orders.edit', 'route.manage', 'stop.confirm', 'odoo.sync', 'audit.view', 'fleet.view'],
  driver: ['stop.confirm', 'fleet.view'],
  sale: ['fleet.view'],
};

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin (Toàn quyền)',
  dispatcher: 'Điều phối viên',
  driver: 'Giao nhận',
  sale: 'Sale (Chỉ xem)',
};
