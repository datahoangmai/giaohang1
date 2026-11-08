/**
 * Odoo 14 Model: shipping.order
 * Based on shipping.order_ir.model.fields_54b215b4.csv
 */

export type OdooMany2One = [number, string] | false;

export type OdooShippingState = 'draft' | 'ready' | 'assigned' | 'in_delivery' | 'done' | 'cancel';

export type OdooCarrierType = 'noi_bo' | 'ahamove' | 'grab' | 'ghn' | 'viettel' | 'other';

export interface OdooShippingOrder {
  id: number;
  name: string; // Tên đơn giao hàng (e.g., "SH/2026/0421")
  display_name?: string; // Tên hiển thị
  sale_id: OdooMany2One; // Đơn bán hàng (sale.order)
  partner_shipping_id: OdooMany2One; // To Partner (res.partner - Khách nhận)
  partner_source_id: OdooMany2One; // From Partner (res.partner - Kho xuất)
  phone?: string; // Điện thoại người nhận
  from_address?: string; // From Address
  to_address?: string; // To Address (Địa chỉ giao hàng)
  state: OdooShippingState; // Trạng thái ('draft' | 'ready' | 'assigned' | 'in_delivery' | 'done' | 'cancel')
  distance?: number; // Distance (Km)
  scheduled_date?: string; // Ngày dự kiến giao
  done_date?: string; // Done Date
  total_amount: number; // Tổng số tiền (Tiền COD / giá trị đơn)
  amount_fee?: number; // Amount Fee (Phí vận chuyển)
  extra_amount?: number; // Extra Amount
  extra_amount_id?: OdooMany2One; // Shipping Extra Amount
  shipper_id?: OdooMany2One; // Shipper (res.users)
  user_id?: OdooMany2One; // Người phụ trách (res.users)
  team_id?: OdooMany2One; // sales Team (crm.team)
  company_id?: OdooMany2One; // Công ty (res.company)
  currency_id?: OdooMany2One; // Tiền tệ (res.currency)
  service_id?: OdooMany2One; // Shipping Service
  service_type?: string; // Service Type
  note?: string; // Ghi chú khách hàng
  internal_note?: string; // Ghi chú nội bộ
  
  // Custom fields (Trường tùy biến) from CSV:
  x_mvd?: string; // Mã vận đơn (e.g., "HCH-VD-8891")
  x_dvvt?: OdooCarrierType; // Đơn vị vận chuyển ('noi_bo' | 'ahamove' | 'grab'...)
  x_hotrolapdat?: boolean; // Có hỗ trợ lắp đặt (true/false)
  x_cpvc?: number; // Chi phí vận chuyển
  x_tongchiphi?: number; // Tổng chi phí
  x_nvkdso?: OdooMany2One; // Nhân viên KD trên SO (hr.employee)
  x_shipper?: OdooMany2One; // Nhân viên giao nhận (hr.employee)
  x_team_id?: OdooMany2One; // Đội bán hàng (crm.team)
  
  // Standard timestamps
  create_date?: string;
  create_uid?: OdooMany2One;
  write_date?: string;
  write_uid?: OdooMany2One;
}

export interface OdooConnectionConfig {
  url: string;
  db: string;
  username: string;
  apiKey: string;
  model: string; // 'shipping.order'
  autoSyncIntervalMinutes?: number;
  useProxy?: boolean;
}

export interface OdooSyncResult {
  success: boolean;
  model: string;
  ordersCount: number;
  orders: OdooShippingOrder[];
  timestamp: string;
  message?: string;
  error?: string;
}
