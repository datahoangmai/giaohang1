/**
 * Supabase Database Types
 * Based on deliver_tables_341ba9e8.txt and HACHIHI DELIVERY Odoo Specification V1.1
 */

export type AppRole = 'super_admin' | 'manager' | 'dispatcher' | 'driver' | 'accountant';

export type DeliveryOrderStatus = 'draft' | 'pending' | 'assigned' | 'in_transit' | 'delivered' | 'failed' | 'cancelled';

export type StopStatus = 'pending' | 'arrived' | 'completed' | 'failed' | 'skipped';

export type RouteStatus = 'draft' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';

export type SyncJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';

export type ReconciliationStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'reconciled';

export type CodTransactionType = 'collection' | 'submission' | 'adjustment' | 'refund';

export interface SupabaseBranch {
  id: string; // uuid
  code: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupabaseProfile {
  id: string; // uuid
  full_name: string;
  phone: string | null;
  role: AppRole;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupabaseDriver {
  id: string; // uuid
  profile_id: string; // uuid -> profiles.id
  employee_code: string; // e.g. 'HCH-TX01'
  license_number: string | null;
  license_expiry: string | null;
  status: 'active' | 'inactive' | 'suspended';
  note: string | null;
  created_at: string;
  updated_at: string;
  // Joined relation helper
  profile?: SupabaseProfile;
}

export interface SupabaseVehicle {
  id: string; // uuid
  branch_id: string; // uuid
  plate_number: string;
  vehicle_type: string | null; // 'motorbike' | 'car_500kg' | 'van_1000kg'
  brand: string | null;
  model: string | null;
  max_weight_kg: number | null;
  max_volume_m3: number | null;
  status: 'active' | 'maintenance' | 'inactive';
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupabaseOrder {
  id: string; // uuid
  branch_id: string; // uuid
  order_number: string; // Odoo name e.g. 'SH/2026/0421'
  source_system: string | null; // 'odoo'
  source_model: string | null; // 'shipping.order'
  source_record_id: string | null; // Odoo shipping.order ID e.g. '10421'
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  delivery_address: string;
  delivery_note: string | null;
  latitude: number | null;
  longitude: number | null;
  status: DeliveryOrderStatus;
  subtotal: number;
  shipping_fee: number;
  cod_amount: number;
  currency: string; // 'VND'
  requested_delivery_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupabaseOrderItem {
  id: string; // uuid
  order_id: string; // uuid
  product_code: string | null;
  product_name: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  line_total: number;
  created_at: string;
}

export interface SupabaseDeliveryRoute {
  id: string; // uuid
  branch_id: string; // uuid
  route_code: string;
  driver_id: string | null; // uuid -> drivers.id
  vehicle_id: string | null; // uuid -> vehicles.id
  planned_date: string;
  status: RouteStatus;
  planned_start_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  planned_distance_km: number | null;
  actual_distance_km: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupabaseRouteStop {
  id: string; // uuid
  route_id: string; // uuid
  order_id: string; // uuid
  sequence_no: number; // integer (1, 2, 3...)
  status: StopStatus;
  planned_arrival_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  latitude: number | null;
  longitude: number | null;
  failure_reason: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  // Joined relation helper
  order?: SupabaseOrder;
}

export interface SupabaseDeliveryEvent {
  id: string; // uuid
  idempotency_key: string; // uuid
  order_id: string; // uuid
  route_id: string | null; // uuid
  route_stop_id: string | null; // uuid
  actor_id: string | null; // uuid
  event_type: string; // 'ROUTE_ASSIGNED' | 'ROUTE_STARTED' | 'ARRIVED_STOP' | 'DELIVERED' | 'FAILED_ATTEMPT'
  event_time: string;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SupabaseDeliveryPhoto {
  id: string; // uuid
  order_id: string; // uuid
  route_stop_id: string | null; // uuid
  uploaded_by: string | null; // uuid
  proof_type: string; // 'signature' | 'goods_photo' | 'receipt'
  bucket_name: string; // 'delivery-proof'
  storage_path: string;
  file_name: string | null;
  mime_type: string;
  file_size_bytes: number | null;
  checksum_sha256: string | null;
  captured_at: string | null;
  uploaded_at: string;
  note: string | null;
  created_at: string;
}

export interface SupabaseOdooSyncJob {
  id: string; // uuid
  idempotency_key: string;
  source_system: string; // 'odoo'
  source_model: string; // 'shipping.order'
  source_record_id: string; // Odoo ID
  operation: string; // 'UPSERT_ORDER' | 'UPDATE_STATUS'
  status: SyncJobStatus;
  attempts: number;
  max_attempts: number;
  next_retry_at: string | null;
  locked_at: string | null;
  completed_at: string | null;
  payload: Record<string, unknown>;
  response_data: Record<string, unknown> | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupabaseDriverLocation {
  id: string; // uuid
  driver_id: string; // uuid
  route_id: string | null; // uuid
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  speed_kmh: number | null;
  heading: number | null;
  recorded_at: string;
  received_at: string;
  source: string; // 'pwa'
  created_at: string;
}

export interface SupabaseCodReconciliation {
  id: string; // uuid
  reconciliation_code: string;
  branch_id: string; // uuid
  driver_id: string; // uuid
  period_start: string;
  period_end: string;
  expected_amount: number;
  declared_amount: number;
  difference_amount: number | null;
  status: ReconciliationStatus;
  submitted_by: string | null;
  reviewed_by: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupabaseCodTransaction {
  id: string; // uuid
  idempotency_key: string;
  order_id: string;
  driver_id: string;
  route_id: string | null;
  reconciliation_id: string | null;
  transaction_type: CodTransactionType;
  amount: number;
  currency: string;
  payment_method: string | null;
  reference_number: string | null;
  description: string;
  created_by: string | null;
  transaction_time: string;
  created_at: string;
}
