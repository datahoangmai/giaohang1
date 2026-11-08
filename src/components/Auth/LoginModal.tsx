import React, { useState } from 'react';
import { AppUser } from '../../types/auth';
import { AuthService } from '../../services/auth/AuthService';
import {
  Lock,
  User,
  Shield,
  KeyRound,
  LogIn,
  CheckCircle2,
  AlertCircle,
  Truck,
  Users,
  Eye,
  EyeOff,
  MapPin,
  Compass,
} from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onLoginSuccess: (user: AppUser) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const isLive = AuthService.isLive();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Vui lòng nhập tên đăng nhập, mã nhân viên, số điện thoại hoặc email.');
      return;
    }
    if (!isLive) {
      setError('Ứng dụng chưa được cấu hình kết nối máy chủ (VITE_WORKER_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). Liên hệ quản trị.');
      return;
    }
    if (!password) {
      setError('Vui lòng nhập mật khẩu.');
      return;
    }

    setLoading(true);
    setError(null);
    const result = await AuthService.login(username, password);
    setLoading(false);
    if (result.success && result.user) {
      setPassword('');
      onLoginSuccess(result.user);
    } else {
      setError(result.message || 'Đăng nhập không thành công.');
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header - Google Maps themed */}
        <div className="p-6 bg-gradient-to-r from-blue-700 via-indigo-700 to-emerald-600 text-white relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center shadow-inner border border-white/20">
              <Compass className="w-7 h-7 text-white animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-xl tracking-tight text-white">Hachihi Delivery</span>
                <span className="px-2 py-0.5 text-[11px] font-semibold bg-white/20 backdrop-blur-sm rounded-full border border-white/25">
                  Google Maps Style
                </span>
              </div>
              <p className="text-xs text-blue-100">
                Nền tảng điều phối giao hàng đa điểm & PWA tài xế
              </p>
            </div>
          </div>
          <p className="text-xs text-blue-100/90 mt-2 bg-black/20 p-2.5 rounded-lg border border-white/10 leading-relaxed">
            Hệ thống yêu cầu xác thực tài khoản để phân quyền chức năng và gán đơn hàng cho từng tài xế.
          </p>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-160px)]">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                <span>Tên đăng nhập / Mã NV / Điện thoại</span>
                <span className="text-[11px] text-slate-400 font-normal">Không phân biệt hoa thường</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Tên đăng nhập, mã nhân viên, SĐT hoặc email"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-800/90 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Mật khẩu
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu"
                  autoComplete="current-password"
                  className="w-full pl-10 pr-11 py-2.5 bg-slate-800/90 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-sm rounded-xl shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>{loading ? 'Đang xác thực...' : 'Đăng Nhập Vào Hệ Thống'}</span>
            </button>
          </form>

          {/* Role Rules Explanation matching User Brief */}
          <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/70 text-[11px] text-slate-300 space-y-2">
            <div className="font-bold text-slate-200 flex items-center gap-1.5 text-xs text-blue-300">
              <Shield className="w-4 h-4 text-blue-400" />
              Quy tắc phân quyền đăng nhập hệ thống:
            </div>
            <ul className="space-y-1.5 text-slate-300 list-disc list-inside">
              <li>
                <strong className="text-rose-300">Nhóm Admin (Quản trị):</strong> Được <span className="text-rose-400 font-bold">FULL QUYỀN</span> — Quản lý tài khoản & phân quyền, cấu hình thông số kết nối Odoo 14 ERP, Cloudflare/Supabase, điều phối và xác nhận mọi đơn hàng.
              </li>
              <li>
                <strong className="text-amber-300">Nhóm Điều Phối (Dispatcher):</strong> Điều phối xe, nạp đơn hàng từ Odoo, tối ưu 2-Opt lộ trình, nhưng <span className="text-amber-400 font-bold">KHÔNG ĐƯỢC cài đặt cấu hình thông số và kết nối hệ thống</span>.
              </li>
              <li>
                <strong className="text-emerald-300">Nhóm Giao Nhận (Driver):</strong> Chỉ xem và <span className="text-emerald-400 font-bold">xác nhận đơn thuộc tuyến của mình</span> (máy chủ kiểm tra, không chỉ ẩn nút trên giao diện).
              </li>
              <li>
                <strong className="text-sky-300">Nhóm Sale:</strong> <span className="text-sky-400 font-bold">Chỉ xem</span> đơn do mình bán và tiến độ/vị trí tuyến giao đơn đó; không sửa, không xác nhận.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
