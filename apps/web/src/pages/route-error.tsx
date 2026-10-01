import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LoadingState } from '@/components/common/states';
import { errorMessage } from '@/lib/api-client';
import { isChunkLoadError, reloadForCurrentBuild } from '@/lib/chunk-reload';
import { cn } from '@/lib/utils';

/**
 * Last-resort boundary. A render failure should never leave a blank screen —
 * the user always gets an explanation and a way back.
 *
 * `inline` is the boundary inside the app shell, where the page area is all it
 * has to fill; the full-screen form is for failures outside it.
 */
export function RouteErrorPage({ error, inline = false }: { error: unknown; inline?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Code from an older deploy is not an error worth reading: reload onto the
  // current build, and only explain if that was already tried.
  const staleCode = isChunkLoadError(error);
  const [reloading, setReloading] = React.useState(staleCode);
  React.useEffect(() => {
    if (staleCode && !reloadForCurrentBuild()) setReloading(false);
  }, [staleCode]);

  if (reloading) return <LoadingState className={inline ? 'min-h-[60vh]' : 'min-h-screen'} />;

  // A fresh location resets React Router's boundary, so the page renders again
  // without throwing away everything else the app has loaded.
  const tryAgain = () =>
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: location.state,
    });

  return (
    <div
      className={cn(
        'flex items-center justify-center p-6',
        inline ? 'min-h-[60vh]' : 'min-h-screen',
      )}
    >
      <div className="w-full max-w-lg space-y-4">
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>This screen could not be displayed</AlertTitle>
          <AlertDescription className="space-y-3">
            {/* A raw error can be one long unbreakable token (a module path, a
                URL). Break it rather than let it widen the page. */}
            <p className="break-words">
              {errorMessage(error, 'An unexpected error occurred while rendering the page.')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={tryAgain}>
                Try again
              </Button>
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                Reload
              </Button>
              <Button size="sm" asChild>
                <Link to="/">Back to Saarthi</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}

export default RouteErrorPage;
