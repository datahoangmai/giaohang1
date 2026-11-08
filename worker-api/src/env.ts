export interface Env {
  ENVIRONMENT?: string;
  /** Danh sách origin được phép gọi API, ngăn cách bằng dấu phẩy. Ví dụ: https://app.hachihi.com */
  ALLOWED_ORIGINS: string;

  ODOO_URL: string;
  ODOO_DB: string;
  /** UID của tài khoản Odoo dành riêng cho tích hợp (không dùng tài khoản admin) */
  ODOO_UID: string;
  ODOO_API_KEY: string;
  /** Nếu Odoo cần gọi method riêng để chuyển sang "done" (ví dụ action_done), điền tên method */
  ODOO_DONE_METHOD?: string;

  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;

  /** goong | google | none */
  GEOCODE_PROVIDER?: string;
  GEOCODE_API_KEY?: string;

  /** Máy chủ OSRM (mặc định: demo công cộng — chỉ để thử, production nên tự host) */
  OSRM_URL?: string;
  DEFAULT_BRANCH_ID?: string;
  /** Domain email nội bộ cho tài khoản không có email thật */
  EMAIL_DOMAIN?: string;
  /** Biên độ phút cho giờ hẹn (windowEnd = giờ hẹn + biên độ). Mặc định 60 */
  WINDOW_TOLERANCE_MIN?: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
}
