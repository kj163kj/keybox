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
    `btn-interactive inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
      isActive
        ? 'bg-slate-900 text-white shadow-2xs'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-50 text-slate-900">
      <header className="safe-top sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs">
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <span className="text-sm font-bold tracking-tight text-slate-900">
                  Keybox Attestation
                </span>
                <span className="block text-[11px] text-slate-500">
                  证书状态查询
                </span>
              </div>
            </Link>

            <nav className="flex flex-wrap items-center gap-1" aria-label="主导航">
              <NavLink to="/" end className={navLinkClass}>
                <Database className="h-3.5 w-3.5" />
                <span>Keybox 列表</span>
              </NavLink>
              <NavLink to="/upload" className={navLinkClass}>
                <Upload className="h-3.5 w-3.5" />
                <span>上传</span>
              </NavLink>
              <NavLink to="/certificates" className={navLinkClass}>
                <Search className="h-3.5 w-3.5" />
                <span>证书查询</span>
              </NavLink>
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {__KEYBOX_PREVIEW__ && isPreviewAvailable() && (
              <>
                <button
                  type="button"
                  onClick={handleToggleMockMode}
                  data-testid="preview-data-source-toggle"
                  className="btn-interactive rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                  title="切换演示与实时数据"
                >
                  数据源：{mockEnabled ? '演示数据' : '实时数据'}
                </button>
                <div className="h-4 w-px bg-slate-200" />
              </>
            )}

            <Link
              to="/admin/keyboxes"
              data-testid="nav-admin-entry"
              aria-current={isAdminRoute ? 'page' : undefined}
              className={navLinkClass({ isActive: isAdminRoute })}
            >
              <Settings className="h-3.5 w-3.5" />
              <span>后台管理</span>
            </Link>

            {admin && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-xs">
                <span className="font-medium text-emerald-900">{admin.username}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="btn-interactive inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-rose-50 hover:text-rose-700"
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
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 text-xs text-slate-500">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 sm:flex-row">
          <span>
            Keybox · 证书状态查询
          </span>
          <span>
            下载权限由管理员控制
          </span>
        </div>
      </footer>
    </div>
  );
}
