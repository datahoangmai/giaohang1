import React, { useEffect, useState } from 'react';
import { AppUser, ROLE_LABEL, UserRole } from '../../types/auth';
import { AuthService } from '../../services/auth/AuthService';
import {
  Users,
  UserPlus,
  Shield,
  KeyRound,
  Trash2,
  Edit2,
  X,
  Search,
  CheckCircle2,
  AlertCircle,
  Phone,
  Truck,
  Eye,
  EyeOff,
  UserCheck,
  Building,
  Sparkles,
  Lock,
} from 'lucide-react';

interface AccountManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AppUser | null;
  onUserListChanged?: () => void;
}

export const AccountManagementModal: React.FC<AccountManagementModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUserListChanged,
}) => {
  const [users, setUsers] = useState<AppUser[]>(AuthService.getUsers());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState<'all' | UserRole>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    employeeCode: '',
    fullName: '',
    phone: '',
    username: '',
    password: '',
    role: 'driver' as UserRole,
    assignedVehicle: '',
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [tempPasswordNotice, setTempPasswordNotice] = useState<{ name: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Nạp danh sách tài khoản từ máy chủ khi mở (chỉ admin mới gọi được)
  useEffect(() => {
    if (!isOpen || currentUser?.role !== 'admin') return;
    let alive = true;
    AuthService.loadUsers()
      .then((list) => alive && setUsers(list))
      .catch((e) => alive && setFormError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [isOpen, currentUser?.role]);

  if (!isOpen) return null;

  // Non-Admin Permission Guard
  if (currentUser && currentUser.role !== 'admin') {
    return (
      <div className="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
        <div className="w-full max-w-md bg-slate-900 border border-amber-500/50 rounded-2xl p-6 shadow-2xl text-center space-y-4 animate-in zoom-in-95 duration-150">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto shadow-inner">
            <Lock className="w-7 h-7 text-amber-400 animate-pulse" />
          </div>
          <h3 className="font-bold text-base text-white">Giới Hạn Quyền Quản Lý Tài Khoản</h3>
          <div className="text-xs text-slate-300 leading-relaxed bg-slate-800/80 p-3.5 rounded-xl border border-slate-700 text-left space-y-1.5">
            <p>
              Tài khoản hiện tại: <strong className="text-white font-mono">{currentUser.fullName} ({currentUser.username})</strong>
            </p>
            <p>
              Nhóm quyền: <span className="text-amber-400 font-semibold">{ROLE_LABEL[currentUser.role]}</span>
            </p>
            <p className="text-slate-400 pt-1 border-t border-slate-700">
              ⚠️ <strong className="text-amber-300">Quy định RBAC:</strong> Nhóm điều phối và nhân viên không có quyền truy cập trang quản lý tài khoản và phân quyền hệ thống. Chỉ tài khoản nhóm <strong className="text-rose-400">Admin (Quản trị viên)</strong> mới có quyền tạo mới mã nhân viên, cấp tài khoản và điều chỉnh quyền hạn.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20 transition cursor-pointer"
          >
            Đóng Cửa Sổ
          </button>
        </div>
      </div>
    );
  }

  const refreshList = async () => {
    try {
      setUsers(await AuthService.loadUsers());
    } catch (e) {
      setFormError((e as Error).message);
    }
    if (onUserListChanged) onUserListChanged();
  };

  const handleAutoGenerateCode = (role: UserRole = formData.role) => {
    const nextCode = AuthService.generateNextEmployeeCode(role);
    setFormData((prev) => ({
      ...prev,
      employeeCode: nextCode,
    }));
  };

  const handleOpenAddForm = () => {
    const nextCode = AuthService.generateNextEmployeeCode('driver');
    setFormData({
      employeeCode: nextCode,
      fullName: '',
      phone: '',
      username: '',
      password: '',
      role: 'driver',
      assignedVehicle: '',
    });
    setFormError(null);
    setFormSuccess(null);
    setEditingUserId(null);
    setShowAddForm(true);
  };

  const handleEditClick = (u: AppUser) => {
    setFormData({
      employeeCode: u.employeeCode,
      fullName: u.fullName,
      phone: u.phone,
      username: u.username,
      password: '',
      role: u.role,
      assignedVehicle: u.assignedVehicle || '',
    });
    setFormError(null);
    setFormSuccess(null);
    setEditingUserId(u.id);
    setShowAddForm(true);
  };

  const handleDeleteUser = async (userId: string, name: string) => {
    if (!confirm(`Khóa tài khoản "${name}"? Người này sẽ không đăng nhập được nữa (lịch sử giao hàng vẫn được giữ).`)) {
      return;
    }
    const res = await AuthService.deleteUser(userId);
    if (res.success) {
      await refreshList();
    } else {
      alert(res.message || 'Không thể khóa tài khoản.');
    }
  };

  const handleToggleActive = async (u: AppUser) => {
    try {
      await AuthService.updateUser(u.id, { isActive: !(u.isActive ?? true) });
      await refreshList();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleResetPassword = async (u: AppUser) => {
    if (!confirm(`Đặt lại mật khẩu cho "${u.fullName}"? Mật khẩu tạm sẽ hiển thị một lần.`)) return;
    const res = await AuthService.resetPassword(u.id);
    if (res.success && res.tempPassword) setTempPasswordNotice({ name: u.fullName, password: res.tempPassword });
    else alert(res.message || 'Không đặt lại được mật khẩu.');
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!formData.fullName.trim() || !formData.username.trim()) {
      setFormError('Vui lòng nhập đầy đủ Tên nhân viên và Tên đăng nhập.');
      return;
    }
    if (!editingUserId && formData.password && formData.password.length < 8) {
      setFormError('Mật khẩu tạm tối thiểu 8 ký tự (hoặc để trống để hệ thống tự tạo).');
      return;
    }

    setBusy(true);
    try {
      if (editingUserId) {
        await AuthService.updateUser(editingUserId, {
          employeeCode: formData.employeeCode.trim().toUpperCase() || undefined,
          fullName: formData.fullName.trim(),
          phone: formData.phone.trim(),
          username: formData.username.trim().toLowerCase(),
          role: formData.role,
        });
        setFormSuccess('Cập nhật tài khoản thành công!');
        await refreshList();
        setTimeout(() => {
          setShowAddForm(false);
          setEditingUserId(null);
        }, 800);
      } else {
        const res = await AuthService.createUser({
          employeeCode: formData.employeeCode.trim().toUpperCase(),
          fullName: formData.fullName.trim(),
          phone: formData.phone.trim(),
          username: formData.username.trim().toLowerCase(),
          password: formData.password.trim() || undefined,
          role: formData.role,
          assignedVehicle: formData.assignedVehicle.trim() || undefined,
        });
        if (res.success) {
          setFormSuccess('Đã tạo tài khoản thành công!');
          if (res.tempPassword) setTempPasswordNotice({ name: formData.fullName.trim(), password: res.tempPassword });
          await refreshList();
          setTimeout(() => setShowAddForm(false), 800);
        } else {
          setFormError(res.message || 'Lỗi khi tạo tài khoản.');
        }
      }
    } catch (err) {
      setFormError((err as Error).message || 'Không thực hiện được thao tác.');
    } finally {
      setBusy(false);
    }
  };

  // Filter users
  const filteredUsers = users.filter((u) => {
    const matchRole = filterRole === 'all' || u.role === filterRole;
    const matchSearch =
      u.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.employeeCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.phone.includes(searchQuery);
    return matchRole && matchSearch;
  });

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return { label: 'Admin (Toàn quyền)', bg: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
      case 'dispatcher':
        return { label: 'Điều Phối Viên', bg: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
      case 'driver':
        return { label: 'Giao Nhận', bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
      case 'sale':
        return { label: 'Sale (Chỉ xem)', bg: 'bg-sky-500/20 text-sky-300 border-sky-500/40' };
    }
  };

  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md">
      <div className="w-full max-w-5xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-850 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white">Quản Lý Tài Khoản Nhân Viên</h2>
                <span className="px-2 py-0.5 text-[11px] font-semibold bg-blue-500/20 text-blue-300 rounded-full border border-blue-500/30">
                  {users.length} tài khoản
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Tạo mã nhân viên, phân quyền Admin / Điều phối / Nhân viên giao hàng và kiểm soát quyền xác nhận đơn
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenAddForm}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-blue-600/30 transition cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>+ Thêm Nhân Viên</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick Stats Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-900/60 border-b border-slate-800 text-xs">
          <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-between">
            <div>
              <span className="text-slate-400 block text-[11px]">Tổng nhân sự</span>
              <span className="text-base font-bold text-white">{users.length}</span>
            </div>
            <Users className="w-5 h-5 text-slate-400" />
          </div>
          <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between">
            <div>
              <span className="text-rose-300 block text-[11px]">Admin (Toàn quyền)</span>
              <span className="text-base font-bold text-rose-400">
                {users.filter((u) => u.role === 'admin').length}
              </span>
            </div>
            <Shield className="w-5 h-5 text-rose-400" />
          </div>
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
            <div>
              <span className="text-amber-300 block text-[11px]">Điều phối viên</span>
              <span className="text-base font-bold text-amber-400">
                {users.filter((u) => u.role === 'dispatcher').length}
              </span>
            </div>
            <Sparkles className="w-5 h-5 text-amber-400" />
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
            <div>
              <span className="text-emerald-300 block text-[11px]">Nhân viên giao hàng</span>
              <span className="text-base font-bold text-emerald-400">
                {users.filter((u) => u.role === 'driver').length}
              </span>
            </div>
            <Truck className="w-5 h-5 text-emerald-400" />
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="p-4 bg-slate-850/50 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo mã NV, tên nhân viên, tên đăng nhập, số điện thoại..."
              className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
            {(
              [
                { id: 'all', label: 'Tất cả' },
                { id: 'admin', label: 'Admin' },
                { id: 'dispatcher', label: 'Điều phối' },
                { id: 'driver', label: 'Giao nhận' },
                { id: 'sale', label: 'Sale' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterRole(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer whitespace-nowrap ${
                  filterRole === tab.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Add / Edit Form Modal Sub-panel */}
          {showAddForm && (
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-800/90 border border-blue-500/40 shadow-xl space-y-4 animate-in slide-in-from-top-4 duration-200">
              <div className="flex items-center justify-between border-b border-slate-700 pb-3">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <UserPlus className="w-4 h-4 text-blue-400" />
                  <span>{editingUserId ? 'Cập Nhật Tài Khoản Nhân Viên' : 'Tạo Mới Tài Khoản Nhân Viên'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {formSuccess && (
                <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{formSuccess}</span>
                </div>
              )}

              <form onSubmit={handleSubmitForm} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-300">
                      Mã nhân viên <span className="text-rose-400">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => handleAutoGenerateCode(formData.role)}
                      className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold underline cursor-pointer"
                      title="Tự động sinh mã nhân viên tiếp theo theo vai trò"
                    >
                      <Sparkles className="w-3 h-3 text-blue-400" />
                      <span>⚡ Tự tạo mã nhanh</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={formData.employeeCode}
                    onChange={(e) => setFormData({ ...formData, employeeCode: e.target.value.toUpperCase() })}
                    placeholder="VD: HCH-TX04, NV001"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white uppercase font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Tên nhân viên (Họ và Tên) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    placeholder="VD: Nguyễn Văn Hải, Lê Minh Tâm"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Số điện thoại
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="VD: 0908 112 233"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Tên đăng nhập (Username) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().trim() })}
                    placeholder="VD: hainguyen, minhquan"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white lowercase font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Mật khẩu tạm {editingUserId ? '(đổi bằng nút "Đặt lại MK" ở danh sách)' : '(để trống = hệ thống tự tạo)'}
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Tối thiểu 8 ký tự — người dùng phải đổi ở lần đăng nhập đầu"
                    disabled={!!editingUserId}
                    autoComplete="new-password"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Nhóm quyền (RBAC) <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="driver">Giao nhận (Xem và xác nhận đơn của mình)</option>
                    <option value="dispatcher">Điều phối viên (Xem, xác nhận, đổi tuyến/thông tin; không sửa cấu hình Odoo)</option>
                    <option value="sale">Sale (Chỉ xem đơn của mình)</option>
                    <option value="admin">Admin (Toàn quyền hệ thống & cấu hình)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Biển số xe / Phương tiện (nếu có)
                  </label>
                  <input
                    type="text"
                    value={formData.assignedVehicle}
                    onChange={(e) => setFormData({ ...formData, assignedVehicle: e.target.value })}
                    placeholder="VD: 59-S2 889.12"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="sm:col-span-2 md:col-span-2 flex items-end gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-md transition cursor-pointer"
                  >
                    {busy ? 'Đang xử lý...' : editingUserId ? 'Lưu Thay Đổi' : 'Xác Nhận Tạo Tài Khoản'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded-xl transition cursor-pointer"
                  >
                    Huỷ
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* User Table */}
          <div className="overflow-x-auto border border-slate-800 rounded-2xl bg-slate-850">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800/80 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">
                <tr>
                  <th className="py-3 px-3.5">Mã NV</th>
                  <th className="py-3 px-3.5">Nhân viên & SĐT</th>
                  <th className="py-3 px-3.5">Tên đăng nhập</th>
                  <th className="py-3 px-3.5">Trạng thái</th>
                  <th className="py-3 px-3.5">Nhóm quyền</th>
                  <th className="py-3 px-3.5">Quy tắc xác nhận đơn</th>
                  <th className="py-3 px-3.5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500 text-xs">
                      Không tìm thấy nhân viên nào phù hợp với điều kiện tìm kiếm.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const badge = getRoleBadge(u.role);
                    const isSelf = currentUser?.id === u.id;
                    const isLocked = u.isActive === false;

                    return (
                      <tr key={u.id} className="hover:bg-slate-800/50 transition">
                        {/* Employee Code */}
                        <td className="py-3 px-3.5">
                          <span className="font-mono font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                            {u.employeeCode}
                          </span>
                        </td>

                        {/* Full Name & Phone */}
                        <td className="py-3 px-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center font-bold text-xs text-white shrink-0 overflow-hidden">
                              {u.avatarUrl ? (
                                <img src={u.avatarUrl} alt={u.fullName} className="w-full h-full object-cover" />
                              ) : (
                                u.fullName.charAt(0)
                              )}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                                <span>{u.fullName}</span>
                                {isSelf && (
                                  <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.2 rounded font-normal">
                                    Bạn
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                                <Phone className="w-3 h-3 text-slate-500" />
                                <span>{u.phone || 'Chưa có SĐT'}</span>
                                {u.assignedVehicle && (
                                  <span className="text-slate-500 ml-1">
                                    • Xe: <span className="text-slate-300 font-mono">{u.assignedVehicle}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Username */}
                        <td className="py-3 px-3.5 font-mono text-slate-300">
                          {u.username}
                        </td>

                        {/* Trạng thái */}
                        <td className="py-3 px-3.5">
                          <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-medium ${isLocked ? 'bg-slate-700/40 text-slate-400 border-slate-600' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'}`}>
                            {isLocked ? 'Đã khóa' : 'Đang hoạt động'}
                          </span>
                        </td>

                        {/* Role */}
                        <td className="py-3 px-3.5">
                          <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-medium ${badge.bg}`}>
                            {badge.label}
                          </span>
                        </td>

                        {/* Order Confirmation Rule */}
                        <td className="py-3 px-3.5 max-w-[220px]">
                          {u.role === 'admin' ? (
                            <span className="text-[11px] text-rose-300 flex items-center gap-1">
                              <Shield className="w-3 h-3 text-rose-400 shrink-0" />
                              Toàn quyền xác nhận mọi đơn
                            </span>
                          ) : u.role === 'dispatcher' ? (
                            <span className="text-[11px] text-amber-300 flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                              Được xác nhận & điều phối
                            </span>
                          ) : u.role === 'sale' ? (
                            <span className="text-[11px] text-sky-300 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-sky-400 shrink-0" />
                              Chỉ xem đơn của mình, không xác nhận
                            </span>
                          ) : (
                            <span className="text-[11px] text-emerald-300 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                              Chỉ xác nhận đơn thuộc tuyến của mình
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => handleEditClick(u)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-300 hover:bg-slate-700/60 transition cursor-pointer"
                              title="Chỉnh sửa nhân viên"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {AuthService.isLive() && (
                              <button
                                onClick={() => handleResetPassword(u)}
                                className="px-2 py-1 rounded-lg text-amber-300 bg-amber-500/10 hover:bg-amber-500/25 border border-amber-500/30 text-[10px] font-semibold transition cursor-pointer"
                                title="Đặt lại mật khẩu (hiển thị mật khẩu tạm một lần)"
                              >
                                Đặt lại MK
                              </button>
                            )}
                            {!isSelf && (
                              <button
                                onClick={() => (isLocked ? handleToggleActive(u) : handleDeleteUser(u.id, u.fullName))}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                                title={isLocked ? 'Mở khóa tài khoản' : 'Khóa tài khoản'}
                              >
                                {isLocked ? <KeyRound className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* RBAC Note Footer */}
          <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-500/20 text-xs text-blue-200/90 leading-relaxed">
            <span className="font-semibold text-blue-300">🔐 Phân quyền do máy chủ kiểm tra:</span> mọi thao tác tạo/sửa/khóa tài khoản đều đi qua Worker và được ghi vào nhật ký (system_audit_logs). Mật khẩu không bao giờ được lưu hay hiển thị lại; chỉ mật khẩu tạm được hiện một lần khi tạo hoặc đặt lại.
          </div>
        </div>

        {tempPasswordNotice && (
          <div className="mx-4 mb-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-xs text-amber-100 flex items-center justify-between gap-3">
            <span>
              Mật khẩu tạm của <strong>{tempPasswordNotice.name}</strong>:{' '}
              <code className="font-mono text-sm bg-slate-950 px-2 py-0.5 rounded select-all">{tempPasswordNotice.password}</code>
              {' '}— chỉ hiển thị một lần, hãy gửi cho người dùng (họ sẽ phải đổi khi đăng nhập).
            </span>
            <button onClick={() => setTempPasswordNotice(null)} className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-[11px] cursor-pointer">Đã lưu</button>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-850 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition cursor-pointer"
          >
            Đóng Quản Lý
          </button>
        </div>
      </div>
    </div>
  );
};
