import React, { useState } from 'react';
import { DeliveryRoute, RouteStop } from '../../types/delivery';
import {
  Package,
  CheckCircle2,
  Clock,
  AlertCircle,
  Phone,
  Navigation,
  MapPin,
  Sparkles,
  RotateCw,
  Search,
  Filter,
  ChevronRight,
  ExternalLink,
  Wrench,
  Bike,
  Plus,
  X,
  Eye,
  Lock,
  UserCheck,
  BellRing,
  User,
  RotateCcw,
} from 'lucide-react';
import { AppUser } from '../../types/auth';
import { AuthService } from '../../services/auth/AuthService';
import { NotificationService } from '../../services/notification/NotificationService';

interface DeliveryOrderListPanelProps {
  route: DeliveryRoute;
  selectedStopId: string;
  onSelectStop: (stopId: string) => void;
  onOpenPODModal: (stop: RouteStop) => void;
  onOpenOdooModal: () => void;
  onClose: () => void;
  currentUser?: AppUser | null;
  activeDriverName?: string;
}

export const DeliveryOrderListPanel: React.FC<DeliveryOrderListPanelProps> = ({
  route,
  selectedStopId,
  onSelectStop,
  onOpenPODModal,
  onOpenOdooModal,
  onClose,
  currentUser,
  activeDriverName,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'my' | 'pending' | 'arrived' | 'completed' | 'failed'>('all');
  const [selectedShipper, setSelectedShipper] = useState<string>('all');

  const completedCount = route.stops.filter((s) => s.status === 'completed').length;
  const arrivedCount = route.stops.filter((s) => s.status === 'arrived').length;
  const pendingCount = route.stops.filter((s) => s.status === 'pending').length;
  const failedCount = route.stops.filter((s) => s.status === 'failed').length;

  const myOrdersCount = route.stops.filter((s) => AuthService.canConfirmOrder(s.order, activeDriverName).allowed).length;

  // Extract distinct delivery shippers present in the route stops with count
  const shipperList = React.useMemo(() => {
    const map = new Map<string, number>();
    route.stops.forEach((s) => {
      const name = s.order.deliveryShipper?.trim() || 'Chưa gán';
      map.set(name, (map.get(name) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [route.stops]);

  const totalCodExpected = route.stops.reduce((acc, s) => acc + (s.order.codAmount || 0), 0);
  const progressPercent = route.stops.length > 0 ? Math.round((completedCount / route.stops.length) * 100) : 0;

  const filteredStops = route.stops.filter((stop) => {
    // 1. Status Filter (chờ giao: pending, đã đến: arrived, đã giao: completed, thất bại: failed, đơn của tôi: my)
    let matchesStatus = true;
    if (statusFilter === 'my') {
      matchesStatus = AuthService.canConfirmOrder(stop.order, activeDriverName).allowed;
    } else if (statusFilter !== 'all') {
      matchesStatus = stop.status === statusFilter;
    }

    // 2. Shipper Filter (theo tên nhân viên giao hàng)
    let matchesShipper = true;
    if (selectedShipper !== 'all') {
      const stopShipper = stop.order.deliveryShipper?.trim() || 'Chưa gán';
      matchesShipper = stopShipper.toLowerCase() === selectedShipper.toLowerCase();
    }

    // 3. Search Query Filter
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      stop.order.customerName.toLowerCase().includes(q) ||
      stop.order.odooName.toLowerCase().includes(q) ||
      (stop.order.originDocument && stop.order.originDocument.toLowerCase().includes(q)) ||
      (stop.order.trackingCode && stop.order.trackingCode.toLowerCase().includes(q)) ||
      stop.order.deliveryAddress.toLowerCase().includes(q) ||
      (stop.order.district && stop.order.district.toLowerCase().includes(q)) ||
      stop.order.customerPhone.includes(q) ||
      (stop.order.deliveryShipper && stop.order.deliveryShipper.toLowerCase().includes(q)) ||
      (stop.order.notes && stop.order.notes.toLowerCase().includes(q)) ||
      (stop.order.items && stop.order.items.some((it) => it.name.toLowerCase().includes(q)));

    return matchesStatus && matchesShipper && matchesSearch;
  });

  const isFiltered = statusFilter !== 'all' || selectedShipper !== 'all' || searchQuery.trim() !== '';

  const handleResetFilters = () => {
    setStatusFilter('all');
    setSelectedShipper('all');
    setSearchQuery('');
  };

  return (
    <div className="fixed inset-y-0 left-0 sm:left-4 sm:top-20 sm:bottom-4 z-[550] w-full sm:w-[420px] bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-100 transition-all animate-fade-in">
      {/* Header */}
      <div className="px-5 py-3.5 bg-slate-800/90 border-b border-slate-700/80 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/30">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-sm text-slate-100">Danh Sách Vận Chuyển</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">
                {route.stops.length} điểm giao
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Lộ trình: <span className="text-amber-400 font-mono font-medium">{route.code}</span> &bull; {route.totalDistanceKm} km
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-700/80 transition-colors"
          title="Đóng bảng danh sách"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Metrics Banner */}
      <div className="px-4 py-3 bg-slate-950/50 border-b border-slate-800 shrink-0 space-y-2">
        {/* Progress Bar */}
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-slate-400">Tiến độ giao hàng</span>
            <span className="font-bold text-emerald-400">
              {completedCount}/{route.stops.length} đơn ({progressPercent}%)
            </span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-sky-400 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* COD Summary Stats */}
        <div className="grid grid-cols-2 gap-2 text-xs pt-1">
          <div className="bg-slate-800/60 p-2 rounded-xl border border-slate-700/50">
            <span className="text-[10px] text-slate-400 block">Tổng COD dự kiến:</span>
            <span className="font-bold text-emerald-400 text-[11px] font-mono">
              {totalCodExpected.toLocaleString('vi-VN')} đ
            </span>
          </div>
          <div className="bg-slate-800/60 p-2 rounded-xl border border-slate-700/50">
            <span className="text-[10px] text-slate-400 block">Đã thu thực tế:</span>
            <span className="font-bold text-sky-400 text-[11px] font-mono">
              {route.totalCodCollected.toLocaleString('vi-VN')} đ
            </span>
          </div>
        </div>

        {/* Action Buttons: Import Odoo & Optimize & Push Notification */}
        <div className="grid grid-cols-3 gap-1.5 pt-1">
          <button
            onClick={onOpenOdooModal}
            className="py-1.5 px-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[11px] font-semibold border border-amber-500/40 flex items-center justify-center gap-1 transition-all shadow-sm"
            title="Nạp đơn hàng từ Odoo 14 model shipping.order"
          >
            <RotateCw className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">Nạp Odoo 14</span>
          </button>

        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="p-3 bg-slate-900 border-b border-slate-800 shrink-0 space-y-2.5">
        {/* 1. Search Input Bar */}
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo khách hàng, SĐT, mã SO, MVD, địa chỉ, shipper..."
            className="w-full pl-9 pr-16 py-1.5 bg-slate-800/80 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 transition-colors"
          />
          <div className="absolute right-2.5 flex items-center gap-1.5">
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-slate-400 hover:text-white text-xs px-1 hover:bg-slate-700 rounded transition cursor-pointer"
                title="Xóa tìm kiếm"
              >
                ✕
              </button>
            )}
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-700/60 text-slate-300">
              {filteredStops.length}/{route.stops.length}
            </span>
          </div>
        </div>

        {/* 2. Status Filter Pills */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1 font-semibold text-slate-300">
              <Filter className="w-3 h-3 text-sky-400" />
              <span>Lọc theo trạng thái:</span>
            </span>
            {statusFilter !== 'all' && (
              <button
                onClick={() => setStatusFilter('all')}
                className="text-[10px] text-sky-400 hover:underline cursor-pointer"
              >
                Tất cả ({route.stops.length})
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] pb-0.5 scrollbar-none">
            {/* Tất cả */}
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-slate-700 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
              }`}
            >
              Tất cả ({route.stops.length})
            </button>

            {/* Chờ giao (pending) */}
            <button
              onClick={() => setStatusFilter('pending')}
              className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                statusFilter === 'pending'
                  ? 'bg-sky-500/20 text-sky-400 border border-sky-500/50 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
              }`}
              title="Đơn hàng đang chờ giao"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
              Chờ giao ({pendingCount})
            </button>

            {/* Đã đến (arrived) */}
            <button
              onClick={() => setStatusFilter('arrived')}
              className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                statusFilter === 'arrived'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
              }`}
              title="Tài xế đã đến điểm giao"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              Đã đến ({arrivedCount})
            </button>

            {/* Đã giao (completed) */}
            <button
              onClick={() => setStatusFilter('completed')}
              className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                statusFilter === 'completed'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
              }`}
              title="Đơn hàng đã giao thành công"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              Đã giao ({completedCount})
            </button>

            {/* Thất bại (failed) */}
            <button
              onClick={() => setStatusFilter('failed')}
              className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                statusFilter === 'failed'
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
              }`}
              title="Đơn hàng giao thất bại"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
              Thất bại ({failedCount})
            </button>

            {/* Đơn của tôi (my) */}
            {currentUser?.role === 'driver' && (
              <button
                onClick={() => setStatusFilter('my')}
                className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                  statusFilter === 'my'
                    ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-400 font-bold'
                    : 'text-emerald-400/80 hover:text-emerald-300 bg-emerald-950/20 border border-emerald-500/20'
                }`}
                title="Chỉ lọc đơn hàng được gán cho bạn"
              >
                <span>🎯 Đơn của tôi ({myOrdersCount})</span>
              </button>
            )}
          </div>
        </div>

        {/* 3. Shipper / Delivery Staff Filter Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1 font-semibold text-slate-300">
              <User className="w-3 h-3 text-sky-400" />
              <span>Lọc theo nhân viên giao hàng:</span>
            </span>
            {selectedShipper !== 'all' && (
              <button
                onClick={() => setSelectedShipper('all')}
                className="text-[10px] text-sky-400 hover:underline cursor-pointer"
              >
                Tất cả nhân viên
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] pb-0.5 scrollbar-none">
            {/* All Shippers */}
            <button
              onClick={() => setSelectedShipper('all')}
              className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors cursor-pointer ${
                selectedShipper === 'all'
                  ? 'bg-slate-700 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
              }`}
            >
              Tất cả ({route.stops.length})
            </button>

            {/* Shipper Pills */}
            {shipperList.map((item) => {
              const isSelected = selectedShipper.toLowerCase() === item.name.toLowerCase();
              return (
                <button
                  key={item.name}
                  onClick={() => setSelectedShipper(isSelected ? 'all' : item.name)}
                  className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                    isSelected
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-400 font-semibold shadow-sm'
                      : 'text-slate-300 hover:text-white bg-slate-800/60 border border-slate-700/60'
                  }`}
                  title={`Lọc đơn gán cho nhân viên: ${item.name}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                  <span>{item.name}</span>
                  <span className="text-[10px] font-mono px-1 rounded bg-black/30 font-bold">
                    {item.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 4. Active Filter Summary Bar with Reset Button */}
        {isFiltered && (
          <div className="flex items-center justify-between text-[10px] bg-slate-950/70 px-2.5 py-1.5 rounded-xl border border-slate-800 text-slate-300 animate-fade-in">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-400">Đang lọc:</span>
              {statusFilter !== 'all' && (
                <span className="px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 font-medium">
                  {statusFilter === 'pending'
                    ? 'Chờ giao'
                    : statusFilter === 'arrived'
                    ? 'Đã đến'
                    : statusFilter === 'completed'
                    ? 'Đã giao'
                    : statusFilter === 'failed'
                    ? 'Thất bại'
                    : 'Đơn của tôi'}
                </span>
              )}
              {selectedShipper !== 'all' && (
                <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium">
                  Shipper: {selectedShipper}
                </span>
              )}
              {searchQuery.trim() !== '' && (
                <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-200 border border-slate-700 font-mono">
                  &quot;{searchQuery}&quot;
                </span>
              )}
              <span className="text-slate-400 font-semibold">
                ({filteredStops.length} đơn)
              </span>
            </div>
            <button
              onClick={handleResetFilters}
              className="text-amber-400 hover:text-amber-300 font-semibold ml-2 flex items-center gap-1 whitespace-nowrap cursor-pointer hover:underline"
              title="Xóa tất cả bộ lọc hiện tại"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Xóa lọc</span>
            </button>
          </div>
        )}
      </div>

      {/* Stops List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 divide-y divide-slate-800/40">
        {filteredStops.length === 0 ? (
          <div className="text-center py-12 px-4 text-slate-400 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
              <Search className="w-6 h-6 text-slate-500" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">Không tìm thấy đơn hàng nào phù hợp</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {isFiltered
                  ? 'Hãy thử điều chỉnh từ khóa tìm kiếm hoặc bỏ bớt các tiêu chí lọc.'
                  : 'Hiện chưa có điểm giao nào trong tuyến vận chuyển.'}
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-1">
              {isFiltered && (
                <button
                  onClick={handleResetFilters}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-400 font-semibold rounded-xl text-xs transition border border-slate-700 cursor-pointer"
                >
                  Xóa tất cả bộ lọc ({route.stops.length} đơn)
                </button>
              )}
              <button
                onClick={onOpenOdooModal}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-colors shadow cursor-pointer"
              >
                Nạp đơn mới từ Odoo
              </button>
            </div>
          </div>
        ) : (
          filteredStops.map((stop) => {
            const isSelected = selectedStopId === stop.id;

            let badgeBg = 'bg-sky-500';
            let badgeText = 'Chưa giao';
            if (stop.status === 'completed') {
              badgeBg = 'bg-emerald-500';
              badgeText = 'Đã giao thành công';
            } else if (stop.status === 'arrived') {
              badgeBg = 'bg-amber-500';
              badgeText = 'Đã đến điểm';
            } else if (stop.status === 'failed') {
              badgeBg = 'bg-rose-500';
              badgeText = 'Giao thất bại';
            }

            return (
              <div
                key={stop.id}
                onClick={() => onSelectStop(stop.id)}
                className={`pt-2.5 rounded-2xl p-3 border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-sky-950/30 border-sky-500/80 shadow-lg shadow-sky-950/50 ring-1 ring-sky-500/30'
                    : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/70'
                }`}
              >
                {/* Header Row */}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center font-extrabold text-xs text-white shrink-0 ${badgeBg}`}
                    >
                      {stop.sequenceOrder}
                    </span>
                    <div>
                      <h4 className="font-bold text-xs text-slate-100 flex items-center gap-1.5">
                        {stop.order.customerName}
                        {stop.order.hasInstallation && (
                          <span
                            title="Có hỗ trợ lắp đặt thiết bị"
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30"
                          >
                            <Wrench className="w-2.5 h-2.5" /> Lắp đặt
                          </span>
                        )}
                      </h4>
                      <p className="text-[10px] text-slate-400 font-mono">
                        <span className="text-amber-400">{stop.order.odooName}</span>
                        {stop.order.trackingCode && <span> &bull; MVD: {stop.order.trackingCode}</span>}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                      stop.status === 'completed'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : stop.status === 'arrived'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : stop.status === 'failed'
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                    }`}
                  >
                    {badgeText}
                  </span>
                </div>

                {/* Delivery Address */}
                <p className="text-[11px] text-slate-300 line-clamp-2 mb-2 leading-relaxed flex items-start gap-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span>{stop.order.deliveryAddress}</span>
                </p>

                {/* COD & Phone info */}
                <div className="grid grid-cols-2 gap-2 bg-slate-900/60 p-2 rounded-xl text-[11px] mb-2.5">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Tiền COD:</span>
                    <span className="font-bold text-emerald-400 font-mono">
                      {stop.order.codAmount > 0
                        ? `${stop.order.codAmount.toLocaleString('vi-VN')} đ`
                        : '0 đ (Đã TT)'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Số điện thoại:</span>
                    <a
                      href={`tel:${stop.order.customerPhone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-sky-400 hover:underline flex items-center gap-1"
                    >
                      <Phone className="w-3 h-3" />
                      {stop.order.customerPhone}
                    </a>
                  </div>
                </div>

                {/* Assigned Shipper Tag & Match Status */}
                {(() => {
                  const authCheck = AuthService.canConfirmOrder(stop.order, activeDriverName);
                  return (
                    <>
                      <div className="flex items-center justify-between text-[10px] bg-slate-900/50 px-2 py-1 rounded-lg border border-slate-800 mb-2">
                        <span className="text-slate-400 truncate max-w-[210px]">
                          Người giao: <strong className="text-slate-200">{stop.order.deliveryShipper || activeDriverName || 'Chưa gán'}</strong>
                        </span>
                        {currentUser?.role === 'driver' && (
                          <span className={`shrink-0 font-medium ${authCheck.allowed ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {authCheck.allowed ? '✅ Đơn của bạn' : '🔒 Đơn người khác'}
                          </span>
                        )}
                        {currentUser?.role === 'admin' && (
                          <span className="text-rose-400 text-[9px] shrink-0">Admin toàn quyền</span>
                        )}
                        {currentUser?.role === 'dispatcher' && (
                          <span className="text-sky-400 text-[9px] shrink-0">Điều phối</span>
                        )}
                        {currentUser?.role === 'sale' && (
                          <span className="text-sky-300 text-[9px] shrink-0">Chỉ xem</span>
                        )}
                      </div>

                      {/* Note if any */}
                      {stop.order.notes && (
                        <p className="text-[10px] text-amber-300/90 italic bg-amber-500/5 px-2 py-1 rounded-lg border border-amber-500/20 mb-2">
                          Ghi chú: {stop.order.notes}
                        </p>
                      )}

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => onSelectStop(stop.id)}
                          className="flex-1 py-1 px-2 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-lg text-[11px] font-semibold border border-slate-700 flex items-center justify-center gap-1 transition-colors"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Xem bản đồ</span>
                        </button>

                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${stop.order.lat},${stop.order.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-1 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px] font-medium border border-slate-700 flex items-center gap-1 transition-colors"
                        >
                          <Navigation className="w-3 h-3 text-sky-400" />
                          <span>Google Maps</span>
                        </a>

                        {authCheck.allowed ? (
                          <button
                            onClick={() => onOpenPODModal(stop)}
                            className={`py-1 px-2.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors ${
                              stop.status === 'completed'
                                ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
                            }`}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            <span>{stop.status === 'completed' ? 'Biên nhận' : 'Giao hàng'}</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => alert(`🔒 Giới hạn quyền xác nhận đơn:\n${authCheck.reason}`)}
                            title={authCheck.reason}
                            className="py-1 px-2.5 rounded-lg text-[11px] font-semibold bg-slate-800/90 hover:bg-slate-800 text-amber-300 border border-amber-500/30 flex items-center gap-1 cursor-not-allowed shadow-sm"
                          >
                            <Lock className="w-3 h-3 text-amber-400" />
                            <span>Khoá quyền</span>
                          </button>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
