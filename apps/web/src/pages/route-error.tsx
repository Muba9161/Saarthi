import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { errorMessage } from '@/lib/api-client';

/**
 * Last-resort boundary. A render failure should never leave a blank screen —
 * the user always gets an explanation and a way back.
 */
export function RouteErrorPage({ error }: { error: unknown }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
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
