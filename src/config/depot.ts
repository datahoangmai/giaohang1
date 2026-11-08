/**
 * Kho / điểm xuất phát — cấu hình thật qua biến môi trường (không phải dữ liệu giả).
 * Tọa độ mặc định chỉ để căn giữa bản đồ lúc chưa có dữ liệu (trung tâm TP.HCM).
 */
const env = ((import.meta as any).env || {}) as Record<string, any>;
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);

export const CENTRAL_HUB = {
  name: String(env.VITE_DEPOT_NAME || 'Kho xuất hàng'),
  address: String(env.VITE_DEPOT_ADDRESS || ''),
  lat: num(env.VITE_DEPOT_LAT, 10.7769),
  lng: num(env.VITE_DEPOT_LNG, 106.7009),
};
