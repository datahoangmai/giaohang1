import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { AuthService } from '../../services/auth/AuthService';

/** Bắt buộc đổi mật khẩu ở lần đăng nhập đầu hoặc sau khi admin đặt lại mật khẩu */
export const ChangePasswordModal: React.FC<{ onDone: () => void; onLogout: () => void }> = ({ onDone, onLogout }) => {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setErr('Mật khẩu mới tối thiểu 8 ký tự.');
    if (pw !== pw2) return setErr('Hai mật khẩu không khớp.');
    setBusy(true);
    const r = await AuthService.changePassword(pw);
    setBusy(false);
    if (r.success) onDone();
    else setErr(r.message || 'Không đổi được mật khẩu.');
  };

  return (
    <div className="fixed inset-0 z-[9990] bg-slate-950/90 backdrop-blur flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3 text-slate-200">
        <div className="flex items-center gap-2 font-bold"><Lock className="w-4 h-4 text-amber-400" /> Đổi mật khẩu để tiếp tục</div>
        <p className="text-xs text-slate-400">Bạn đang dùng mật khẩu tạm do quản trị viên cấp. Hãy đặt mật khẩu riêng.</p>
        {err && <div className="text-xs p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300">{err}</div>}
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mật khẩu mới (≥ 8 ký tự)" className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm" />
        <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Nhập lại mật khẩu mới" className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm" />
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-semibold cursor-pointer">{busy ? 'Đang lưu...' : 'Đổi mật khẩu'}</button>
          <button type="button" onClick={onLogout} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm cursor-pointer">Đăng xuất</button>
        </div>
      </form>
    </div>
  );
};
