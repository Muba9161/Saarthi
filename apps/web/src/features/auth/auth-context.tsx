import * as React from 'react';
import {
  hasAnyPermission as hasAnyPermissionOf,
  hasPermission as hasPermissionOf,
  type Feature,
  type Permission,
  type RoleName,
  type SessionPayload,
} from '@saarthi/shared';
import { api, setAccessToken, setUnauthenticatedHandler, ApiError } from '@/lib/api-client';

/**
 * Session state for the whole client.
 *
 * The access token lives in memory only. On boot the app silently exchanges
 * the httpOnly refresh cookie for a fresh token, so a reload keeps the user
 * signed in without ever exposing a long-lived credential to JavaScript.
 */

interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  session: SessionPayload;
}

interface AuthContextValue {
  session: SessionPayload | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  login: (email: string, password: string) => Promise<SessionPayload>;
  register: (input: Record<string, unknown>) => Promise<SessionPayload>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  can: (...permissions: Permission[]) => boolean;
  canAll: (...permissions: Permission[]) => boolean;
  hasFeature: (feature: Feature) => boolean;
  hasRole: (...roles: RoleName[]) => boolean;
  isPlatformAdmin: boolean;
  isDriver: boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<SessionPayload | null>(null);
  const [status, setStatus] = React.useState<AuthContextValue['status']>('loading');
  const refreshTimer = React.useRef<number | null>(null);

  const clearSession = React.useCallback(() => {
    setAccessToken(null);
    setSession(null);
    setStatus('unauthenticated');
    if (refreshTimer.current) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  /** Refresh a little before expiry so a long session never blips. */
  const scheduleRefresh = React.useCallback((expiresIn: number) => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    const delay = Math.max(30_000, (expiresIn - 60) * 1000);
    refreshTimer.current = window.setTimeout(() => {
      void api
        .post<AuthResponse>('/auth/refresh', {})
        .then((result) => {
          setAccessToken(result.accessToken);
          setSession(result.session);
          scheduleRefresh(result.expiresIn);
        })
        .catch(() => clearSession());
    }, delay);
  }, [clearSession]);

  const applyAuth = React.useCallback(
    (result: AuthResponse) => {
      setAccessToken(result.accessToken);
      setSession(result.session);
      setStatus('authenticated');
      scheduleRefresh(result.expiresIn);
      return result.session;
    },
    [scheduleRefresh],
  );

  // Restore the session on first load.
  React.useEffect(() => {
    let cancelled = false;

    setUnauthenticatedHandler(() => clearSession());

    void (async () => {
      try {
        const result = await api.post<AuthResponse>('/auth/refresh', {}, { skipAuthRetry: true });
        if (!cancelled) applyAuth(result);
      } catch {
        if (!cancelled) {
          setStatus('unauthenticated');
          setSession(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      setUnauthenticatedHandler(null);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [applyAuth, clearSession]);

  const login = React.useCallback(
    async (email: string, password: string) => {
      const result = await api.post<AuthResponse>('/auth/login', { email, password });
      return applyAuth(result);
    },
    [applyAuth],
  );

  const register = React.useCallback(
    async (input: Record<string, unknown>) => {
      const result = await api.post<AuthResponse>('/auth/register', input);
      return applyAuth(result);
    },
    [applyAuth],
  );

  const logout = React.useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // Signing out must succeed locally even if the network call fails.
    }
    clearSession();
  }, [clearSession]);

  const refreshSession = React.useCallback(async () => {
    try {
      const payload = await api.get<SessionPayload>('/auth/me');
      setSession(payload);
    } catch (error) {
      if (error instanceof ApiError && error.isAuthError) clearSession();
    }
  }, [clearSession]);

  const switchOrganization = React.useCallback(
    async (organizationId: string) => {
      const result = await api.post<AuthResponse>('/auth/switch-organization', { organizationId });
      applyAuth(result);
    },
    [applyAuth],
  );

  const value = React.useMemo<AuthContextValue>(() => {
    const permissions = session?.permissions ?? [];
    const features = session?.subscription?.features ?? [];
    const roles = session?.user.roles ?? [];
    const isPlatformAdmin = roles.includes('PLATFORM_ADMIN' as RoleName);

    return {
      session,
      status,
      login,
      register,
      logout,
      refreshSession,
      switchOrganization,
      can: (...required) => hasAnyPermissionOf(permissions, required),
      canAll: (...required) => required.every((permission) => hasPermissionOf(permissions, permission)),
      // Platform admins are never blocked by a tenant's plan.
      hasFeature: (feature) => isPlatformAdmin || features.includes(feature),
      hasRole: (...required) =>
        required.some(
          (role) => roles.includes(role) || session?.organization?.membershipRole === role,
        ),
      isPlatformAdmin,
      isDriver: session?.driver !== null && session?.driver !== undefined,
    };
  }, [session, status, login, register, logout, refreshSession, switchOrganization]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Convenience for components that require an established session. */
export function useSession(): SessionPayload {
  const { session } = useAuth();
  if (!session) throw new Error('useSession requires an authenticated user');
  return session;
}
