import type { DeliveryRoute, DriverProfile } from '../types/delivery';
import { CENTRAL_HUB } from './depot';

/** Trạng thái rỗng khi chưa có tuyến — không chứa dữ liệu mẫu. */
export const EMPTY_ROUTE: DeliveryRoute = {
  id: 'none',
  code: '—',
  driverId: 'none',
  vehiclePlate: '',
  vehicleType: 'motorbike',
  routeDate: '',
  status: 'draft',
  totalDistanceKm: 0,
  estimatedDurationMin: 0,
  totalCodExpected: 0,
  totalCodCollected: 0,
  stops: [],
  locationHistory: [],
  currentDriverLocation: undefined,
};

export const EMPTY_DRIVER: DriverProfile = {
  id: 'none',
  name: 'Chưa có tuyến',
  phone: '',
  employeeCode: '',
  avatarUrl: '',
  currentStatus: 'idle',
  assignedVehiclePlate: '',
  vehicleType: 'motorbike',
  codBalanceHolding: 0,
  currentLat: CENTRAL_HUB.lat,
  currentLng: CENTRAL_HUB.lng,
  rating: 0,
  completedStopsToday: 0,
};
