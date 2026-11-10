import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { apiClient, onUnauthorized, setCsrfToken } from '../api/client';
import type { LoginInput, Me } from '../api/openapi.types';

interface AuthContextValue {
  admin: Me | null;
  isLoading: boolean;
  refreshSession: () => Promise<Me | null>;
  login: (input: LoginInput) => Promise<{ admin: Me; requestId: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<Me | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshSession = useCallback(async (): Promise<Me | null> => {
    try {
      const res = await apiClient.adminMe();
      setAdmin(res.data);
      return res.data;
    } catch {
      setAdmin(null);
      setCsrfToken(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    return onUnauthorized(() => {
      setAdmin(null);
      setCsrfToken(null);
    });
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const res = await apiClient.adminLogin(input);
    const me: Me = {
      id: res.data.admin.id,
      username: res.data.admin.username,
      csrf_token: res.data.csrf_token,
      expires_at: res.data.expires_at,
    };
    setAdmin(me);
    return { admin: me, requestId: res.requestId };
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.adminLogout();
    } finally {
      setAdmin(null);
      setCsrfToken(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ admin, isLoading, refreshSession, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export function AdminRouteGuard({ children }: { children: React.ReactNode }) {
  const { admin, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12" role="status" aria-label="正在校验管理员会话">
        <div className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white p-6">
          <div className="h-5 w-48 rounded bg-slate-200" />
          <div className="mt-4 h-4 w-72 rounded bg-slate-100" />
        </div>
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/admin/login" state={{ from: location.pathname + location.search }} replace />;
  }

  return <>{children}</>;
}
