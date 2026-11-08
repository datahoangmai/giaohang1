import React, { useState } from 'react';
import { DeliveryRoute } from '../../types/delivery';
import {
  Navigation,
  Clock,
  MapPin,
  AlertTriangle,
  Flame,
  ChevronDown,
  ChevronUp,
  TrendingDown,
  Sparkles,
  ShieldCheck,
  Zap,
} from 'lucide-react';

interface RouteSituationalSummaryProps {
  route: DeliveryRoute;
  className?: string;
}

export const RouteSituationalSummary: React.FC<RouteSituationalSummaryProps> = ({
  route,
  className = '',
}) => {
  const [isMinimized, setIsMinimized] = useState(false);

  // Calculate remaining stats
  const totalStops = route.stops.length;
  const completedStops = route.stops.filter((s) => s.status === 'completed').length;
  const failedStops = route.stops.filter((s) => s.status === 'failed').length;
  const remainingStops = totalStops - completedStops - failedStops;

  // Remaining distance: approximate proportional to remaining stops
  const completedRatio = totalStops > 0 ? (completedStops + failedStops * 0.5) / totalStops : 0;
  const remainingDistanceKm = Math.max(
    0.8,
    parseFloat((route.totalDistanceKm * (1 - completedRatio * 0.85)).toFixed(1))
  );

  // Base remaining duration
  const baseRemainingMinutes = Math.max(
    5,
    Math.round(remainingDistanceKm * 3.2 + remainingStops * 7)
  );

  const totalRemainingMinutes = baseRemainingMinutes;

  // Calculate projected ETA completion time
  const now = new Date();
  const projectedFinishDate = new Date(now.getTime() + totalRemainingMinutes * 60000);
  const projectedFinishTime = projectedFinishDate.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const progressPercent = totalStops > 0 ? Math.round((completedStops / totalStops) * 100) : 0;

  return (
    <div
      className={`pointer-events-auto bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl transition-all duration-300 text-slate-100 ${
        isMinimized ? 'w-auto' : 'w-80 sm:w-88'
      } ${className}`}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></div>
          <span className="font-bold text-xs tracking-wide text-slate-200">
            Tình Hình Tuyến Giao
          </span>
          <span className="text-[10px] font-mono text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20">
            {remainingStops} điểm còn lại
          </span>
        </div>

        <button
          onClick={() => setIsMinimized(!isMinimized)}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          title={isMinimized ? 'Mở rộng bảng lộ trình' : 'Thu nhỏ bảng lộ trình'}
        >
          {isMinimized ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {/* Summary Content Body (collapsible) */}
      {!isMinimized && (
        <div className="p-3.5 space-y-3 text-xs">
          {/* Main Key Metrics: Distance & Time Remaining */}
          <div className="grid grid-cols-2 gap-2">
            {/* Remaining Distance */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-2.5">
              <div className="flex items-center gap-1.5 text-slate-400 text-[11px] mb-1">
                <Navigation className="w-3.5 h-3.5 text-sky-400" />
                <span>Quãng đường còn:</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-black text-slate-100 font-mono tracking-tight">
                  {remainingDistanceKm}
                </span>
                <span className="text-xs text-slate-400 font-medium">km</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Tổng tuyến: {route.totalDistanceKm} km
              </span>
            </div>

            {/* Remaining Duration & ETA */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-2.5">
              <div className="flex items-center gap-1.5 text-slate-400 text-[11px] mb-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Thời gian dự kiến:</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-black text-amber-300 font-mono tracking-tight">
                  ~{totalRemainingMinutes}
                </span>
                <span className="text-xs text-slate-400 font-medium">phút</span>
              </div>
              <span className="text-[10px] text-emerald-400 font-medium block mt-0.5">
                Dự kiến xong: <strong>{projectedFinishTime}</strong>
              </span>
            </div>
          </div>

          {/* Progress Bar of Completed Stops */}
          <div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>Tiến độ hoàn thành:</span>
              <span className="font-mono font-semibold text-slate-200">
                {completedStops}/{totalStops} điểm ({progressPercent}%)
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-sky-400 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              ></div>
            </div>
          </div>

        </div>
      )}

      {/* Minimized Quick Preview */}
      {isMinimized && (
        <div className="px-3.5 py-2 flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <Navigation className="w-3.5 h-3.5 text-sky-400" />
            <span className="font-mono font-bold text-slate-200">{remainingDistanceKm} km</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-mono font-bold text-amber-300">~{totalRemainingMinutes}p</span>
          </div>
        </div>
      )}
    </div>
  );
};
