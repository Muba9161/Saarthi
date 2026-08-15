import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Permission } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';

/**
 * Demo-only shortcut past the document round-trip.
 *
 * Trip assignment refuses an unverified driver or truck, and a real submission
 * needs every mandatory document on file — which would stop a freshly
 * registered fleet from dispatching anything. This renders only when the
 * server reports demo mode, and the endpoint behind it is refused otherwise.
 */
export function DemoVerifyButton({
  subjectType,
  subjectId,
  verified,
  invalidateKeys = [],
  className,
}: {
  subjectType: 'driver' | 'truck' | 'organization';
  subjectId: string;
  verified: boolean;
  invalidateKeys?: unknown[][];
  className?: string;
}) {
  const { can, session } = useAuth();
  const queryClient = useQueryClient();

  const verify = useMutation({
    mutationFn: () =>
      api.post(`/verification/subject/${subjectType}/${subjectId}/demo-verify`, {}),
    onSuccess: () => {
      toast.success('Verified', {
        description: 'Demo mode — no documents were reviewed. This record can now be dispatched.',
      });
      for (const key of invalidateKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      void queryClient.invalidateQueries({ queryKey: ['verification'] });
    },
    onError: (error) => toast.error('Could not verify', { description: errorMessage(error) }),
  });

  if (verified || !session?.demoMode || !can(Permission.VERIFICATION_SUBMIT)) return null;

  return (
    <Button
      size="sm"
      variant="outline"
      className={className}
      loading={verify.isPending}
      onClick={() => verify.mutate()}
      title="Demo mode only — skips document review"
    >
      <BadgeCheck className="size-4" />
      Verify (demo)
    </Button>
  );
}
