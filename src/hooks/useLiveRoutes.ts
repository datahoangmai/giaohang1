import { useCallback, useEffect, useRef, useState } from 'react';
import { DriverLocationLog } from '../types/delivery';
import { AppUser } from '../types/auth';
import { isLiveConfigured } from '../services/api/ApiClient';
import { LiveRoute, RouteApi } from '../services/api/RouteApi';

/**
 * Nạp tuyến thật từ máy chủ và cập nhật định kỳ.
 * - Tuyến/điểm dừng: 10 giây/lần.
 * - Vị trí tài xế của tuyến đang chọn: 5 giây/lần (điều phối, sale; tài xế dùng GPS của chính máy mình).
 */
export function useLiveRoutes(user: AppUser | null) {
  const [routes, setRoutes] = useState<LiveRoute[]>([]);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [locations, setLocations] = useState<DriverLocationLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeRouteId;

  const reload = useCallback(async () => {
    if (!isLiveConfigured || !user) return;
    try {
      const list = await RouteApi.loadActiveRoutes();
      setRoutes(list);
      setError(null);
      setActiveRouteId((cur) => {
        if (cur && list.some((r) => r.route.id === cur)) return cur;
        const prefer = list.find((r) => r.route.status === 'in_progress') || list.find((r) => r.route.status === 'assigned') || list[0];
        return prefer?.route.id ?? null;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!isLiveConfigured || !user) {
      setRoutes([]);
      setActiveRouteId(null);
      return;
    }
    setLoading(true);
    reload().finally(() => setLoading(false));
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 10_000);
    return () => window.clearInterval(t);
  }, [user?.id, reload]);

  useEffect(() => {
    if (!isLiveConfigured || !user || user.role === 'driver' || !activeRouteId) {
      setLocations([]);
      return;
    }
    let alive = true;
    const pull = async () => {
      try {
        const l = await RouteApi.loadLocations(activeRouteId);
        if (alive) setLocations(l);
      } catch {
        /* giữ dữ liệu cũ, lần sau thử lại */
      }
    };
    void pull();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void pull();
    }, 5_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [user?.id, user?.role, activeRouteId]);

  const active = routes.find((r) => r.route.id === activeRouteId) || null;
  return { routes, active, activeRouteId, setActiveRouteId, locations, loading, error, reload };
}
