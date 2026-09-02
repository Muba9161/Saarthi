import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/features/auth/auth-context';
import { RealtimeProvider } from '@/hooks/use-realtime';
import { ThemeProvider } from '@/features/theme/theme-context';
import { AppLocaleProvider } from '@/features/i18n';
import { ApiError } from '@/lib/api-client';
import { router } from '@/app/router';

/**
 * Application root: data layer, session, language, realtime, theme, then
 * routing. Ordering matters — realtime needs the session, language reads the
 * account's stored preference from it, and the router needs all three.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry a request the server has already rejected on merit.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <AppLocaleProvider>
            <RealtimeProvider>
              <TooltipProvider delayDuration={200}>
                <RouterProvider router={router} />
                <Toaster
                  position="top-right"
                  richColors
                  closeButton
                  toastOptions={{ className: 'font-sans' }}
                />
              </TooltipProvider>
            </RealtimeProvider>
          </AppLocaleProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
