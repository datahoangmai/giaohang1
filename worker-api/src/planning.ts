import type { Env } from './env';
import { HttpError, assertUuid, json, readJson } from './http';
import {
  buildMatrixPoints, evaluateOrder, osrmGeometry, osrmMatrix, solve,
  type OptInput, type OptOrder, type OptResult, type OptVehicle,
} from './optimizer';
import { audit, getDefaultBranch, inList, requireAuth, svc } from './supabase';

const OSRM_DEFAULT = 'https://router.project-osrm.org';
const TZ_OFFSET_MIN = 7 * 60;

const minToIso = (date: string, min: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + (min - TZ_OFFSET_MIN) * 60_000).toISOString();

function parseHm(s: string | undefined, dflt: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : dflt;
}

/** phút từ 00:00 giờ VN của `date`, hoặc null nếu giờ hẹn thuộc ngày khác / không có giờ cụ thể */
function windowEndFor(scheduledAt: string | null, date: string, tolerance: number): number | null {
  if (!scheduledAt) return null;
  const local = new Date(Date.parse(scheduledAt) + TZ_OFFSET_MIN * 60_000);
  if (local.toISOString().slice(0, 10) !== date) return null;
  const min = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (min === 0) return null; // Odoo chỉ có ngày, không có giờ
  return min + tolerance;
}

interface RunBody {
  plannedDate?: string;
  startTime?: string;
  orderIds?: string[];
  /** Cặp tài xế - xe. Bỏ trống: tự ghép theo xe mặc định của tài xế */
  assignments?: Array<{ driverId: string; vehicleId: string }>;
  maxStopsPerRoute?: number;
  maxRouteHours?: number;
}

async function buildContext(env: Env, b: RunBody) {
  const date = b.plannedDate;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'plannedDate phải dạng YYYY-MM-DD.');
  const branch = await getDefaultBranch(env);
  const tolerance = Number(env.WINDOW_TOLERANCE_MIN) || 60;

  // Đơn ứng viên
  let orders: any[];
  if (b.orderIds?.length) {
    b.orderIds.forEach((x) => assertUuid(x, 'orderId'));
    orders = await svc<any[]>(env, `orders?id=${inList(b.orderIds)}&select=*`);
  } else {
    orders = await svc<any[]>(
      env,
      `orders?status=in.(unassigned,assigned)&carrier_service=eq.noi_bo` +
        `&or=(requested_delivery_date.eq.${date},requested_delivery_date.is.null)&select=*&limit=500`
    );
  }

  // Loại đơn đã nằm trong tuyến đang hoạt động
  const ids = orders.map((o) => o.id);
  const busy = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const rows = await svc<any[]>(
      env,
      `route_stops?order_id=${inList(ids.slice(i, i + 100))}&select=order_id,delivery_routes!inner(status)&delivery_routes.status=in.(draft,assigned,in_progress)`
    );
    (rows || []).forEach((r) => busy.add(r.order_id));
  }

  const skipped: Array<{ orderId: string; orderNumber: string; reason: string }> = [];
  const usable: any[] = [];
  for (const o of orders) {
    if (busy.has(o.id)) skipped.push({ orderId: o.id, orderNumber: o.order_number, reason: 'Đã nằm trong một tuyến đang hoạt động' });
    else if (o.cod_needs_review) skipped.push({ orderId: o.id, orderNumber: o.order_number, reason: 'COD cần điều phối xác nhận trước' });
    else if (!['ok', 'manual'].includes(o.geocode_status) || o.latitude == null || o.longitude == null)
      skipped.push({ orderId: o.id, orderNumber: o.order_number, reason: 'Chưa có tọa độ đã xác nhận (kiểm tra địa chỉ)' });
    else usable.push(o);
  }

  // Tài xế + xe
  const drivers = await svc<any[]>(env, 'drivers?status=eq.active&select=id,profile_id,employee_code,default_vehicle_id,profiles(full_name)');
  const vehicles = await svc<any[]>(env, 'vehicles?status=eq.active&select=id,plate_number,vehicle_type,max_weight_kg');
  const vById = new Map(vehicles.map((v) => [v.id, v]));
  const dById = new Map(drivers.map((d) => [d.id, d]));

  let pairs: Array<{ driverId: string; vehicleId: string }> = [];
  if (b.assignments?.length) {
    for (const a of b.assignments) {
      if (!dById.has(a.driverId) || !vById.has(a.vehicleId)) throw new HttpError(400, 'Tài xế hoặc xe không hợp lệ / không hoạt động.');
    }
    pairs = b.assignments;
  } else {
    const usedV = new Set<string>();
    for (const d of drivers) {
      if (d.default_vehicle_id && vById.has(d.default_vehicle_id) && !usedV.has(d.default_vehicle_id)) {
        pairs.push({ driverId: d.id, vehicleId: d.default_vehicle_id });
        usedV.add(d.default_vehicle_id);
      }
    }
    const freeV = vehicles.filter((v) => !usedV.has(v.id));
    for (const d of drivers.filter((d) => !pairs.some((p) => p.driverId === d.id))) {
      const v = freeV.shift();
      if (!v) break;
      pairs.push({ driverId: d.id, vehicleId: v.id });
    }
  }
  if (!pairs.length) throw new HttpError(400, 'Không có cặp tài xế - xe khả dụng. Hãy gán xe mặc định cho tài xế hoặc truyền assignments.');

  const optVehicles: OptVehicle[] = pairs.map((p) => ({
    vehicleId: p.vehicleId,
    driverId: p.driverId,
    capacityKg: Number(vById.get(p.vehicleId)?.max_weight_kg) || 150,
  }));
  const optOrders: OptOrder[] = usable.map((o) => ({
    id: o.id,
    lat: Number(o.latitude),
    lng: Number(o.longitude),
    weightKg: Number(o.weight_kg) || 2,
    serviceMin: Number(o.service_minutes) || 5,
    windowStart: null,
    windowEnd: windowEndFor(o.scheduled_at, date, tolerance),
    cod: Number(o.cod_amount) || 0,
  }));

  const input: OptInput = {
    hub: { lat: branch.lat, lng: branch.lng },
    startMin: parseHm(b.startTime, 8 * 60),
    orders: optOrders,
    vehicles: optVehicles,
    maxStopsPerRoute: Math.min(40, Math.max(1, Number(b.maxStopsPerRoute) || 15)),
    maxRouteMin: Math.round((Number(b.maxRouteHours) || 8) * 60),
  };
  return { date, branch, input, usable, skipped, drivers: dById, vehicles: vById };
}

function present(env: Env, date: string, ctx: Awaited<ReturnType<typeof buildContext>>, result: OptResult) {
  const oById = new Map(ctx.usable.map((o) => [o.id, o]));
  const info = (id: string) => {
    const o = oById.get(id);
    return {
      orderId: id,
      orderNumber: o?.order_number,
      customerName: o?.customer_name,
      address: o?.delivery_address,
      lat: Number(o?.latitude),
      lng: Number(o?.longitude),
      codAmount: Number(o?.cod_amount) || 0,
      hasInstallation: !!o?.has_installation,
      scheduledAt: o?.scheduled_at || null,
    };
  };
  return {
    plannedDate: date,
    hub: ctx.input.hub,
    estimated: result.estimated,
    savedKm: result.savedKm,
    routes: result.routes.map((r) => ({
      driverId: r.driverId,
      driverName: ctx.drivers.get(r.driverId)?.profiles?.full_name,
      vehicleId: r.vehicleId,
      plate: ctx.vehicles.get(r.vehicleId)?.plate_number,
      distanceKm: r.distanceKm,
      durationMin: r.durationMin,
      totalWeightKg: r.totalWeightKg,
      capacityKg: r.capacityKg,
      totalCod: r.totalCod,
      geometry: r.geometry,
      stops: r.stops.map((s) => ({ ...info(s.orderId), eta: minToIso(date, s.etaMin), lateRisk: s.lateRisk, lateByMin: s.lateByMin })),
    })),
    unassigned: result.unassigned.map((u) => ({ ...info(u.orderId), reason: u.reason })),
    skipped: ctx.skipped,
  };
}

export async function runOptimization(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env, ['admin', 'dispatcher']);
  const body = await readJson<RunBody>(req);
  const ctx = await buildContext(env, body);
  if (!ctx.input.orders.length) {
    return json({ runId: null, plan: present(env, ctx.date, ctx, { routes: [], unassigned: [], estimated: false, savedKm: null }), message: 'Không có đơn đủ điều kiện để xếp tuyến.' });
  }

  const osrm = env.OSRM_URL || OSRM_DEFAULT;
  const matrix = await osrmMatrix(osrm, buildMatrixPoints(ctx.input));
  const result = solve(ctx.input, matrix);
  if (!matrix.estimated) {
    for (const r of result.routes) {
      const pts: Array<[number, number]> = [[ctx.input.hub.lat, ctx.input.hub.lng]];
      for (const s of r.stops) {
        const o = ctx.input.orders.find((x) => x.id === s.orderId)!;
        pts.push([o.lat, o.lng]);
      }
      pts.push([ctx.input.hub.lat, ctx.input.hub.lng]);
      r.geometry = await osrmGeometry(osrm, pts);
    }
  }

  const plan = present(env, ctx.date, ctx, result);
  const run = await svc<any[]>(env, 'optimization_runs', {
    method: 'POST', prefer: 'return=representation',
    body: {
      planned_date: ctx.date, status: 'draft', created_by: auth.profile.id,
      input_snapshot: { request: body, orderIds: ctx.usable.map((o) => o.id), startMin: ctx.input.startMin, vehicles: ctx.input.vehicles },
      result: plan,
    },
  });
  await audit(env, auth.profile.id, 'optimization.run', 'optimization_run', run[0].id, null, { orders: ctx.input.orders.length, routes: plan.routes.length }, req);
  return json({ runId: run[0].id, plan });
}

interface ConfirmBody {
  /** Điều phối đã chỉnh tay: mỗi tuyến là danh sách orderId theo thứ tự */
  routes?: Array<{ driverId: string; vehicleId: string; orderIds: string[] }>;
}

export async function confirmOptimization(req: Request, env: Env, runId: string): Promise<Response> {
  const auth = await requireAuth(req, env, ['admin', 'dispatcher']);
  assertUuid(runId);
  const body = await readJson<ConfirmBody>(req).catch(() => ({} as ConfirmBody));

  const runs = await svc<any[]>(env, `optimization_runs?id=eq.${runId}&select=*`);
  const run = runs?.[0];
  if (!run) throw new HttpError(404, 'Không tìm thấy phương án.');
  if (run.status !== 'draft') throw new HttpError(409, `Phương án đã ở trạng thái "${run.status}".`);

  const date: string = run.planned_date;
  const plan = run.result as ReturnType<typeof present>;
  const branch = await getDefaultBranch(env);

  // Danh sách tuyến cuối cùng: do điều phối chỉnh, hoặc nguyên gợi ý
  const finalRoutes = body.routes?.length
    ? body.routes
    : plan.routes.map((r) => ({ driverId: r.driverId, vehicleId: r.vehicleId, orderIds: r.stops.map((s) => s.orderId) }));

  // Kiểm tra: đơn không trùng giữa các tuyến, thuộc phương án, chưa bị nhận bởi tuyến khác
  const allowed = new Set<string>([...(run.input_snapshot?.orderIds || [])]);
  const seen = new Set<string>();
  for (const r of finalRoutes) {
    assertUuid(r.driverId, 'driverId');
    assertUuid(r.vehicleId, 'vehicleId');
    for (const id of r.orderIds) {
      if (!allowed.has(id)) throw new HttpError(400, 'Có đơn không thuộc phương án này.');
      if (seen.has(id)) throw new HttpError(400, 'Một đơn xuất hiện ở nhiều tuyến.');
      seen.add(id);
    }
  }
  const orderIds = [...seen];
  if (!orderIds.length) throw new HttpError(400, 'Không có đơn nào để giao việc.');

  // Chống xác nhận đồng thời: chỉ một request chuyển được draft -> confirmed
  const claimed = await svc<any[]>(env, `optimization_runs?id=eq.${runId}&status=eq.draft`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { status: 'confirmed', confirmed_by: auth.profile.id, updated_at: new Date().toISOString() },
  });
  if (!claimed?.length) throw new HttpError(409, 'Phương án vừa được xác nhận bởi người khác.');

  try {
    const orders = await svc<any[]>(env, `orders?id=${inList(orderIds)}&select=*`);
    const oById = new Map(orders.map((o) => [o.id, o]));
    const stillBusy = await svc<any[]>(
      env,
      `route_stops?order_id=${inList(orderIds)}&select=order_id,delivery_routes!inner(status)&delivery_routes.status=in.(draft,assigned,in_progress)`
    );
    if (stillBusy?.length) throw new HttpError(409, 'Có đơn vừa được gán vào tuyến khác. Hãy chạy lại gợi ý.');

    // Tính lại ETA theo thứ tự cuối cùng
    const osrm = env.OSRM_URL || OSRM_DEFAULT;
    const tolerance = Number(env.WINDOW_TOLERANCE_MIN) || 60;
    const optOrders: OptOrder[] = orders.map((o) => ({
      id: o.id, lat: Number(o.latitude), lng: Number(o.longitude), weightKg: Number(o.weight_kg) || 2,
      serviceMin: Number(o.service_minutes) || 5, windowStart: null,
      windowEnd: windowEndFor(o.scheduled_at, date, tolerance), cod: Number(o.cod_amount) || 0,
    }));
    const input: OptInput = {
      hub: { lat: branch.lat, lng: branch.lng }, startMin: run.input_snapshot?.startMin ?? 480, orders: optOrders,
      vehicles: [], maxStopsPerRoute: 999, maxRouteMin: 24 * 60,
    };
    const matrix = await osrmMatrix(osrm, buildMatrixPoints(input));

    const existingToday = await svc<any[]>(env, `delivery_routes?planned_date=eq.${date}&select=id`);
    let seq = existingToday?.length || 0;
    const createdRoutes: any[] = [];

    for (const r of finalRoutes) {
      if (!r.orderIds.length) continue;
      const ev = evaluateOrder(input, matrix, r.orderIds);
      seq += 1;
      const code = `R${date.replace(/-/g, '').slice(2)}-${String(seq).padStart(2, '0')}`;
      const pts: Array<[number, number]> = [[branch.lat, branch.lng], ...r.orderIds.map((id) => [Number(oById.get(id).latitude), Number(oById.get(id).longitude)] as [number, number]), [branch.lat, branch.lng]];
      const geometry = matrix.estimated ? null : await osrmGeometry(osrm, pts);

      const route = (
        await svc<any[]>(env, 'delivery_routes', {
          method: 'POST', prefer: 'return=representation',
          body: {
            branch_id: branch.id, route_code: code, driver_id: r.driverId, vehicle_id: r.vehicleId, planned_date: date,
            status: 'assigned', planned_start_at: minToIso(date, input.startMin), planned_distance_km: ev.distanceKm,
            created_by: auth.profile.id, optimization_run_id: runId, confirmed_by: auth.profile.id,
            confirmed_at: new Date().toISOString(), route_geometry: geometry,
          },
        })
      )[0];

      const stops = ev.stops.map((s, i) => {
        const o = oById.get(s.orderId);
        return {
          route_id: route.id, order_id: s.orderId, sequence_no: i + 1, status: 'pending',
          planned_arrival_at: minToIso(date, s.etaMin), eta_at: minToIso(date, s.etaMin),
          time_window_end: windowEndFor(o.scheduled_at, date, tolerance) != null ? minToIso(date, windowEndFor(o.scheduled_at, date, tolerance)!) : null,
          late_risk: s.lateRisk, latitude: o.latitude, longitude: o.longitude,
        };
      });
      await svc(env, 'route_stops', { method: 'POST', body: stops, prefer: 'return=minimal' });
      await svc(env, `orders?id=${inList(r.orderIds)}`, { method: 'PATCH', body: { status: 'assigned' }, prefer: 'return=minimal' });
      await svc(env, 'delivery_events', {
        method: 'POST', prefer: 'return=minimal',
        body: r.orderIds.map((id) => ({ order_id: id, route_id: route.id, actor_id: auth.profile.id, event_type: 'ROUTE_ASSIGNED', description: `Gán vào tuyến ${code}`, metadata: { run_id: runId } })),
      });
      createdRoutes.push({ id: route.id, code, driverId: r.driverId, stops: stops.length, distanceKm: ev.distanceKm });
    }

    await audit(env, auth.profile.id, 'optimization.confirm', 'optimization_run', runId, null, { routes: createdRoutes, edited: !!body.routes }, req);
    return json({ ok: true, routes: createdRoutes });
  } catch (e) {
    // Hoàn lại để điều phối thử lại
    await svc(env, `optimization_runs?id=eq.${runId}`, { method: 'PATCH', body: { status: 'draft', confirmed_by: null }, prefer: 'return=minimal' });
    throw e;
  }
}

export async function discardOptimization(req: Request, env: Env, runId: string): Promise<Response> {
  const auth = await requireAuth(req, env, ['admin', 'dispatcher']);
  assertUuid(runId);
  const rows = await svc<any[]>(env, `optimization_runs?id=eq.${runId}&status=eq.draft`, {
    method: 'PATCH', prefer: 'return=representation', body: { status: 'discarded', updated_at: new Date().toISOString() },
  });
  if (!rows?.length) throw new HttpError(409, 'Phương án không còn ở trạng thái nháp.');
  await audit(env, auth.profile.id, 'optimization.discard', 'optimization_run', runId, null, null, req);
  return json({ ok: true });
}
