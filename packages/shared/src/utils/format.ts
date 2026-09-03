/**
 * Formatting helpers shared by the API (notification bodies, AI context) and
 * the web client, so a distance or currency renders identically everywhere.
 */

export function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km)) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function formatDurationMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (hours < 24) return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0 ? `${days} d` : `${days} d ${remainingHours} h`;
}

export function formatSpeedKph(kph: number): string {
  if (!Number.isFinite(kph)) return '—';
  return `${Math.round(kph)} km/h`;
}

/** Indian numbering system currency formatting (₹1,23,456). */
export function formatCurrency(amount: number | null | undefined, currency = 'INR'): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `₹${amount.toFixed(2)}`;
  }
}

export function formatCompactCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const abs = Math.abs(amount);
  if (abs >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000) return `₹${(amount / 100_000).toFixed(2)} L`;
  if (abs >= 1_000) return `₹${(amount / 1_000).toFixed(1)} K`;
  return formatCurrency(amount);
}

export function formatNumber(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(fractionDigits)}%`;
}

/** Convert an ENUM_LIKE_VALUE into "Enum like value". */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return '—';
  const lower = value.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function initialsOf(firstName?: string | null, lastName?: string | null): string {
  const first = (firstName ?? '').trim().charAt(0);
  const last = (lastName ?? '').trim().charAt(0);
  return `${first}${last}`.toUpperCase() || '?';
}

/** Normalise an Indian vehicle registration number for storage and lookup. */
export function normalizeRegistrationNumber(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '');
}

/** Present a stored registration number as UP-16-AB-1234. */
export function formatRegistrationNumber(value: string): string {
  const normalized = normalizeRegistrationNumber(value);
  const match = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(normalized);
  if (!match) return normalized;
  return [match[1], match[2], match[3], match[4]].filter(Boolean).join('-');
}

export function relativeTimeFrom(date: Date | string, now: Date = new Date()): string {
  const target = typeof date === 'string' ? new Date(date) : date;
  const diffSeconds = Math.round((target.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSeconds);

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 3600],
    ['hour', 86_400],
    ['day', 604_800],
    ['week', 2_629_800],
    ['month', 31_557_600],
  ];

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  let divisor = 1;
  for (const [unit, threshold] of units) {
    if (abs < threshold) {
      return formatter.format(Math.round(diffSeconds / divisor), unit);
    }
    divisor = threshold;
  }
  return formatter.format(Math.round(diffSeconds / 31_557_600), 'year');
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

/**
 * A date and time, in the locale Saarthi is used in.
 *
 * Deliberately not relative: `relativeTimeFrom` is right for "when did this
 * happen", but a deadline or a departure has to be readable as an actual
 * date somebody can put in a diary.
 */
export function formatDateTime(
  date: Date | string | null | undefined,
  locale = 'en-IN',
): string {
  if (!date) return '—';
  const target = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(target.getTime())) return '—';
  return target.toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The date alone, for fields where the time carries no information. */
export function formatDate(date: Date | string | null | undefined, locale = 'en-IN'): string {
  if (!date) return '—';
  const target = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(target.getTime())) return '—';
  return target.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}
