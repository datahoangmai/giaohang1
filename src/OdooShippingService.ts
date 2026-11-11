import { OdooShippingOrder, OdooSyncResult } from '../../types/odoo';
import { DeliveryOrder } from '../../types/delivery';
import { CENTRAL_HUB } from '../../config/depot';
import { api } from '../api/ApiClient';
import { AuthService } from '../auth/AuthService';

/** Kết quả kiểm tra kết nối Odoo thật do Worker trả về */
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

/** Một dòng xem trước phiếu trong Odoo (chưa nạp vào hệ thống) */
export interface OdooPreviewItem {
  id: number; name: string; state: string; customer: string; sale: string; phone: string;
  toAddress: string; totalAmount: number; tracking: string; carrier: string; hasInstallation: boolean;
  scheduledDate: string; createDate: string; imported: boolean;
}
export interface OdooPreview {
  counts: Record<string, number>;
  total: number; offset: number; limit: number;
  items: OdooPreviewItem[];
}

type LiveInfo = {
  dbId: string;
  lat: number | null;
  lng: number | null;
  geocodeStatus: DeliveryOrder['geocodeStatus'];
  codAmount: number;
  codNeedsReview: boolean;
};

/**
 * Chỉ Worker mới nói chuyện với Odoo. Trình duyệt đọc phiếu giao từ cơ sở dữ liệu (RLS lọc theo vai trò),
 * không lưu dữ liệu khách hàng vào localStorage và không sinh dữ liệu/tọa độ giả.
 */
class OdooShippingServiceClass {
  /** Kiểm tra kết nối Odoo thật (Worker gọi Odoo, trả kết quả từng bước) */
  public async testConnection(): Promise<OdooHealth> {
    return api<OdooHealth>('/api/odoo/test');
  }

  /** Xem trước phiếu trong Odoo theo trạng thái (chỉ đọc, chưa ghi gì vào hệ thống) */
  public async previewOdoo(p: { states: string[]; q?: string; offset?: number; limit?: number }): Promise<OdooPreview> {
    const qs = new URLSearchParams();
    if (p.states.length) qs.set('states', p.states.join(','));
    if (p.q) qs.set('q', p.q);
    qs.set('offset', String(p.offset ?? 0));
    qs.set('limit', String(p.limit ?? 50));
    return api<OdooPreview>(`/api/odoo/preview?${qs.toString()}`);
  }

  /** Nạp vào hệ thống đúng các phiếu đã chọn (ids) hoặc toàn bộ phiếu theo trạng thái (states) */
  public async importFromOdoo(sel: { ids?: number[]; states?: string[] }): Promise<{ fetched: number; inserted: number; updated: number }> {
    const r = await api<{ stats: { fetched: number; inserted: number; updated: number } }>('/api/odoo/sync', { method: 'POST', body: sel });
    return r.stats;
  }

  public async fetchShippingOrders(
    _domain?: unknown,
    _unused?: unknown,
    opts: { sync?: boolean } = {}
  ): Promise<OdooSyncResult> {
    try {
      let note = '';
      if (opts.sync && AuthService.can('odoo.sync')) {
        const r = await api<{ stats: { fetched: number; inserted: number; updated: number; geocodePending: number } }>('/api/odoo/sync', { method: 'POST', body: {} });
        note = ` Vừa đồng bộ Odoo: ${r.stats.fetched} phiếu (${r.stats.inserted} mới, ${r.stats.updated} cập nhật)${r.stats.geocodePending ? ', còn địa chỉ chờ geocode' : ''}.`;
      }
      const res = await api<{ result: OdooShippingOrder[] }>('/api/odoo/shipping-orders');
      return {
        success: true,
        model: 'shipping.order',
        ordersCount: res.result.length,
        orders: [...res.result],
        timestamp: new Date().toISOString(),
        message: `Đã tải ${res.result.length} phiếu từ cơ sở dữ liệu.${note}`,
      };
    } catch (e) {
      const msg = (e as Error).message;
      return { success: false, model: 'shipping.order', ordersCount: 0, orders: [], timestamp: new Date().toISOString(), message: msg, error: msg };
    }
  }

  /** Chuyển phiếu Odoo (kèm trường _db_id, _lat... do Worker thêm) sang đơn giao nội bộ. */
  public mapOdooShippingToDeliveryOrder(item: OdooShippingOrder, live?: LiveInfo): DeliveryOrder {
    const raw = item as OdooShippingOrder & {
      _db_id?: string; _lat?: number | null; _lng?: number | null;
      _geocode_status?: DeliveryOrder['geocodeStatus']; _cod_amount?: number; _cod_needs_review?: boolean;
    };
    if (!live && raw._db_id) {
      live = {
        dbId: raw._db_id, lat: raw._lat ?? null, lng: raw._lng ?? null,
        geocodeStatus: raw._geocode_status, codAmount: raw._cod_amount ?? 0, codNeedsReview: !!raw._cod_needs_review,
      };
    }
    const customerName = Array.isArray(item.partner_shipping_id) ? item.partner_shipping_id[1] : '';
    const saleOrderName = Array.isArray(item.sale_id) ? item.sale_id[1] : '';
    const address = item.to_address || '';
    // Tọa độ chỉ do máy chủ geocode; chưa có thì để 0 và geocodeStatus cho biết trạng thái.
    const lat = live?.lat ?? 0;
    const lng = live?.lng ?? 0;
    const district = (/(Quận\s*\d+|Q\.?\s*\d+|Bình Thạnh|Phú Nhuận|Tân Bình|Tân Phú|Gò Vấp|Thủ Đức|Bình Tân)/i.exec(address)?.[0]) || '';
    const actualCod = live?.codAmount ?? 0;

    return {
      id: live ? live.dbId : String(item.id),
      odooPickingId: item.id,
      odooName: item.name,
      originDocument: saleOrderName,
      customerName,
      customerPhone: item.phone || '',
      deliveryAddress: address,
      district,
      lat,
      lng,
      codAmount: actualCod,
      codStatus: actualCod > 0 ? 'pending_collection' : 'not_required',
      weightKg: 0,
      packageCount: 1,
      notes: item.note || '',
      status: item.state === 'done' ? 'delivered' : item.state === 'in_delivery' ? 'in_transit' : 'assigned',
      syncStatus: 'SYNCED',
      scheduledTimeWindow: item.scheduled_date ? item.scheduled_date.slice(11, 16) : '',
      items: [],
      shippingOrderId: item.id,
      shippingOrderName: item.name,
      trackingCode: item.x_mvd || '',
      carrierService: item.x_dvvt || '',
      hasInstallation: Boolean(item.x_hotrolapdat),
      shippingFee: item.amount_fee || item.x_cpvc || 0,
      extraAmount: item.extra_amount || 0,
      totalShippingCost: item.x_tongchiphi || item.amount_fee || 0,
      salesEmployee: Array.isArray(item.x_nvkdso) ? item.x_nvkdso[1] : undefined,
      deliveryShipper: Array.isArray(item.x_shipper) ? item.x_shipper[1] : undefined,
      shippingState: item.state,
      fromAddress: item.from_address || CENTRAL_HUB.address,
      toAddress: item.to_address,
      internalNote: item.internal_note,
      doneDate: item.done_date,
      dbOrderId: live?.dbId,
      geocodeStatus: live?.geocodeStatus,
      codNeedsReview: live?.codNeedsReview,
    };
  }
}

export const OdooShippingService = new OdooShippingServiceClass();
