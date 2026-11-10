import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

function ProtectedAdminOutlet() {
  return (
    <AdminRouteGuard>
      <Outlet />
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
