
export type VehicleType = 'motorbike' | 'car_500kg' | 'van_1000kg' | 'truck_2000kg';

export type OrderStatus = 'unassigned' | 'assigned' | 'in_transit' | 'delivered' | 'failed' | 'cancelled';

export type StopStatus = 'pending' | 'arrived' | 'completed' | 'failed' | 'skipped';

export type DeliveryEventType =
  | 'ROUTE_ASSIGNED'
  | 'ROUTE_STARTED'
  | 'ARRIVED_STOP'
  | 'DELIVERED'
  | 'FAILED_ATTEMPT'
  | 'NOTE_ADDED'
  | 'PHOTO_ADDED'
  | 'CASH_COLLECTED';

export type CODStatus = 'not_required' | 'pending_collection' | 'driver_collected' | 'reconciled_with_accountant';

export type OdooSyncStatus = 'PENDING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

export interface DriverProfile {
  id: string;
  name: string;
  phone: string;
  employeeCode: string;
  avatarUrl: string;
  currentStatus: 'offline' | 'idle' | 'delivering';
  assignedVehiclePlate: string;
  vehicleType: VehicleType;
  codBalanceHolding: number;
  currentLat: number;
  currentLng: number;
  rating: number;
  completedStopsToday: number;
}

export interface DeliveryOrder {
  id: string;
  odooPickingId: number;
  odooName: string; // e.g. "SH/2026/0421"
  originDocument: string; // e.g. "SO2026-0891"
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  district: string;
  lat: number;
  lng: number;
  codAmount: number;
  codStatus: CODStatus;
  weightKg: number;
  packageCount: number;
  notes: string;
  status: OrderStatus;
  syncStatus: OdooSyncStatus;
  scheduledTimeWindow?: string;
  items: Array<{ name: string; quantity: number; unitPrice: number }>;

  // Direct mapping from Odoo model 'shipping.order' (from CSV)
  shippingOrderId?: number;
  shippingOrderName?: string;
  trackingCode?: string; // x_mvd: Mã vận đơn
  carrierService?: string; // x_dvvt: Đơn vị vận chuyển (noi_bo, ahamove, grab...)
  hasInstallation?: boolean; // x_hotrolapdat: Có hỗ trợ lắp đặt
  shippingFee?: number; // amount_fee hoặc x_cpvc
  extraAmount?: number; // extra_amount
  totalShippingCost?: number; // x_tongchiphi
  salesEmployee?: string; // x_nvkdso
  deliveryShipper?: string; // x_shipper hoặc shipper_id
  shippingState?: 'draft' | 'ready' | 'assigned' | 'in_delivery' | 'done' | 'cancel'; // state
  fromAddress?: string; // from_address
  toAddress?: string; // to_address
  internalNote?: string; // internal_note
  doneDate?: string; // done_date

  // Chế độ thật (từ Supabase)
  dbOrderId?: string; // orders.id (uuid)
  geocodeStatus?: 'pending' | 'ok' | 'low_confidence' | 'failed' | 'manual';
  codNeedsReview?: boolean; // tín hiệu COD mâu thuẫn, điều phối cần xác nhận
}

export interface RouteStop {
  id: string;
  routeId: string;
  orderId: string;
  order: DeliveryOrder;
  sequenceOrder: number;
  status: StopStatus;
  estimatedArrival?: string;
  actualArrival?: string;
  completedAt?: string;
  failureReasonCode?: string;
  failureNote?: string;
  recipientSignedName?: string;
  signatureDataUrl?: string;
  podPhotoUrl?: string;
  podPhotoSizeKb?: number;
}

export interface DriverLocationLog {
  lat: number;
  lng: number;
  accuracy: number;
  speedKmh?: number | null;
  heading?: number | null;
  timestamp: string;
  source: 'gps';
}

export interface DeliveryRoute {
  id: string;
  code: string;
  driverId: string;
  vehiclePlate: string;
  vehicleType: VehicleType;
  routeDate: string;
  status: 'draft' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  totalDistanceKm: number;
  estimatedDurationMin: number;
  totalCodExpected: number;
  totalCodCollected: number;
  startedAt?: string;
  completedAt?: string;
  stops: RouteStop[];
  currentDriverLocation?: DriverLocationLog;
  locationHistory?: DriverLocationLog[];
  lastLocationSyncAt?: string;
}

export interface DeliveryEvent {
  id: string;
  stopId: string;
  eventType: DeliveryEventType;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  clientEventId: string;
  timestamp: string;
  note?: string;
  metadata?: Record<string, unknown>;
}

export interface OfflineActionQueueItem {
  clientEventId: string;
  stopId: string;
  eventType: DeliveryEventType;
  latitude: number;
  longitude: number;
  timestamp: string;
  note?: string;
  recipientName?: string;
  signatureDataUrl?: string;
  photoDataUrl?: string;
  photoSizeKb?: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  errorMessage?: string;
}
