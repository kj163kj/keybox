import React from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Database,
  FileCheck2,
  FileText,
  LogIn,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { isMockMode, setApiMockMode } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function AppLayout() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const [mockEnabled, setMockEnabled] = React.useState(isMockMode());

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('已安全退出管理员会话');
      navigate('/admin/login');
    } catch {
      navigate('/admin/login');
    }
  };

  const handleToggleMockMode = () => {
    const next = !mockEnabled;
    setApiMockMode(next);
    setMockEnabled(next);
    toast.info(next ? '已切换至契约 Mock 数据模式' : '已切换至真实后端 API 模式 (/api/v1)');
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
                  Android 密钥盒收集与证书状态核验平台
                </span>
              </div>
            </Link>

            <nav className="flex flex-wrap items-center gap-1" aria-label="主导航">
              <NavLink to="/" end className={navLinkClass}>
                <Database className="h-3.5 w-3.5" />
                <span>公开列表</span>
              </NavLink>
              <NavLink to="/upload" className={navLinkClass}>
                <Upload className="h-3.5 w-3.5" />
                <span>上传与预检</span>
              </NavLink>
              <NavLink to="/certificates" className={navLinkClass}>
                <Search className="h-3.5 w-3.5" />
                <span>证书状态查询</span>
              </NavLink>
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleToggleMockMode}
              className="btn-interactive rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
              title="切换开发期契约一致 Mock 数据或真实后端同源代理"
            >
              数据源：{mockEnabled ? '契约 Mock' : 'Live API'}
            </button>

            <div className="h-4 w-px bg-slate-200" />

            <nav className="flex flex-wrap items-center gap-1" aria-label="管理端导航">
              <NavLink to="/admin/keyboxes" className={navLinkClass}>
                <FileCheck2 className="h-3.5 w-3.5" />
                <span>Keybox 管理</span>
              </NavLink>
              <NavLink to="/admin/audit-logs" className={navLinkClass}>
                <FileText className="h-3.5 w-3.5" />
                <span>审计日志</span>
              </NavLink>
              <NavLink to="/admin/system" className={navLinkClass}>
                <Settings className="h-3.5 w-3.5" />
                <span>系统设置</span>
              </NavLink>
            </nav>

            {admin ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-xs">
                <span className="font-medium text-emerald-900">{admin.username}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="btn-interactive inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-rose-50 hover:text-rose-700"
                >
                  <LogOut className="h-3 w-3" />
                  <span>登出</span>
                </button>
              </div>
            ) : (
              <NavLink to="/admin/login" className={navLinkClass}>
                <LogIn className="h-3.5 w-3.5" />
                <span>管理员登录</span>
              </NavLink>
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
            严格遵循 <code className="font-mono">api/openapi.json</code> (OpenAPI 3.0.3) 与{' '}
            <code className="font-mono">docs/api.md</code> 契约
          </span>
          <span>
            零私钥暴露 · 响应头强制 <code className="font-mono">Cache-Control: no-store</code> ·
            HttpOnly 会话 + CSRF 保护
          </span>
        </div>
      </footer>
    </div>
  );
}
