import React, { useState, useEffect } from 'react';
import {
  OdooShippingOrder,
  OdooShippingState,
} from '../../types/odoo';
import { OdooShippingService, OdooHealth } from '../../services/odoo/OdooShippingService';
import { DeliveryOrder } from '../../types/delivery';
import {
  RotateCw,
  Server,
  Database,
  Key,
  User,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Package,
  Wrench,
  Truck,
  Phone,
  MapPin,
  Calendar,
  Layers,
  FileSpreadsheet,
  Check,
  Code2,
  ShieldAlert,
} from 'lucide-react';
import { AppUser, ROLE_LABEL } from '../../types/auth';
import { AuthService } from '../../services/auth/AuthService';

interface OdooIntegrationModalProps {
  onClose: () => void;
  onDispatchOrdersToRoute: (orders: DeliveryOrder[]) => void;
  currentUser?: AppUser | null;
}

export const OdooIntegrationModal: React.FC<OdooIntegrationModalProps> = ({
  onClose,
  onDispatchOrdersToRoute,
  currentUser,
}) => {
  const [activeTab, setActiveTab] = useState<'orders' | 'connection'>('orders');
  const [shippingOrders, setShippingOrders] = useState<OdooShippingOrder[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [health, setHealth] = useState<OdooHealth | null>(null);
  const [filterState, setFilterState] = useState<string>('all');
  const [filterInstallation, setFilterInstallation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Initial load
  useEffect(() => {
    loadOrders();
  }, []);

  const [loadMessage, setLoadMessage] = useState<string | null>(null);

  const loadOrders = async (withSync = false) => {
    setIsLoading(true);
    try {
      const res = await OdooShippingService.fetchShippingOrders(undefined, undefined, { sync: withSync });
      setLoadMessage(res.message || null);
      setShippingOrders(res.orders);
      // Default select all ready / in_delivery
      const readyIds = res.orders
        .filter((o) => o.state === 'ready' || o.state === 'in_delivery')
        .map((o) => o.id);
      setSelectedIds(readyIds);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setHealth(null);
    try {
      setHealth(await OdooShippingService.testConnection());
    } catch (e) {
      setHealth({ ok: false, url: '', db: '', missingFields: [], steps: [{ step: 'Gọi Worker', ok: false, detail: (e as Error).message }] });
    } finally {
      setIsTesting(false);
    }
  };

  const handleToggleSelectOrder = (id: number) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.length === filteredOrders.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredOrders.map((o) => o.id));
    }
  };

  const handleDispatchSelected = () => {
    const selectedOrders = shippingOrders.filter((o) => selectedIds.includes(o.id));
    const deliveryOrders = selectedOrders.map((item) =>
      OdooShippingService.mapOdooShippingToDeliveryOrder(item)
    );
    onDispatchOrdersToRoute(deliveryOrders);
    onClose();
  };

  // Filtering
  const filteredOrders = shippingOrders.filter((o) => {
    const matchesState = filterState === 'all' || o.state === filterState;
    const matchesInstall =
      filterInstallation === 'all' ||
      (filterInstallation === 'yes' && o.x_hotrolapdat) ||
      (filterInstallation === 'no' && !o.x_hotrolapdat);
    const q = searchQuery.toLowerCase();
    const partnerName = Array.isArray(o.partner_shipping_id) ? o.partner_shipping_id[1] : '';
    const saleName = Array.isArray(o.sale_id) ? o.sale_id[1] : '';
    const trackingCode = o.x_mvd || '';

    const matchesSearch =
      !q ||
      o.name.toLowerCase().includes(q) ||
      partnerName.toLowerCase().includes(q) ||
      saleName.toLowerCase().includes(q) ||
      trackingCode.toLowerCase().includes(q) ||
      (o.to_address && o.to_address.toLowerCase().includes(q));

    return matchesState && matchesInstall && matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-[650] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-5xl h-[92vh] shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Top Header */}
        <div className="px-6 py-4 bg-slate-800/90 border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/30">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100">
                  Odoo 14 ERP &bull; Model <code className="text-amber-400 font-mono">shipping.order</code>
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Đã kết nối
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Đồng bộ phiếu giao hàng, khách hàng, địa chỉ, COD và trường tùy biến từ file CSV
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-700 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 px-6 gap-2 bg-slate-950/40 text-xs overflow-x-auto">
          <button
            onClick={() => setActiveTab('orders')}
            className={`py-3 px-3 font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'orders'
                ? 'border-amber-400 text-amber-400 bg-amber-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Package className="w-4 h-4" />
            Danh Sách Đơn Giao ({shippingOrders.length})
          </button>

          <button
            onClick={() => setActiveTab('connection')}
            className={`py-3 px-3 font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'connection'
                ? 'border-amber-400 text-amber-400 bg-amber-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>Kiểm Tra Kết Nối Odoo</span>
          </button>

        </div>

        {/* Modal Main Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-900/50">
          {/* TAB 1: ORDERS LIST */}
          {activeTab === 'orders' && (
            <div className="space-y-4">
              {loadMessage && (
                <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-[11px] text-slate-300">{loadMessage}</div>
              )}
              {/* Guidance & Quick Dispatch Banner */}
              <div className="bg-gradient-to-r from-amber-500/20 via-slate-800 to-sky-500/20 p-4 rounded-2xl border border-amber-500/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-black text-lg border border-amber-500/40 shrink-0 shadow">
                    📦
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-amber-300 flex items-center gap-2">
                      Cách Nạp Đơn Odoo Vào Danh Sách Vận Chuyển:
                    </h3>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Chọn các đơn bên dưới hoặc bấm nút <strong className="text-amber-400 font-semibold">"Nạp Vào Bản Đồ"</strong> để đưa các phiếu giao hàng từ Odoo thành điểm dừng trên bản đồ.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0 w-full md:w-auto">
                  <button
                    onClick={() => {
                      const readyOrders = shippingOrders.filter((o) => o.state === 'ready' || o.state === 'in_delivery');
                      const toDispatch = (readyOrders.length > 0 ? readyOrders : shippingOrders).map((item) =>
                        OdooShippingService.mapOdooShippingToDeliveryOrder(item)
                      );
                      onDispatchOrdersToRoute(toDispatch);
                      onClose();
                    }}
                    className="flex-1 md:flex-none px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/30 transition-all hover:scale-102"
                  >
                    <Check className="w-4 h-4" />
                    <span>Nạp Nhanh Tất Cả Đơn Sẵn Sàng ({shippingOrders.filter(o => o.state === 'ready' || o.state === 'in_delivery').length})</span>
                  </button>
                </div>
              </div>

              {/* Filter bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-800/40 p-3 rounded-2xl border border-slate-700/60">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Tìm theo mã đơn, khách, SO, MVD..."
                    className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-200 w-56 focus:outline-none focus:border-amber-500"
                  />

                  {/* Filter by state */}
                  <select
                    value={filterState}
                    onChange={(e) => setFilterState(e.target.value)}
                    className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="all">Tất cả trạng thái</option>
                    <option value="ready">Sẵn sàng (ready)</option>
                    <option value="in_delivery">Đang giao (in_delivery)</option>
                    <option value="draft">Bản nháp (draft)</option>
                    <option value="done">Đã hoàn thành (done)</option>
                  </select>

                  {/* Filter by installation */}
                  <select
                    value={filterInstallation}
                    onChange={(e) => setFilterInstallation(e.target.value)}
                    className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="all">Tất cả lắp đặt</option>
                    <option value="yes">Có hỗ trợ lắp đặt (x_hotrolapdat)</option>
                    <option value="no">Không lắp đặt</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => loadOrders(true)}
                    disabled={isLoading}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-xl text-xs font-semibold border border-amber-500/30 flex items-center gap-1.5 transition-colors"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    Đồng bộ từ Odoo
                  </button>
                  <button
                    onClick={handleSelectAll}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium border border-slate-700"
                  >
                    {selectedIds.length === filteredOrders.length ? 'Bỏ chọn hết' : 'Chọn tất cả'}
                  </button>
                </div>
              </div>

              {/* Orders Table */}
              <div className="border border-slate-700/80 rounded-2xl overflow-hidden bg-slate-900/80 shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-800/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700">
                      <tr>
                        <th className="p-3 w-10 text-center">
                          <input
                            type="checkbox"
                            checked={filteredOrders.length > 0 && selectedIds.length === filteredOrders.length}
                            onChange={handleSelectAll}
                            className="rounded accent-amber-500 cursor-pointer"
                          />
                        </th>
                        <th className="p-3">Mã Đơn & MVD</th>
                        <th className="p-3">Khách Hàng (To Partner)</th>
                        <th className="p-3">Địa Chỉ Giao (to_address)</th>
                        <th className="p-3 text-right">Tổng Tiền (COD)</th>
                        <th className="p-3 text-center">Lắp Đặt</th>
                        <th className="p-3 text-center">ĐV Vận Chuyển</th>
                        <th className="p-3">Nhân Viên Phụ Trách</th>
                        <th className="p-3 text-center">Trạng Thái</th>
                        <th className="p-3 text-center">Thao Tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {filteredOrders.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="p-8 text-center text-slate-400">
                            Không tìm thấy đơn hàng nào phù hợp với bộ lọc.
                          </td>
                        </tr>
                      ) : (
                        filteredOrders.map((order) => {
                          const isSelected = selectedIds.includes(order.id);
                          const partnerName = Array.isArray(order.partner_shipping_id)
                            ? order.partner_shipping_id[1]
                            : 'Không tên';
                          const saleName = Array.isArray(order.sale_id) ? order.sale_id[1] : '';
                          const salesStaff = Array.isArray(order.x_nvkdso) ? order.x_nvkdso[1] : '';

                          return (
                            <tr
                              key={order.id}
                              onClick={() => handleToggleSelectOrder(order.id)}
                              className={`cursor-pointer transition-colors ${
                                isSelected ? 'bg-amber-500/10 hover:bg-amber-500/15' : 'hover:bg-slate-800/50'
                              }`}
                            >
                              <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleToggleSelectOrder(order.id)}
                                  className="rounded accent-amber-500 cursor-pointer"
                                />
                              </td>

                              <td className="p-3">
                                <div className="font-bold text-slate-100 flex items-center gap-1.5">
                                  <span>{order.name}</span>
                                </div>
                                <div className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                                  <span className="text-sky-400">{saleName}</span> &bull; 
                                  <span className="text-amber-400">{order.x_mvd}</span>
                                </div>
                              </td>

                              <td className="p-3">
                                <p className="font-semibold text-slate-200">{partnerName}</p>
                                <p className="text-[11px] text-sky-400 flex items-center gap-1">
                                  <Phone className="w-3 h-3" />
                                  {order.phone || 'Chưa có SĐT'}
                                </p>
                              </td>

                              <td className="p-3 max-w-xs">
                                <p className="text-[11px] text-slate-300 truncate" title={order.to_address}>
                                  {order.to_address}
                                </p>
                                {order.note && (
                                  <p className="text-[10px] text-amber-300/80 truncate">
                                    Ghi chú: {order.note}
                                  </p>
                                )}
                              </td>

                              <td className="p-3 text-right">
                                <span className="font-bold text-emerald-400 block font-mono">
                                  {order.total_amount > 0
                                    ? `${order.total_amount.toLocaleString('vi-VN')} đ`
                                    : '0 đ (Đã TT)'}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  Phí: {order.amount_fee ? `${order.amount_fee.toLocaleString('vi-VN')} đ` : '0 đ'}
                                </span>
                              </td>

                              <td className="p-3 text-center">
                                {order.x_hotrolapdat ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                    <Wrench className="w-3 h-3" /> Có lắp đặt
                                  </span>
                                ) : (
                                  <span className="text-slate-500 text-[10px]">Chỉ giao</span>
                                )}
                              </td>

                              <td className="p-3 text-center">
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                                  {order.x_dvvt === 'noi_bo' ? 'Tài xế Nội bộ' : order.x_dvvt?.toUpperCase()}
                                </span>
                              </td>

                              <td className="p-3 text-[11px]">
                                <span className="text-slate-300 block">{salesStaff || 'KD Odoo'}</span>
                                <span className="text-[10px] text-slate-500">
                                  Tạo: {order.create_date?.slice(0, 10)}
                                </span>
                              </td>

                              <td className="p-3 text-center">
                                <span
                                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                                    order.state === 'in_delivery'
                                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                                      : order.state === 'ready'
                                      ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                                      : order.state === 'done'
                                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                      : 'bg-slate-700/60 text-slate-300'
                                  }`}
                                >
                                  {order.state === 'in_delivery'
                                    ? 'Đang giao'
                                    : order.state === 'ready'
                                    ? 'Sẵn sàng'
                                    : order.state === 'done'
                                    ? 'Đã giao'
                                    : order.state}
                                </span>
                              </td>

                              <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => {
                                    const deliveryOrder = OdooShippingService.mapOdooShippingToDeliveryOrder(order);
                                    onDispatchOrdersToRoute([deliveryOrder]);
                                    onClose();
                                  }}
                                  className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 font-bold rounded-lg text-[10px] border border-amber-500/40 transition-all shadow-xs whitespace-nowrap"
                                  title="Đưa riêng đơn này vào lộ trình bản đồ"
                                >
                                  + Nạp đơn này
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}


          {/* TAB 2: KIỂM TRA KẾT NỐI THẬT (Worker gọi Odoo) */}
          {activeTab === 'connection' && (
            <div className="max-w-2xl space-y-4">
              <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300 space-y-2">
                <h3 className="font-bold text-slate-100 text-sm">Kết nối Odoo được đặt ở máy chủ (Cloudflare Worker)</h3>
                <p>URL, database, UID và API key nằm trong biến/secret của Worker (<code className="font-mono">ODOO_URL, ODOO_DB, ODOO_UID, ODOO_API_KEY</code>), không nhập và không lưu trong trình duyệt. Nút dưới đây để Worker gọi thử Odoo thật và báo kết quả từng bước.</p>
              </div>
              <button
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-2 cursor-pointer"
              >
                <RotateCw className={`w-4 h-4 ${isTesting ? 'animate-spin' : ''}`} />
                {isTesting ? 'Đang kiểm tra...' : 'Kiểm tra kết nối Odoo'}
              </button>
              {health && (
                <div className={`p-4 rounded-2xl border text-xs space-y-2 ${health.ok ? 'bg-emerald-950/40 border-emerald-500/40' : 'bg-rose-950/40 border-rose-500/40'}`}>
                  <p className={`font-bold ${health.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {health.ok ? 'Kết nối Odoo thật thành công' : 'Chưa kết nối được Odoo'}
                  </p>
                  {health.url && <p className="text-slate-400 font-mono">{health.url} · DB: {health.db}</p>}
                  <ul className="space-y-1">
                    {health.steps.map((st, i) => (
                      <li key={i} className="flex items-start gap-2">
                        {st.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                        <span><strong className="text-slate-100">{st.step}:</strong> <span className="text-slate-300">{st.detail}</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-800/90 border-t border-slate-700/80 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {activeTab === 'orders' ? (
              <span>
                Đã chọn: <strong className="text-amber-400">{selectedIds.length}</strong> / {filteredOrders.length} đơn hàng
              </span>
            ) : (
              <span>Model: <strong className="text-amber-400">shipping.order</strong></span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition-colors"
            >
              Đóng
            </button>

            {activeTab === 'orders' && (
              <button
                onClick={handleDispatchSelected}
                disabled={selectedIds.length === 0}
                className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-40 text-slate-950 font-extrabold rounded-xl text-xs flex items-center gap-2 transition-all shadow-xl shadow-amber-500/30 hover:scale-102"
              >
                <Check className="w-4 h-4" />
                <span>🚀 Nạp {selectedIds.length} Đơn Vào Danh Sách Vận Chuyển & Vẽ Bản Đồ</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
