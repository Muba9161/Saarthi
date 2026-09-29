import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Permission } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { useSecureAction } from '@/features/secure-access/secure-unlock-dialog';

/**
 * The account-wide switch for RC details on QR scans — off until the account
 * holder turns it on.
 *
 * Turning it either way asks for the secure PIN or a passkey, and the server
 * emails whoever did it. Returned as a hook with its own dialog so the profile
 * menu can render the switch inside the menu and the PIN prompt outside it: a
 * dialog opened from inside a closing menu would close with it.
 */

const POLICY_KEY = ['qr-privacy-policy'] as const;

export function useQrRcVisibility() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canRead = can(Permission.QR_READ);
  const canManage = can(Permission.QR_MANAGE) && can(Permission.ORG_UPDATE);
  const { guard, dialog } = useSecureAction('change whether QR scans show RC details');

  const policy = useQuery({
    queryKey: POLICY_KEY,
    queryFn: () => api.get<{ showRcDetails: boolean }>('/qr/privacy-policy'),
    enabled: canRead && canManage,
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      guard(() => api.put<{ showRcDetails: boolean }>('/qr/rc-visibility', { enabled })),
    onSuccess: (result) => {
      if (!result) return;
      toast.success(
        result.showRcDetails
          ? 'RC details now show on QR scans'
          : 'RC details now hidden on QR scans',
        { description: 'We have emailed you to confirm the change.' },
      );
      void queryClient.invalidateQueries({ queryKey: POLICY_KEY });
    },
    onError: (error) => toast.error('Could not change it', { description: errorMessage(error) }),
  });

  return {
    available: canRead && canManage,
    enabled: policy.data?.showRcDetails ?? false,
    loading: policy.isLoading,
    pending: toggle.isPending,
    setEnabled: (enabled: boolean) => toggle.mutate(enabled),
    dialog,
  };
}
