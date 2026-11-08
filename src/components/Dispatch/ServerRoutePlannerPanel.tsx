import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Check, Loader2, Sparkles, Truck, X } from 'lucide-react';
import { api } from '../../services/api/ApiClient';

interface PlanStop {
  orderId: string;
  orderNumber?: string;
  customerName?: string;
  address?: string;
  codAmount: number;
  hasInstallation: boolean;
  eta?: string;
  lateRisk?: boolean;
  lateByMin?: number;
}
interface PlanRoute {
  driverId: string;
  driverName?: string;
  vehicleId: string;
  plate?: string;
  distanceKm: number;
  durationMin: number;
  totalWeightKg: number;
  capacityKg: number;
  totalCod: number;
  stops: PlanStop[];
}
interface Plan {
  plannedDate: string;
  estimated: boolean;
  savedKm: number | null;
  routes: PlanRoute[];
  unassigned: Array<PlanStop & { reason: string }>;
  skipped: Array<{ orderId: string; orderNumber: string; reason: string }>;
}

interface Props {
  onClose: () => void;
  onConfirmed: () => void;
}

const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '--:--');
const todayVN = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

export const ServerRoutePlannerPanel: React.FC<Props> = ({ onClose, onConfirmed }) => {
  const [date, setDate] = useState(todayVN());
  const [startTime, setStartTime] = useState('08:00');
  const [maxStops, setMaxStops] = useState(15);
  const [runId, setRunId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState<'run' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async () => {
    setBusy('run');
    setError(null);
    setDone(null);
    try {
      const r = await api<{ runId: string | null; plan: Plan; message?: string }>('/api/optimization/run', {
        body: { plannedDate: date, startTime, maxStopsPerRoute: maxStops },
      });
      setRunId(r.runId);
      setPlan(r.plan);
      setEdited(false);
      if (r.message) setError(r.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const mutate = (fn: (routes: PlanRoute[]) => PlanRoute[]) => {
    if (!plan) return;
    setPlan({ ...plan, routes: fn(plan.routes.map((r) => ({ ...r, stops: [...r.stops] }))) });
    setEdited(true);
  };

  const move = (ri: number, si: number, dir: -1 | 1) =>
    mutate((routes) => {
      const s = routes[ri].stops;
      const j = si + dir;
      if (j < 0 || j >= s.length) return routes;
      [s[si], s[j]] = [s[j], s[si]];
      return routes;
    });

  const moveToRoute = (ri: number, si: number, target: number) =>
    mutate((routes) => {
      if (target === ri) return routes;
      const [st] = routes[ri].stops.splice(si, 1);
      routes[target].stops.push(st);
      return routes;
    });

  const confirm = async () => {
    if (!plan || !runId) return;
    setBusy('confirm');
    setError(null);
    try {
      const body = edited
        ? { routes: plan.routes.filter((r) => r.stops.length).map((r) => ({ driverId: r.driverId, vehicleId: r.vehicleId, orderIds: r.stops.map((s) => s.orderId) })) }
        : {};
      const r = await api<{ routes: Array<{ code: string; stops: number }> }>(`/api/optimization/${runId}/confirm`, { body });
      setDone(`Đã giao việc: ${r.routes.map((x) => `${x.code} (${x.stops} điểm)`).join(', ')}`);
      setPlan(null);
      setRunId(null);
      onConfirmed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (runId) await api(`/api/optimization/${runId}/discard`, { body: {} }).catch(() => undefined);
    setPlan(null);
    setRunId(null);
  };

  const totals = useMemo(
    () => ({
      stops: plan?.routes.reduce((t, r) => t + r.stops.length, 0) ?? 0,
      km: plan ? Math.round(plan.routes.reduce((t, r) => t + r.distanceKm, 0) * 10) / 10 : 0,
    }),
    [plan]
  );

  return (
    <div className="fixed inset-0 z-[600] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl text-slate-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-sky-400" />
            <h2 className="font-bold text-sm sm:text-base">Gợi ý & xếp tuyến giao hàng</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 border-b border-slate-800 flex flex-wrap items-end gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Ngày giao</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Giờ xuất phát</span>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Tối đa điểm/xe</span>
            <input type="number" min={1} max={40} value={maxStops} onChange={(e) => setMaxStops(Number(e.target.value) || 15)} className="w-24 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg" />
          </label>
          <button onClick={run} disabled={busy !== null} className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold flex items-center gap-1.5 cursor-pointer">
            {busy === 'run' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Chạy gợi ý
          </button>
          <p className="text-[11px] text-slate-500 max-w-sm">Hệ thống chỉ gợi ý. Tài xế chỉ nhận việc sau khi bạn bấm “Xác nhận & giao việc”.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
          {done && <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 flex gap-2"><Check className="w-4 h-4 shrink-0" />{done}</div>}

          {plan && (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700">{plan.routes.length} tuyến • {totals.stops} điểm • {totals.km} km</span>
                {plan.savedKm != null && plan.savedKm > 0 && <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">Ít hơn ~{plan.savedKm} km so với chia vòng tròn</span>}
                {plan.estimated && <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">Ước tính theo đường chim bay (dịch vụ chỉ đường không phản hồi)</span>}
                {edited && <span className="px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-300">Đã chỉnh tay — ETA sẽ tính lại khi xác nhận</span>}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {plan.routes.map((r, ri) => (
                  <div key={`${r.driverId}-${ri}`} className="rounded-xl border border-slate-700 bg-slate-800/50 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold"><Truck className="w-4 h-4 text-sky-400" />{r.driverName || 'Tài xế'} <span className="text-[11px] font-mono text-slate-400">{r.plate}</span></div>
                      <span className="text-[11px] text-slate-400">{r.stops.length} điểm • {r.distanceKm} km • {Math.floor(r.durationMin / 60)}h{String(r.durationMin % 60).padStart(2, '0')}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">Tải: {r.totalWeightKg}/{r.capacityKg} kg • COD: {r.totalCod.toLocaleString('vi-VN')} đ</div>
                    <ol className="space-y-1.5">
                      {r.stops.map((s, si) => (
                        <li key={s.orderId} className="flex items-start gap-2 p-2 rounded-lg bg-slate-900/70 border border-slate-800 text-[11px]">
                          <span className="w-5 h-5 shrink-0 rounded-full bg-sky-600 text-white text-[10px] font-bold flex items-center justify-center">{si + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono font-semibold text-slate-100">{s.orderNumber}</span>
                              <span className="text-slate-400">{edited ? '' : fmtTime(s.eta)}</span>
                              {s.hasInstallation && <span className="px-1 rounded bg-violet-500/20 text-violet-300">Lắp đặt</span>}
                              {s.lateRisk && !edited && <span className="px-1 rounded bg-rose-500/20 text-rose-300">Trễ ~{s.lateByMin}′</span>}
                            </div>
                            <div className="truncate text-slate-300">{s.customerName}</div>
                            <div className="truncate text-slate-500">{s.address}</div>
                          </div>
                          <div className="flex flex-col gap-0.5 items-end shrink-0">
                            <div className="flex gap-0.5">
                              <button onClick={() => move(ri, si, -1)} className="p-1 rounded bg-slate-800 hover:bg-slate-700 cursor-pointer" aria-label="Lên"><ArrowUp className="w-3 h-3" /></button>
                              <button onClick={() => move(ri, si, 1)} className="p-1 rounded bg-slate-800 hover:bg-slate-700 cursor-pointer" aria-label="Xuống"><ArrowDown className="w-3 h-3" /></button>
                            </div>
                            {plan.routes.length > 1 && (
                              <select value={ri} onChange={(e) => moveToRoute(ri, si, Number(e.target.value))} className="bg-slate-800 border border-slate-700 rounded text-[10px] px-1 py-0.5" aria-label="Chuyển sang tuyến khác">
                                {plan.routes.map((x, k) => <option key={k} value={k}>→ {x.driverName || `Tuyến ${k + 1}`}</option>)}
                              </select>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>

              {plan.unassigned.length > 0 && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-xs">
                  <div className="font-semibold text-rose-300 mb-1">Chưa xếp được ({plan.unassigned.length})</div>
                  {plan.unassigned.map((u) => <div key={u.orderId} className="text-slate-300"><span className="font-mono">{u.orderNumber}</span> — {u.reason}</div>)}
                </div>
              )}
              {plan.skipped.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                  <div className="font-semibold text-amber-300 mb-1">Bị loại khỏi gợi ý ({plan.skipped.length}) — cần xử lý trước</div>
                  {plan.skipped.map((u) => <div key={u.orderId} className="text-slate-300"><span className="font-mono">{u.orderNumber}</span> — {u.reason}</div>)}
                </div>
              )}
            </>
          )}
        </div>

        {plan && runId && (
          <div className="p-4 border-t border-slate-800 flex items-center justify-end gap-2">
            <button onClick={discard} disabled={busy !== null} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs cursor-pointer">Hủy gợi ý</button>
            <button onClick={confirm} disabled={busy !== null || totals.stops === 0} className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer">
              {busy === 'confirm' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Xác nhận & giao việc
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
