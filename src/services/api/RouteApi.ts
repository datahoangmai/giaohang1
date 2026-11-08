import { DeliveryOrder, DeliveryRoute, DriverLocationLog, DriverProfile, RouteStop, StopStatus, VehicleType } from '../../types/delivery';
import { api, db } from './ApiClient';
import { OdooShippingService } from '../odoo/OdooShippingService';
import { CENTRAL_HUB } from '../../config/depot';

export interface LiveRoute {
  route: DeliveryRoute;
  driver: DriverProfile;
  geometry: Array<[number, number]> | null;
}

const ROUTE_SELECT =
  'id,route_code,driver_id,vehicle_id,planned_date,status,planned_distance_km,actual_start_at,actual_end_at,route_geometry,' +
  'drivers(id,employee_code,profiles(full_name,phone)),vehicles(plate_number,vehicle_type),' +
  'route_stops(id,order_id,sequence_no,status,eta_at,arrived_at,completed_at,failure_reason,note,late_risk,' +
  'orders(id,order_number,customer_name,customer_phone,delivery_address,delivery_note,latitude,longitude,cod_amount,cod_needs_review,geocode_status,odoo_raw,has_installation,weight_kg,carrier_service,status))';

const VEHICLE_TYPES: VehicleType[] = ['motorbike', 'car_500kg', 'van_1000kg', 'truck_2000kg'];

function mapOrder(o: any): DeliveryOrder {
  const lat = o.latitude == null ? null : Number(o.latitude);
  const lng = o.longitude == null ? null : Number(o.longitude);
  const cod = Number(o.cod_amount) || 0;
  if (o.odoo_raw) {
    return OdooShippingService.mapOdooShippingToDeliveryOrder(o.odoo_raw, {
      dbId: o.id, lat, lng, geocodeStatus: o.geocode_status, codAmount: cod, codNeedsReview: !!o.cod_needs_review,
    });
  }
  return {
    id: o.id, dbOrderId: o.id, odooPickingId: 0, odooName: o.order_number, originDocument: '',
    customerName: o.customer_name, customerPhone: o.customer_phone || '', deliveryAddress: o.delivery_address,
    district: '', lat: lat ?? 0, lng: lng ?? 0, codAmount: cod, codStatus: cod > 0 ? 'pending_collection' : 'not_required',
    weightKg: Number(o.weight_kg) || 2, packageCount: 1, notes: o.delivery_note || '', status: 'assigned', syncStatus: 'SYNCED',
    items: [], geocodeStatus: o.geocode_status, codNeedsReview: !!o.cod_needs_review,
  };
}

function mapRoute(r: any): LiveRoute {
  const stops: RouteStop[] = (r.route_stops || [])
    .slice()
    .sort((a: any, b: any) => a.sequence_no - b.sequence_no)
    .map((s: any) => ({
      id: s.id,
      routeId: r.id,
      orderId: s.order_id,
      order: mapOrder(s.orders),
      sequenceOrder: s.sequence_no,
      status: s.status as StopStatus,
      estimatedArrival: s.eta_at || undefined,
      actualArrival: s.arrived_at || undefined,
      completedAt: s.completed_at || undefined,
      failureReasonCode: s.failure_reason || undefined,
      failureNote: s.note || undefined,
    }));

  const collected = stops.filter((s) => s.status === 'completed').reduce((t, s) => t + s.order.codAmount, 0);
  const lastEta = stops.length ? Date.parse(stops[stops.length - 1].estimatedArrival || '') : NaN;
  const start = r.actual_start_at ? Date.parse(r.actual_start_at) : NaN;
  const vType = (VEHICLE_TYPES as string[]).includes(r.vehicles?.vehicle_type) ? (r.vehicles.vehicle_type as VehicleType) : 'motorbike';
  const plate = r.vehicles?.plate_number || '';

  const route: DeliveryRoute = {
    id: r.id,
    code: r.route_code,
    driverId: r.driver_id,
    vehiclePlate: plate,
    vehicleType: vType,
    routeDate: r.planned_date,
    status: r.status,
    totalDistanceKm: Number(r.planned_distance_km) || 0,
    estimatedDurationMin: !Number.isNaN(lastEta) && !Number.isNaN(start) ? Math.max(0, Math.round((lastEta - start) / 60000)) : 0,
    totalCodExpected: stops.reduce((t, s) => t + s.order.codAmount, 0),
    totalCodCollected: collected,
    startedAt: r.actual_start_at || undefined,
    completedAt: r.actual_end_at || undefined,
    stops,
  };

  const driver: DriverProfile = {
    id: r.driver_id,
    name: r.drivers?.profiles?.full_name || 'Tài xế',
    phone: r.drivers?.profiles?.phone || '',
    employeeCode: r.drivers?.employee_code || '',
    avatarUrl: '',
    currentStatus: r.status === 'in_progress' ? 'delivering' : 'idle',
    assignedVehiclePlate: plate,
    vehicleType: vType,
    codBalanceHolding: collected,
    currentLat: CENTRAL_HUB.lat,
    currentLng: CENTRAL_HUB.lng,
    rating: 5,
    completedStopsToday: stops.filter((s) => s.status === 'completed').length,
  };
  return { route, driver, geometry: r.route_geometry || null };
}

export const RouteApi = {
  /** Các tuyến người dùng được phép thấy (RLS ở server tự lọc theo vai trò) */
  async loadActiveRoutes(): Promise<LiveRoute[]> {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
    const rows = await db<any[]>(
      `delivery_routes?select=${encodeURIComponent(ROUTE_SELECT).replace(/%2C/g, ',').replace(/%28/g, '(').replace(/%29/g, ')')}` +
        `&status=in.(assigned,in_progress,completed)&planned_date=gte.${since}&order=planned_date.desc,route_code.asc`
    );
    return (rows || []).map(mapRoute);
  },

  async loadLocations(routeId: string, limit = 25): Promise<DriverLocationLog[]> {
    const rows = await db<any[]>(
      `driver_locations?route_id=eq.${routeId}&select=latitude,longitude,accuracy_m,speed_kmh,heading,recorded_at&order=recorded_at.desc&limit=${limit}`
    );
    return (rows || [])
      .reverse()
      .map((l) => ({
        lat: Number(l.latitude), lng: Number(l.longitude), accuracy: Number(l.accuracy_m) || 0,
        speedKmh: l.speed_kmh == null ? null : Number(l.speed_kmh), heading: l.heading == null ? null : Number(l.heading),
        timestamp: l.recorded_at, source: 'gps' as const,
      }));
  },

  async loadOpenAlerts(): Promise<Array<{ id: string; type: string; severity: string; message: string; created_at: string; route_id: string | null }>> {
    return db(`alerts?resolved_at=is.null&select=id,type,severity,message,created_at,route_id&order=created_at.desc&limit=30`);
  },

  startRoute: (routeId: string) => api(`/api/routes/${routeId}/start`, { method: 'POST', body: {} }),

  postStopEvent: (
    stopId: string,
    body: {
      eventType: 'ARRIVED_STOP' | 'DELIVERED' | 'FAILED_ATTEMPT';
      clientEventId: string;
      lat?: number;
      lng?: number;
      accuracy?: number;
      note?: string;
      recipientName?: string;
      failureReason?: string;
      timestamp?: string;
    }
  ) => api<{ ok: boolean; duplicate?: boolean; codRecorded?: boolean }>(`/api/stops/${stopId}/events`, { method: 'POST', body }),

  resolveAlert: (id: string) => db(`alerts?id=eq.${id}`, { method: 'PATCH', body: { resolved_at: new Date().toISOString() }, prefer: 'return=minimal' }),
};
