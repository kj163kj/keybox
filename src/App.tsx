import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileCheck2, FileText, Settings } from 'lucide-react';
import { Toaster } from 'sonner';
import { AppLayout } from './components/AppLayout';
import { AdminRouteGuard, AuthProvider } from './context/AuthContext';
import { PublicKeyboxListPage } from './pages/PublicKeyboxListPage';
import { UploadKeyboxPage } from './pages/UploadKeyboxPage';
import { PublicKeyboxDetailPage } from './pages/PublicKeyboxDetailPage';
import { CertificateSearchPage } from './pages/CertificateSearchPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AdminKeyboxListPage } from './pages/AdminKeyboxListPage';
import { AdminKeyboxDetailPage } from './pages/AdminKeyboxDetailPage';
import { AdminAuditLogsPage } from './pages/AdminAuditLogsPage';
import { AdminSystemPage } from './pages/AdminSystemPage';

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

const defaultQueryClient = createAppQueryClient();

const adminSubNavLinkClass = ({ isActive }: { isActive: boolean }) =>
  `btn-interactive inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
    isActive
      ? 'bg-slate-900 text-white shadow-2xs'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;

function ProtectedAdminOutlet() {
  return (
    <AdminRouteGuard>
      <div className="space-y-5">
        <nav
          aria-label="后台管理子导航"
          data-testid="admin-subnav"
          className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xs"
        >
          <NavLink to="/admin/keyboxes" className={adminSubNavLinkClass}>
            <FileCheck2 className="h-3.5 w-3.5" />
            <span>Keybox 管理</span>
          </NavLink>
          <NavLink to="/admin/audit-logs" className={adminSubNavLinkClass}>
            <FileText className="h-3.5 w-3.5" />
            <span>审计日志</span>
          </NavLink>
          <NavLink to="/admin/system" className={adminSubNavLinkClass}>
            <Settings className="h-3.5 w-3.5" />
            <span>系统设置</span>
          </NavLink>
        </nav>
        <Outlet />
      </div>
    </AdminRouteGuard>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<PublicKeyboxListPage />} />
        <Route path="/upload" element={<UploadKeyboxPage />} />
        <Route path="/keyboxes/:id" element={<PublicKeyboxDetailPage />} />
        <Route path="/certificates" element={<CertificateSearchPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route element={<ProtectedAdminOutlet />}>
          <Route path="/admin/keyboxes" element={<AdminKeyboxListPage />} />
          <Route path="/admin/keyboxes/:id" element={<AdminKeyboxDetailPage />} />
          <Route path="/admin/audit-logs" element={<AdminAuditLogsPage />} />
          <Route path="/admin/system" element={<AdminSystemPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={defaultQueryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster position="bottom-right" richColors closeButton />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
