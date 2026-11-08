import React, { useState, useEffect } from 'react';
import {
  Navigation,
  Radio,
  Play,
  Pause,
  RotateCw,
  LocateFixed,
  Compass,
  Gauge,
  ShieldCheck,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  Layers,
  Sun,
  SunMedium,
  Smartphone,
  HardDrive,
  Info,
} from 'lucide-react';
import { DriverLocationLog, DriverProfile, DeliveryRoute } from '../../types/delivery';
import { DriverTrackingService, TrackingMode } from '../../services/tracking/DriverTrackingService';

interface DriverLiveTrackingBarProps {
  activeDriver: DriverProfile;
  route: DeliveryRoute;
  currentLocation: DriverLocationLog | null;
  isAutoFollow: boolean;
  onToggleAutoFollow: (enabled: boolean) => void;
  onCenterDriver: () => void;
}

export const DriverLiveTrackingBar: React.FC<DriverLiveTrackingBarProps> = ({
  activeDriver,
  route,
  currentLocation,
  isAutoFollow,
  onToggleAutoFollow,
  onCenterDriver,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(10);
  const [isTracking, setIsTracking] = useState<boolean>(true);
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('real_gps');
  const [lastSyncNotice, setLastSyncNotice] = useState<string | null>(null);
  const [geofenceNotice, setGeofenceNotice] = useState<{ name: string; distance: number } | null>(null);
  const [isWakeLockActive, setIsWakeLockActive] = useState<boolean>(false);
  const [wakeLockSupported, setWakeLockSupported] = useState<boolean>(false);
  const [tileCacheStats, setTileCacheStats] = useState<{ count: number; sizeBytes: number } | null>(null);

  useEffect(() => {
    const service = DriverTrackingService.getInstance();
    setIsTracking(service.isTracking());
    setTrackingMode(service.getTrackingMode());
    setWakeLockSupported(service.isWakeLockSupported());

    const unsubWakeLock = service.subscribeWakeLock((active) => {
      setIsWakeLockActive(active);
    });

    const unsubCountdown = service.subscribeCountdown((sec) => {
      setSecondsRemaining(sec);
      if (sec === 10) {
        setLastSyncNotice('Đã đồng bộ tọa độ tài xế vào lộ trình');
        const timer = setTimeout(() => setLastSyncNotice(null), 3000);
        return () => clearTimeout(timer);
      }
    });

    const unsubGeofence = service.subscribeGeofence((stop, dist) => {
      setGeofenceNotice({
        name: stop.order.customerName,
        distance: dist,
      });
      const timer = setTimeout(() => setGeofenceNotice(null), 6000);
      return () => clearTimeout(timer);
    });

    // Check service worker tile cache stats if supported
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        if (event.data?.type === 'TILE_CACHE_STATS') {
          setTileCacheStats({
            count: event.data.count,
            sizeBytes: event.data.sizeBytes,
          });
        }
      };
      navigator.serviceWorker.controller.postMessage({ type: 'GET_TILE_CACHE_STATS' }, [channel.port2]);
    }

    return () => {
      unsubCountdown();
      unsubGeofence();
      unsubWakeLock();
    };
  }, []);

  const handleToggleTracking = () => {
    const service = DriverTrackingService.getInstance();
    if (service.isTracking()) {
      service.stop();
      setIsTracking(false);
    } else {
      service.start(activeDriver, route);
      setIsTracking(true);
    }
  };

  const handleForceSync = () => {
    const service = DriverTrackingService.getInstance();
    service.forceUpdateNow();
  };

  const handleToggleWakeLock = async () => {
    const service = DriverTrackingService.getInstance();
    if (isWakeLockActive) {
      await service.releaseWakeLock();
    } else {
      await service.requestWakeLock();
    }
  };

  const progressPercent = ((10 - secondsRemaining) / 10) * 100;

  return (
    <div className="fixed bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-[560] max-w-xl w-[94vw] sm:w-auto">
      {/* Geofence proximity alert pill */}
      {geofenceNotice && (
        <div className="mb-2 px-3.5 py-2 bg-emerald-500/95 text-white rounded-2xl shadow-xl flex items-center justify-between gap-3 text-xs font-semibold animate-bounce backdrop-blur-md border border-emerald-400">
          <div className="flex items-center gap-2">
            <span className="text-base">🔔</span>
            <span>
              Tài xế đang cách <strong>{geofenceNotice.name}</strong> chỉ{' '}
              <span className="underline font-black">{geofenceNotice.distance}m</span>!
            </span>
          </div>
          <button
            onClick={() => setGeofenceNotice(null)}
            className="text-white/80 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-emerald-600/50"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Floating GPS HUD Bar */}
      <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden transition-all text-slate-100">
        {/* Top condensed bar */}
        <div className="px-3.5 py-2.5 flex items-center justify-between gap-2.5 sm:gap-4">
          {/* Status & Driver indicator */}
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center">
              <span
                className={`w-3 h-3 rounded-full ${
                  isTracking ? 'bg-emerald-500 animate-ping' : 'bg-slate-500'
                }`}
              ></span>
              <span
                className={`absolute w-2 h-2 rounded-full ${
                  isTracking ? 'bg-emerald-400' : 'bg-slate-400'
                }`}
              ></span>
            </div>

            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1">
                  <Navigation className="w-3.5 h-3.5 text-sky-400 fill-sky-400/20" />
                  {activeDriver.name}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {activeDriver.assignedVehiclePlate}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 flex items-center gap-1">
                <span>🛰️ GPS Thiết Bị</span>
                <span>&bull;</span>
                <span className="text-emerald-400 font-medium">Chu kỳ 10s</span>
              </p>
            </div>
          </div>

          {/* 10-Second Countdown Dial */}
          <div className="flex items-center gap-2">
            <div
              className="relative w-8 h-8 rounded-full flex items-center justify-center bg-slate-800 border border-slate-700 cursor-pointer"
              onClick={handleForceSync}
              title="Nhấn để đồng bộ ngay lập tức"
            >
              <svg className="w-8 h-8 -rotate-90">
                <circle
                  cx="16"
                  cy="16"
                  r="13"
                  className="stroke-slate-700"
                  strokeWidth="2.5"
                  fill="transparent"
                />
                <circle
                  cx="16"
                  cy="16"
                  r="13"
                  className="stroke-emerald-400 transition-all duration-300"
                  strokeWidth="2.5"
                  strokeDasharray={81.68}
                  strokeDashoffset={81.68 - (81.68 * progressPercent) / 100}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <span className="absolute text-[10px] font-black text-slate-200">
                {secondsRemaining}s
              </span>
            </div>

            {/* Auto-follow toggle */}
            <button
              onClick={() => onToggleAutoFollow(!isAutoFollow)}
              className={`p-2 rounded-xl text-xs font-medium border transition-all flex items-center gap-1.5 ${
                isAutoFollow
                  ? 'bg-sky-500/20 text-sky-300 border-sky-500/50 shadow-sm'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
              }`}
              title="Tự động bám theo tài xế trên bản đồ"
            >
              <LocateFixed className={`w-3.5 h-3.5 ${isAutoFollow ? 'text-sky-400 animate-spin-slow' : ''}`} />
              <span className="hidden sm:inline text-[11px]">Bám theo</span>
            </button>

            {/* Wake Lock Keep Screen On Button */}
            <button
              onClick={handleToggleWakeLock}
              className={`p-2 rounded-xl text-xs font-medium border transition-all flex items-center gap-1.5 ${
                isWakeLockActive
                  ? 'bg-amber-500/25 text-amber-300 border-amber-500/60 shadow-sm'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
              }`}
              title={
                isWakeLockActive
                  ? 'Màn hình đang giữ sáng liên tục (Screen Wake Lock BẬT)'
                  : 'Bật giữ sáng màn hình khi tài xế kẹp điện thoại trên xe máy'
              }
            >
              {isWakeLockActive ? (
                <SunMedium className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              ) : (
                <Sun className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline text-[11px]">
                {isWakeLockActive ? 'Sáng MH' : 'Giữ sáng'}
              </span>
            </button>

            {/* Play/Pause */}
            <button
              onClick={handleToggleTracking}
              className={`p-2 rounded-xl text-xs font-semibold border transition-all ${
                isTracking
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
              }`}
              title={isTracking ? 'Tạm dừng chu kỳ định vị 10s' : 'Bật lại chu kỳ định vị 10s'}
            >
              {isTracking ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>

            {/* Expand Telemetry */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              title={isExpanded ? 'Thu gọn chi tiết' : 'Mở rộng thông số GPS'}
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Live sync toast banner */}
        {lastSyncNotice && (
          <div className="px-3.5 py-1 bg-emerald-500/15 border-t border-emerald-500/30 text-[10px] text-emerald-300 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
              {lastSyncNotice}
            </span>
            <span className="font-mono text-slate-400">
              {currentLocation ? new Date(currentLocation.timestamp).toLocaleTimeString('vi-VN') : ''}
            </span>
          </div>
        )}

        {/* Expanded Telemetry HUD */}
        {isExpanded && (
          <div className="px-4 py-3 bg-slate-950/70 border-t border-slate-800 space-y-2.5 text-xs animate-in slide-in-from-bottom-2 duration-150">
            {/* Driver Mobile PWA Operational Notice */}
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-[11px] text-amber-200">
              <Smartphone className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-semibold text-amber-300 block">Lưu ý hoạt động GPS trên Mobile PWA:</span>
                <p className="text-amber-200/80 leading-relaxed">
                  Trình duyệt (Chrome / Safari) sẽ tự ngắt timer GPS khi tắt màn hình. Tài xế nên bật nút{' '}
                  <strong className="text-amber-300 font-bold">"Sáng MH" (Wake Lock)</strong> khi gắn giá đỡ xe máy, hoặc chỉ cần mở lại màn hình là GPS tự động đồng bộ ngay lập tức!
                </p>
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-slate-900/80 p-2 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block flex items-center gap-1">
                  <Gauge className="w-3 h-3 text-sky-400" /> Tốc độ
                </span>
                <span className="font-bold text-white text-sm">
                  {currentLocation?.speedKmh ?? 0} <span className="text-[10px] text-slate-400 font-normal">km/h</span>
                </span>
              </div>

              <div className="bg-slate-900/80 p-2 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" /> Độ chính xác
                </span>
                <span className="font-bold text-emerald-400 text-sm">
                  &plusmn;{currentLocation?.accuracy ?? 10} <span className="text-[10px] text-slate-400 font-normal">m</span>
                </span>
              </div>

              <div className="bg-slate-900/80 p-2 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block flex items-center gap-1">
                  <Compass className="w-3 h-3 text-amber-400" /> Hướng di chuyển
                </span>
                <span className="font-bold text-amber-400 text-sm">
                  {currentLocation?.heading ?? 0}&deg;
                </span>
              </div>
            </div>

            {/* Coordinates & Route Sync Info */}
            <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-900/60 px-3 py-1.5 rounded-xl border border-slate-800/80">
              <span>Tọa độ hiện tại:</span>
              <span className="font-mono text-slate-200">
                {currentLocation ? `${currentLocation.lat.toFixed(5)}, ${currentLocation.lng.toFixed(5)}` : 'Đang lấy...'}
              </span>
            </div>

            {/* OSM Tile Caching Policy Status */}
            <div className="flex items-center justify-between text-[11px] bg-slate-900/60 px-3 py-1.5 rounded-xl border border-slate-800/80 text-slate-300">
              <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <HardDrive className="w-3 h-3 text-emerald-400" />
                Tile Cache OSM (Policy):
              </span>
              <span className="font-medium text-emerald-300 text-[10px]">
                {tileCacheStats ? (
                  `${tileCacheStats.count} tiles cached (~${(tileCacheStats.sizeBytes / (1024 * 1024)).toFixed(1)} MB)`
                ) : (
                  'CacheFirst PWA Active'
                )}
              </span>
            </div>

            {/* Mode selection buttons */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                onClick={onCenterDriver}
                className="ml-auto px-2.5 py-1 rounded-lg text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1"
                title="Định vị ngay đến xe trên bản đồ"
              >
                <LocateFixed className="w-3 h-3 text-sky-400" />
                Định vị xe
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
