import type { Env, ExecutionContext } from './env';
import { geocode } from './geocode';
import { HttpError, UUID_RE, assertUuid, json, readJson } from './http';
import { enqueueOdooState, processOdooQueue } from './odoo';
import { audit, getDefaultBranch, inList, requireAuth, rest, svc } from './supabase';

async function myDriverId(env: Env, profileId: string): Promise<string | null> {
  const r = await svc<any[]>(env, `drivers?profile_id=eq.${profileId}&select=id`);
  return r?.[0]?.id || null;
}

// ---------------------------------------------------------------------------
// Tài xế bắt đầu chạy tuyến
// ---------------------------------------------------------------------------
export async function startRoute(req: Request, env: Env, ctx: ExecutionContext, routeId: string): Promise<Response> {
  const auth = await requireAuth(req, env, ['admin', 'dispatcher', 'driver']);
  assertUuid(routeId);
  const route = (await svc<any[]>(env, `delivery_routes?id=eq.${routeId}&select=*`))?.[0];
  if (!route) throw new HttpError(404, 'Không tìm thấy tuyến.');
  if (auth.profile.role === 'driver' && route.driver_id !== (await myDriverId(env, auth.profile.id))) throw new HttpError(403, 'Đây không phải tuyến của bạn.');
  if (route.status === 'in_progress') return json({ ok: true, already: true });
  if (route.status !== 'assigned') throw new HttpError(409, `Tuyến đang ở trạng thái "${route.status}", không thể bắt đầu.`);

  await svc(env, `delivery_routes?id=eq.${routeId}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'in_progress', actual_start_at: new Date().toISOString() } });
  const stops = await svc<any[]>(env, `route_stops?route_id=eq.${routeId}&select=order_id,orders(id,order_number,odoo_shipping_order_id,status)`);
  const orderIds = stops.map((s) => s.order_id);
  if (orderIds.length) {
    await svc(env, `orders?id=${inList(orderIds)}&status=in.(assigned,unassigned)`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'in_transit' } });
    await svc(env, 'delivery_events', {
      method: 'POST', prefer: 'return=minimal',
      body: orderIds.map((id) => ({ order_id: id, route_id: routeId, actor_id: auth.profile.id, event_type: 'ROUTE_STARTED', description: 'Tài xế bắt đầu tuyến' })),
    });
    for (const s of stops) {
      if (s.orders) await enqueueOdooState(env, s.orders, 'in_delivery', 'Hachihi: tài xế đã nhận hàng và bắt đầu giao.', `start:${routeId}`);
    }
    ctx.waitUntil(processOdooQueue(env, 20).catch((e) => console.error(e)));
  }
  await audit(env, auth.profile.id, 'route.start', 'delivery_route', routeId, null, null, req);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Sự kiện tại điểm dừng
// ---------------------------------------------------------------------------
interface StopEventBody {
  eventType?: 'ARRIVED_STOP' | 'DELIVERED' | 'FAILED_ATTEMPT';
  clientEventId?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  note?: string;
  recipientName?: string;
  failureReason?: string;
  timestamp?: string;
}

export async function stopEvent(req: Request, env: Env, ctx: ExecutionContext, stopId: string): Promise<Response> {
  const auth = await requireAuth(req, env, ['admin', 'dispatcher', 'driver']);
  assertUuid(stopId);
  const b = await readJson<StopEventBody>(req);
  if (!b.eventType || !['ARRIVED_STOP', 'DELIVERED', 'FAILED_ATTEMPT'].includes(b.eventType)) throw new HttpError(400, 'eventType không hợp lệ.');
  if (!b.clientEventId || !UUID_RE.test(b.clientEventId)) throw new HttpError(400, 'clientEventId phải là UUID.');
  if (b.eventType === 'FAILED_ATTEMPT' && !b.failureReason?.trim()) throw new HttpError(400, 'Cần nhập lý do giao thất bại.');

  const stop = (
    await svc<any[]>(env, `route_stops?id=eq.${stopId}&select=*,delivery_routes(id,driver_id,status),orders(id,order_number,cod_amount,odoo_shipping_order_id,status)`)
  )?.[0];
  if (!stop) throw new HttpError(404, 'Không tìm thấy điểm dừng.');
  const driverId = await myDriverId(env, auth.profile.id);
  if (auth.profile.role === 'driver' && stop.delivery_routes.driver_id !== driverId) throw new HttpError(403, 'Điểm dừng này không thuộc tuyến của bạn.');
  if (stop.delivery_routes.status !== 'in_progress' && b.eventType !== 'ARRIVED_STOP') {
    throw new HttpError(409, 'Tuyến chưa bắt đầu hoặc đã kết thúc.');
  }

  // Idempotent: gửi lại cùng clientEventId thì trả kết quả cũ
  const dup = await svc<any[]>(env, `delivery_events?idempotency_key=eq.${b.clientEventId}&select=id`);
  if (dup?.length) return json({ ok: true, duplicate: true });

  if (['completed', 'failed'].includes(stop.status)) throw new HttpError(409, 'Điểm dừng này đã được chốt kết quả.');

  const when = b.timestamp && !Number.isNaN(Date.parse(b.timestamp)) ? new Date(b.timestamp).toISOString() : new Date().toISOString();
  await svc(env, 'delivery_events', {
    method: 'POST', prefer: 'return=minimal',
    body: {
      idempotency_key: b.clientEventId, order_id: stop.order_id, route_id: stop.route_id, route_stop_id: stop.id,
      actor_id: auth.profile.id, event_type: b.eventType, event_time: when,
      latitude: b.lat ?? null, longitude: b.lng ?? null, description: b.note || b.failureReason || null,
      metadata: { accuracy: b.accuracy ?? null, recipientName: b.recipientName ?? null, failureReason: b.failureReason ?? null },
    },
  });

  const order = stop.orders;
  let codRecorded: boolean | undefined;

  if (b.eventType === 'ARRIVED_STOP') {
    await svc(env, `route_stops?id=eq.${stopId}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'arrived', arrived_at: when } });
  } else if (b.eventType === 'DELIVERED') {
    await svc(env, `route_stops?id=eq.${stopId}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'completed', completed_at: when, note: b.note || null } });
    await svc(env, `orders?id=eq.${order.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'delivered' } });
    const cod = Number(order.cod_amount) || 0;
    if (cod > 0 && driverId) {
      try {
        await svc(env, 'cod_transactions', {
          method: 'POST', prefer: 'return=minimal',
          body: { order_id: order.id, driver_id: driverId, route_id: stop.route_id, transaction_type: 'collection', amount: cod, currency: 'VND', payment_method: 'cash', description: `Thu COD đơn ${order.order_number}`, created_by: auth.profile.id, transaction_time: when },
        });
        codRecorded = true;
      } catch (e) {
        codRecorded = false;
        console.error('Ghi COD thất bại (kiểm tra nhãn enum transaction_type):', e);
      }
    }
    await enqueueOdooState(env, order, 'done', `Hachihi: đã giao thành công${b.recipientName ? ` — người nhận: ${b.recipientName}` : ''}${b.note ? ` — ${b.note}` : ''}.`, b.clientEventId);
  } else {
    await svc(env, `route_stops?id=eq.${stopId}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'failed', failure_reason: b.failureReason, note: b.note || null, completed_at: when } });
    await svc(env, `orders?id=eq.${order.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'failed' } });
    await svc(env, 'alerts?on_conflict=dedupe_key', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: { route_id: stop.route_id, order_id: order.id, driver_id: stop.delivery_routes.driver_id, type: 'failed_delivery', severity: 'warning', message: `Giao thất bại đơn ${order.order_number}: ${b.failureReason}`, dedupe_key: `failed:${stopId}:${b.clientEventId}` },
    });
    await enqueueOdooState(env, order, 'ready', `Hachihi: giao thất bại — ${b.failureReason}${b.note ? ` (${b.note})` : ''}.`, b.clientEventId);
  }

  // Tuyến hoàn tất khi không còn điểm chờ
  if (b.eventType !== 'ARRIVED_STOP') {
    const left = await svc<any[]>(env, `route_stops?route_id=eq.${stop.route_id}&status=in.(pending,arrived)&select=id&limit=1`);
    if (!left?.length) {
      await svc(env, `delivery_routes?id=eq.${stop.route_id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'completed', actual_end_at: when } });
    }
  }

  ctx.waitUntil(processOdooQueue(env, 10).catch((e) => console.error(e)));
  await audit(env, auth.profile.id, `stop.${b.eventType.toLowerCase()}`, 'route_stop', stopId, { status: stop.status }, { eventType: b.eventType }, req);
  return json({ ok: true, codRecorded });
}

// ---------------------------------------------------------------------------
// Điều phối đổi tài xế/xe, đổi thứ tự điểm dừng
// ---------------------------------------------------------------------------
export async function patchRoute(req: Request, env: Env, routeId: string): Promise<Response> {
  const auth = await requireAuth(req, env, ['admin', 'dispatcher']);
  assertUuid(routeId);
  const b = await readJson<{ driverId?: string; vehicleId?: string; stopOrder?: string[] }>(req);
  const route = (await svc<any[]>(env, `delivery_routes?id=eq.${routeId}&select=*`))?.[0];
  if (!route) throw new HttpError(404, 'Không tìm thấy tuyến.');
  if (['completed', 'cancelled'].includes(route.status)) throw new HttpError(409, 'Tuyến đã kết thúc, không thể sửa.');

  const patch: Record<string, unknown> = {};
  if (b.driverId) patch.driver_id = assertUuid(b.driverId, 'driverId');
  if (b.vehicleId) patch.vehicle_id = assertUuid(b.vehicleId, 'vehicleId');
  if (Object.keys(patch).length) {
    await svc(env, `delivery_routes?id=eq.${routeId}`, { method: 'PATCH', prefer: 'return=minimal', body: patch });
  }

  if (b.stopOrder?.length) {
    const stops = await svc<any[]>(env, `route_stops?route_id=eq.${routeId}&select=id,status,sequence_no`);
    const ids = new Set(stops.map((s) => s.id));
    if (b.stopOrder.length !== stops.length || b.stopOrder.some((id) => !ids.has(id))) throw new HttpError(400, 'Danh sách điểm dừng không khớp với tuyến.');
    const done = new Set(stops.filter((s) => ['completed', 'failed'].includes(s.status)).map((s) => s.id));
    // Điểm đã chốt phải giữ nguyên vị trí đầu danh sách
    const lockedPrefix = stops.filter((s) => done.has(s.id)).sort((a, b) => a.sequence_no - b.sequence_no).map((s) => s.id);
    const head = b.stopOrder.slice(0, lockedPrefix.length);
    if (head.join() !== lockedPrefix.join()) throw new HttpError(400, 'Không được đổi vị trí các điểm đã giao.');
    // sequence_no có thể có unique (route_id, sequence_no): đẩy tạm lên số lớn rồi gán lại
    for (const [i, id] of b.stopOrder.entries()) {
      await svc(env, `route_stops?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: { sequence_no: 1000 + i } });
    }
    for (const [i, id] of b.stopOrder.entries()) {
      await svc(env, `route_stops?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: { sequence_no: i + 1 } });
    }
  }
  await audit(env, auth.profile.id, 'route.update', 'delivery_route', routeId, route, { ...patch, stopOrder: b.stopOrder }, req);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Sửa tọa độ / geocode lại
// ---------------------------------------------------------------------------
export async function setOrderLocation(req: Request, env: Env, orderId: string): Promise<Response> {
  const auth = await requireAuth(req, env, ['admin', 'dispatcher']);
  assertUuid(orderId);
  const b = await readJson<{ lat?: number; lng?: number; address?: string }>(req);
  const before = (await svc<any[]>(env, `orders?id=eq.${orderId}&select=id,delivery_address,latitude,longitude,geocode_status`))?.[0];
  if (!before) throw new HttpError(404, 'Không tìm thấy đơn.');

  let patch: Record<string, unknown>;
  if (typeof b.lat === 'number' && typeof b.lng === 'number') {
    if (b.lat < 8 || b.lat > 24 || b.lng < 102 || b.lng > 110) throw new HttpError(400, 'Tọa độ nằm ngoài Việt Nam.');
    patch = { latitude: b.lat, longitude: b.lng, geocode_status: 'manual', geocode_provider: 'manual' };
    if (b.address?.trim()) patch.delivery_address = b.address.trim();
  } else {
    const address = (b.address || before.delivery_address || '').trim();
    const g = await geocode(env, address, await getDefaultBranch(env));
    patch = { delivery_address: address, latitude: g.lat, longitude: g.lng, geocode_status: g.status, geocode_provider: g.provider };
  }
  const rows = await svc<any[]>(env, `orders?id=eq.${orderId}`, { method: 'PATCH', prefer: 'return=representation', body: patch });
  await audit(env, auth.profile.id, 'order.set_location', 'order', orderId, before, patch, req);
  return json({ order: { id: orderId, lat: rows[0].latitude, lng: rows[0].longitude, geocodeStatus: rows[0].geocode_status } });
}

// ---------------------------------------------------------------------------
// Danh sách phiếu dạng Odoo (RLS tự lọc theo vai trò vì dùng JWT người dùng)
// ---------------------------------------------------------------------------
export async function listOdooShaped(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  const url = new URL(req.url);
  const states = (url.searchParams.get('states') || 'draft,ready,assigned,in_delivery').split(',').filter((s) => /^[a-z_]+$/.test(s));
  const rows = await rest<any[]>(
    env, auth.token,
    `orders?source_system=eq.odoo&odoo_state=${inList(states)}&select=id,odoo_raw,latitude,longitude,geocode_status,cod_amount,cod_needs_review,status&order=scheduled_at.asc.nullslast&limit=500`
  );
  return json({
    result: (rows || []).map((r) => ({
      ...r.odoo_raw,
      _db_id: r.id,
      _lat: r.latitude == null ? null : Number(r.latitude),
      _lng: r.longitude == null ? null : Number(r.longitude),
      _geocode_status: r.geocode_status,
      _cod_amount: Number(r.cod_amount) || 0,
      _cod_needs_review: !!r.cod_needs_review,
      _status: r.status,
    })),
  });
}
