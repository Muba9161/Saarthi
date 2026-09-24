/**
 * What happens to a paid account whose period ends unpaid.
 *
 *   Period ends unpaid (trial or month)
 *     → GRACE: full access for `BILLING_GRACE_DAYS`, with a warning
 *     → ARCHIVED: locked — only renewal is reachable — for `DATA_PURGE_AFTER_DAYS`
 *     → PURGED: the business's own data is permanently deleted
 *
 * Renewing at any point before the purge restores the account exactly as it
 * was. Payments, invoices, the audit log and records shared with other
 * parties (orders, bookings) are never deleted.
 *
 * Shared so the API that enforces it and every screen that explains it quote
 * the same numbers.
 */
export const BILLING_GRACE_DAYS = 3;
export const DATA_PURGE_AFTER_DAYS = 90;

const DAY_MS = 86_400_000;

/** When an account whose period ended at `periodEnd` is archived if still unpaid. */
export function archiveDateFor(periodEnd: Date): Date {
  return new Date(periodEnd.getTime() + BILLING_GRACE_DAYS * DAY_MS);
}

/** When an account archived at `archivedAt` has its own data deleted. */
export function purgeDateFor(archivedAt: Date): Date {
  return new Date(archivedAt.getTime() + DATA_PURGE_AFTER_DAYS * DAY_MS);
}

/** The warning an owner is given the moment a paid period ends unpaid. */
export function unpaidWarning(planName: string, archiveOn: Date): string {
  return `${planName} has not been renewed. Renew by ${archiveOn.toLocaleDateString('en-IN')} or your account will be archived, and archived accounts are permanently deleted after ${DATA_PURGE_AFTER_DAYS} days.`;
}
