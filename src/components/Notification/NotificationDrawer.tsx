import React, { useState, useEffect } from 'react';
import {
  Bell,
  BellRing,
  X,
  CheckCircle2,
  AlertCircle,
  Volume2,
  Smartphone,
  Send,
  Package,
  Trash2,
  ExternalLink,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { NotificationService, AppPushNotification } from '../../services/notification/NotificationService';
import { AppUser } from '../../types/auth';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AppUser | null;
  activeDriverName: string;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  isOpen,
  onClose,
  currentUser,
  activeDriverName,
}) => {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [notifications, setNotifications] = useState<AppPushNotification[]>([]);
  const [isRequesting, setIsRequesting] = useState(false);
  const [testSentNotice, setTestSentNotice] = useState<string | null>(null);

  useEffect(() => {
    setPermission(NotificationService.getPermissionStatus());
    setNotifications(NotificationService.getRecentNotifications());

    const unsub = NotificationService.subscribe(() => {
      setNotifications(NotificationService.getRecentNotifications());
    });

    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRequestPermission = async () => {
    setIsRequesting(true);
    const granted = await NotificationService.requestPermission();
    setPermission(NotificationService.getPermissionStatus());
    setIsRequesting(false);

    if (granted) {
      setTestSentNotice('Đã cấp quyền thông báo đẩy thành công!');
      setTimeout(() => setTestSentNotice(null), 4000);
    }
  };

  const handleTestChime = () => {
    NotificationService.playOrderChime();
    NotificationService.triggerVibration();
  };

  const handleClearAll = () => {
    NotificationService.clearAll();
    setNotifications([]);
  };

  return (
    <div className="fixed inset-0 z-[9990] flex justify-end bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-slate-900 border-l border-slate-700/80 h-full flex flex-col shadow-2xl text-slate-100 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-800/90 border-b border-slate-700/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <BellRing className="w-5 h-5 animate-bounce-subtle" />
            </div>
            <div>
              <h2 className="font-bold text-base text-white">Trung Tâm Thông Báo Đẩy</h2>
              <p className="text-[11px] text-slate-400">Service Worker &amp; Web Push API cho Tài Xế</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-700/80 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status & Permissions Banner */}
        <div className="p-4 bg-slate-950/60 border-b border-slate-800/80 space-y-3 shrink-0">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Service Worker:
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono">
              /sw.js (Active)
            </span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-sky-400" />
              Quyền Thông Báo Trình Duyệt:
            </span>
            {permission === 'granted' ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                🟢 Đã Bật (Granted)
              </span>
            ) : permission === 'denied' ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                🔴 Đã Bị Chặn (Blocked)
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                🟡 Chưa Cấp Quyền
              </span>
            )}
          </div>

          {/* Request Permission Button if not granted */}
          {permission !== 'granted' && (
            <div className="pt-1">
              <button
                onClick={handleRequestPermission}
                disabled={isRequesting}
                className="w-full py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2"
              >
                <Bell className="w-4 h-4" />
                <span>{isRequesting ? 'Đang kích hoạt...' : 'Bật Quyền Thông Báo Đẩy Cho Máy'}</span>
              </button>
              {permission === 'denied' && (
                <p className="text-[10px] text-rose-300 mt-1.5 leading-relaxed">
                  Lưu ý: Trình duyệt đang chặn thông báo. Vui lòng bấm vào biểu tượng ổ khóa 🔒 trên thanh địa chỉ URL để chọn &quot;Cho phép thông báo&quot;.
                </p>
              )}
            </div>
          )}

          {/* Quick Test Actions */}
          <div className="grid grid-cols-1 gap-2 pt-1">
            <button
              onClick={handleTestChime}
              className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold rounded-xl text-xs transition flex items-center justify-center gap-1.5"
              title="Thử chuông báo 2 tone Web Audio & rung"
            >
              <Volume2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Thử Chuông &amp; Rung</span>
            </button>
          </div>

          {testSentNotice && (
            <div className="p-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-[11px] text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{testSentNotice}</span>
            </div>
          )}
        </div>

        {/* Notification History List */}
        <div className="px-5 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <span>Lịch sử thông báo điều phối ({notifications.length})</span>
          {notifications.length > 0 && (
            <button
              onClick={handleClearAll}
              className="text-slate-400 hover:text-rose-400 flex items-center gap-1 text-[11px] transition"
            >
              <Trash2 className="w-3 h-3" />
              <span>Xóa tất cả</span>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {notifications.length === 0 ? (
            <div className="text-center py-12 text-slate-500 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-800/80 flex items-center justify-center mx-auto text-slate-400">
                <Bell className="w-6 h-6" />
              </div>
              <p className="text-xs">Chưa có thông báo điều phối nào gần đây.</p>
              <p className="text-[11px] text-slate-600">
                Khi có đơn hàng mới từ Odoo 14 được điều phối về máy tài xế, Service Worker sẽ phát chuông và đẩy thông báo lên màn hình.
              </p>
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className="p-3 bg-slate-800/70 border border-slate-700/60 rounded-xl space-y-1.5 hover:border-slate-600 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-bold text-xs text-white flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    {n.title}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono shrink-0">
                    {new Date(n.timestamp).toLocaleTimeString('vi-VN')}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">{n.body}</p>

                {n.codAmount !== undefined && n.codAmount > 0 && (
                  <div className="pt-1 flex items-center justify-between text-[10px]">
                    <span className="text-slate-400">Tiền thu COD:</span>
                    <span className="font-bold text-emerald-400 font-mono">
                      {n.codAmount.toLocaleString('vi-VN')} đ
                    </span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer info */}
        <div className="p-3.5 bg-slate-950/80 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between shrink-0">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Hachihi Push Gateway V1.2
          </span>
          <span>Chuông báo + Rung 250ms</span>
        </div>
      </div>
    </div>
  );
};
