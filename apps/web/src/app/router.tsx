import * as React from 'react';
import { Navigate, Outlet, createBrowserRouter, useRouteError } from 'react-router-dom';
import { AppShell } from '@/layouts/app-shell';
import { AuthLayout } from '@/layouts/auth-layout';
import { useAuth } from '@/features/auth/auth-context';
import { LoadingState } from '@/components/common/states';
import { NotFoundPage } from '@/pages/not-found';
import { RouteErrorPage } from '@/pages/route-error';

const LandingPage = React.lazy(() => import('@/pages/marketing/landing'));

/**
 * Routing.
 *
 * Feature pages are code-split so the driver app does not download the fleet
 * analytics bundle. `RequireAuth` gates the shell; individual pages re-check
 * their own permissions, and the API is authoritative regardless.
 */

const lazyPage = (loader: () => Promise<{ default: React.ComponentType }>) => {
  const Component = React.lazy(loader);
  return (
    <React.Suspense fallback={<LoadingState className="min-h-[60vh]" />}>
      <Component />
    </React.Suspense>
  );
};

/** The root path is the marketing site when signed out, the app when signed in. */
function RootRoute() {
  const { status } = useAuth();

  if (status === 'loading') return <LoadingState label="Loading Saarthi…" className="min-h-screen" />;
  if (status === 'authenticated') return <HomeRedirect />;
  return React.createElement(
    React.Suspense,
    { fallback: <LoadingState className="min-h-screen" /> },
    React.createElement(LandingPage),
  );
}

function RequireAuth() {
  const { status } = useAuth();

  if (status === 'loading') return <LoadingState label="Checking your session…" className="min-h-screen" />;
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Sends each account type to the home screen that suits it. */
function HomeRedirect() {
  const { isDriver, isPlatformAdmin, session } = useAuth();

  if (isDriver) return <Navigate to="/driver" replace />;
  if (isPlatformAdmin && !session?.organization) return <Navigate to="/admin" replace />;
  // An association has no fleet dashboard to land on — its home is the queue.
  if (session?.organization?.type === 'TRUCK_ASSOCIATION') {
    return <Navigate to="/association" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}

function RouteError() {
  const error = useRouteError();
  return <RouteErrorPage error={error} />;
}

export const router = createBrowserRouter([
  { path: '/', element: <RootRoute />, errorElement: <RouteError /> },
  {
    element: <AuthLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/login', element: lazyPage(() => import('@/pages/auth/login')) },
      { path: '/register', element: lazyPage(() => import('@/pages/auth/register')) },
      { path: '/forgot-password', element: lazyPage(() => import('@/pages/auth/forgot-password')) },
      { path: '/reset-password', element: lazyPage(() => import('@/pages/auth/reset-password')) },
    ],
  },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/dashboard', element: lazyPage(() => import('@/pages/dashboard')) },

          // Fleet
          { path: '/fleet/trucks', element: lazyPage(() => import('@/pages/fleet/trucks')) },
          { path: '/fleet/trucks/:id', element: lazyPage(() => import('@/pages/fleet/truck-detail')) },
          { path: '/fleet/drivers', element: lazyPage(() => import('@/pages/fleet/drivers')) },
          { path: '/fleet/drivers/:id', element: lazyPage(() => import('@/pages/fleet/driver-detail')) },
          { path: '/fleet/documents', element: lazyPage(() => import('@/pages/fleet/documents')) },
          {
            path: '/fleet/rc-lookup',
            element: lazyPage(() => import('@/pages/fleet/rc-lookup')),
          },
          { path: '/fleet/maintenance', element: lazyPage(() => import('@/pages/fleet/maintenance')) },
          { path: '/fleet/fuel', element: lazyPage(() => import('@/pages/fleet/fuel')) },

          // Operations
          { path: '/tracking', element: lazyPage(() => import('@/pages/tracking/live-map')) },
          { path: '/trips', element: lazyPage(() => import('@/pages/trips/trips')) },
          { path: '/trips/:id', element: lazyPage(() => import('@/pages/trips/trip-detail')) },
          { path: '/orders', element: lazyPage(() => import('@/pages/orders/orders')) },
          { path: '/orders/new', element: lazyPage(() => import('@/pages/orders/new-order')) },
          { path: '/orders/:id', element: lazyPage(() => import('@/pages/orders/order-detail')) },
          { path: '/marketplace', element: lazyPage(() => import('@/pages/marketplace/requirements')) },
          { path: '/browse', element: lazyPage(() => import('@/pages/marketplace/browse')) },
          {
            path: '/marketplace/vehicles',
            element: lazyPage(() => import('@/pages/resale/marketplace')),
          },
          { path: '/supplier/materials', element: lazyPage(() => import('@/pages/supplier/materials')) },

          // Generalized vehicles
          { path: '/fleet/vehicles', element: lazyPage(() => import('@/pages/fleet/vehicles')) },
          {
            path: '/fleet/vehicles/:id/telemetry',
            element: lazyPage(() => import('@/pages/telemetry/vehicle-telemetry')),
          },

          // Hardware & telemetry
          { path: '/devices', element: lazyPage(() => import('@/pages/devices/devices')) },
          {
            path: '/devices/:id',
            element: lazyPage(() => import('@/pages/devices/device-detail')),
          },
          {
            path: '/telemetry/alerts',
            element: lazyPage(() => import('@/pages/telemetry/alerts')),
          },

          // Travel — customer
          { path: '/travel', element: lazyPage(() => import('@/pages/travel/search')) },
          {
            path: '/travel/packages/:id',
            element: lazyPage(() => import('@/pages/travel/package-detail')),
          },
          {
            path: '/travel/bookings',
            element: lazyPage(() => import('@/pages/travel/bookings')),
          },
          {
            path: '/travel/bookings/:id',
            element: lazyPage(() => import('@/pages/travel/booking-detail')),
          },

          // Travel — provider
          {
            path: '/travel/provider/packages',
            element: lazyPage(() => import('@/pages/travel/provider-packages')),
          },
          {
            path: '/travel/provider/bookings',
            element: lazyPage(() => import('@/pages/travel/provider-bookings')),
          },

          // Truck association
          {
            path: '/association',
            element: lazyPage(() => import('@/pages/association/dashboard')),
          },
          {
            path: '/association/alerts/:id',
            element: lazyPage(() => import('@/pages/association/alert-detail')),
          },

          // Safety
          { path: '/sos', element: lazyPage(() => import('@/pages/sos/incidents')) },
          { path: '/sos/:id', element: lazyPage(() => import('@/pages/sos/incident-detail')) },
          { path: '/nearby', element: lazyPage(() => import('@/pages/nearby/nearby')) },

          // Intelligence
          { path: '/analytics', element: lazyPage(() => import('@/pages/analytics/analytics')) },
          { path: '/copilot', element: lazyPage(() => import('@/pages/ai/copilot')) },

          // Demo
          { path: '/simulator', element: lazyPage(() => import('@/pages/simulator/simulator')) },

          // Driver app
          { path: '/driver', element: lazyPage(() => import('@/pages/driver/home')) },
          { path: '/driver/nearby', element: lazyPage(() => import('@/pages/driver/nearby')) },
          { path: '/driver/score', element: lazyPage(() => import('@/pages/driver/score')) },
          { path: '/driver/documents', element: lazyPage(() => import('@/pages/driver/documents')) },
          { path: '/driver/trips', element: lazyPage(() => import('@/pages/driver/trips')) },
          { path: '/driver/trips/:id', element: lazyPage(() => import('@/pages/trips/trip-detail')) },
          { path: '/driver/sos', element: lazyPage(() => import('@/pages/driver/sos')) },
          { path: '/driver/sos/:id', element: lazyPage(() => import('@/pages/sos/incident-detail')) },

          // Account
          { path: '/notifications', element: lazyPage(() => import('@/pages/notifications')) },
          {
            path: '/settings/profile',
            element: lazyPage(() => import('@/pages/settings/profile-builder')),
          },
          { path: '/qr', element: lazyPage(() => import('@/pages/qr/qr-codes')) },
          { path: '/verification', element: lazyPage(() => import('@/pages/verification')) },
          { path: '/settings', element: lazyPage(() => import('@/pages/settings/settings')) },
          {
            path: '/settings/subscription',
            element: lazyPage(() => import('@/pages/settings/subscription')),
          },

          // Platform administration
          { path: '/admin', element: lazyPage(() => import('@/pages/admin/overview')) },
          { path: '/admin/verification', element: lazyPage(() => import('@/pages/admin/verification-queue')) },
          { path: '/admin/users', element: lazyPage(() => import('@/pages/admin/users')) },
          { path: '/admin/organizations', element: lazyPage(() => import('@/pages/admin/organizations')) },
          { path: '/admin/audit', element: lazyPage(() => import('@/pages/admin/audit')) },

          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
