import { useT } from '@/features/i18n';
import { useNow } from '@/hooks/use-now';
import { updatedAgo, updatedAgoMessage } from './live-ride-status';

/**
 * "Updated 20 s ago", ageing on its own between fetches.
 *
 * Kept as its own small component so the once-a-second tick repaints this text
 * and nothing around it.
 */
export function UpdatedAgo({ recordedAt }: { recordedAt: string }) {
  const t = useT();
  const now = useNow(1000);
  const ago = updatedAgo(recordedAt, now);
  if (!ago) return null;

  const message = updatedAgoMessage(ago);
  return <time dateTime={recordedAt}>{t(message.key, message.values)}</time>;
}
