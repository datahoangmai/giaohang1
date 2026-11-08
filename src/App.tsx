import React, { useState, useEffect, useRef } from 'react';
import { LeafletMap, UserLocation } from './components/Map/LeafletMap';
import { DriverActiveStopModal } from './components/Driver/DriverActiveStopModal';
import { RouteSituationalSummary } from './components/Map/RouteSituationalSummary';
import { OdooIntegrationModal } from './components/Odoo/OdooIntegrationModal';
import { DeliveryOrderListPanel } from './components/Dispatch/DeliveryOrderListPanel';
import { LoginModal } from './components/Auth/LoginModal';
import { AccountManagementModal } from './components/Auth/AccountManagementModal';
import { GoogleMyMapsDrawer } from './components/Map/GoogleMyMapsDrawer';
import { DriverLiveTrackingBar } from './components/Tracking/DriverLiveTrackingBar';
import { NotificationDrawer } from './components/Notification/NotificationDrawer';
import { DriverTrackingService } from './services/tracking/DriverTrackingService';
import { NotificationService, AppPushNotification } from './services/notification/NotificationService';
import { AuthService } from './services/auth/AuthService';
import { AppUser, ROLE_LABEL } from './types/auth';
import { RouteApi } from './services/api/RouteApi';
import { useLiveRoutes } from './hooks/useLiveRoutes';
import { LocationUploader } from './services/tracking/LocationUploader';
import { ServerRoutePlannerPanel } from './components/Dispatch/ServerRoutePlannerPanel';
import { ChangePasswordModal } from './components/Auth/ChangePasswordModal';
import { OdooShippingService } from './services/odoo/OdooShippingService';
import { EMPTY_ROUTE, EMPTY_DRIVER } from './config/emptyState';
import { DeliveryRoute, DriverProfile, RouteStop, DeliveryOrder } from './types/delivery';
import {
  Sparkles,
  Phone,
  Navigation,
  CheckCircle2,
  Clock,
  Layers,
  Bike,
  Truck,
  RotateCw,
  BookOpen,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  AlertCircle,
  Package,
  Locate,
  Flame,
  ListOrdered,
  List,
  Users,
  LogOut,
  Lock,
  Shield,
  User,
  Crosshair,
  MapPin,
  Bell,
  BellRing,
} from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(AuthService.getCurrentUser());
  const [showAccountModal, setShowAccountModal] = useState(false);

  // Bắt đầu rỗng: toàn bộ dữ liệu đến từ máy chủ.
  const [route, setRoute] = useState<DeliveryRoute>(EMPTY_ROUTE);
  const [drivers, setDrivers] = useState<DriverProfile[]>([EMPTY_DRIVER]);
  const [showPlanner, setShowPlanner] = useState(false);
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [openAlerts, setOpenAlerts] = useState<Array<{ id: string; type: string; severity: string; message: string; created_at: string }>>([]);
  const [mustChangePw, setMustChangePw] = useState<boolean>(!!AuthService.getCurrentUser()?.mustChangePassword);
  const live = useLiveRoutes(currentUser);
  const eventIds = useRef(new Map<string, string>());

  // Hết phiên đăng nhập (làm mới token thất bại) => quay về màn hình đăng nhập
  useEffect(() => AuthService.subscribe((u) => setCurrentUser(u)), []);
  useEffect(() => {
    if (currentUser?.mustChangePassword) setMustChangePw(true);
  }, [currentUser?.id]);
  const [selectedStopId, setSelectedStopId] = useState<string>(route.stops[0]?.id || '');
  const [activeModalStop, setActiveModalStop] = useState<RouteStop | null>(null);

  // Google My Maps Left Drawer and Layer Toggles
  const [showMyMapsDrawer, setShowMyMapsDrawer] = useState(true);
  const [showStopsLayer, setShowStopsLayer] = useState(true);
  const [showRoutePolyline, setShowRoutePolyline] = useState(true);
  const [showDriversLayer, setShowDriversLayer] = useState(true);
  const [showHubLayer, setShowHubLayer] = useState(true);
  const [targetCoordinates, setTargetCoordinates] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);

  // Panels visibility
  const [showOdooModal, setShowOdooModal] = useState(false);
  const [showDeliveryList, setShowDeliveryList] = useState(false);

  // Push Notification state
  const [showNotificationDrawer, setShowNotificationDrawer] = useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [activePushBanner, setActivePushBanner] = useState<AppPushNotification | null>(null);

  // Initialize Service Worker and subscribe to notifications
  useEffect(() => {
    NotificationService.initServiceWorker();

    const unsub = NotificationService.subscribe((notif) => {
      setActivePushBanner(notif);
      setUnreadNotifCount((prev) => prev + 1);
    });

    return () => unsub();
  }, []);

  // Geolocation state
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Helper: Fly to coordinates (e.g. Google My Maps reference location)
  const handleFlyToCoordinates = (lat: number, lng: number, zoom = 13) => {
    setTargetCoordinates({ lat, lng, zoom });
  };

  // Active driver for current route
  const activeDriver = drivers.find((d) => d.id === route.driverId) || drivers[0];

  // Auto-follow driver on map
  const [isAutoFollowDriver, setIsAutoFollowDriver] = useState(false);

  // 10-Second Real-Time Driver Tracking Cycle using Geolocation API
  // Chế độ thật: chỉ tài xế có tuyến đang chạy mới bật GPS, và tuyệt đối không giả lập vị trí.
  const trackingEnabled = currentUser?.role === 'driver' && route.status === 'in_progress';
  useEffect(() => {
    const service = DriverTrackingService.getInstance();
    if (trackingEnabled) service.start(activeDriver, route);
    else service.stop();

    const unsubLoc = service.subscribeLocation((locLog) => {
      if (currentUser?.role !== 'driver' || !trackingEnabled) return;
      if (currentUser.driverId) void LocationUploader.push(currentUser.driverId, route.id === 'none' ? null : route.id, locLog);
      // 1. Sync location to route state
      setRoute((prevRoute) => {
        const history = [...(prevRoute.locationHistory || [])];
        history.push(locLog);
        if (history.length > 25) history.shift();

        return {
          ...prevRoute,
          currentDriverLocation: locLog,
          locationHistory: history,
          lastLocationSyncAt: locLog.timestamp,
        };
      });

      // 2. Update active driver coordinates in drivers state
      setDrivers((prevDrivers) =>
        prevDrivers.map((d) =>
          d.id === route.driverId
            ? {
                ...d,
                currentLat: locLog.lat,
                currentLng: locLog.lng,
                currentStatus: 'delivering' as const,
              }
            : d
        )
      );

      // 3. Update device user location marker on map
      setUserLocation({
        lat: locLog.lat,
        lng: locLog.lng,
        accuracy: locLog.accuracy,
        timestamp: new Date(locLog.timestamp).getTime(),
      });

      // 4. Auto-center map if Auto-Follow is active
      if (isAutoFollowDriver) {
        setTargetCoordinates({ lat: locLog.lat, lng: locLog.lng, zoom: 15 });
      }
    });

    return () => {
      unsubLoc();
    };
  }, [route.driverId, route.id, isAutoFollowDriver, trackingEnabled, currentUser?.id]);

  // Keep route and active driver updated in tracking service
  useEffect(() => {
    DriverTrackingService.getInstance().updateRoute(route);
  }, [route]);

  useEffect(() => {
    DriverTrackingService.getInstance().updateDriver(activeDriver);
  }, [activeDriver]);

  // Đồng bộ tuyến thật từ máy chủ vào giao diện
  useEffect(() => {
    if (!live.active) {
      setRoute(EMPTY_ROUTE);
      setDrivers([EMPTY_DRIVER]);
      return;
    }
    setRoute((prev) => ({
      ...live.active!.route,
      locationHistory: prev.id === live.active!.route.id ? prev.locationHistory : [],
      currentDriverLocation: prev.id === live.active!.route.id ? prev.currentDriverLocation : undefined,
      lastLocationSyncAt: prev.id === live.active!.route.id ? prev.lastLocationSyncAt : undefined,
    }));
    setDrivers((prev) => {
      const old = prev.find((d) => d.id === live.active!.driver.id);
      return [old ? { ...live.active!.driver, currentLat: old.currentLat, currentLng: old.currentLng } : live.active!.driver];
    });
    setSelectedStopId((cur) => {
      const stops = live.active!.route.stops;
      if (stops.some((s) => s.id === cur)) return cur;
      return (stops.find((s) => s.status === 'pending' || s.status === 'arrived') || stops[0])?.id || '';
    });
  }, [live.active]);

  // Vị trí tài xế do máy chủ trả về (điều phối, sale)
  useEffect(() => {
    if (currentUser?.role === 'driver' || live.locations.length === 0) return;
    const last = live.locations[live.locations.length - 1];
    setRoute((prev) => ({ ...prev, locationHistory: live.locations, currentDriverLocation: last, lastLocationSyncAt: last.timestamp }));
    setDrivers((prev) => prev.map((d) => (d.id === route.driverId ? { ...d, currentLat: last.lat, currentLng: last.lng } : d)));
  }, [live.locations]);

  // Cảnh báo cho điều phối/admin
  useEffect(() => {
    if (!AuthService.can('route.manage')) return;
    let alive = true;
    const pull = () =>
      RouteApi.loadOpenAlerts()
        .then((a) => alive && setOpenAlerts(a))
        .catch(() => undefined);
    void pull();
    const t = window.setInterval(pull, 20_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [currentUser?.id]);

  const handleCenterDriverOnMap = () => {
    const curLoc = route.currentDriverLocation;
    if (curLoc) {
      setTargetCoordinates({ lat: curLoc.lat, lng: curLoc.lng, zoom: 16 });
    } else if (activeDriver) {
      setTargetCoordinates({ lat: activeDriver.currentLat, lng: activeDriver.currentLng, zoom: 16 });
    }
  };

  // Active stop selected in bottom card
  const selectedStop = route.stops.find((s) => s.id === selectedStopId) || route.stops[0];
  const selectedIndex = route.stops.findIndex((s) => s.id === selectedStopId);

  // Dispatch orders from Odoo shipping.order model directly into the route
  const handleDispatchOrdersFromOdoo = (deliveryOrders: DeliveryOrder[]) => {
    if (deliveryOrders.length === 0) return;
    // Việc xếp tuyến do máy chủ gợi ý, điều phối xác nhận
    setShowPlanner(true);
  };

  // Gửi sự kiện điểm dừng lên máy chủ (idempotent: gửi lại dùng cùng clientEventId)
  const sendLiveStopEvent = async (
    stopId: string,
    eventType: 'ARRIVED_STOP' | 'DELIVERED' | 'FAILED_ATTEMPT',
    data: { lat?: number; lng?: number; note?: string; recipientName?: string; failureReason?: string }
  ) => {
    const key = `${stopId}:${eventType}`;
    const clientEventId = eventIds.current.get(key) || crypto.randomUUID();
    eventIds.current.set(key, clientEventId);
    try {
      const r = await RouteApi.postStopEvent(stopId, {
        eventType, clientEventId, ...data, accuracy: userLocation?.accuracy, timestamp: new Date().toISOString(),
      });
      eventIds.current.delete(key);
      if (r.codRecorded === false) setLiveNotice('Đã giao nhưng chưa ghi được phiếu thu COD — báo điều phối kiểm tra.');
      await live.reload();
    } catch (e) {
      setLiveNotice(`Chưa gửi được lên máy chủ: ${(e as Error).message}. Bấm lại để gửi lại (không bị trùng).`);
    }
  };

  // Complete a stop
  const handleCompleteStop = (
    stopId: string,
    podData: { photoUrl?: string; note?: string; recipientName?: string; lat: number; lng: number }
  ) => {
    void sendLiveStopEvent(stopId, 'DELIVERED', { lat: podData.lat, lng: podData.lng, note: podData.note, recipientName: podData.recipientName });
  };

  // Fail a stop
  const handleFailStop = (
    stopId: string,
    reasonCode: string,
    note: string,
    lat: number,
    lng: number
  ) => {
    void sendLiveStopEvent(stopId, 'FAILED_ATTEMPT', { lat, lng, note, failureReason: reasonCode });
  };

  // Mark arrived
  const handleMarkArrived = (stopId: string, lat: number, lng: number) => {
    void sendLiveStopEvent(stopId, 'ARRIVED_STOP', { lat, lng });
  };

  const completedCount = route.stops.filter((s) => s.status === 'completed').length;
  const progressPercent = route.stops.length ? Math.round((completedCount / route.stops.length) * 100) : 0;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans select-none text-slate-100 flex flex-col">
      {/* Top Floating Google Maps Style App Bar */}
      <header className="absolute top-3 inset-x-2 sm:inset-x-4 z-[450] flex items-center justify-between pointer-events-none gap-2">
        {/* Left: Google My Maps Toggle & Brand */}
        <div className="pointer-events-auto flex items-center gap-2 bg-slate-900/95 backdrop-blur-md px-3 py-1.5 rounded-2xl border border-slate-700/80 shadow-2xl shrink-0">
          {/* Hamburger / My Maps Drawer Toggle */}
          <button
            onClick={() => setShowMyMapsDrawer(!showMyMapsDrawer)}
            className={`p-1.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 ${
              showMyMapsDrawer
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
            }`}
            title="Bật/Tắt Bảng Điều Khiển Google My Maps"
          >
            <Layers className="w-4 h-4 text-blue-300" />
            <span className="hidden md:inline text-xs font-bold">Lớp Bản Đồ</span>
          </button>

          <div className="flex items-center gap-2 pl-1 sm:pl-2 border-l border-slate-700/80">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-blue-600 via-indigo-600 to-emerald-500 flex items-center justify-center text-white font-black text-xs shadow-md">
              G
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-extrabold text-slate-100 text-xs sm:text-sm tracking-tight flex items-center gap-1">
                  <span>Hachihi Delivery</span>
                  <span className="text-[10px] text-blue-400 font-semibold hidden sm:inline">&bull; Google My Maps</span>
                </h1>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  HCM
                </span>
              </div>
              <p className="text-[10px] text-slate-400 truncate max-w-[140px] sm:max-w-none">
                {route.stops.length} điểm &bull; {route.totalDistanceKm} km &bull; {activeDriver.name}
              </p>
            </div>
          </div>
        </div>

        {/* Right: Quick Actions, RBAC Account Management, User Chip */}
        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 bg-slate-900/95 backdrop-blur-md p-1.5 rounded-2xl border border-slate-700/80 shadow-2xl flex-wrap justify-end">
          {/* Quick Fly to Google Reference coordinates (10.772, 106.603) */}
          <button
            onClick={() => handleFlyToCoordinates(10.7720938, 106.6035479, 13)}
            className="hidden xl:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 text-xs font-semibold border border-blue-500/30 transition shadow-sm cursor-pointer"
            title="Di chuyển đến tọa độ tham chiếu Google My Maps: 10.772, 106.603 (Chợ Lớn / Bình Tân / Q6)"
          >
            <Crosshair className="w-3.5 h-3.5 text-blue-400" />
            <span>Khu Vực 10.772, 106.603</span>
          </button>

          {/* Delivery Orders List Panel Toggle */}
          <button
            onClick={() => setShowDeliveryList(!showDeliveryList)}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer ${
              showDeliveryList
                ? 'bg-sky-500 text-slate-950 ring-2 ring-sky-300 shadow-sky-500/30'
                : 'bg-slate-800 hover:bg-slate-700 text-sky-400 border border-sky-500/40'
            }`}
            title="Mở bảng Danh Sách Vận Chuyển và tất cả các điểm dừng"
          >
            <ListOrdered className="w-4 h-4" />
            <span className="hidden sm:inline">Danh Sách ({route.stops.length})</span>
          </button>

          {/* Odoo shipping.order Modal Button (chỉ admin/điều phối) */}
          {AuthService.can('odoo.sync') && (
          <button
            onClick={() => setShowOdooModal(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-bold border border-amber-500/40 transition-all hover:scale-102 shadow-sm cursor-pointer"
            title="Quản lý đồng bộ và nạp đơn Odoo model shipping.order"
          >
            <Package className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline">Nạp Đơn Odoo 14</span>
          </button>
          )}

          {/* Gợi ý tuyến từ máy chủ (chế độ thật) */}
          {AuthService.can('route.manage') && (
            <button
              onClick={() => setShowPlanner(true)}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-sm cursor-pointer"
              title="Gợi ý và xếp tuyến cho điều phối"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Gợi Ý Tuyến</span>
            </button>
          )}

          {/* Push Notification Drawer Button */}
          <button
            onClick={() => {
              setShowNotificationDrawer(true);
              setUnreadNotifCount(0);
            }}
            className="relative flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-all hover:scale-102 shadow-sm cursor-pointer"
            title="Trung tâm thông báo đẩy Service Worker cho tài xế"
          >
            <BellRing className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Thông Báo</span>
            {unreadNotifCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-black animate-pulse">
                {unreadNotifCount}
              </span>
            )}
          </button>

          {/* Account Management Button (Admin Full or RBAC Guard for others) */}
          <button
            onClick={() => setShowAccountModal(true)}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold border transition-all hover:scale-102 shadow-sm cursor-pointer ${
              currentUser?.role === 'admin'
                ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title="Trang quản lý tài khoản, mã nhân viên & phân quyền hệ thống"
          >
            <Users className="w-3.5 h-3.5 text-rose-400" />
            <span className="hidden sm:inline">Quản Lý Tài Khoản</span>
            {currentUser?.role !== 'admin' && <Lock className="w-3 h-3 text-amber-400" />}
          </button>

          {/* User Profile Pill & Logout Button */}
          {currentUser && (
            <div className="flex items-center gap-2 pl-1.5 sm:pl-2 border-l border-slate-700/80">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center font-bold text-[11px] text-white shrink-0 overflow-hidden shadow">
                  {currentUser.avatarUrl ? (
                    <img src={currentUser.avatarUrl} alt={currentUser.fullName} className="w-full h-full object-cover" />
                  ) : (
                    currentUser.fullName.charAt(0)
                  )}
                </div>
                <div className="hidden xl:block text-left">
                  <div className="text-[11px] font-bold text-slate-100 leading-tight">
                    {currentUser.fullName}
                  </div>
                  <div className="text-[10px] leading-tight">
                    <span className={`font-semibold ${currentUser.role === 'admin' ? 'text-rose-400' : currentUser.role === 'dispatcher' ? 'text-amber-400' : currentUser.role === 'sale' ? 'text-sky-400' : 'text-emerald-400'}`}>
                      {ROLE_LABEL[currentUser.role]}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  DriverTrackingService.getInstance().stop();
                  AuthService.logout();
                  setCurrentUser(null);
                  setRoute(EMPTY_ROUTE);
                  setDrivers([EMPTY_DRIVER]);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                title="Đăng xuất / Chuyển tài khoản khác"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Thanh tuyến (chế độ thật): chọn tuyến, bắt đầu tuyến, cảnh báo */}
      {currentUser && (
        <div className="absolute top-[64px] inset-x-2 sm:inset-x-4 z-[440] flex flex-wrap items-start gap-2 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-2 bg-slate-900/95 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-[11px] shadow-xl">
            {live.routes.length > 0 ? (
              <select
                value={live.activeRouteId || ''}
                onChange={(e) => live.setActiveRouteId(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-100"
                aria-label="Chọn tuyến"
              >
                {live.routes.map((r) => (
                  <option key={r.route.id} value={r.route.id}>
                    {r.route.code} • {r.driver.name} • {r.route.stops.length} điểm
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-slate-400">{live.loading ? 'Đang tải tuyến...' : 'Chưa có tuyến nào được giao.'}</span>
            )}
            {live.active && (
              <span className={`px-1.5 py-0.5 rounded font-semibold ${route.status === 'in_progress' ? 'bg-emerald-500/20 text-emerald-300' : route.status === 'completed' ? 'bg-slate-700 text-slate-300' : 'bg-amber-500/20 text-amber-300'}`}>
                {route.status === 'in_progress' ? 'Đang chạy' : route.status === 'completed' ? 'Đã xong' : 'Chờ xuất phát'}
              </span>
            )}
            {live.active && route.status === 'assigned' && AuthService.can('stop.confirm') && currentUser.role !== 'sale' && (
              <button
                onClick={async () => {
                  try {
                    await RouteApi.startRoute(route.id);
                    await live.reload();
                  } catch (e) {
                    setLiveNotice((e as Error).message);
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
              >
                Bắt đầu tuyến
              </button>
            )}
            {live.error && <span className="text-rose-400" title={live.error}>Lỗi kết nối</span>}
          </div>

          {AuthService.can('route.manage') && (
            <div className="pointer-events-auto relative">
              <button
                onClick={() => setAlertsOpen(!alertsOpen)}
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border shadow-xl cursor-pointer ${openAlerts.length ? 'bg-rose-600/90 border-rose-400 text-white' : 'bg-slate-900/95 border-slate-700 text-slate-300'}`}
              >
                Cảnh báo ({openAlerts.length})
              </button>
              {alertsOpen && (
                <div className="absolute mt-1 w-80 max-h-72 overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 space-y-1">
                  {openAlerts.length === 0 && <div className="p-2 text-[11px] text-slate-400">Không có cảnh báo đang mở.</div>}
                  {openAlerts.map((a) => (
                    <div key={a.id} className="p-2 rounded-lg bg-slate-800 text-[11px] flex items-start gap-2">
                      <div className="flex-1">
                        <div className={a.severity === 'critical' ? 'text-rose-300 font-semibold' : 'text-amber-200'}>{a.message}</div>
                        <div className="text-slate-500">{new Date(a.created_at).toLocaleTimeString('vi-VN')}</div>
                      </div>
                      <button
                        onClick={() => RouteApi.resolveAlert(a.id).then(() => setOpenAlerts((x) => x.filter((y) => y.id !== a.id)))}
                        className="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 cursor-pointer"
                      >
                        Xong
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {liveNotice && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[9996] max-w-md w-[92vw] bg-slate-900 border border-amber-500/60 rounded-xl px-4 py-3 text-xs text-amber-100 shadow-2xl flex items-start gap-3">
          <span className="flex-1">{liveNotice}</span>
          <button onClick={() => setLiveNotice(null)} className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 cursor-pointer">Đóng</button>
        </div>
      )}

      {/* Main Full-Screen Leaflet Map Area */}
      <main className="w-full h-full relative z-0 flex-1 min-h-0">
        <LeafletMap
          route={route}
          activeRoute={route}
          stops={route.stops}
          drivers={drivers}
          selectedStopId={selectedStopId}
          onSelectStop={(stop) => setSelectedStopId(stop.id)}
          onOpenPODModal={(stop) => setActiveModalStop(stop)}
          userLocation={userLocation}
          setUserLocation={setUserLocation}
          isLocating={isLocating}
          setIsLocating={setIsLocating}
          locateError={locateError}
          setLocateError={setLocateError}
          showStopsLayer={showStopsLayer}
          showRoutePolyline={showRoutePolyline}
          showDriversLayer={showDriversLayer}
          showHubLayer={showHubLayer}
          targetCoordinates={targetCoordinates}
        />
      </main>

      {/* Google My Maps Collapsible Left Drawer */}
      <GoogleMyMapsDrawer
        route={route}
        selectedStopId={selectedStopId}
        onSelectStop={(stop) => setSelectedStopId(stop.id)}
        currentUser={currentUser}
        isOpen={showMyMapsDrawer}
        onToggleOpen={() => setShowMyMapsDrawer(!showMyMapsDrawer)}
        showStopsLayer={showStopsLayer}
        onToggleStopsLayer={setShowStopsLayer}
        showRoutePolyline={showRoutePolyline}
        onToggleRoutePolyline={setShowRoutePolyline}
        showDriversLayer={showDriversLayer}
        onToggleDriversLayer={setShowDriversLayer}
        showHubLayer={showHubLayer}
        onToggleHubLayer={setShowHubLayer}
        onOpenOdooModal={() => setShowOdooModal(true)}
        onFlyToCoordinates={handleFlyToCoordinates}
      />

      {/* Floating Bottom Card: Google Maps Place Card / Driver 1-Tap Workflow */}
      {selectedStop && (
        <div className="absolute bottom-4 inset-x-3 sm:inset-x-auto sm:right-6 sm:left-auto sm:w-96 z-[450] pointer-events-auto">
          <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl p-4 shadow-2xl space-y-3">
            {/* Header with Stop Sequence & Status */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center font-extrabold text-xs text-white ${
                    selectedStop.status === 'completed'
                      ? 'bg-emerald-500'
                      : selectedStop.status === 'arrived'
                      ? 'bg-amber-500'
                      : selectedStop.status === 'failed'
                      ? 'bg-rose-500'
                      : 'bg-sky-500'
                  }`}
                >
                  #{selectedStop.sequenceOrder}
                </span>
                <div>
                  <h4 className="font-bold text-xs text-slate-100">{selectedStop.order.customerName}</h4>
                  <p className="text-[10px] text-slate-400 font-mono">{selectedStop.order.odooName}</p>
                </div>
              </div>

              {/* Status Badge */}
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  selectedStop.status === 'completed'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : selectedStop.status === 'arrived'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : selectedStop.status === 'failed'
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                }`}
              >
                {selectedStop.status === 'completed'
                  ? '🟢 Đã giao'
                  : selectedStop.status === 'arrived'
                  ? '🟠 Đã đến điểm'
                  : selectedStop.status === 'failed'
                  ? '🔴 Giao thất bại'
                  : '🔵 Chưa giao'}
              </span>
            </div>

            {/* Address & Details */}
            <p className="text-xs text-slate-300 leading-relaxed truncate">
              📍 {selectedStop.order.deliveryAddress}
            </p>

            <div className="grid grid-cols-2 gap-2 bg-slate-800/60 p-2.5 rounded-xl text-xs">
              <div>
                <span className="text-[10px] text-slate-400 block">Thu hộ COD:</span>
                <span className="font-bold text-emerald-400">
                  {selectedStop.order.codAmount > 0
                    ? `${selectedStop.order.codAmount.toLocaleString('vi-VN')} đ`
                    : '0 đ (Đã TT)'}
                </span>
              </div>
              <div className="flex items-center justify-end">
                <a
                  href={`tel:${selectedStop.order.customerPhone}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium hover:bg-emerald-500/30"
                >
                  <Phone className="w-3 h-3" />
                  {selectedStop.order.customerPhone}
                </a>
              </div>
            </div>

            {/* Assigned Shipper Info Row */}
            {(() => {
              const authCheck = AuthService.canConfirmOrder(selectedStop.order, activeDriver.name);
              return (
                <>
                  <div className="flex items-center justify-between text-[11px] bg-slate-800/80 px-2.5 py-1.5 rounded-xl border border-slate-700/60">
                    <span className="text-slate-400 truncate max-w-[200px]">
                      Người giao: <strong className="text-slate-200">{selectedStop.order.deliveryShipper || activeDriver.name}</strong>
                    </span>
                    {currentUser?.role === 'sale' && (
                      <span className="text-sky-300 font-semibold text-[10px] shrink-0">Chỉ xem</span>
                    )}
                    {currentUser?.role === 'driver' && (
                      <span className={`font-semibold text-[10px] shrink-0 ${authCheck.allowed ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {authCheck.allowed ? '✅ Đơn của bạn' : '🔒 Đơn người khác'}
                      </span>
                    )}
                    {currentUser?.role === 'admin' && (
                      <span className="text-rose-400 font-semibold text-[10px] shrink-0">Admin toàn quyền</span>
                    )}
                    {currentUser?.role === 'dispatcher' && (
                      <span className="text-sky-400 font-semibold text-[10px] shrink-0">Điều phối viên</span>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    {/* Google Maps Nav */}
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${selectedStop.order.lat},${selectedStop.order.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
                      title="Mở Google Maps dẫn đường"
                    >
                      <Navigation className="w-3.5 h-3.5 text-sky-400" />
                      <span>Google Maps</span>
                    </a>

                    {/* Action: Open POD Modal or Mark Arrived with RBAC check */}
                    {selectedStop.status !== 'completed' && selectedStop.status !== 'failed' ? (
                      authCheck.allowed ? (
                        <button
                          onClick={() => setActiveModalStop(selectedStop)}
                          className="flex-1 py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Xác nhận giao</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => alert(`🔒 Giới hạn quyền xác nhận đơn:\n${authCheck.reason}`)}
                          title={authCheck.reason}
                          className="flex-1 py-2 px-3 bg-slate-800/90 hover:bg-slate-800 text-amber-300 font-medium rounded-xl text-xs border border-amber-500/30 transition-all flex items-center justify-center gap-1.5 cursor-not-allowed"
                        >
                          <Lock className="w-3.5 h-3.5 text-amber-400" />
                          <span>Khoá quyền</span>
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => setActiveModalStop(selectedStop)}
                        className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-xs border border-slate-700 transition-colors cursor-pointer"
                      >
                        Xem lại biên nhận
                      </button>
                    )}
                  </div>
                </>
              );
            })()}

            {/* Prev / Next Pagination Controls */}
            <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px] text-slate-400">
              <button
                disabled={selectedIndex <= 0}
                onClick={() => setSelectedStopId(route.stops[selectedIndex - 1].id)}
                className="flex items-center gap-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Điểm trước
              </button>

              <span className="font-mono text-slate-300">
                {selectedIndex + 1} / {route.stops.length} ({progressPercent}%)
              </span>

              <button
                disabled={selectedIndex >= route.stops.length - 1}
                onClick={() => setSelectedStopId(route.stops[selectedIndex + 1].id)}
                className="flex items-center gap-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400"
              >
                Điểm sau <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Real-time Driver GPS Tracking HUD Bar (10s Cycle) */}
      <DriverLiveTrackingBar
        activeDriver={activeDriver}
        route={route}
        currentLocation={route.currentDriverLocation || null}
        isAutoFollow={isAutoFollowDriver}
        onToggleAutoFollow={(val) => setIsAutoFollowDriver(val)}
        onCenterDriver={handleCenterDriverOnMap}
      />

      {/* Driver POD & Stop Completion Modal */}
      {activeModalStop && (
        <DriverActiveStopModal
          stop={activeModalStop}
          driverName={activeDriver.name}
          driverCode={activeDriver.employeeCode}
          userLocation={userLocation}
          currentUser={currentUser}
          onClose={() => setActiveModalStop(null)}
          onCompleteStop={handleCompleteStop}
          onFailStop={handleFailStop}
          onMarkArrived={handleMarkArrived}
        />
      )}

      {/* Delivery Orders & Stops Panel */}
      {showDeliveryList && (
        <DeliveryOrderListPanel
          route={route}
          selectedStopId={selectedStopId}
          onSelectStop={(stopId) => setSelectedStopId(stopId)}
          onOpenPODModal={(stop) => setActiveModalStop(stop)}
          onOpenOdooModal={() => setShowOdooModal(true)}
          onClose={() => setShowDeliveryList(false)}
          currentUser={currentUser}
          activeDriverName={activeDriver.name}
        />
      )}

      {/* Odoo 14 shipping.order Integration Manager Modal */}
      {showOdooModal && (
        <OdooIntegrationModal
          onClose={() => setShowOdooModal(false)}
          onDispatchOrdersToRoute={handleDispatchOrdersFromOdoo}
          currentUser={currentUser}
        />
      )}

      {/* Admin Account Management Modal */}
      {showAccountModal && (
        <AccountManagementModal
          isOpen={showAccountModal}
          currentUser={currentUser}
          onClose={() => setShowAccountModal(false)}
        />
      )}

      {/* Floating Push Notification Toast Banner */}
      {activePushBanner && (
        <div className="fixed top-20 right-4 sm:right-6 z-[9995] max-w-sm w-[92vw] sm:w-auto bg-slate-900/95 border-2 border-emerald-500 rounded-2xl p-4 shadow-2xl backdrop-blur-xl animate-in slide-in-from-top-4 duration-300 text-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shrink-0 mt-0.5">
                <BellRing className="w-5 h-5 animate-bounce-subtle" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.2 rounded bg-emerald-500/30 text-emerald-300 text-[9px] font-bold uppercase tracking-wider">
                    Service Worker Push
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {new Date(activePushBanner.timestamp).toLocaleTimeString('vi-VN')}
                  </span>
                </div>
                <h4 className="font-bold text-xs text-white">{activePushBanner.title}</h4>
                <p className="text-[11px] text-slate-300 leading-relaxed">{activePushBanner.body}</p>
                {activePushBanner.codAmount !== undefined && activePushBanner.codAmount > 0 && (
                  <p className="text-[10px] text-emerald-400 font-mono font-semibold pt-0.5">
                    Thu hộ COD: {activePushBanner.codAmount.toLocaleString('vi-VN')} đ
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => setActivePushBanner(null)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition shrink-0"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-800 flex items-center justify-between gap-2">
            <button
              onClick={() => {
                setShowDeliveryList(true);
                setActivePushBanner(null);
              }}
              className="flex-1 py-1.5 px-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs transition text-center cursor-pointer"
            >
              Xem danh sách đơn
            </button>
            <button
              onClick={() => {
                setShowNotificationDrawer(true);
                setActivePushBanner(null);
              }}
              className="py-1.5 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition border border-slate-700 cursor-pointer"
            >
              Cài đặt Push
            </button>
          </div>
        </div>
      )}

      {/* Driver Service Worker Push Notification Drawer */}
      <NotificationDrawer
        isOpen={showNotificationDrawer}
        onClose={() => setShowNotificationDrawer(false)}
        currentUser={currentUser}
        activeDriverName={activeDriver.name}
      />

      {/* Mandatory Login Modal (Mới cho dùng) */}
      <LoginModal
        isOpen={!currentUser}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setMustChangePw(!!user.mustChangePassword);
        }}
      />

      {/* Gợi ý tuyến phía máy chủ */}
      {showPlanner && (
        <ServerRoutePlannerPanel
          onClose={() => setShowPlanner(false)}
          onConfirmed={() => {
            void live.reload();
          }}
        />
      )}

      {currentUser && mustChangePw && (
        <ChangePasswordModal
          onDone={() => setMustChangePw(false)}
          onLogout={() => {
            AuthService.logout();
            setCurrentUser(null);
          }}
        />
      )}
    </div>

  );
}
