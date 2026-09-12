import * as React from 'react';
import {
  hasAnyPermission as hasAnyPermissionOf,
  hasPermission as hasPermissionOf,
  type Feature,
  type Permission,
  // A value import, not a type-only one: the membership-role comparison below
  // needs `RoleName.DRIVER` at runtime. The const object carries both.
  RoleName,
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
  /** For a driver who registered without their employer's invite code. */
  joinFleet: (fleetInviteCode: string) => Promise<SessionPayload>;
  can: (...permissions: Permission[]) => boolean;
  canAll: (...permissions: Permission[]) => boolean;
  hasFeature: (feature: Feature) => boolean;
  hasRole: (...roles: RoleName[]) => boolean;
  isPlatformAdmin: boolean;
  /**
   * An employed driver, and nothing else.
   *
   * NOT the same as "has a driver profile", and the difference is the whole
   * reason both flags exist. A Personal customer who ticked "I drive one of my
   * vehicles myself" has a driver profile against his own user — that is the
   * feature working — but he is the owner: he buys the plan, adds the vehicles,
   * hires the drivers and pays the bill.
   *
   * While this asked only whether a driver profile existed, that man was
   * redirected to the driver app the moment he signed in and handed the driver
   * menu: My trip, My score, My QR badge. No Vehicles, no Drivers, no
   * Subscription. He had paid for a Personal plan and been given the screens of
   * somebody else's employee, with no way to add the very vehicles the plan was
   * sold to him for.
   *
   * The discriminator is the membership role, which registration already sets
   * correctly: an owner who drives stays FLEET_OWNER, an employed driver is
   * DRIVER. The API draws the same line the same way — see `isDriverOnly` in
   * `telemetry.service.ts`.
   */
  isDriver: boolean;
  /**
   * This person can be assigned to a vehicle and driven.
   *
   * True for an employed driver and for an owner who drives his own car. What
   * it gates is the driving surface — SOS, terminal sign-on, their own trip and
   * score — none of which depends on who signs the cheque.
   */
  hasDriverProfile: boolean;
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

  /*
   * A driver attaching themselves to a fleet with its invite code.
   *
   * Handled here rather than in the card that offers it because the reply is a
   * whole new session: joining moves the driver into the fleet's tenant, and
   * the token they are holding names the seat they have just left. Applying it
   * through `applyAuth` is what keeps that a single step for the caller.
   */
  const joinFleet = React.useCallback(
    async (fleetInviteCode: string) => {
      const result = await api.post<AuthResponse>('/drivers/me/fleet', { fleetInviteCode });
      return applyAuth(result);
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
      joinFleet,
      can: (...required) => hasAnyPermissionOf(permissions, required),
      canAll: (...required) => required.every((permission) => hasPermissionOf(permissions, permission)),
      // Platform admins are never blocked by a tenant's plan.
      hasFeature: (feature) => isPlatformAdmin || features.includes(feature),
      hasRole: (...required) =>
        required.some(
          (role) => roles.includes(role) || session?.organization?.membershipRole === role,
        ),
      isPlatformAdmin,
      /*
       * Both derived from the same profile, differing only in whether the
       * person is *also* the account holder. See the interface above.
       */
      isDriver:
        session?.driver != null && session?.organization?.membershipRole === RoleName.DRIVER,
      hasDriverProfile: session?.driver != null,
    };
  }, [session, status, login, register, logout, refreshSession, switchOrganization, joinFleet]);

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
