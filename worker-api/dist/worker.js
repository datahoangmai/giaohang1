// src/http.ts
class HttpError extends Error {
  status;
  detail;
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}
function corsHeaders(env, req) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "null",
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }
  });
}
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Nội dung JSON không hợp lệ.");
  }
}
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(v, label = "id") {
  if (typeof v !== "string" || !UUID_RE.test(v))
    throw new HttpError(400, `${label} không hợp lệ.`);
  return v;
}
function randomPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

// src/supabase.ts
async function rest(env, token, path, init = {}) {
  const { body, prefer, headers, ...rest } = init;
  const key = token ? env.SUPABASE_ANON_KEY : env.SUPABASE_SERVICE_ROLE_KEY;
  const h = {
    apikey: key,
    Authorization: `Bearer ${token || env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...headers || {}
  };
  if (prefer)
    h.Prefer = prefer;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...rest,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 204)
    return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const code = data?.code;
    const status = code === "23505" ? 409 : res.status === 401 || res.status === 403 ? res.status : res.status >= 500 ? 502 : 400;
    throw new HttpError(status, data?.message || `Lỗi cơ sở dữ liệu (${res.status})`, data);
  }
  return data;
}
var svc = (env, path, init = {}) => rest(env, null, path, init);
async function gotrue(env, path, init = {}) {
  const key = init.admin ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/${path}`, {
    method: init.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${init.token || key}`,
      "Content-Type": "application/json"
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}
var tokenCache = new Map;
async function requireAuth(req, env, roles) {
  const header = req.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token)
    throw new HttpError(401, "Thiếu thông tin đăng nhập.");
  const now = Date.now();
  let uid = tokenCache.get(token)?.uid;
  if (!uid || (tokenCache.get(token)?.exp || 0) < now) {
    const r = await gotrue(env, "user", { token });
    if (!r.ok || !r.data?.id)
      throw new HttpError(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
    uid = r.data.id;
    tokenCache.set(token, { uid, exp: now + 30000 });
    if (tokenCache.size > 500)
      tokenCache.clear();
  }
  const rows = await svc(env, `profiles?id=eq.${uid}&select=*`);
  const profile = rows?.[0];
  if (!profile || !profile.is_active)
    throw new HttpError(403, "Tài khoản đã bị khóa hoặc chưa được cấp quyền.");
  if (roles && !roles.includes(profile.role))
    throw new HttpError(403, "Bạn không có quyền thực hiện thao tác này.");
  return { token, profile };
}
async function audit(env, actor, action, entityType, entityId, before, after, req, metadata = {}) {
  try {
    await svc(env, "system_audit_logs", {
      method: "POST",
      body: {
        actor_id: actor,
        action,
        entity_type: entityType,
        entity_id: entityId,
        ip_address: req?.headers.get("CF-Connecting-IP") || null,
        user_agent: req?.headers.get("User-Agent")?.slice(0, 300) || null,
        before_data: before ?? null,
        after_data: after ?? null,
        metadata
      }
    });
  } catch (e) {
    console.error("audit failed", e);
  }
}
async function getDefaultBranch(env) {
  const q = env.DEFAULT_BRANCH_ID ? `branches?id=eq.${env.DEFAULT_BRANCH_ID}&select=id,latitude,longitude` : "branches?is_active=eq.true&select=id,latitude,longitude&order=created_at.asc&limit=1";
  const rows = await svc(env, q);
  const b = rows?.[0];
  if (!b)
    throw new HttpError(500, "Chưa có chi nhánh (branches) nào đang hoạt động.");
  return { id: b.id, lat: Number(b.latitude) || 10.7825, lng: Number(b.longitude) || 106.698 };
}
function inList(values) {
  return `in.(${values.map((v) => String(v).replace(/[(),"]/g, "")).join(",")})`;
}

// src/alerts.ts
function distM(a, b) {
  const R = 6371000;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
async function raise(env, rows) {
  if (!rows.length)
    return;
  await svc(env, "alerts?on_conflict=dedupe_key", { method: "POST", body: rows, prefer: "resolution=ignore-duplicates,return=minimal" });
}
async function computeAlerts(env) {
  const routes = await svc(env, "delivery_routes?status=eq.in_progress&select=id,driver_id,actual_start_at,route_geometry,drivers(profiles(full_name))");
  const now = Date.now();
  const bucket10 = Math.floor(now / 600000);
  const alerts = [];
  for (const r of routes || []) {
    const name = r.drivers?.profiles?.full_name || "Tài xế";
    const locs = await svc(env, `driver_locations?route_id=eq.${r.id}&select=latitude,longitude,recorded_at&order=recorded_at.desc&limit=30`);
    const last = locs?.[0];
    const lastAt = last ? Date.parse(last.recorded_at) : null;
    const startedAt = r.actual_start_at ? Date.parse(r.actual_start_at) : now;
    const silentMs = now - (lastAt ?? startedAt);
    if (silentMs > 120000) {
      alerts.push({ route_id: r.id, driver_id: r.driver_id, type: "no_signal", severity: "critical", message: `${name} mất tín hiệu GPS ${Math.round(silentMs / 60000)} phút.`, dedupe_key: `no_signal:${r.id}:${bucket10}` });
    } else {
      await svc(env, `alerts?route_id=eq.${r.id}&type=eq.no_signal&resolved_at=is.null`, { method: "PATCH", prefer: "return=minimal", body: { resolved_at: new Date().toISOString() } });
    }
    if (last && lastAt && now - lastAt < 300000) {
      const here = [Number(last.latitude), Number(last.longitude)];
      const recent = locs.filter((l) => now - Date.parse(l.recorded_at) <= 15 * 60000);
      const spanMs = recent.length ? Date.parse(recent[0].recorded_at) - Date.parse(recent[recent.length - 1].recorded_at) : 0;
      if (recent.length >= 5 && spanMs >= 14 * 60000 && recent.every((l) => distM(here, [Number(l.latitude), Number(l.longitude)]) < 100)) {
        const pend = await svc(env, `route_stops?route_id=eq.${r.id}&status=in.(pending,arrived)&select=latitude,longitude`);
        const nearStop = (pend || []).some((s) => s.latitude != null && distM(here, [Number(s.latitude), Number(s.longitude)]) < 150);
        if (!nearStop)
          alerts.push({ route_id: r.id, driver_id: r.driver_id, type: "idle_too_long", severity: "warning", message: `${name} đứng yên hơn 15 phút ngoài điểm giao.`, dedupe_key: `idle:${r.id}:${bucket10}` });
      }
      const geo = r.route_geometry;
      if (geo?.length && recent.length >= 3) {
        const off = recent.slice(0, 3).every((l) => Math.min(...geo.map((p) => distM(p, [Number(l.latitude), Number(l.longitude)]))) > 500);
        if (off)
          alerts.push({ route_id: r.id, driver_id: r.driver_id, type: "off_route", severity: "warning", message: `${name} đang lệch tuyến dự kiến hơn 500 m.`, dedupe_key: `off:${r.id}:${bucket10}` });
      }
    }
    const late = await svc(env, `route_stops?route_id=eq.${r.id}&status=in.(pending,arrived)&time_window_end=lt.${new Date(now).toISOString()}&select=id,orders(order_number)`);
    for (const s of late || []) {
      alerts.push({ route_id: r.id, driver_id: r.driver_id, type: "late_risk", severity: "warning", message: `Đơn ${s.orders?.order_number || ""} đã quá giờ hẹn mà chưa giao.`, dedupe_key: `late:${s.id}` });
    }
  }
  await raise(env, alerts);
  return { routes: routes?.length || 0, raised: alerts.length };
}

// src/geocode.ts
function inVietnam(lat, lng) {
  return lat >= 8 && lat <= 24 && lng >= 102 && lng <= 110;
}
function distKm(a, b) {
  const R = 6371;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function normalizeAddress(addr) {
  let s = addr.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();
  if (!/vi[eệ]t\s*nam/i.test(s))
    s += ", Việt Nam";
  return s;
}
async function geocode(env, address, hub) {
  const provider = (env.GEOCODE_PROVIDER || "none").toLowerCase();
  const key = env.GEOCODE_API_KEY;
  const q = encodeURIComponent(normalizeAddress(address));
  if (!address.trim() || provider === "none" || !key) {
    return { lat: null, lng: null, status: "failed", provider: "none" };
  }
  try {
    let lat = null;
    let lng = null;
    let precise = false;
    if (provider === "goong") {
      const r = await fetch(`https://rsapi.goong.io/geocode?address=${q}&api_key=${key}`);
      const d = await r.json();
      const loc = d?.results?.[0]?.geometry?.location;
      if (loc) {
        lat = loc.lat;
        lng = loc.lng;
        precise = /^\s*\d/.test(address);
      }
    } else if (provider === "google") {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${q}&region=vn&language=vi&key=${key}`);
      const d = await r.json();
      const first = d?.results?.[0];
      if (first?.geometry?.location) {
        lat = first.geometry.location.lat;
        lng = first.geometry.location.lng;
        const lt = first.geometry.location_type;
        precise = (lt === "ROOFTOP" || lt === "RANGE_INTERPOLATED") && !first.partial_match;
      }
    }
    if (lat === null || lng === null || !inVietnam(lat, lng)) {
      return { lat: null, lng: null, status: "failed", provider };
    }
    let status = precise ? "ok" : "low_confidence";
    if (hub && distKm([hub.lat, hub.lng], [lat, lng]) > 80)
      status = "low_confidence";
    return { lat, lng, status, provider };
  } catch (e) {
    console.error("geocode error", e);
    return { lat: null, lng: null, status: "failed", provider };
  }
}

// src/odoo.ts
var SHIPPING_FIELDS = [
  "name",
  "sale_id",
  "partner_shipping_id",
  "partner_source_id",
  "phone",
  "from_address",
  "to_address",
  "state",
  "distance",
  "scheduled_date",
  "done_date",
  "total_amount",
  "amount_fee",
  "extra_amount",
  "shipper_id",
  "x_shipper",
  "x_mvd",
  "x_dvvt",
  "x_hotrolapdat",
  "x_cpvc",
  "x_tongchiphi",
  "x_nvkdso",
  "note",
  "internal_note",
  "create_date",
  "write_date"
];
async function odooExec(env, model, method, args, kwargs = {}) {
  if (!env.ODOO_URL || !env.ODOO_API_KEY)
    throw new HttpError(503, "Chưa cấu hình kết nối Odoo trên Worker.");
  const res = await fetch(`${env.ODOO_URL.replace(/\/$/, "")}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [env.ODOO_DB, Number(env.ODOO_UID), env.ODOO_API_KEY, model, method, args, kwargs]
      }
    })
  });
  if (!res.ok)
    throw new HttpError(502, `Odoo trả về HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) {
    throw new HttpError(502, `Odoo: ${data.error.data?.message || data.error.message || "lỗi không rõ"}`);
  }
  return data.result;
}
async function odooHealth(env) {
  const out = { ok: false, url: env.ODOO_URL || "", db: env.ODOO_DB || "", missingFields: [], steps: [] };
  const step = (name, ok, detail) => out.steps.push({ step: name, ok, detail });
  const missing = ["ODOO_URL", "ODOO_DB", "ODOO_UID", "ODOO_API_KEY"].filter((k) => !env[k]);
  if (missing.length) {
    step("Cấu hình Worker", false, `Thiếu: ${missing.join(", ")}`);
    return out;
  }
  step("Cấu hình Worker", true, "Đủ ODOO_URL, ODOO_DB, ODOO_UID, ODOO_API_KEY");
  try {
    const r = await fetch(`${env.ODOO_URL.replace(/\/$/, "")}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service: "common", method: "version", args: [] } })
    });
    if (!r.ok)
      throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.error)
      throw new Error(d.error.data?.message || d.error.message);
    out.version = d.result?.server_version;
    step("Máy chủ Odoo", true, `Odoo ${out.version || "?"}`);
  } catch (e) {
    step("Máy chủ Odoo", false, `Không gọi được ${env.ODOO_URL}/jsonrpc: ${e.message}`);
    return out;
  }
  try {
    const u = await odooExec(env, "res.users", "read", [[Number(env.ODOO_UID)]], { fields: ["name", "login"] });
    if (!u?.length)
      throw new Error("Không đọc được user theo ODOO_UID");
    out.user = `${u[0].name} (${u[0].login})`;
    step("Xác thực (UID + API key)", true, out.user);
  } catch (e) {
    step("Xác thực (UID + API key)", false, e.message);
    return out;
  }
  try {
    const f = await odooExec(env, "shipping.order", "fields_get", [], { attributes: ["type"] });
    out.missingFields = SHIPPING_FIELDS.filter((x) => !(x in f));
    step("Model shipping.order", out.missingFields.length === 0, out.missingFields.length ? `Thiếu trường: ${out.missingFields.join(", ")}` : `Đủ ${SHIPPING_FIELDS.length} trường cần dùng`);
  } catch (e) {
    step("Model shipping.order", false, e.message);
    return out;
  }
  try {
    out.totalOrders = await odooExec(env, "shipping.order", "search_count", [[]]);
    step("Đọc dữ liệu", true, `${out.totalOrders} phiếu giao trong Odoo`);
  } catch (e) {
    step("Đọc dữ liệu", false, e.message);
    return out;
  }
  out.ok = out.steps.every((x) => x.ok);
  return out;
}
var odooIso = (s) => s.replace(" ", "T") + "Z";
var vnDate = (s) => new Date(new Date(odooIso(s)).getTime() + 7 * 3600000).toISOString().slice(0, 10);
var str = (v) => typeof v === "string" ? v : "";
function mapStatus(odooState, current) {
  switch (odooState) {
    case "done":
      return "delivered";
    case "cancel":
      return "cancelled";
    case "in_delivery":
      return "in_transit";
    case "assigned":
      return current === "in_transit" ? current : "assigned";
    default:
      return current && ["assigned", "in_transit", "failed"].includes(current) ? current : "unassigned";
  }
}
async function loadPersonMaps(env) {
  const rows = await svc(env, "profiles?is_active=eq.true&role=in.(driver,sale)&select=id,full_name,employee_code,odoo_employee_id");
  const m = { byEmployee: new Map, byCode: new Map, byName: new Map };
  for (const p of rows || []) {
    if (p.odoo_employee_id)
      m.byEmployee.set(p.odoo_employee_id, p.id);
    if (p.employee_code)
      m.byCode.set(p.employee_code.toLowerCase(), p.id);
    m.byName.set(p.full_name.trim().toLowerCase(), p.id);
  }
  return m;
}
function matchPerson(v, maps) {
  if (!v)
    return null;
  const [id, name] = v;
  if (maps.byEmployee.has(id))
    return maps.byEmployee.get(id);
  const code = /\(([^)]+)\)\s*$/.exec(name)?.[1]?.trim().toLowerCase();
  if (code && maps.byCode.has(code))
    return maps.byCode.get(code);
  const plain = name.replace(/\([^)]*\)/g, "").trim().toLowerCase();
  return maps.byName.get(plain) || null;
}
var PREPAID_RE = /(đã thanh toán|da thanh toan|vnpay|chuyển khoản|chuyen khoan|0 đồng)/i;
async function syncOdoo(env, opts = {}) {
  const t0 = Date.now();
  const branch = await getDefaultBranch(env);
  const stateRows = await svc(env, "sync_state?key=eq.odoo_shipping&select=value");
  const lastWrite = opts.full ? null : stateRows?.[0]?.value?.last_write_date || null;
  const domain = lastWrite ? [["write_date", ">=", lastWrite]] : [["state", "in", ["draft", "ready", "assigned", "in_delivery"]]];
  const records = [];
  const PAGE = 200;
  for (let page = 0;page < 10; page++) {
    const batch = await odooExec(env, "shipping.order", "search_read", [domain], {
      fields: SHIPPING_FIELDS,
      limit: PAGE,
      offset: page * PAGE,
      order: "write_date asc, id asc"
    });
    records.push(...batch);
    if (batch.length < PAGE)
      break;
  }
  const stats = {
    fetched: records.length,
    inserted: 0,
    updated: 0,
    geocoded: 0,
    geocodePending: 0,
    lastWriteDate: lastWrite,
    durationMs: 0
  };
  if (records.length) {
    const maps = await loadPersonMaps(env);
    const existing = new Map;
    for (let i = 0;i < records.length; i += 100) {
      const ids = records.slice(i, i + 100).map((r) => r.id);
      const rows = await svc(env, `orders?source_system=eq.odoo&source_model=eq.shipping.order&source_record_id=${inList(ids)}` + `&select=id,source_record_id,status,delivery_address,geocode_status,branch_id`);
      for (const r of rows || [])
        existing.set(String(r.source_record_id), r);
    }
    const inserts = [];
    const updates = [];
    const conflictAlerts = [];
    for (const r of records) {
      const cur = existing.get(String(r.id));
      const address = str(r.to_address);
      const note = str(r.note);
      const total = Number(r.total_amount) || 0;
      const status = mapStatus(r.state, cur?.status);
      const addrChanged = cur ? cur.delivery_address !== address : true;
      const geocodeStatus = !cur ? "pending" : addrChanged && cur.geocode_status !== "manual" ? "pending" : cur.geocode_status;
      const row = {
        source_system: "odoo",
        source_model: "shipping.order",
        source_record_id: String(r.id),
        odoo_shipping_order_id: r.id,
        order_number: r.name,
        customer_name: r.partner_shipping_id ? r.partner_shipping_id[1] : "Khách hàng Odoo",
        customer_phone: str(r.phone) || null,
        delivery_address: address || "(chưa có địa chỉ)",
        delivery_note: note || null,
        status,
        subtotal: total,
        shipping_fee: Number(r.amount_fee) || Number(r.x_cpvc) || 0,
        cod_amount: total,
        currency: "VND",
        requested_delivery_date: r.scheduled_date ? vnDate(r.scheduled_date) : null,
        scheduled_at: r.scheduled_date ? odooIso(r.scheduled_date) : null,
        tracking_code: str(r.x_mvd) || null,
        carrier_service: str(r.x_dvvt) || "noi_bo",
        has_installation: Boolean(r.x_hotrolapdat),
        extra_amount: Number(r.extra_amount) || 0,
        total_shipping_cost: Number(r.x_tongchiphi) || 0,
        odoo_state: r.state,
        odoo_write_date: odooIso(r.write_date),
        odoo_raw: r,
        sale_profile_id: matchPerson(r.x_nvkdso, maps),
        shipper_profile_id: matchPerson(r.x_shipper, maps),
        service_minutes: r.x_hotrolapdat ? 20 : 5,
        cod_needs_review: total > 0 && PREPAID_RE.test(note),
        geocode_status: geocodeStatus
      };
      if (cur) {
        updates.push(row);
        if (["assigned", "in_transit"].includes(cur.status) && (r.state === "cancel" || r.state === "done" && cur.status !== "delivered")) {
          conflictAlerts.push({
            order_id: cur.id,
            type: "odoo_conflict",
            severity: "critical",
            message: `Phiếu ${r.name} đã ${r.state === "cancel" ? "bị hủy" : "hoàn tất"} trên Odoo nhưng đang nằm trong tuyến giao.`,
            dedupe_key: `odoo_conflict:${cur.id}:${r.state}`
          });
        }
      } else {
        inserts.push({ ...row, branch_id: branch.id });
      }
    }
    const upsert = (rows) => svc(env, "orders?on_conflict=source_system,source_model,source_record_id", {
      method: "POST",
      body: rows,
      prefer: "resolution=merge-duplicates,return=minimal"
    });
    for (let i = 0;i < inserts.length; i += 200)
      await upsert(inserts.slice(i, i + 200));
    for (let i = 0;i < updates.length; i += 200)
      await upsert(updates.slice(i, i + 200));
    stats.inserted = inserts.length;
    stats.updated = updates.length;
    if (conflictAlerts.length) {
      await svc(env, "alerts?on_conflict=dedupe_key", { method: "POST", body: conflictAlerts, prefer: "resolution=ignore-duplicates,return=minimal" });
    }
    stats.lastWriteDate = records.reduce((mx, r) => r.write_date > mx ? r.write_date : mx, lastWrite || "");
    await svc(env, "sync_state?on_conflict=key", {
      method: "POST",
      body: { key: "odoo_shipping", value: { last_write_date: stats.lastWriteDate, last_run_at: new Date().toISOString(), last_stats: { fetched: stats.fetched } }, updated_at: new Date().toISOString() },
      prefer: "resolution=merge-duplicates,return=minimal"
    });
  }
  const g = await geocodePending(env, opts.maxGeocode ?? 20);
  stats.geocoded = g.done;
  stats.geocodePending = g.remaining;
  stats.durationMs = Date.now() - t0;
  return stats;
}
async function geocodePending(env, limit) {
  const branch = await getDefaultBranch(env);
  const rows = await svc(env, `orders?geocode_status=eq.pending&select=id,delivery_address&order=created_at.asc&limit=${limit}`);
  let done = 0;
  for (const o of rows || []) {
    const g = await geocode(env, o.delivery_address, branch);
    await svc(env, `orders?id=eq.${o.id}`, {
      method: "PATCH",
      body: { latitude: g.lat, longitude: g.lng, geocode_status: g.status, geocode_provider: g.provider },
      prefer: "return=minimal"
    });
    if (g.status === "failed") {
      await svc(env, "alerts?on_conflict=dedupe_key", {
        method: "POST",
        prefer: "resolution=ignore-duplicates,return=minimal",
        body: { order_id: o.id, type: "geocode_failed", severity: "warning", message: `Không xác định được tọa độ: ${o.delivery_address}`, dedupe_key: `geocode_failed:${o.id}:${(o.delivery_address || "").length}` }
      });
    }
    done++;
  }
  const left = await svc(env, "orders?geocode_status=eq.pending&select=id&limit=1");
  return { done, remaining: left?.length ? 1 : 0 };
}
async function enqueueOdooState(env, order, state, message, eventKey) {
  if (!order.odoo_shipping_order_id)
    return null;
  const rows = await svc(env, "odoo_sync_jobs?on_conflict=idempotency_key", {
    method: "POST",
    prefer: "resolution=ignore-duplicates,return=representation",
    body: {
      idempotency_key: `odoo:${order.id}:${state}:${eventKey}`,
      source_system: "odoo",
      source_model: "shipping.order",
      source_record_id: String(order.odoo_shipping_order_id),
      operation: "set_state",
      status: "pending",
      payload: { order_id: order.id, odoo_id: order.odoo_shipping_order_id, state, message, done_date: state === "done" ? new Date().toISOString() : null }
    }
  });
  return rows?.[0]?.id || null;
}
var odooDateTime = (iso) => iso.replace("T", " ").slice(0, 19);
async function processOdooQueue(env, limit = 10) {
  const now = new Date().toISOString();
  const jobs = await svc(env, `odoo_sync_jobs?status=eq.pending&operation=eq.set_state&or=(next_retry_at.is.null,next_retry_at.lte.${now})&order=created_at.asc&limit=${limit}`);
  const out = { processed: 0, synced: 0, failed: 0, conflict: 0 };
  for (const job of jobs || []) {
    out.processed++;
    const p = job.payload;
    try {
      const cur = await odooExec(env, "shipping.order", "read", [[p.odoo_id]], { fields: ["state"] });
      const curState = cur?.[0]?.state;
      if (!cur?.length)
        throw new HttpError(404, "Phiếu Odoo không còn tồn tại.");
      if (curState === p.state) {
        await finishJob(env, job, "synced", { note: "Odoo đã ở trạng thái đích" });
        out.synced++;
        continue;
      }
      if ((curState === "done" || curState === "cancel") && p.state !== curState) {
        await finishJob(env, job, "conflict", { odoo_state: curState }, `Odoo đang ở trạng thái "${curState}", không ghi đè thành "${p.state}".`);
        await svc(env, "alerts?on_conflict=dedupe_key", {
          method: "POST",
          prefer: "resolution=ignore-duplicates,return=minimal",
          body: { order_id: p.order_id, type: "odoo_conflict", severity: "critical", message: `Xung đột ghi ngược Odoo: phiếu #${p.odoo_id} đang "${curState}", app muốn đặt "${p.state}".`, dedupe_key: `odoo_conflict:${job.id}` }
        });
        out.conflict++;
        continue;
      }
      if (p.state === "done" && env.ODOO_DONE_METHOD) {
        await odooExec(env, "shipping.order", env.ODOO_DONE_METHOD, [[p.odoo_id]]);
      } else {
        const vals = { state: p.state };
        if (p.state === "done")
          vals.done_date = odooDateTime(p.done_date || new Date().toISOString());
        await odooExec(env, "shipping.order", "write", [[p.odoo_id], vals]);
      }
      if (p.message) {
        try {
          await odooExec(env, "shipping.order", "message_post", [[p.odoo_id]], { body: p.message });
        } catch (e) {
          console.warn("message_post bỏ qua:", e.message);
        }
      }
      await finishJob(env, job, "synced", { written_state: p.state });
      await svc(env, `orders?id=eq.${p.order_id}`, { method: "PATCH", body: { odoo_state: p.state }, prefer: "return=minimal" });
      out.synced++;
    } catch (e) {
      const attempts = (job.attempts || 0) + 1;
      const max = job.max_attempts || 8;
      const terminal = attempts >= max;
      await svc(env, `odoo_sync_jobs?id=eq.${job.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          attempts,
          status: terminal ? "failed" : "pending",
          last_error: e.message.slice(0, 500),
          next_retry_at: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60000).toISOString()
        }
      });
      if (terminal)
        out.failed++;
    }
  }
  return out;
}
async function finishJob(env, job, status, response, error) {
  await svc(env, `odoo_sync_jobs?id=eq.${job.id}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: { status, attempts: (job.attempts || 0) + 1, completed_at: new Date().toISOString(), response_data: response, last_error: error || null }
  });
}

// src/delivery.ts
async function myDriverId(env, profileId) {
  const r = await svc(env, `drivers?profile_id=eq.${profileId}&select=id`);
  return r?.[0]?.id || null;
}
async function startRoute(req, env, ctx, routeId) {
  const auth = await requireAuth(req, env, ["admin", "dispatcher", "driver"]);
  assertUuid(routeId);
  const route = (await svc(env, `delivery_routes?id=eq.${routeId}&select=*`))?.[0];
  if (!route)
    throw new HttpError(404, "Không tìm thấy tuyến.");
  if (auth.profile.role === "driver" && route.driver_id !== await myDriverId(env, auth.profile.id))
    throw new HttpError(403, "Đây không phải tuyến của bạn.");
  if (route.status === "in_progress")
    return json({ ok: true, already: true });
  if (route.status !== "assigned")
    throw new HttpError(409, `Tuyến đang ở trạng thái "${route.status}", không thể bắt đầu.`);
  await svc(env, `delivery_routes?id=eq.${routeId}`, { method: "PATCH", prefer: "return=minimal", body: { status: "in_progress", actual_start_at: new Date().toISOString() } });
  const stops = await svc(env, `route_stops?route_id=eq.${routeId}&select=order_id,orders(id,order_number,odoo_shipping_order_id,status)`);
  const orderIds = stops.map((s) => s.order_id);
  if (orderIds.length) {
    await svc(env, `orders?id=${inList(orderIds)}&status=in.(assigned,unassigned)`, { method: "PATCH", prefer: "return=minimal", body: { status: "in_transit" } });
    await svc(env, "delivery_events", {
      method: "POST",
      prefer: "return=minimal",
      body: orderIds.map((id) => ({ order_id: id, route_id: routeId, actor_id: auth.profile.id, event_type: "ROUTE_STARTED", description: "Tài xế bắt đầu tuyến" }))
    });
    for (const s of stops) {
      if (s.orders)
        await enqueueOdooState(env, s.orders, "in_delivery", "Hachihi: tài xế đã nhận hàng và bắt đầu giao.", `start:${routeId}`);
    }
    ctx.waitUntil(processOdooQueue(env, 20).catch((e) => console.error(e)));
  }
  await audit(env, auth.profile.id, "route.start", "delivery_route", routeId, null, null, req);
  return json({ ok: true });
}
async function stopEvent(req, env, ctx, stopId) {
  const auth = await requireAuth(req, env, ["admin", "dispatcher", "driver"]);
  assertUuid(stopId);
  const b = await readJson(req);
  if (!b.eventType || !["ARRIVED_STOP", "DELIVERED", "FAILED_ATTEMPT"].includes(b.eventType))
    throw new HttpError(400, "eventType không hợp lệ.");
  if (!b.clientEventId || !UUID_RE.test(b.clientEventId))
    throw new HttpError(400, "clientEventId phải là UUID.");
  if (b.eventType === "FAILED_ATTEMPT" && !b.failureReason?.trim())
    throw new HttpError(400, "Cần nhập lý do giao thất bại.");
  const stop = (await svc(env, `route_stops?id=eq.${stopId}&select=*,delivery_routes(id,driver_id,status),orders(id,order_number,cod_amount,odoo_shipping_order_id,status)`))?.[0];
  if (!stop)
    throw new HttpError(404, "Không tìm thấy điểm dừng.");
  const driverId = await myDriverId(env, auth.profile.id);
  if (auth.profile.role === "driver" && stop.delivery_routes.driver_id !== driverId)
    throw new HttpError(403, "Điểm dừng này không thuộc tuyến của bạn.");
  if (stop.delivery_routes.status !== "in_progress" && b.eventType !== "ARRIVED_STOP") {
    throw new HttpError(409, "Tuyến chưa bắt đầu hoặc đã kết thúc.");
  }
  const dup = await svc(env, `delivery_events?idempotency_key=eq.${b.clientEventId}&select=id`);
  if (dup?.length)
    return json({ ok: true, duplicate: true });
  if (["completed", "failed"].includes(stop.status))
    throw new HttpError(409, "Điểm dừng này đã được chốt kết quả.");
  const when = b.timestamp && !Number.isNaN(Date.parse(b.timestamp)) ? new Date(b.timestamp).toISOString() : new Date().toISOString();
  await svc(env, "delivery_events", {
    method: "POST",
    prefer: "return=minimal",
    body: {
      idempotency_key: b.clientEventId,
      order_id: stop.order_id,
      route_id: stop.route_id,
      route_stop_id: stop.id,
      actor_id: auth.profile.id,
      event_type: b.eventType,
      event_time: when,
      latitude: b.lat ?? null,
      longitude: b.lng ?? null,
      description: b.note || b.failureReason || null,
      metadata: { accuracy: b.accuracy ?? null, recipientName: b.recipientName ?? null, failureReason: b.failureReason ?? null }
    }
  });
  const order = stop.orders;
  let codRecorded;
  if (b.eventType === "ARRIVED_STOP") {
    await svc(env, `route_stops?id=eq.${stopId}`, { method: "PATCH", prefer: "return=minimal", body: { status: "arrived", arrived_at: when } });
  } else if (b.eventType === "DELIVERED") {
    await svc(env, `route_stops?id=eq.${stopId}`, { method: "PATCH", prefer: "return=minimal", body: { status: "completed", completed_at: when, note: b.note || null } });
    await svc(env, `orders?id=eq.${order.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "delivered" } });
    const cod = Number(order.cod_amount) || 0;
    if (cod > 0 && driverId) {
      try {
        await svc(env, "cod_transactions", {
          method: "POST",
          prefer: "return=minimal",
          body: { order_id: order.id, driver_id: driverId, route_id: stop.route_id, transaction_type: "collection", amount: cod, currency: "VND", payment_method: "cash", description: `Thu COD đơn ${order.order_number}`, created_by: auth.profile.id, transaction_time: when }
        });
        codRecorded = true;
      } catch (e) {
        codRecorded = false;
        console.error("Ghi COD thất bại (kiểm tra nhãn enum transaction_type):", e);
      }
    }
    await enqueueOdooState(env, order, "done", `Hachihi: đã giao thành công${b.recipientName ? ` — người nhận: ${b.recipientName}` : ""}${b.note ? ` — ${b.note}` : ""}.`, b.clientEventId);
  } else {
    await svc(env, `route_stops?id=eq.${stopId}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed", failure_reason: b.failureReason, note: b.note || null, completed_at: when } });
    await svc(env, `orders?id=eq.${order.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed" } });
    await svc(env, "alerts?on_conflict=dedupe_key", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: { route_id: stop.route_id, order_id: order.id, driver_id: stop.delivery_routes.driver_id, type: "failed_delivery", severity: "warning", message: `Giao thất bại đơn ${order.order_number}: ${b.failureReason}`, dedupe_key: `failed:${stopId}:${b.clientEventId}` }
    });
    await enqueueOdooState(env, order, "ready", `Hachihi: giao thất bại — ${b.failureReason}${b.note ? ` (${b.note})` : ""}.`, b.clientEventId);
  }
  if (b.eventType !== "ARRIVED_STOP") {
    const left = await svc(env, `route_stops?route_id=eq.${stop.route_id}&status=in.(pending,arrived)&select=id&limit=1`);
    if (!left?.length) {
      await svc(env, `delivery_routes?id=eq.${stop.route_id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "completed", actual_end_at: when } });
    }
  }
  ctx.waitUntil(processOdooQueue(env, 10).catch((e) => console.error(e)));
  await audit(env, auth.profile.id, `stop.${b.eventType.toLowerCase()}`, "route_stop", stopId, { status: stop.status }, { eventType: b.eventType }, req);
  return json({ ok: true, codRecorded });
}
async function patchRoute(req, env, routeId) {
  const auth = await requireAuth(req, env, ["admin", "dispatcher"]);
  assertUuid(routeId);
  const b = await readJson(req);
  const route = (await svc(env, `delivery_routes?id=eq.${routeId}&select=*`))?.[0];
  if (!route)
    throw new HttpError(404, "Không tìm thấy tuyến.");
  if (["completed", "cancelled"].includes(route.status))
    throw new HttpError(409, "Tuyến đã kết thúc, không thể sửa.");
  const patch = {};
  if (b.driverId)
    patch.driver_id = assertUuid(b.driverId, "driverId");
  if (b.vehicleId)
    patch.vehicle_id = assertUuid(b.vehicleId, "vehicleId");
  if (Object.keys(patch).length) {
    await svc(env, `delivery_routes?id=eq.${routeId}`, { method: "PATCH", prefer: "return=minimal", body: patch });
  }
  if (b.stopOrder?.length) {
    const stops = await svc(env, `route_stops?route_id=eq.${routeId}&select=id,status,sequence_no`);
    const ids = new Set(stops.map((s) => s.id));
    if (b.stopOrder.length !== stops.length || b.stopOrder.some((id) => !ids.has(id)))
      throw new HttpError(400, "Danh sách điểm dừng không khớp với tuyến.");
    const done = new Set(stops.filter((s) => ["completed", "failed"].includes(s.status)).map((s) => s.id));
    const lockedPrefix = stops.filter((s) => done.has(s.id)).sort((a, b) => a.sequence_no - b.sequence_no).map((s) => s.id);
    const head = b.stopOrder.slice(0, lockedPrefix.length);
    if (head.join() !== lockedPrefix.join())
      throw new HttpError(400, "Không được đổi vị trí các điểm đã giao.");
    for (const [i, id] of b.stopOrder.entries()) {
      await svc(env, `route_stops?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: { sequence_no: 1000 + i } });
    }
    for (const [i, id] of b.stopOrder.entries()) {
      await svc(env, `route_stops?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: { sequence_no: i + 1 } });
    }
  }
  await audit(env, auth.profile.id, "route.update", "delivery_route", routeId, route, { ...patch, stopOrder: b.stopOrder }, req);
  return json({ ok: true });
}
async function setOrderLocation(req, env, orderId) {
  const auth = await requireAuth(req, env, ["admin", "dispatcher"]);
  assertUuid(orderId);
  const b = await readJson(req);
  const before = (await svc(env, `orders?id=eq.${orderId}&select=id,delivery_address,latitude,longitude,geocode_status`))?.[0];
  if (!before)
    throw new HttpError(404, "Không tìm thấy đơn.");
  let patch;
  if (typeof b.lat === "number" && typeof b.lng === "number") {
    if (b.lat < 8 || b.lat > 24 || b.lng < 102 || b.lng > 110)
      throw new HttpError(400, "Tọa độ nằm ngoài Việt Nam.");
    patch = { latitude: b.lat, longitude: b.lng, geocode_status: "manual", geocode_provider: "manual" };
    if (b.address?.trim())
      patch.delivery_address = b.address.trim();
  } else {
    const address = (b.address || before.delivery_address || "").trim();
    const g = await geocode(env, address, await getDefaultBranch(env));
    patch = { delivery_address: address, latitude: g.lat, longitude: g.lng, geocode_status: g.status, geocode_provider: g.provider };
  }
  const rows = await svc(env, `orders?id=eq.${orderId}`, { method: "PATCH", prefer: "return=representation", body: patch });
  await audit(env, auth.profile.id, "order.set_location", "order", orderId, before, patch, req);
  return json({ order: { id: orderId, lat: rows[0].latitude, lng: rows[0].longitude, geocodeStatus: rows[0].geocode_status } });
}
async function listOdooShaped(req, env) {
  const auth = await requireAuth(req, env);
  const url = new URL(req.url);
  const states = (url.searchParams.get("states") || "draft,ready,assigned,in_delivery").split(",").filter((s) => /^[a-z_]+$/.test(s));
  const rows = await rest(env, auth.token, `orders?source_system=eq.odoo&odoo_state=${inList(states)}&select=id,odoo_raw,latitude,longitude,geocode_status,cod_amount,cod_needs_review,status&order=scheduled_at.asc.nullslast&limit=500`);
  return json({
    result: (rows || []).map((r) => ({
      ...r.odoo_raw,
      _db_id: r.id,
      _lat: r.latitude == null ? null : Number(r.latitude),
      _lng: r.longitude == null ? null : Number(r.longitude),
      _geocode_status: r.geocode_status,
      _cod_amount: Number(r.cod_amount) || 0,
      _cod_needs_review: !!r.cod_needs_review,
      _status: r.status
    }))
  });
}

// src/optimizer.ts
var LATE_PENALTY = 20;
var OVERTIME_PENALTY = 10;
var BALANCE_WEIGHT = 4;
function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function estimateMatrix(points) {
  const n = points.length;
  const dist = Array.from({ length: n }, () => new Array(n).fill(0));
  const dur = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0;i < n; i++)
    for (let j = 0;j < n; j++) {
      if (i === j)
        continue;
      const km = haversineKm(points[i], points[j]) * 1.35;
      dist[i][j] = km;
      dur[i][j] = km / 22 * 60;
    }
  return { dist, dur, estimated: true };
}
async function osrmMatrix(osrmUrl, points) {
  if (points.length > 90)
    return estimateMatrix(points);
  try {
    const coords = points.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(";");
    const res = await fetch(`${osrmUrl.replace(/\/$/, "")}/table/v1/driving/${coords}?annotations=duration,distance`);
    if (!res.ok)
      throw new Error(`OSRM ${res.status}`);
    const d = await res.json();
    if (d.code !== "Ok" || !d.durations || !d.distances)
      throw new Error("OSRM trả dữ liệu thiếu");
    const n = points.length;
    const fallback = estimateMatrix(points);
    const dur = d.durations.map((row, i) => row.map((v, j) => v == null ? fallback.dur[i][j] : v / 60));
    const dist = d.distances.map((row, i) => row.map((v, j) => v == null ? fallback.dist[i][j] : v / 1000));
    return n ? { dur, dist, estimated: false } : fallback;
  } catch (e) {
    console.warn("OSRM lỗi, dùng ước tính:", e.message);
    return estimateMatrix(points);
  }
}
async function osrmGeometry(osrmUrl, points) {
  if (points.length < 2 || points.length > 90)
    return null;
  try {
    const coords = points.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(";");
    const res = await fetch(`${osrmUrl.replace(/\/$/, "")}/route/v1/driving/${coords}?overview=simplified&geometries=geojson`);
    if (!res.ok)
      return null;
    const d = await res.json();
    const line = d?.routes?.[0]?.geometry?.coordinates;
    return line ? line.map(([lng, lat]) => [lat, lng]) : null;
  } catch {
    return null;
  }
}
function simulate(order, input, m) {
  let t = input.startMin;
  let prev = 0;
  let distanceKm = 0;
  let late = 0;
  const etas = [];
  const lates = [];
  for (const idx of order) {
    const o = input.orders[idx - 1];
    t += m.dur[prev][idx];
    distanceKm += m.dist[prev][idx];
    if (o.windowStart != null && t < o.windowStart)
      t = o.windowStart;
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
    lates
  };
}
function improve(order, input, m) {
  let best = order.slice();
  let bestCost = simulate(best, input, m).cost;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0;i < best.length - 1; i++) {
      for (let k = i + 1;k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const c = simulate(cand, input, m).cost;
        if (c < bestCost - 0.01) {
          best = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
    for (let i = 0;i < best.length; i++) {
      const without = best.filter((_, x) => x !== i);
      for (let j = 0;j <= without.length; j++) {
        if (j === i)
          continue;
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
function buildMatrixPoints(input) {
  return [[input.hub.lat, input.hub.lng], ...input.orders.map((o) => [o.lat, o.lng])];
}
function solve(input, m) {
  const n = input.orders.length;
  const routes = input.vehicles.map(() => []);
  const load = input.vehicles.map(() => 0);
  const unassigned = [];
  const idxs = Array.from({ length: n }, (_, i) => i + 1).sort((a, b) => {
    const wa = input.orders[a - 1].windowEnd ?? 1e9;
    const wb = input.orders[b - 1].windowEnd ?? 1e9;
    if (wa !== wb)
      return wa - wb;
    return m.dur[0][b] - m.dur[0][a];
  });
  for (const idx of idxs) {
    const o = input.orders[idx - 1];
    let bestV = -1;
    let bestPos = 0;
    let bestDelta = Infinity;
    let sawCapacityFail = false;
    for (let v = 0;v < input.vehicles.length; v++) {
      if (load[v] + o.weightKg > input.vehicles[v].capacityKg) {
        sawCapacityFail = true;
        continue;
      }
      if (routes[v].length >= input.maxStopsPerRoute)
        continue;
      const baseCost = simulate(routes[v], input, m).cost;
      for (let pos = 0;pos <= routes[v].length; pos++) {
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
      unassigned.push({ orderId: o.id, reason: sawCapacityFail ? "Vượt tải trọng của tất cả xe còn lại" : "Các xe đã đủ số điểm tối đa" });
    } else {
      routes[bestV].splice(bestPos, 0, idx);
      load[bestV] += o.weightKg;
    }
  }
  for (let v = 0;v < routes.length; v++)
    routes[v] = improve(routes[v], input, m);
  let baseline = 0;
  const rr = input.vehicles.map(() => []);
  Array.from({ length: n }, (_, i) => i + 1).forEach((idx, i) => rr[i % Math.max(1, input.vehicles.length)]?.push(idx));
  for (const r of rr)
    baseline += simulate(r, input, m).distanceKm;
  const out = routes.map((r, v) => {
    const s = simulate(r, input, m);
    return {
      vehicleId: input.vehicles[v].vehicleId,
      driverId: input.vehicles[v].driverId,
      stops: r.map((idx, i) => ({
        orderId: input.orders[idx - 1].id,
        etaMin: Math.round(s.etas[i]),
        lateRisk: s.lates[i] > 0,
        lateByMin: Math.round(s.lates[i])
      })),
      distanceKm: Math.round(s.distanceKm * 10) / 10,
      durationMin: Math.round(s.durationMin),
      totalWeightKg: Math.round(load[v] * 10) / 10,
      totalCod: r.reduce((sum, idx) => sum + input.orders[idx - 1].cod, 0),
      capacityKg: input.vehicles[v].capacityKg,
      geometry: null
    };
  });
  const total = out.reduce((s, r) => s + r.distanceKm, 0);
  return {
    routes: out.filter((r) => r.stops.length > 0),
    unassigned,
    estimated: m.estimated,
    savedKm: n > 1 && baseline > 0 ? Math.round((baseline - total) * 10) / 10 : null
  };
}
function evaluateOrder(input, m, orderedOrderIds) {
  const idxById = new Map(input.orders.map((o, i) => [o.id, i + 1]));
  const seq = orderedOrderIds.map((id) => idxById.get(id)).filter((x) => x !== undefined);
  const s = simulate(seq, input, m);
  return {
    stops: seq.map((idx, i) => ({
      orderId: input.orders[idx - 1].id,
      etaMin: Math.round(s.etas[i]),
      lateRisk: s.lates[i] > 0,
      lateByMin: Math.round(s.lates[i])
    })),
    distanceKm: Math.round(s.distanceKm * 10) / 10,
    durationMin: Math.round(s.durationMin)
  };
}

// src/planning.ts
var OSRM_DEFAULT = "https://router.project-osrm.org";
var TZ_OFFSET_MIN = 7 * 60;
var minToIso = (date, min) => new Date(Date.parse(`${date}T00:00:00Z`) + (min - TZ_OFFSET_MIN) * 60000).toISOString();
function parseHm(s, dflt) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : dflt;
}
function windowEndFor(scheduledAt, date, tolerance) {
  if (!scheduledAt)
    return null;
  const local = new Date(Date.parse(scheduledAt) + TZ_OFFSET_MIN * 60000);
  if (local.toISOString().slice(0, 10) !== date)
    return null;
  const min = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (min === 0)
    return null;
  return min + tolerance;
}
async function buildContext(env, b) {
  const date = b.plannedDate;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new HttpError(400, "plannedDate phải dạng YYYY-MM-DD.");
  const branch = await getDefaultBranch(env);
  const tolerance = Number(env.WINDOW_TOLERANCE_MIN) || 60;
  let orders;
  if (b.orderIds?.length) {
    b.orderIds.forEach((x) => assertUuid(x, "orderId"));
    orders = await svc(env, `orders?id=${inList(b.orderIds)}&select=*`);
  } else {
    orders = await svc(env, `orders?status=in.(unassigned,assigned)&carrier_service=eq.noi_bo` + `&or=(requested_delivery_date.eq.${date},requested_delivery_date.is.null)&select=*&limit=500`);
  }
  const ids = orders.map((o) => o.id);
  const busy = new Set;
  for (let i = 0;i < ids.length; i += 100) {
    const rows = await svc(env, `route_stops?order_id=${inList(ids.slice(i, i + 100))}&select=order_id,delivery_routes!inner(status)&delivery_routes.status=in.(draft,assigned,in_progress)`);
    (rows || []).forEach((r) => busy.add(r.order_id));
  }
  const skipped = [];
  const usable = [];
  for (const o of orders) {
    if (busy.has(o.id))
      skipped.push({ orderId: o.id, orderNumber: o.order_number, reason: "Đã nằm trong một tuyến đang hoạt động" });
    else if (o.cod_needs_review)
      skipped.push({ orderId: o.id, orderNumber: o.order_number, reason: "COD cần điều phối xác nhận trước" });
    else if (!["ok", "manual"].includes(o.geocode_status) || o.latitude == null || o.longitude == null)
      skipped.push({ orderId: o.id, orderNumber: o.order_number, reason: "Chưa có tọa độ đã xác nhận (kiểm tra địa chỉ)" });
    else
      usable.push(o);
  }
  const drivers = await svc(env, "drivers?status=eq.active&select=id,profile_id,employee_code,default_vehicle_id,profiles(full_name)");
  const vehicles = await svc(env, "vehicles?status=eq.active&select=id,plate_number,vehicle_type,max_weight_kg");
  const vById = new Map(vehicles.map((v) => [v.id, v]));
  const dById = new Map(drivers.map((d) => [d.id, d]));
  let pairs = [];
  if (b.assignments?.length) {
    for (const a of b.assignments) {
      if (!dById.has(a.driverId) || !vById.has(a.vehicleId))
        throw new HttpError(400, "Tài xế hoặc xe không hợp lệ / không hoạt động.");
    }
    pairs = b.assignments;
  } else {
    const usedV = new Set;
    for (const d of drivers) {
      if (d.default_vehicle_id && vById.has(d.default_vehicle_id) && !usedV.has(d.default_vehicle_id)) {
        pairs.push({ driverId: d.id, vehicleId: d.default_vehicle_id });
        usedV.add(d.default_vehicle_id);
      }
    }
    const freeV = vehicles.filter((v) => !usedV.has(v.id));
    for (const d of drivers.filter((d) => !pairs.some((p) => p.driverId === d.id))) {
      const v = freeV.shift();
      if (!v)
        break;
      pairs.push({ driverId: d.id, vehicleId: v.id });
    }
  }
  if (!pairs.length)
    throw new HttpError(400, "Không có cặp tài xế - xe khả dụng. Hãy gán xe mặc định cho tài xế hoặc truyền assignments.");
  const optVehicles = pairs.map((p) => ({
    vehicleId: p.vehicleId,
    driverId: p.driverId,
    capacityKg: Number(vById.get(p.vehicleId)?.max_weight_kg) || 150
  }));
  const optOrders = usable.map((o) => ({
    id: o.id,
    lat: Number(o.latitude),
    lng: Number(o.longitude),
    weightKg: Number(o.weight_kg) || 2,
    serviceMin: Number(o.service_minutes) || 5,
    windowStart: null,
    windowEnd: windowEndFor(o.scheduled_at, date, tolerance),
    cod: Number(o.cod_amount) || 0
  }));
  const input = {
    hub: { lat: branch.lat, lng: branch.lng },
    startMin: parseHm(b.startTime, 8 * 60),
    orders: optOrders,
    vehicles: optVehicles,
    maxStopsPerRoute: Math.min(40, Math.max(1, Number(b.maxStopsPerRoute) || 15)),
    maxRouteMin: Math.round((Number(b.maxRouteHours) || 8) * 60)
  };
  return { date, branch, input, usable, skipped, drivers: dById, vehicles: vById };
}
function present(env, date, ctx, result) {
  const oById = new Map(ctx.usable.map((o) => [o.id, o]));
  const info = (id) => {
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
      scheduledAt: o?.scheduled_at || null
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
      stops: r.stops.map((s) => ({ ...info(s.orderId), eta: minToIso(date, s.etaMin), lateRisk: s.lateRisk, lateByMin: s.lateByMin }))
    })),
    unassigned: result.unassigned.map((u) => ({ ...info(u.orderId), reason: u.reason })),
    skipped: ctx.skipped
  };
}
async function runOptimization(req, env) {
  const auth = await requireAuth(req, env, ["admin", "dispatcher"]);
  const body = await readJson(req);
  const ctx = await buildContext(env, body);
  if (!ctx.input.orders.length) {
    return json({ runId: null, plan: present(env, ctx.date, ctx, { routes: [], unassigned: [], estimated: false, savedKm: null }), message: "Không có đơn đủ điều kiện để xếp tuyến." });
  }
  const osrm = env.OSRM_URL || OSRM_DEFAULT;
  const matrix = await osrmMatrix(osrm, buildMatrixPoints(ctx.input));
  const result = solve(ctx.input, matrix);
  if (!matrix.estimated) {
    for (const r of result.routes) {
      const pts = [[ctx.input.hub.lat, ctx.input.hub.lng]];
      for (const s of r.stops) {
        const o = ctx.input.orders.find((x) => x.id === s.orderId);
        pts.push([o.lat, o.lng]);
      }
      pts.push([ctx.input.hub.lat, ctx.input.hub.lng]);
      r.geometry = await osrmGeometry(osrm, pts);
    }
  }
  const plan = present(env, ctx.date, ctx, result);
  const run = await svc(env, "optimization_runs", {
    method: "POST",
    prefer: "return=representation",
    body: {
      planned_date: ctx.date,
      status: "draft",
      created_by: auth.profile.id,
      input_snapshot: { request: body, orderIds: ctx.usable.map((o) => o.id), startMin: ctx.input.startMin, vehicles: ctx.input.vehicles },
      result: plan
    }
  });
  await audit(env, auth.profile.id, "optimization.run", "optimization_run", run[0].id, null, { orders: ctx.input.orders.length, routes: plan.routes.length }, req);
  return json({ runId: run[0].id, plan });
}
async function confirmOptimization(req, env, runId) {
  const auth = await requireAuth(req, env, ["admin", "dispatcher"]);
  assertUuid(runId);
  const body = await readJson(req).catch(() => ({}));
  const runs = await svc(env, `optimization_runs?id=eq.${runId}&select=*`);
  const run = runs?.[0];
  if (!run)
    throw new HttpError(404, "Không tìm thấy phương án.");
  if (run.status !== "draft")
    throw new HttpError(409, `Phương án đã ở trạng thái "${run.status}".`);
  const date = run.planned_date;
  const plan = run.result;
  const branch = await getDefaultBranch(env);
  const finalRoutes = body.routes?.length ? body.routes : plan.routes.map((r) => ({ driverId: r.driverId, vehicleId: r.vehicleId, orderIds: r.stops.map((s) => s.orderId) }));
  const allowed = new Set([...run.input_snapshot?.orderIds || []]);
  const seen = new Set;
  for (const r of finalRoutes) {
    assertUuid(r.driverId, "driverId");
    assertUuid(r.vehicleId, "vehicleId");
    for (const id of r.orderIds) {
      if (!allowed.has(id))
        throw new HttpError(400, "Có đơn không thuộc phương án này.");
      if (seen.has(id))
        throw new HttpError(400, "Một đơn xuất hiện ở nhiều tuyến.");
      seen.add(id);
    }
  }
  const orderIds = [...seen];
  if (!orderIds.length)
    throw new HttpError(400, "Không có đơn nào để giao việc.");
  const claimed = await svc(env, `optimization_runs?id=eq.${runId}&status=eq.draft`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { status: "confirmed", confirmed_by: auth.profile.id, updated_at: new Date().toISOString() }
  });
  if (!claimed?.length)
    throw new HttpError(409, "Phương án vừa được xác nhận bởi người khác.");
  try {
    const orders = await svc(env, `orders?id=${inList(orderIds)}&select=*`);
    const oById = new Map(orders.map((o) => [o.id, o]));
    const stillBusy = await svc(env, `route_stops?order_id=${inList(orderIds)}&select=order_id,delivery_routes!inner(status)&delivery_routes.status=in.(draft,assigned,in_progress)`);
    if (stillBusy?.length)
      throw new HttpError(409, "Có đơn vừa được gán vào tuyến khác. Hãy chạy lại gợi ý.");
    const osrm = env.OSRM_URL || OSRM_DEFAULT;
    const tolerance = Number(env.WINDOW_TOLERANCE_MIN) || 60;
    const optOrders = orders.map((o) => ({
      id: o.id,
      lat: Number(o.latitude),
      lng: Number(o.longitude),
      weightKg: Number(o.weight_kg) || 2,
      serviceMin: Number(o.service_minutes) || 5,
      windowStart: null,
      windowEnd: windowEndFor(o.scheduled_at, date, tolerance),
      cod: Number(o.cod_amount) || 0
    }));
    const input = {
      hub: { lat: branch.lat, lng: branch.lng },
      startMin: run.input_snapshot?.startMin ?? 480,
      orders: optOrders,
      vehicles: [],
      maxStopsPerRoute: 999,
      maxRouteMin: 24 * 60
    };
    const matrix = await osrmMatrix(osrm, buildMatrixPoints(input));
    const existingToday = await svc(env, `delivery_routes?planned_date=eq.${date}&select=id`);
    let seq = existingToday?.length || 0;
    const createdRoutes = [];
    for (const r of finalRoutes) {
      if (!r.orderIds.length)
        continue;
      const ev = evaluateOrder(input, matrix, r.orderIds);
      seq += 1;
      const code = `R${date.replace(/-/g, "").slice(2)}-${String(seq).padStart(2, "0")}`;
      const pts = [[branch.lat, branch.lng], ...r.orderIds.map((id) => [Number(oById.get(id).latitude), Number(oById.get(id).longitude)]), [branch.lat, branch.lng]];
      const geometry = matrix.estimated ? null : await osrmGeometry(osrm, pts);
      const route = (await svc(env, "delivery_routes", {
        method: "POST",
        prefer: "return=representation",
        body: {
          branch_id: branch.id,
          route_code: code,
          driver_id: r.driverId,
          vehicle_id: r.vehicleId,
          planned_date: date,
          status: "assigned",
          planned_start_at: minToIso(date, input.startMin),
          planned_distance_km: ev.distanceKm,
          created_by: auth.profile.id,
          optimization_run_id: runId,
          confirmed_by: auth.profile.id,
          confirmed_at: new Date().toISOString(),
          route_geometry: geometry
        }
      }))[0];
      const stops = ev.stops.map((s, i) => {
        const o = oById.get(s.orderId);
        return {
          route_id: route.id,
          order_id: s.orderId,
          sequence_no: i + 1,
          status: "pending",
          planned_arrival_at: minToIso(date, s.etaMin),
          eta_at: minToIso(date, s.etaMin),
          time_window_end: windowEndFor(o.scheduled_at, date, tolerance) != null ? minToIso(date, windowEndFor(o.scheduled_at, date, tolerance)) : null,
          late_risk: s.lateRisk,
          latitude: o.latitude,
          longitude: o.longitude
        };
      });
      await svc(env, "route_stops", { method: "POST", body: stops, prefer: "return=minimal" });
      await svc(env, `orders?id=${inList(r.orderIds)}`, { method: "PATCH", body: { status: "assigned" }, prefer: "return=minimal" });
      await svc(env, "delivery_events", {
        method: "POST",
        prefer: "return=minimal",
        body: r.orderIds.map((id) => ({ order_id: id, route_id: route.id, actor_id: auth.profile.id, event_type: "ROUTE_ASSIGNED", description: `Gán vào tuyến ${code}`, metadata: { run_id: runId } }))
      });
      createdRoutes.push({ id: route.id, code, driverId: r.driverId, stops: stops.length, distanceKm: ev.distanceKm });
    }
    await audit(env, auth.profile.id, "optimization.confirm", "optimization_run", runId, null, { routes: createdRoutes, edited: !!body.routes }, req);
    return json({ ok: true, routes: createdRoutes });
  } catch (e) {
    await svc(env, `optimization_runs?id=eq.${runId}`, { method: "PATCH", body: { status: "draft", confirmed_by: null }, prefer: "return=minimal" });
    throw e;
  }
}
async function discardOptimization(req, env, runId) {
  const auth = await requireAuth(req, env, ["admin", "dispatcher"]);
  assertUuid(runId);
  const rows = await svc(env, `optimization_runs?id=eq.${runId}&status=eq.draft`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { status: "discarded", updated_at: new Date().toISOString() }
  });
  if (!rows?.length)
    throw new HttpError(409, "Phương án không còn ở trạng thái nháp.");
  await audit(env, auth.profile.id, "optimization.discard", "optimization_run", runId, null, null, req);
  return json({ ok: true });
}

// src/users.ts
var ROLES = ["admin", "dispatcher", "driver", "sale"];
var CODE_PREFIX = { admin: "HCH-ADM", dispatcher: "HCH-DP", driver: "HCH-TX", sale: "HCH-KD" };
async function profileDto(env, p) {
  let driverId = null;
  let assignedVehicle;
  if (p.role === "driver") {
    const d = await svc(env, `drivers?profile_id=eq.${p.id}&select=id,default_vehicle_id,vehicles:default_vehicle_id(plate_number)`);
    driverId = d?.[0]?.id || null;
    assignedVehicle = d?.[0]?.vehicles?.plate_number || undefined;
  }
  return {
    id: p.id,
    employeeCode: p.employee_code || "",
    fullName: p.full_name,
    phone: p.phone || "",
    username: p.username || "",
    email: p.email || "",
    role: p.role,
    avatarUrl: p.avatar_url || undefined,
    isActive: p.is_active,
    driverId,
    assignedVehicle,
    mustChangePassword: p.must_change_password,
    odooEmployeeId: p.odoo_employee_id,
    odooUserId: p.odoo_user_id,
    createdAt: undefined
  };
}
var fails = new Map;
async function login(req, env) {
  const { identifier, password } = await readJson(req);
  const id = (identifier || "").trim();
  if (!id || !password)
    throw new HttpError(400, "Vui lòng nhập tên đăng nhập và mật khẩu.");
  const ip = req.headers.get("CF-Connecting-IP") || "ip";
  const key = `${ip}|${id.toLowerCase()}`;
  const f = fails.get(key);
  if (f && f.until > Date.now() && f.n >= 5)
    throw new HttpError(429, "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 10 phút.");
  const generic = new HttpError(401, "Thông tin đăng nhập không đúng.");
  let email = "";
  if (id.includes("@")) {
    email = id.toLowerCase();
  } else {
    const phone = id.replace(/\s+/g, "");
    const safe = id.replace(/[(),*"\\]/g, "");
    const rows = await svc(env, `profiles?or=(username.ilike.${encodeURIComponent(safe)},employee_code.ilike.${encodeURIComponent(safe)},phone.eq.${encodeURIComponent(phone)})&is_active=eq.true&select=email&limit=2`);
    if (!rows || rows.length !== 1 || !rows[0].email)
      throw generic;
    email = rows[0].email;
  }
  const r = await gotrue(env, "token?grant_type=password", { method: "POST", body: { email, password } });
  if (!r.ok) {
    fails.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 10 * 60000 });
    throw generic;
  }
  fails.delete(key);
  const rows = await svc(env, `profiles?id=eq.${r.data.user.id}&select=*`);
  const profile = rows?.[0];
  if (!profile || !profile.is_active)
    throw new HttpError(403, "Tài khoản đã bị khóa hoặc chưa được cấp quyền.");
  await audit(env, profile.id, "auth.login", "profile", profile.id, null, null, req);
  return json({
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (r.data.expires_in || 3600),
    user: await profileDto(env, profile)
  });
}
async function refresh(req, env) {
  const { refreshToken } = await readJson(req);
  if (!refreshToken)
    throw new HttpError(400, "Thiếu refresh token.");
  const r = await gotrue(env, "token?grant_type=refresh_token", { method: "POST", body: { refresh_token: refreshToken } });
  if (!r.ok)
    throw new HttpError(401, "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.");
  const rows = await svc(env, `profiles?id=eq.${r.data.user.id}&select=*`);
  if (!rows?.[0]?.is_active)
    throw new HttpError(403, "Tài khoản đã bị khóa.");
  return json({
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (r.data.expires_in || 3600),
    user: await profileDto(env, rows[0])
  });
}
async function me(req, env) {
  const ctx = await requireAuth(req, env);
  return json({ user: await profileDto(env, ctx.profile) });
}
async function changePassword(req, env) {
  const ctx = await requireAuth(req, env);
  const { newPassword } = await readJson(req);
  if (!newPassword || newPassword.length < 8)
    throw new HttpError(400, "Mật khẩu mới tối thiểu 8 ký tự.");
  const r = await gotrue(env, "user", { method: "PUT", token: ctx.token, body: { password: newPassword } });
  if (!r.ok)
    throw new HttpError(400, r.data?.msg || r.data?.message || "Không đổi được mật khẩu.");
  await svc(env, `profiles?id=eq.${ctx.profile.id}`, { method: "PATCH", body: { must_change_password: false }, prefer: "return=minimal" });
  await audit(env, ctx.profile.id, "auth.change_password", "profile", ctx.profile.id, null, null, req);
  return json({ ok: true });
}
async function nextEmployeeCode(env, role) {
  const prefix = CODE_PREFIX[role];
  const rows = await svc(env, `profiles?employee_code=ilike.${prefix}*&select=employee_code`);
  let max = 0;
  for (const r of rows || []) {
    const n = parseInt(r.employee_code.slice(prefix.length), 10);
    if (!Number.isNaN(n))
      max = Math.max(max, n);
  }
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}
async function activeAdminCount(env) {
  const rows = await svc(env, "profiles?role=eq.admin&is_active=eq.true&select=id");
  return rows?.length || 0;
}
async function listUsers(req, env) {
  await requireAuth(req, env, ["admin"]);
  const rows = await svc(env, "profiles?select=*,drivers(id,default_vehicle_id,vehicles:default_vehicle_id(plate_number))&order=created_at.desc");
  return json({
    users: (rows || []).map((p) => ({
      id: p.id,
      employeeCode: p.employee_code || "",
      fullName: p.full_name,
      phone: p.phone || "",
      username: p.username || "",
      email: p.email || "",
      role: p.role,
      isActive: p.is_active,
      avatarUrl: p.avatar_url || undefined,
      driverId: p.drivers?.[0]?.id || null,
      assignedVehicle: p.drivers?.[0]?.vehicles?.plate_number || undefined,
      mustChangePassword: p.must_change_password,
      odooEmployeeId: p.odoo_employee_id,
      odooUserId: p.odoo_user_id,
      createdAt: p.created_at
    }))
  });
}
async function createUser(req, env) {
  const ctx = await requireAuth(req, env, ["admin"]);
  const b = await readJson(req);
  if (!b.fullName?.trim())
    throw new HttpError(400, "Thiếu họ tên.");
  if (!b.username?.trim() || !/^[a-z0-9._-]{3,32}$/i.test(b.username.trim()))
    throw new HttpError(400, "Tên đăng nhập 3–32 ký tự (chữ, số, . _ -).");
  if (!b.role || !ROLES.includes(b.role))
    throw new HttpError(400, "Vai trò không hợp lệ.");
  const username = b.username.trim().toLowerCase();
  const email = (b.email?.trim() || `${username}@${env.EMAIL_DOMAIN || "hachihi.local"}`).toLowerCase();
  const code = (b.employeeCode?.trim() || await nextEmployeeCode(env, b.role)).toUpperCase();
  const tempPassword = b.password?.trim() || randomPassword(12);
  if (tempPassword.length < 8)
    throw new HttpError(400, "Mật khẩu tối thiểu 8 ký tự.");
  const created = await gotrue(env, "admin/users", {
    method: "POST",
    admin: true,
    body: { email, password: tempPassword, email_confirm: true, user_metadata: { full_name: b.fullName.trim() } }
  });
  if (!created.ok) {
    const msg = String(created.data?.msg || created.data?.message || "");
    throw new HttpError(created.status === 422 ? 409 : 400, /already|registered/i.test(msg) ? "Email này đã được dùng." : `Không tạo được tài khoản: ${msg}`);
  }
  const uid = created.data.id;
  try {
    const branch = await getDefaultBranch(env);
    const profile = await svc(env, "profiles", {
      method: "POST",
      prefer: "return=representation",
      body: {
        id: uid,
        full_name: b.fullName.trim(),
        phone: b.phone?.trim() || null,
        role: b.role,
        email,
        username,
        employee_code: code,
        branch_id: branch.id,
        is_active: true,
        must_change_password: true,
        odoo_employee_id: b.odooEmployeeId ?? null,
        odoo_user_id: b.odooUserId ?? null
      }
    });
    if (b.role === "driver") {
      await svc(env, "drivers", {
        method: "POST",
        prefer: "return=minimal",
        body: { profile_id: uid, employee_code: code, default_vehicle_id: b.defaultVehicleId || null }
      });
    }
    await audit(env, ctx.profile.id, "user.create", "profile", uid, null, { username, role: b.role, employee_code: code }, req);
    return json({ user: await profileDto(env, profile[0]), tempPassword }, 201);
  } catch (e) {
    await gotrue(env, `admin/users/${uid}`, { method: "DELETE", admin: true });
    if (e instanceof HttpError && e.status === 409)
      throw new HttpError(409, "Tên đăng nhập hoặc mã nhân viên đã tồn tại.");
    throw e;
  }
}
async function updateUser(req, env, id) {
  const ctx = await requireAuth(req, env, ["admin"]);
  assertUuid(id);
  const b = await readJson(req);
  const before = (await svc(env, `profiles?id=eq.${id}&select=*`))?.[0];
  if (!before)
    throw new HttpError(404, "Không tìm thấy tài khoản.");
  const patch = {};
  if (b.fullName !== undefined)
    patch.full_name = b.fullName.trim();
  if (b.phone !== undefined)
    patch.phone = b.phone.trim() || null;
  if (b.username !== undefined) {
    if (!/^[a-z0-9._-]{3,32}$/i.test(b.username.trim()))
      throw new HttpError(400, "Tên đăng nhập không hợp lệ.");
    patch.username = b.username.trim().toLowerCase();
  }
  if (b.employeeCode !== undefined)
    patch.employee_code = b.employeeCode.trim().toUpperCase();
  if (b.odooEmployeeId !== undefined)
    patch.odoo_employee_id = b.odooEmployeeId;
  if (b.odooUserId !== undefined)
    patch.odoo_user_id = b.odooUserId;
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role))
      throw new HttpError(400, "Vai trò không hợp lệ.");
    patch.role = b.role;
  }
  if (b.isActive !== undefined)
    patch.is_active = b.isActive;
  const demoting = before.role === "admin" && b.role !== undefined && b.role !== "admin";
  const deactivating = before.role === "admin" && b.isActive === false;
  if ((demoting || deactivating) && await activeAdminCount(env) <= 1)
    throw new HttpError(400, "Không thể hạ quyền hoặc khóa admin cuối cùng.");
  if (id === ctx.profile.id && b.isActive === false)
    throw new HttpError(400, "Bạn không thể tự khóa tài khoản của mình.");
  let after = before;
  if (Object.keys(patch).length) {
    const rows = await svc(env, `profiles?id=eq.${id}`, { method: "PATCH", prefer: "return=representation", body: patch });
    after = rows[0];
  }
  if (b.isActive !== undefined) {
    await gotrue(env, `admin/users/${id}`, { method: "PUT", admin: true, body: { ban_duration: b.isActive ? "none" : "876000h" } });
  }
  if (after.role === "driver") {
    const d = await svc(env, `drivers?profile_id=eq.${id}&select=id`);
    if (!d?.length) {
      await svc(env, "drivers", { method: "POST", prefer: "return=minimal", body: { profile_id: id, employee_code: after.employee_code || id.slice(0, 8), default_vehicle_id: b.defaultVehicleId || null } });
    } else if (b.defaultVehicleId !== undefined) {
      await svc(env, `drivers?profile_id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: { default_vehicle_id: b.defaultVehicleId } });
    }
  }
  await audit(env, ctx.profile.id, "user.update", "profile", id, before, after, req);
  return json({ user: await profileDto(env, after) });
}
async function resetPassword(req, env, id) {
  const ctx = await requireAuth(req, env, ["admin"]);
  assertUuid(id);
  const tempPassword = randomPassword(12);
  const r = await gotrue(env, `admin/users/${id}`, { method: "PUT", admin: true, body: { password: tempPassword } });
  if (!r.ok)
    throw new HttpError(400, "Không đặt lại được mật khẩu.");
  await svc(env, `profiles?id=eq.${id}`, { method: "PATCH", body: { must_change_password: true }, prefer: "return=minimal" });
  await audit(env, ctx.profile.id, "user.reset_password", "profile", id, null, null, req);
  return json({ tempPassword });
}

// src/index.ts
async function route(req, env, ctx) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const m = req.method;
  let g;
  if (p === "/" || p === "/api/health")
    return json({ status: "online", service: "hachihi-delivery-worker", time: new Date().toISOString() });
  if (p === "/api/auth/login" && m === "POST")
    return login(req, env);
  if (p === "/api/auth/refresh" && m === "POST")
    return refresh(req, env);
  if (p === "/api/auth/me" && m === "GET")
    return me(req, env);
  if (p === "/api/auth/change-password" && m === "POST")
    return changePassword(req, env);
  if (p === "/api/admin/users" && m === "GET")
    return listUsers(req, env);
  if (p === "/api/admin/users" && m === "POST")
    return createUser(req, env);
  if ((g = p.match(/^\/api\/admin\/users\/([^/]+)$/)) && m === "PATCH")
    return updateUser(req, env, g[1]);
  if ((g = p.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/)) && m === "POST")
    return resetPassword(req, env, g[1]);
  if (p === "/api/odoo/sync" && m === "POST") {
    const a = await requireAuth(req, env, ["admin", "dispatcher"]);
    const full = url.searchParams.get("full") === "1" && a.profile.role === "admin";
    const stats = await syncOdoo(env, { full });
    await audit(env, a.profile.id, "odoo.sync", "odoo", null, null, stats, req);
    return json({ ok: true, stats });
  }
  if (p === "/api/odoo/sync-status" && m === "GET") {
    await requireAuth(req, env, ["admin", "dispatcher"]);
    const [state, jobs] = await Promise.all([
      svc(env, "sync_state?key=eq.odoo_shipping&select=value,updated_at"),
      svc(env, "odoo_sync_jobs?status=in.(pending,failed,conflict)&select=id,status,attempts,last_error,source_record_id,created_at&order=created_at.desc&limit=50")
    ]);
    return json({ state: state?.[0] || null, queue: jobs || [] });
  }
  if (p === "/api/odoo/test" && m === "GET") {
    await requireAuth(req, env, ["admin", "dispatcher"]);
    return json(await odooHealth(env));
  }
  if (p === "/api/odoo/shipping-orders" && m === "GET")
    return listOdooShaped(req, env);
  if ((g = p.match(/^\/api\/orders\/([^/]+)\/location$/)) && m === "POST")
    return setOrderLocation(req, env, g[1]);
  if (p === "/api/optimization/run" && m === "POST")
    return runOptimization(req, env);
  if ((g = p.match(/^\/api\/optimization\/([^/]+)\/confirm$/)) && m === "POST")
    return confirmOptimization(req, env, g[1]);
  if ((g = p.match(/^\/api\/optimization\/([^/]+)\/discard$/)) && m === "POST")
    return discardOptimization(req, env, g[1]);
  if ((g = p.match(/^\/api\/routes\/([^/]+)\/start$/)) && m === "POST")
    return startRoute(req, env, ctx, g[1]);
  if ((g = p.match(/^\/api\/routes\/([^/]+)$/)) && m === "PATCH")
    return patchRoute(req, env, g[1]);
  if ((g = p.match(/^\/api\/stops\/([^/]+)\/events$/)) && m === "POST")
    return stopEvent(req, env, ctx, g[1]);
  throw new HttpError(404, "Không tìm thấy API.");
}
var src_default = {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(env, req);
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env, ctx);
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors))
        h.set(k, v);
      return new Response(res.body, { status: res.status, headers: h });
    } catch (e) {
      if (e instanceof HttpError)
        return json({ error: e.message }, e.status, cors);
      console.error("Lỗi không mong đợi", e);
      return json({ error: "Lỗi máy chủ nội bộ." }, 500, cors);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const steps = [
        ["syncOdoo", () => syncOdoo(env, { maxGeocode: 15 })],
        ["processOdooQueue", () => processOdooQueue(env, 20)],
        ["geocodePending", () => geocodePending(env, 15)],
        ["computeAlerts", () => computeAlerts(env)]
      ];
      for (const [name, fn] of steps) {
        try {
          console.log(name, JSON.stringify(await fn()));
        } catch (e) {
          console.error(`cron ${name} lỗi:`, e.message);
        }
      }
    })());
  }
};
export {
  src_default as default
};
