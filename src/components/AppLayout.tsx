import React from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Database,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { isMockMode, setApiMockMode } from '../api/client';
import { isPreviewAvailable } from '../api/preview-config';
import { useAuth } from '../context/AuthContext';

export function AppLayout() {
  const { admin, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mockEnabled, setMockEnabled] = React.useState(isMockMode());
  const isAdminRoute = location.pathname.startsWith('/admin');

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('已退出登录');
      navigate('/admin/login');
    } catch {
      navigate('/admin/login');
    }
  };

  const handleToggleMockMode = () => {
    const next = !mockEnabled;
    setApiMockMode(next);
    setMockEnabled(next);
    toast.info(next ? '已切换至演示数据' : '已切换至实时数据');
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `macos-segmented-item btn-interactive ${
      isActive
        ? 'macos-segmented-item-active'
        : ''
    }`;

  return (
    <div className="flex min-h-[100dvh] flex-col text-slate-900">
      <header className="macos-toolbar safe-top sticky top-0 z-30">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-3.5">
            <div className="macos-traffic-lights hidden sm:inline-flex" aria-hidden="true">
              <span className="macos-traffic-dot bg-[#ff5f57]" />
              <span className="macos-traffic-dot bg-[#febc2e]" />
              <span className="macos-traffic-dot bg-[#28c840]" />
            </div>

            <div className="hidden h-4 w-px bg-slate-300/70 sm:block" aria-hidden="true" />

            <Link to="/" className="btn-interactive flex items-center gap-2.5 rounded-lg px-1 py-0.5">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-[9px] text-white shadow-xs"
                style={{
                  background: 'linear-gradient(180deg, #2b95ff 0%, #007aff 100%)',
                  boxShadow:
                    'inset 0 1px 0 rgba(255,255,255,0.35), 0 1px 3px rgba(0, 122, 255, 0.3)',
                }}
              >
                <ShieldCheck className="h-4.5 w-4.5 text-white" />
              </div>
              <div>
                <span className="text-[13px] font-semibold tracking-tight text-slate-900">
                  Keybox 仓库
                </span>
                <span className="block text-[10.5px] font-medium text-slate-500">
                  证书状态查询
                </span>
              </div>
            </Link>
          </div>

          <nav className="macos-segmented" aria-label="主导航">
            <NavLink to="/" end className={navLinkClass}>
              <Database className="h-3.5 w-3.5 text-[#007aff]" />
              <span>Keybox 列表</span>
            </NavLink>
            <NavLink to="/upload" className={navLinkClass}>
              <Upload className="h-3.5 w-3.5 text-[#007aff]" />
              <span>上传</span>
            </NavLink>
            <NavLink to="/certificates" className={navLinkClass}>
              <Search className="h-3.5 w-3.5 text-[#007aff]" />
              <span>证书查询</span>
            </NavLink>
          </nav>

          <div className="flex flex-wrap items-center gap-2">
            {__KEYBOX_PREVIEW__ && isPreviewAvailable() && (
              <>
                <button
                  type="button"
                  onClick={handleToggleMockMode}
                  data-testid="preview-data-source-toggle"
                  className="btn-interactive rounded-full border border-black/10 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-2xs hover:bg-white"
                  title="切换演示与实时数据"
                >
                  数据源：{mockEnabled ? '演示数据' : '实时数据'}
                </button>
                <div className="h-4 w-px bg-slate-300/70" />
              </>
            )}

            <Link
              to="/admin/keyboxes"
              data-testid="nav-admin-entry"
              aria-current={isAdminRoute ? 'page' : undefined}
              className={`btn-interactive inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shadow-2xs ${
                isAdminRoute
                  ? 'bg-[#007aff] text-white shadow-xs'
                  : 'border border-black/10 bg-white/85 text-slate-700 hover:bg-white hover:text-slate-900'
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
              <span>后台管理</span>
            </Link>

            {admin && (
              <div className="flex items-center gap-2 rounded-full border border-emerald-300/70 bg-emerald-50/85 px-2.5 py-1 text-xs shadow-2xs">
                <span className="font-medium text-emerald-900">{admin.username}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="btn-interactive inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 shadow-2xs hover:bg-rose-50 hover:text-rose-700"
                >
                  <LogOut className="h-3 w-3" />
                  <span>退出</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="safe-bottom mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <div className="macos-window-shell p-4 sm:p-6">
          <Outlet />
        </div>
      </main>

      <footer className="border-t border-black/5 bg-white/50 py-3.5 text-xs text-slate-500 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 sm:flex-row">
          <span>
            Keybox 仓库
          </span>
          <span>
            下载权限由管理员控制
          </span>
        </div>
      </footer>
    </div>
  );
}
