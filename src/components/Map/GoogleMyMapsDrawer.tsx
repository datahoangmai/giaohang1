import React, { useState } from 'react';
import {
  Layers,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Truck,
  Warehouse,
  Flame,
  Route as RouteIcon,
  Search,
  ExternalLink,
  RotateCw,
  Sparkles,
  Phone,
  CheckCircle2,
  Lock,
  Compass,
  Check,
  Eye,
  Crosshair,
} from 'lucide-react';
import { DeliveryRoute, RouteStop } from '../../types/delivery';
import { AppUser } from '../../types/auth';
import { AuthService } from '../../services/auth/AuthService';

interface GoogleMyMapsDrawerProps {
  route: DeliveryRoute;
  selectedStopId: string;
  onSelectStop: (stop: RouteStop) => void;
  currentUser: AppUser | null;
  isOpen: boolean;
  onToggleOpen: () => void;
  // Layer visibility toggles
  showStopsLayer: boolean;
  onToggleStopsLayer: (val: boolean) => void;
  showRoutePolyline: boolean;
  onToggleRoutePolyline: (val: boolean) => void;
  showDriversLayer: boolean;
  onToggleDriversLayer: (val: boolean) => void;
  showHubLayer: boolean;
  onToggleHubLayer: (val: boolean) => void;
  // Quick Actions
  onOpenOdooModal: () => void;
  onFlyToCoordinates: (lat: number, lng: number, zoom?: number) => void;
}

export const GoogleMyMapsDrawer: React.FC<GoogleMyMapsDrawerProps> = ({
  route,
  selectedStopId,
  onSelectStop,
  currentUser,
  isOpen,
  onToggleOpen,
  showStopsLayer,
  onToggleStopsLayer,
  showRoutePolyline,
  onToggleRoutePolyline,
  showDriversLayer,
  onToggleDriversLayer,
  showHubLayer,
  onToggleHubLayer,
  onOpenOdooModal,
  onFlyToCoordinates,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'my' | 'pending' | 'completed' | 'failed'>('all');

  const sortedStops = [...route.stops].sort((a, b) => a.sequenceOrder - b.sequenceOrder);

  // Check my orders count for logged in staff
  const myStopsCount = sortedStops.filter((s) => {
    const auth = AuthService.canConfirmOrder(s.order);
    return auth.allowed;
  }).length;

  const filteredStops = sortedStops.filter((stop) => {
    // Filter by type
    if (filterType === 'my') {
      const auth = AuthService.canConfirmOrder(stop.order);
      if (!auth.allowed) return false;
    } else if (filterType === 'pending') {
      if (stop.status !== 'pending' && stop.status !== 'arrived') return false;
    } else if (filterType === 'completed') {
      if (stop.status !== 'completed') return false;
    } else if (filterType === 'failed') {
      if (stop.status !== 'failed') return false;
    }

    // Search query
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      stop.order.customerName.toLowerCase().includes(q) ||
      stop.order.odooName.toLowerCase().includes(q) ||
      stop.order.deliveryAddress.toLowerCase().includes(q) ||
      stop.order.customerPhone.includes(q) ||
      (stop.order.deliveryShipper && stop.order.deliveryShipper.toLowerCase().includes(q))
    );
  });

  return (
    <>
      {/* Floating Toggle Button when Drawer is collapsed */}
      {!isOpen && (
        <button
          onClick={onToggleOpen}
          title="Mở Bảng Điều Khiển Google My Maps"
          className="absolute top-20 left-4 z-[420] flex items-center gap-2 px-3 py-2 bg-slate-900/95 hover:bg-slate-800 text-slate-100 rounded-2xl shadow-2xl border border-slate-700/80 backdrop-blur-md transition-all hover:scale-102 cursor-pointer font-semibold text-xs group"
        >
          <div className="w-5 h-5 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
            🗺️
          </div>
          <span className="hidden sm:inline">Bản Đồ Google My Maps</span>
          <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-white" />
        </button>
      )}

      {/* Main Google My Maps Floating Panel */}
      <div
        className={`fixed sm:absolute top-16 sm:top-20 bottom-4 left-2 sm:left-4 z-[420] w-[96vw] sm:w-[380px] bg-slate-900/98 backdrop-blur-xl border border-slate-700/90 rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-100 transition-all duration-300 ${
          isOpen ? 'translate-x-0 opacity-100' : '-translate-x-[110%] opacity-0 pointer-events-none'
        }`}
      >
        {/* Google My Maps Header Card */}
        <div className="p-4 bg-gradient-to-r from-blue-900/60 via-slate-850 to-slate-900 border-b border-slate-800 shrink-0 relative">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-600/30 border border-blue-400/40 flex items-center justify-center text-blue-300 shadow-md">
                <Compass className="w-5 h-5 text-blue-400 animate-spin-slow" />
              </div>
              <div>
                <h3 className="font-extrabold text-sm text-white tracking-tight leading-tight flex items-center gap-1.5">
                  <span>Hachihi Delivery</span>
                  <span className="px-1.5 py-0.2 text-[9px] font-bold bg-blue-500/30 text-blue-300 rounded border border-blue-400/40">
                    My Maps
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400 leading-tight mt-0.5">
                  Lộ trình giao hàng đa điểm TP.HCM
                </p>
              </div>
            </div>

            <button
              onClick={onToggleOpen}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition"
              title="Thu nhỏ bảng điều khiển"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Reference Map Coordinates Button (Chợ Lớn / Bình Tân / Q6 - 10.772, 106.603) */}
          <div className="mt-3 flex items-center justify-between gap-1.5 pt-2 border-t border-slate-800/80 text-[11px]">
            <button
              onClick={() => onFlyToCoordinates(10.7720938, 106.6035479, 13)}
              className="flex-1 py-1 px-2.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded-lg border border-blue-500/30 flex items-center justify-center gap-1.5 transition text-[10px] font-semibold"
              title="Phóng to đến đúng tọa độ Google My Maps: 10.772, 106.603"
            >
              <Crosshair className="w-3 h-3 text-blue-400" />
              <span>Xem Tọa Độ Tham Chiếu (10.772, 106.603)</span>
            </button>
          </div>

          {/* Quick Route Metrics */}
          <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-center text-[10px]">
            <div className="bg-slate-800/70 p-1.5 rounded-lg border border-slate-700/50">
              <span className="text-slate-400 block">Số điểm</span>
              <strong className="text-white text-xs font-mono">{route.stops.length} điểm</strong>
            </div>
            <div className="bg-slate-800/70 p-1.5 rounded-lg border border-slate-700/50">
              <span className="text-slate-400 block">Cự ly</span>
              <strong className="text-sky-400 text-xs font-mono">{route.totalDistanceKm} km</strong>
            </div>
            <div className="bg-slate-800/70 p-1.5 rounded-lg border border-slate-700/50">
              <span className="text-slate-400 block">Dự kiến</span>
              <strong className="text-amber-400 text-xs font-mono">~{route.estimatedDurationMin}p</strong>
            </div>
          </div>
        </div>

        {/* Quick Dispatch / Optimizer bar */}
        <div className="px-3 py-2 bg-slate-950/60 border-b border-slate-800/80 flex items-center gap-2 text-xs shrink-0">
          <button
            onClick={onOpenOdooModal}
            className="flex-1 py-1.5 px-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 rounded-xl border border-amber-500/30 flex items-center justify-center gap-1 font-semibold transition"
          >
            <RotateCw className="w-3.5 h-3.5 text-amber-400" />
            <span>Nạp Đơn Odoo</span>
          </button>
        </div>

        {/* Search & Filter Header for Stops */}
        <div className="p-3 bg-slate-900 border-b border-slate-800/80 shrink-0 space-y-2">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm điểm giao, khách, SĐT, mã Odoo..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto text-[11px] pb-0.5">
            <button
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition cursor-pointer ${
                filterType === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Tất cả ({route.stops.length})
            </button>
            <button
              onClick={() => setFilterType('my')}
              className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition cursor-pointer flex items-center gap-1 ${
                filterType === 'my'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-emerald-400 hover:bg-slate-700'
              }`}
            >
              <span>Đơn của tôi</span>
              <span className="px-1.5 py-0.1 text-[9px] rounded-full bg-black/30 font-bold font-mono">
                {myStopsCount}
              </span>
            </button>
            <button
              onClick={() => setFilterType('pending')}
              className={`px-2 py-1 rounded-lg font-medium whitespace-nowrap transition cursor-pointer ${
                filterType === 'pending'
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Chưa giao
            </button>
            <button
              onClick={() => setFilterType('completed')}
              className={`px-2 py-1 rounded-lg font-medium whitespace-nowrap transition cursor-pointer ${
                filterType === 'completed'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Đã giao
            </button>
            <button
              onClick={() => setFilterType('failed')}
              className={`px-2 py-1 rounded-lg font-medium whitespace-nowrap transition cursor-pointer ${
                filterType === 'failed'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Thất bại
            </button>
          </div>
        </div>

        {/* Scrollable Body: Google My Maps Layers & Stops List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80 text-xs">
          {/* Layer 1: Delivery Stops Layer Header */}
          <div className="p-3 bg-slate-850/50">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showStopsLayer}
                  onChange={(e) => onToggleStopsLayer(e.target.checked)}
                  className="w-3.5 h-3.5 rounded text-blue-500 bg-slate-800 border-slate-600 focus:ring-0 cursor-pointer"
                />
                <span className="font-bold text-xs text-slate-200 flex items-center gap-1.5">
                  <span>📍</span>
                  <span>Lớp Điểm Giao Hàng</span>
                </span>
              </label>
              <span className="text-[10px] text-slate-400">
                {filteredStops.length} điểm
              </span>
            </div>

            {/* List of stops under this layer */}
            {showStopsLayer && (
              <div className="space-y-1.5 mt-2 pl-2">
                {filteredStops.length === 0 ? (
                  <div className="p-3 text-center text-slate-400 text-xs bg-slate-800/40 rounded-xl">
                    Không tìm thấy điểm giao phù hợp bộ lọc.
                  </div>
                ) : (
                  filteredStops.map((stop) => {
                    const isSelected = selectedStopId === stop.id;
                    const authCheck = AuthService.canConfirmOrder(stop.order);

                    // Colors matching Google My Maps numbered pins
                    let pinBg = 'bg-blue-600';
                    let statusLabel = 'Chưa giao';
                    if (stop.status === 'completed') {
                      pinBg = 'bg-emerald-600';
                      statusLabel = 'Đã giao';
                    } else if (stop.status === 'arrived') {
                      pinBg = 'bg-amber-500 text-slate-950';
                      statusLabel = 'Đã đến';
                    } else if (stop.status === 'failed') {
                      pinBg = 'bg-rose-600';
                      statusLabel = 'Thất bại';
                    }

                    return (
                      <div
                        key={stop.id}
                        onClick={() => onSelectStop(stop)}
                        className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-start gap-2.5 ${
                          isSelected
                            ? 'bg-blue-950/40 border-blue-500 shadow-md ring-1 ring-blue-500/40'
                            : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/80 hover:border-slate-600'
                        }`}
                      >
                        {/* Numbered Google My Maps teardrop Pin icon */}
                        <div
                          className={`w-6 h-6 rounded-full ${pinBg} text-white font-black text-xs flex items-center justify-center shrink-0 shadow mt-0.5`}
                        >
                          {stop.sequenceOrder}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold text-xs text-slate-100 truncate">
                              {stop.order.customerName}
                            </span>
                            <span
                              className={`text-[9px] font-semibold px-1.5 py-0.2 rounded shrink-0 ${
                                stop.status === 'completed'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : stop.status === 'failed'
                                  ? 'bg-rose-500/20 text-rose-400'
                                  : 'bg-blue-500/20 text-blue-300'
                              }`}
                            >
                              {statusLabel}
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-400 truncate mt-0.5">
                            {stop.order.deliveryAddress}
                          </p>

                          <div className="flex items-center justify-between gap-2 mt-1.5 pt-1 border-t border-slate-700/50 text-[10px]">
                            <span className="font-mono text-emerald-400 font-semibold">
                              COD: {stop.order.codAmount > 0 ? `${stop.order.codAmount.toLocaleString('vi-VN')} đ` : '0 đ (Đã TT)'}
                            </span>

                            {/* Staff authorization indicator */}
                            {currentUser?.role === 'driver' ? (
                              authCheck.allowed ? (
                                <span className="text-emerald-400 font-bold flex items-center gap-0.5">
                                  <Check className="w-3 h-3" /> Đơn của bạn
                                </span>
                              ) : (
                                <span className="text-amber-400 flex items-center gap-0.5" title={authCheck.reason}>
                                  <Lock className="w-2.5 h-2.5" /> Đơn khác
                                </span>
                              )
                            ) : (
                              <span className="text-slate-400 truncate max-w-[120px]">
                                Shipper: {stop.order.deliveryShipper || 'Chưa gán'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Layer 2: Route Polyline Layer */}
          <div className="p-3 bg-slate-900/60 flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showRoutePolyline}
                onChange={(e) => onToggleRoutePolyline(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-blue-500 bg-slate-800 border-slate-600 focus:ring-0 cursor-pointer"
              />
              <span className="font-semibold text-xs text-slate-200 flex items-center gap-1.5">
                <RouteIcon className="w-3.5 h-3.5 text-blue-400" />
                <span>Lớp Lộ Trình Đường Đi</span>
              </span>
            </label>
            <span className="text-[10px] text-blue-400 font-mono font-medium">
              {route.totalDistanceKm} km
            </span>
          </div>

          {/* Layer 3: Fleet / Drivers Layer with Live 10s GPS Telemetry */}
          <div className="p-3 bg-slate-900/60 flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showDriversLayer}
                onChange={(e) => onToggleDriversLayer(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-blue-500 bg-slate-800 border-slate-600 focus:ring-0 cursor-pointer"
              />
              <span className="font-semibold text-xs text-slate-200 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-sky-400" />
                <span>Lớp Vị Trí Xe & Tài Xế</span>
              </span>
            </label>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span className="text-[10px] text-emerald-400 font-mono font-bold">
                10s: {route.currentDriverLocation?.speedKmh ?? 26} km/h
              </span>
            </div>
          </div>

          {/* Layer 4: Central Hub Warehouse */}
          <div className="p-3 bg-slate-900/60 flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showHubLayer}
                onChange={(e) => onToggleHubLayer(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-blue-500 bg-slate-800 border-slate-600 focus:ring-0 cursor-pointer"
              />
              <span className="font-semibold text-xs text-slate-200 flex items-center gap-1.5">
                <Warehouse className="w-3.5 h-3.5 text-amber-400" />
                <span>Kho xuất hàng</span>
              </span>
            </label>
          </div>

        </div>

        {/* Footer info: Google My Maps reference note */}
        <div className="p-3 bg-slate-950/80 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between shrink-0">
          <span className="truncate">Tương thích chuẩn Google Maps & OSM</span>
          <a
            href="https://www.google.com/maps/d/u/0/view?mid=1l5afTOsiLc4kc3Cja0crkd7bjdgWZ4Y&ll=10.772093818133634%2C106.60354796762061&z=13"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline flex items-center gap-1 shrink-0 font-medium"
          >
            <span>Mở Google My Maps</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </>
  );
};
