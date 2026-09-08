import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import type { Permission } from '@saarthi/shared';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The trash button on a list row or card, with its confirmation.
 *
 * One component rather than the pattern repeated per screen, because the parts
 * that get forgotten when it is copied are the ones that matter:
 *
 *  - It renders *nothing* without the delete permission. The API enforces the
 *    same rule, so a visible button the server would refuse is only a way to
 *    show someone an error they could not have avoided.
 *  - It confirms first, naming the record. Deletion is the one action in a
 *    fleet console a user cannot undo from the UI.
 *  - It stops the click from propagating. Rows and cards in this product are
 *    themselves clickable and navigate to a detail page; without this, pressing
 *    delete opens the record instead of removing it.
 *  - It reports the server's own refusal. Most of these endpoints have business
 *    rules — a truck on an active trip cannot be archived — and the reason is
 *    the only useful thing to say when the attempt fails.
 *
 * Most Saarthi endpoints archive rather than erase, so the copy says "Archive"
 * unless a caller passes `mode="delete"`. Saying "delete permanently" about a
 * soft delete teaches people to distrust the warning.
 */
export function DeleteAction({
  endpoint,
  itemLabel,
  entityName,
  permission,
  invalidateKeys,
  mode = 'archive',
  onDeleted,
  disabled,
  disabledReason,
  size = 'icon-sm',
  className,
}: {
  /** API path, e.g. `/trucks/abc123`. Called with DELETE. */
  endpoint: string;
  /** What is being removed, shown in the confirmation — a plate, a name. */
  itemLabel: string;
  /** Lower-case singular noun for the copy, e.g. "truck". */
  entityName: string;
  /** Hidden entirely unless the session holds this. */
  permission: Permission;
  /** Query keys to invalidate on success. */
  invalidateKeys: readonly unknown[][];
  /**
   * `archive` (the default) is a soft delete the record can be restored from;
   * `delete` is permanent and says so.
   */
  mode?: 'archive' | 'delete';
  onDeleted?: () => void;
  /** For records the UI already knows cannot go — an in-flight trip. */
  disabled?: boolean;
  disabledReason?: string;
  size?: 'icon-sm' | 'icon' | 'sm';
  className?: string;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const verb = mode === 'archive' ? 'Archive' : 'Delete';

  const remove = useMutation({
    mutationFn: () => api.delete(endpoint),
    onSuccess: () => {
      for (const key of invalidateKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(`${itemLabel} ${mode === 'archive' ? 'archived' : 'deleted'}`);
      setOpen(false);
      onDeleted?.();
    },
    onError: (error) => {
      // Left open: the reason is usually something the user can act on, and
      // closing the dialog would hide the attempt along with the explanation.
      toast.error(`Could not ${verb.toLowerCase()} this ${entityName}`, {
        description: errorMessage(error),
      });
    },
  });

  if (!can(permission)) return null;

  const label = `${verb} ${itemLabel}`;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size={size}
            aria-label={label}
            disabled={disabled}
            className={cn(
              'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
              className,
            )}
            onClick={(event) => {
              // The row behind this is a link to the detail page.
              event.stopPropagation();
              event.preventDefault();
              setOpen(true);
            }}
          >
            <Trash2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{disabled && disabledReason ? disabledReason : label}</TooltipContent>
      </Tooltip>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent
          onClick={(event) => event.stopPropagation()}
          aria-describedby="delete-action-description"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {verb} this {entityName}?
            </AlertDialogTitle>
            <AlertDialogDescription id="delete-action-description">
              <span className="font-medium text-foreground">{itemLabel}</span>{' '}
              {mode === 'archive'
                ? `will be removed from your active ${entityName} list. Its history is kept, and an administrator can restore it.`
                : 'will be permanently deleted. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(event) => {
                // Radix closes the dialog on action by default; the request has
                // not resolved yet, so hold it open until the mutation settles.
                event.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending ? `${verb.slice(0, -1)}ing…` : verb}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default DeleteAction;
