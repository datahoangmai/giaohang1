import type { Env } from './env';
import { inList, svc } from './supabase';

function distM(a: [number, number], b: [number, number]) {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function raise(env: Env, rows: any[]) {
  if (!rows.length) return;
  await svc(env, 'alerts?on_conflict=dedupe_key', { method: 'POST', body: rows, prefer: 'resolution=ignore-duplicates,return=minimal' });
}

/** Chạy mỗi lượt cron: không có tín hiệu, đứng yên lâu, lệch tuyến, nguy cơ trễ */
export async function computeAlerts(env: Env): Promise<{ routes: number; raised: number }> {
  const routes = await svc<any[]>(env, 'delivery_routes?status=eq.in_progress&select=id,driver_id,actual_start_at,route_geometry,drivers(profiles(full_name))');
  const now = Date.now();
  const bucket10 = Math.floor(now / 600_000);
  const alerts: any[] = [];

  for (const r of routes || []) {
    const name = r.drivers?.profiles?.full_name || 'Tài xế';
    const locs = await svc<any[]>(env, `driver_locations?route_id=eq.${r.id}&select=latitude,longitude,recorded_at&order=recorded_at.desc&limit=30`);
    const last = locs?.[0];
    const lastAt = last ? Date.parse(last.recorded_at) : null;
    const startedAt = r.actual_start_at ? Date.parse(r.actual_start_at) : now;

    // Mất tín hiệu > 2 phút
    const silentMs = now - (lastAt ?? startedAt);
    if (silentMs > 120_000) {
      alerts.push({ route_id: r.id, driver_id: r.driver_id, type: 'no_signal', severity: 'critical', message: `${name} mất tín hiệu GPS ${Math.round(silentMs / 60000)} phút.`, dedupe_key: `no_signal:${r.id}:${bucket10}` });
    } else {
      await svc(env, `alerts?route_id=eq.${r.id}&type=eq.no_signal&resolved_at=is.null`, { method: 'PATCH', prefer: 'return=minimal', body: { resolved_at: new Date().toISOString() } });
    }

    if (last && lastAt && now - lastAt < 300_000) {
      const here: [number, number] = [Number(last.latitude), Number(last.longitude)];

      // Đứng yên > 15 phút (mọi điểm trong 15 phút gần nhất cách nhau < 100 m) và không ở gần điểm dừng chờ
      const recent = locs.filter((l) => now - Date.parse(l.recorded_at) <= 15 * 60_000);
      const spanMs = recent.length ? Date.parse(recent[0].recorded_at) - Date.parse(recent[recent.length - 1].recorded_at) : 0;
      if (recent.length >= 5 && spanMs >= 14 * 60_000 && recent.every((l) => distM(here, [Number(l.latitude), Number(l.longitude)]) < 100)) {
        const pend = await svc<any[]>(env, `route_stops?route_id=eq.${r.id}&status=in.(pending,arrived)&select=latitude,longitude`);
        const nearStop = (pend || []).some((s) => s.latitude != null && distM(here, [Number(s.latitude), Number(s.longitude)]) < 150);
        if (!nearStop) alerts.push({ route_id: r.id, driver_id: r.driver_id, type: 'idle_too_long', severity: 'warning', message: `${name} đứng yên hơn 15 phút ngoài điểm giao.`, dedupe_key: `idle:${r.id}:${bucket10}` });
      }

      // Lệch tuyến > 500 m so với đường dự kiến (so với đỉnh gần nhất của polyline đã đơn giản hóa)
      const geo = r.route_geometry as Array<[number, number]> | null;
      if (geo?.length && recent.length >= 3) {
        const off = recent.slice(0, 3).every((l) => Math.min(...geo.map((p) => distM(p, [Number(l.latitude), Number(l.longitude)]))) > 500);
        if (off) alerts.push({ route_id: r.id, driver_id: r.driver_id, type: 'off_route', severity: 'warning', message: `${name} đang lệch tuyến dự kiến hơn 500 m.`, dedupe_key: `off:${r.id}:${bucket10}` });
      }
    }

    // Nguy cơ trễ giờ hẹn
    const late = await svc<any[]>(env, `route_stops?route_id=eq.${r.id}&status=in.(pending,arrived)&time_window_end=lt.${new Date(now).toISOString()}&select=id,orders(order_number)`);
    for (const s of late || []) {
      alerts.push({ route_id: r.id, driver_id: r.driver_id, type: 'late_risk', severity: 'warning', message: `Đơn ${s.orders?.order_number || ''} đã quá giờ hẹn mà chưa giao.`, dedupe_key: `late:${s.id}` });
    }
  }
  await raise(env, alerts);
  return { routes: routes?.length || 0, raised: alerts.length };
}

export { inList };
