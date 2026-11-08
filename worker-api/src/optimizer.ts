/**
 * Gợi ý tuyến: cheapest-insertion có ràng buộc tải trọng + khung giờ, sau đó cải thiện bằng 2-opt / or-opt.
 * Ma trận thời gian lấy từ OSRM (đường thật); nếu OSRM lỗi thì ước tính từ khoảng cách đường chim bay.
 * Thời gian tính bằng phút kể từ 00:00 (giờ địa phương) của ngày giao.
 */
export interface OptOrder {
  id: string;
  lat: number;
  lng: number;
  weightKg: number;
  serviceMin: number;
  /** giờ muộn nhất được phép đến (phút từ 00:00); null = không ràng buộc */
  windowEnd: number | null;
  windowStart: number | null;
  cod: number;
}

export interface OptVehicle {
  vehicleId: string;
  driverId: string;
  capacityKg: number;
}

export interface OptInput {
  hub: { lat: number; lng: number };
  startMin: number;
  orders: OptOrder[];
  vehicles: OptVehicle[];
  maxStopsPerRoute: number;
  maxRouteMin: number;
}

export interface OptStop {
  orderId: string;
  etaMin: number;
  lateRisk: boolean;
  lateByMin: number;
}

export interface OptRoute {
  vehicleId: string;
  driverId: string;
  stops: OptStop[];
  distanceKm: number;
  durationMin: number;
  totalWeightKg: number;
  totalCod: number;
  capacityKg: number;
  geometry: Array<[number, number]> | null;
}

export interface OptResult {
  routes: OptRoute[];
  unassigned: Array<{ orderId: string; reason: string }>;
  estimated: boolean; // true = dùng ước tính chim bay, không phải OSRM
  savedKm: number | null;
}

export interface Matrix {
  dur: number[][]; // phút
  dist: number[][]; // km
  estimated: boolean;
}

const LATE_PENALTY = 20; // phạt mỗi phút trễ
const OVERTIME_PENALTY = 10;
const BALANCE_WEIGHT = 4; // phạt nhẹ để chia đều số điểm giữa các xe

function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function estimateMatrix(points: Array<[number, number]>): Matrix {
  const n = points.length;
  const dist = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const dur = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const km = haversineKm(points[i], points[j]) * 1.35;
      dist[i][j] = km;
      dur[i][j] = (km / 22) * 60; // tốc độ đô thị ~22 km/h
    }
  return { dist, dur, estimated: true };
}

export async function osrmMatrix(osrmUrl: string, points: Array<[number, number]>): Promise<Matrix> {
  if (points.length > 90) return estimateMatrix(points);
  try {
    const coords = points.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(';');
    const res = await fetch(`${osrmUrl.replace(/\/$/, '')}/table/v1/driving/${coords}?annotations=duration,distance`);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const d: any = await res.json();
    if (d.code !== 'Ok' || !d.durations || !d.distances) throw new Error('OSRM trả dữ liệu thiếu');
    const n = points.length;
    const fallback = estimateMatrix(points);
    const dur = d.durations.map((row: Array<number | null>, i: number) => row.map((v, j) => (v == null ? fallback.dur[i][j] : v / 60)));
    const dist = d.distances.map((row: Array<number | null>, i: number) => row.map((v, j) => (v == null ? fallback.dist[i][j] : v / 1000)));
    return n ? { dur, dist, estimated: false } : fallback;
  } catch (e) {
    console.warn('OSRM lỗi, dùng ước tính:', (e as Error).message);
    return estimateMatrix(points);
  }
}

export async function osrmGeometry(osrmUrl: string, points: Array<[number, number]>): Promise<Array<[number, number]> | null> {
  if (points.length < 2 || points.length > 90) return null;
  try {
    const coords = points.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(';');
    const res = await fetch(`${osrmUrl.replace(/\/$/, '')}/route/v1/driving/${coords}?overview=simplified&geometries=geojson`);
    if (!res.ok) return null;
    const d: any = await res.json();
    const line = d?.routes?.[0]?.geometry?.coordinates as Array<[number, number]> | undefined;
    return line ? line.map(([lng, lat]) => [lat, lng] as [number, number]) : null;
  } catch {
    return null;
  }
}

interface Sim {
  cost: number;
  durationMin: number;
  distanceKm: number;
  late: number;
  etas: number[];
  lates: number[];
}

/** Mô phỏng một tuyến. idx: chỉ số trong ma trận (0 = kho, i+1 = đơn thứ i) */
function simulate(order: number[], input: OptInput, m: Matrix): Sim {
  let t = input.startMin;
  let prev = 0;
  let distanceKm = 0;
  let late = 0;
  const etas: number[] = [];
  const lates: number[] = [];
  for (const idx of order) {
    const o = input.orders[idx - 1];
    t += m.dur[prev][idx];
    distanceKm += m.dist[prev][idx];
    if (o.windowStart != null && t < o.windowStart) t = o.windowStart;
    etas.push(t);
    const l = o.windowEnd != null ? Math.max(0, t - o.windowEnd) : 0;
    lates.push(l);
    late += l;
    t += o.serviceMin;
    prev = idx;
  }
  if (order.length) {
    t += m.dur[prev][0];
    distanceKm += m.dist[prev][0];
  }
  const durationMin = t - input.startMin;
  const over = Math.max(0, durationMin - input.maxRouteMin);
  return {
    cost: durationMin + LATE_PENALTY * late + OVERTIME_PENALTY * over,
    durationMin,
    distanceKm,
    late,
    etas,
    lates,
  };
}

function improve(order: number[], input: OptInput, m: Matrix): number[] {
  let best = order.slice();
  let bestCost = simulate(best, input, m).cost;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    // 2-opt
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const c = simulate(cand, input, m).cost;
        if (c < bestCost - 0.01) {
          best = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
    // or-opt: chuyển 1 điểm sang vị trí khác
    for (let i = 0; i < best.length; i++) {
      const without = best.filter((_, x) => x !== i);
      for (let j = 0; j <= without.length; j++) {
        if (j === i) continue;
        const cand = [...without.slice(0, j), best[i], ...without.slice(j)];
        const c = simulate(cand, input, m).cost;
        if (c < bestCost - 0.01) {
          best = cand;
          bestCost = c;
          improved = true;
          break;
        }
      }
    }
  }
  return best;
}

export function buildMatrixPoints(input: OptInput): Array<[number, number]> {
  return [[input.hub.lat, input.hub.lng], ...input.orders.map((o) => [o.lat, o.lng] as [number, number])];
}

/** Chạy tối ưu với ma trận đã có (hàm thuần, dễ test) */
export function solve(input: OptInput, m: Matrix): OptResult {
  const n = input.orders.length;
  const routes: number[][] = input.vehicles.map(() => []);
  const load: number[] = input.vehicles.map(() => 0);
  const unassigned: OptResult['unassigned'] = [];

  // Xếp đơn gấp (giờ hẹn sớm) trước, rồi đơn xa kho trước
  const idxs = Array.from({ length: n }, (_, i) => i + 1).sort((a, b) => {
    const wa = input.orders[a - 1].windowEnd ?? 1e9;
    const wb = input.orders[b - 1].windowEnd ?? 1e9;
    if (wa !== wb) return wa - wb;
    return m.dur[0][b] - m.dur[0][a];
  });

  for (const idx of idxs) {
    const o = input.orders[idx - 1];
    let bestV = -1;
    let bestPos = 0;
    let bestDelta = Infinity;
    let sawCapacityFail = false;

    for (let v = 0; v < input.vehicles.length; v++) {
      if (load[v] + o.weightKg > input.vehicles[v].capacityKg) {
        sawCapacityFail = true;
        continue;
      }
      if (routes[v].length >= input.maxStopsPerRoute) continue;
      const baseCost = simulate(routes[v], input, m).cost;
      for (let pos = 0; pos <= routes[v].length; pos++) {
        const cand = [...routes[v].slice(0, pos), idx, ...routes[v].slice(pos)];
        const delta = simulate(cand, input, m).cost - baseCost + BALANCE_WEIGHT * routes[v].length;
        if (delta < bestDelta) {
          bestDelta = delta;
          bestV = v;
          bestPos = pos;
        }
      }
    }

    if (bestV < 0) {
      unassigned.push({ orderId: o.id, reason: sawCapacityFail ? 'Vượt tải trọng của tất cả xe còn lại' : 'Các xe đã đủ số điểm tối đa' });
    } else {
      routes[bestV].splice(bestPos, 0, idx);
      load[bestV] += o.weightKg;
    }
  }

  // Cải thiện từng tuyến
  for (let v = 0; v < routes.length; v++) routes[v] = improve(routes[v], input, m);

  // Quãng đường nếu mỗi đơn đi riêng từ kho (mốc so sánh, không phải phương án thật) bị bỏ qua.
  // Mốc "trước tối ưu" = thứ tự nhập vào chia đều theo vòng tròn.
  let baseline = 0;
  const rr: number[][] = input.vehicles.map(() => []);
  Array.from({ length: n }, (_, i) => i + 1).forEach((idx, i) => rr[i % Math.max(1, input.vehicles.length)]?.push(idx));
  for (const r of rr) baseline += simulate(r, input, m).distanceKm;

  const out: OptRoute[] = routes.map((r, v) => {
    const s = simulate(r, input, m);
    return {
      vehicleId: input.vehicles[v].vehicleId,
      driverId: input.vehicles[v].driverId,
      stops: r.map((idx, i) => ({
        orderId: input.orders[idx - 1].id,
        etaMin: Math.round(s.etas[i]),
        lateRisk: s.lates[i] > 0,
        lateByMin: Math.round(s.lates[i]),
      })),
      distanceKm: Math.round(s.distanceKm * 10) / 10,
      durationMin: Math.round(s.durationMin),
      totalWeightKg: Math.round(load[v] * 10) / 10,
      totalCod: r.reduce((sum, idx) => sum + input.orders[idx - 1].cod, 0),
      capacityKg: input.vehicles[v].capacityKg,
      geometry: null,
    };
  });

  const total = out.reduce((s, r) => s + r.distanceKm, 0);
  return {
    routes: out.filter((r) => r.stops.length > 0),
    unassigned,
    estimated: m.estimated,
    savedKm: n > 1 && baseline > 0 ? Math.round((baseline - total) * 10) / 10 : null,
  };
}

/** Tính lại ETA cho thứ tự điểm do điều phối chỉnh tay */
export function evaluateOrder(input: OptInput, m: Matrix, orderedOrderIds: string[]): { stops: OptStop[]; distanceKm: number; durationMin: number } {
  const idxById = new Map(input.orders.map((o, i) => [o.id, i + 1]));
  const seq = orderedOrderIds.map((id) => idxById.get(id)).filter((x): x is number => x !== undefined);
  const s = simulate(seq, input, m);
  return {
    stops: seq.map((idx, i) => ({
      orderId: input.orders[idx - 1].id,
      etaMin: Math.round(s.etas[i]),
      lateRisk: s.lates[i] > 0,
      lateByMin: Math.round(s.lates[i]),
    })),
    distanceKm: Math.round(s.distanceKm * 10) / 10,
    durationMin: Math.round(s.durationMin),
  };
}
