import React, { useState, useRef } from 'react';
import { Camera, CheckCircle2, XCircle, Navigation, Phone, MapPin, DollarSign, Clock, ShieldCheck, AlertTriangle, Lock } from 'lucide-react';
import { RouteStop, DeliveryEventType } from '../../types/delivery';
import { UserLocation } from '../Map/LeafletMap';
import { AppUser } from '../../types/auth';
import { AuthService } from '../../services/auth/AuthService';

interface DriverActiveStopModalProps {
  stop: RouteStop;
  driverName: string;
  driverCode: string;
  userLocation: UserLocation | null;
  currentUser?: AppUser | null;
  onClose: () => void;
  onCompleteStop: (stopId: string, podData: { photoUrl?: string; note?: string; recipientName?: string; lat: number; lng: number }) => void;
  onFailStop: (stopId: string, reasonCode: string, note: string, lat: number, lng: number) => void;
  onMarkArrived: (stopId: string, lat: number, lng: number) => void;
}

export const DriverActiveStopModal: React.FC<DriverActiveStopModalProps> = ({
  stop,
  driverName,
  driverCode,
  userLocation,
  currentUser,
  onClose,
  onCompleteStop,
  onFailStop,
  onMarkArrived,
}) => {
  const [activeTab, setActiveTab] = useState<'success' | 'fail'>('success');
  const [photoPreview, setPhotoPreview] = useState<string | null>(stop.podPhotoUrl || null);
  const [note, setNote] = useState<string>(stop.failureNote || '');
  const [recipientName, setRecipientName] = useState<string>(stop.recipientSignedName || stop.order.customerName);
  const [failReason, setFailReason] = useState<string>('CUSTOMER_UNREACHABLE');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fallback GPS coordinates
  const currentLat = userLocation?.lat || stop.order.lat;
  const currentLng = userLocation?.lng || stop.order.lng;

  // RBAC Permission Check
  const authCheck = AuthService.canConfirmOrder(stop.order, driverName);

  // Handle Photo selection with client-side canvas watermarking (Time, GPS, Order ID)
  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Draw original image
        ctx.drawImage(img, 0, 0);

        // Watermark background band at bottom
        const bandHeight = Math.max(60, img.height * 0.12);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(0, img.height - bandHeight, img.width, bandHeight);

        // Watermark text
        ctx.fillStyle = '#10b981';
        ctx.font = `bold ${Math.max(16, img.height * 0.028)}px sans-serif`;
        ctx.fillText(
          `HACHIHI DELIVERY POD - ${stop.order.odooName}`,
          20,
          img.height - bandHeight + bandHeight * 0.35
        );

        ctx.fillStyle = '#f8fafc';
        ctx.font = `${Math.max(13, img.height * 0.022)}px sans-serif`;
        const timeStr = new Date().toLocaleString('vi-VN');
        ctx.fillText(
          `GPS: ${currentLat.toFixed(5)}, ${currentLng.toFixed(5)} | ${timeStr} | TX: ${driverName} (${driverCode})`,
          20,
          img.height - bandHeight + bandHeight * 0.75
        );

        const watermarkedUrl = canvas.toDataURL('image/jpeg', 0.85);
        setPhotoPreview(watermarkedUrl);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmSuccess = () => {
    onCompleteStop(stop.id, {
      photoUrl: photoPreview || undefined,
      note,
      recipientName,
      lat: currentLat,
      lng: currentLng,
    });
    onClose();
  };

  const handleConfirmFail = () => {
    onFailStop(stop.id, failReason, note, currentLat, currentLng);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="bg-slate-800/90 px-5 py-3.5 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-full bg-sky-500 text-white font-extrabold text-xs flex items-center justify-center">
              #{stop.sequenceOrder}
            </span>
            <div>
              <h3 className="font-bold text-slate-100 text-sm">{stop.order.odooName}</h3>
              <p className="text-[11px] text-slate-400">Đơn Odoo picking: #{stop.order.odooPickingId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700/60 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* RBAC Warning Banner if user is not authorized to confirm this order */}
          {!authCheck.allowed && (
            <div className="p-3.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs flex items-start gap-2.5 shadow-lg">
              <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-amber-300">Giới hạn quyền xác nhận đơn hàng</div>
                <div className="mt-0.5 text-slate-300 leading-relaxed">{authCheck.reason}</div>
              </div>
            </div>
          )}

          {/* Customer & Address Card */}
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-200 font-semibold text-sm">{stop.order.customerName}</span>
              <a
                href={`tel:${stop.order.customerPhone}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium hover:bg-emerald-500/30"
              >
                <Phone className="w-3.5 h-3.5" />
                {stop.order.customerPhone}
              </a>
            </div>

            <p className="text-xs text-slate-300 flex items-start gap-1.5 leading-relaxed">
              <MapPin className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{stop.order.deliveryAddress}</span>
            </p>

            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-700/40 text-xs">
              <div>
                <span className="text-slate-400 text-[11px] block">Thu COD (total_amount):</span>
                <span className="font-bold text-emerald-400">
                  {stop.order.codAmount > 0 ? `${stop.order.codAmount.toLocaleString('vi-VN')} đ` : '0 đ (Đã thanh toán)'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block">Mã vận đơn (x_mvd):</span>
                <span className="font-mono font-bold text-amber-400">{stop.order.trackingCode || 'MVD-000'}</span>
              </div>
            </div>

            {/* Custom Shipping Order Badges */}
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-700/40 text-[11px]">
              {stop.order.hasInstallation && (
                <span className="px-2 py-0.5 rounded-full font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                  <span>🔧</span> Có hỗ trợ lắp đặt (x_hotrolapdat)
                </span>
              )}
              {stop.order.carrierService && (
                <span className="px-2 py-0.5 rounded-full font-medium bg-slate-800 text-slate-300 border border-slate-700">
                  ĐV: {stop.order.carrierService === 'noi_bo' ? 'Tài xế Nội bộ' : stop.order.carrierService}
                </span>
              )}
              {stop.order.salesEmployee && (
                <span className="px-2 py-0.5 rounded-full font-medium bg-slate-800 text-sky-400 border border-slate-700">
                  KD: {stop.order.salesEmployee}
                </span>
              )}
            </div>

            {stop.order.notes && (
              <div className="bg-amber-950/40 border border-amber-600/30 rounded-lg p-2 text-[11px] text-amber-200">
                <strong>Ghi chú đơn (note):</strong> {stop.order.notes}
              </div>
            )}

            {stop.order.internalNote && (
              <div className="bg-slate-900/60 border border-slate-700/60 rounded-lg p-2 text-[11px] text-slate-300">
                <strong className="text-sky-400">Ghi chú nội bộ (internal_note):</strong> {stop.order.internalNote}
              </div>
            )}
          </div>

          {/* Quick External Navigation Button */}
          <div className="flex gap-2">
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${stop.order.lat},${stop.order.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-xl text-xs transition-colors shadow-lg"
            >
              <Navigation className="w-4 h-4" />
              Mở Google Maps dẫn đường
            </a>

            {stop.status === 'pending' && (
              <button
                onClick={() => onMarkArrived(stop.id, currentLat, currentLng)}
                className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-xl text-xs transition-colors shadow-lg flex items-center gap-1.5"
              >
                <Clock className="w-4 h-4" />
                Đã đến điểm giao
              </button>
            )}
          </div>

          {/* Action Tabs: Success vs Failed */}
          <div className="flex border-b border-slate-700">
            <button
              onClick={() => setActiveTab('success')}
              className={`flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                activeTab === 'success'
                  ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              Xác nhận Giao Thành Công
            </button>
            <button
              onClick={() => setActiveTab('fail')}
              className={`flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                activeTab === 'fail'
                  ? 'border-rose-500 text-rose-400 bg-rose-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <XCircle className="w-4 h-4" />
              Báo Giao Thất Bại
            </button>
          </div>

          {activeTab === 'success' ? (
            <div className="space-y-3.5">
              {/* Photo Proof of Delivery (POD) */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>Ảnh chụp hàng hóa / người nhận (POD)*</span>
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Đóng dấu GPS tự động
                  </span>
                </label>

                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  ref={fileInputRef}
                  onChange={handlePhotoCapture}
                  className="hidden"
                />

                {photoPreview ? (
                  <div className="relative rounded-xl overflow-hidden border border-emerald-500/50 group">
                    <img src={photoPreview} alt="POD Proof" className="w-full h-44 object-cover" />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="absolute bottom-2 right-2 px-2.5 py-1 bg-slate-900/90 hover:bg-slate-900 text-emerald-400 text-xs rounded-lg border border-emerald-500/50 shadow-md backdrop-blur-sm"
                    >
                      Chụp lại ảnh
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-28 border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-emerald-400 bg-slate-800/40 transition-colors"
                  >
                    <Camera className="w-6 h-6 text-emerald-400" />
                    <span className="text-xs font-medium">Bấm để chụp ảnh hoặc tải biên nhận</span>
                    <span className="text-[10px] text-slate-500">Tự động gắn tọa độ GPS & thời gian UTC</span>
                  </button>
                )}
              </div>

              {/* Recipient Name */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Người ký nhận / Nhận hàng thay
                </label>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Nhập tên người nhận hoặc 'Chính chủ' / 'Bảo vệ'"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Ghi chú giao hàng (nếu có)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="VD: Đã bàn giao cho lễ tân toà nhà, khách gửi tiền mặt..."
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* GPS Stamp Confirmation Info */}
              <div className="bg-slate-800/80 rounded-xl p-2.5 text-[11px] text-slate-400 flex items-center justify-between border border-slate-700/50">
                <span>GPS chốt giao:</span>
                <span className="font-mono text-emerald-400">{currentLat.toFixed(5)}, {currentLng.toFixed(5)}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Lý do giao hàng thất bại *
                </label>
                <select
                  value={failReason}
                  onChange={(e) => setFailReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-rose-500"
                >
                  <option value="CUSTOMER_UNREACHABLE">Khách không nghe máy (đã gọi 3 lần)</option>
                  <option value="WRONG_ADDRESS">Sai địa chỉ / Không tìm được số nhà</option>
                  <option value="RESCHEDULED">Khách hẹn giao lại ngày sau</option>
                  <option value="REJECTED_PARCEL">Khách từ chối nhận hàng (sai sản phẩm / đổi ý)</option>
                  <option value="CANNOT_PAY_COD">Khách không đủ tiền thanh toán COD</option>
                  <option value="DAMAGED_GOODS">Hàng hoá bị hư hỏng trong quá trình vận chuyển</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Chi tiết lý do & biên bản
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="Mô tả cụ thể thời gian gọi điện, phản hồi của khách hàng..."
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="bg-rose-950/40 border border-rose-600/30 rounded-xl p-2.5 text-[11px] text-rose-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>
                  Điểm giao thất bại sẽ được ghi nhận và có thể chuyển sang chuyến giao sau trên hệ thống Điều phối Hachihi.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-800/90 px-5 py-3 border-t border-slate-700 flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
          >
            Đóng
          </button>

          {activeTab === 'success' ? (
            <button
              onClick={handleConfirmSuccess}
              disabled={!authCheck.allowed}
              title={!authCheck.allowed ? authCheck.reason : 'Xác nhận giao hàng thành công'}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-lg flex items-center gap-1.5 ${
                authCheck.allowed
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer shadow-emerald-500/20'
                  : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed opacity-60'
              }`}
            >
              {!authCheck.allowed ? <Lock className="w-4 h-4 text-amber-400" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>{authCheck.allowed ? 'Xác nhận Giao Thành Công' : 'Khoá Quyền (Không phải đơn của bạn)'}</span>
            </button>
          ) : (
            <button
              onClick={handleConfirmFail}
              disabled={!authCheck.allowed}
              title={!authCheck.allowed ? authCheck.reason : 'Lưu biên bản thất bại'}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-lg flex items-center gap-1.5 ${
                authCheck.allowed
                  ? 'bg-rose-600 hover:bg-rose-500 text-white cursor-pointer shadow-rose-600/20'
                  : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed opacity-60'
              }`}
            >
              {!authCheck.allowed ? <Lock className="w-4 h-4 text-amber-400" /> : <XCircle className="w-4 h-4" />}
              <span>{authCheck.allowed ? 'Lưu Biên Bản Thất Bại' : 'Khoá Quyền'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
