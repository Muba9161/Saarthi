/**
 * Who Saarthi is, legally — and how to reach that entity.
 *
 * Every company fact the Terms and the Privacy Policy state lives here and
 * nowhere else. Two documents that each spell out a registered address drift
 * the moment one of them is edited, and a legal document that contradicts its
 * sibling is worse than one that is merely out of date.
 *
 * A field that still needs its real value holds `'TODO: <hint>'`.
 * `unresolvedLegalFields()` below finds them, and the documents render a
 * development-only banner listing what is still missing — so an unfilled
 * registered address is visible while the site is being built rather than
 * discovered by a regulator. A field that is `null` is deliberately left out
 * of the documents instead.
 */

import { SITE } from '@/features/seo';

export interface PostalAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export const LEGAL_ENTITY = {
  /** The name on the certificate of incorporation, not the product name. */
  name: 'VorldX Industries Private Limited',
  /** What the product is called in front of customers. */
  tradingName: 'VorldX Saarthi',
  /** Short form used mid-sentence. */
  shortName: 'Saarthi',
  /** Corporate Identity Number issued by the MCA. */
  cin: 'U62099UP2026PTC245598',
  /** GSTIN under which subscription invoices are raised. */
  gstin: '09AAMCV0179Q1ZE',
  /** As the MCA records it; the GST principal place of business is the same. */
  registeredOffice: {
    line1: 'MJCC Towers, Kh No. 282',
    line2: 'Hariharpur Nilmatha',
    city: 'Lucknow',
    state: 'Uttar Pradesh',
    postalCode: '226002',
    country: 'India',
  } satisfies PostalAddress,
  /** One shared mailbox for now; split per role when dedicated ones exist. */
  email: {
    support: 'vx.saarthi@gmail.com',
    privacy: 'vx.saarthi@gmail.com',
    legal: 'vx.saarthi@gmail.com',
    /** Must be monitored: the DPDP Act and the IT Rules both require it. */
    grievance: 'vx.saarthi@gmail.com',
  },
  /** Support telephone in +91 format. `null` leaves the row out of both documents. */
  phone: null as string | null,
  website: SITE.url,
  /**
   * The named Grievance Officer.
   *
   * Rule 3(2) of the IT (Intermediary Guidelines) Rules 2021 and section 13 of
   * the DPDP Act 2023 both require a named, contactable person — a role
   * mailbox alone does not satisfy either. `name` is `null` until one is
   * appointed, which leaves the name row out of both documents.
   */
  grievanceOfficer: {
    name: null as string | null,
    designation: 'Grievance Officer',
  },
  /** Where a dispute is heard. */
  jurisdiction: {
    city: 'Lucknow',
    state: 'Uttar Pradesh',
    country: 'India',
  },
} as const;

/** Whether a value is still waiting on a real one. */
export function isPlaceholder(value: string): boolean {
  return value.startsWith('TODO:');
}

/**
 * An entity value as it should appear in the document.
 *
 * A `TODO` must never reach a reader, so an unfilled field renders as a
 * visible gap instead. That is deliberately conspicuous: a legal document with
 * "[to be completed]" where the registered office should be is obviously
 * unfinished, whereas one that quietly omits the line reads as finished and is
 * not.
 */
export function entityText(value: string): string {
  return isPlaceholder(value) ? '[to be completed]' : value;
}

/** One-line postal address, for a paragraph rather than an address block. */
export function formatAddress(address: PostalAddress): string {
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ].filter((part): part is string => Boolean(part) && !isPlaceholder(part as string));

  return parts.length > 1 ? parts.join(', ') : '[to be completed]';
}

/**
 * Every entity field still holding a placeholder, as dotted paths.
 *
 * Walks the object rather than listing the fields, so a field added above is
 * covered without anybody remembering to add it here too.
 */
export function unresolvedLegalFields(): string[] {
  const found: string[] = [];

  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (value.startsWith('TODO:')) found.push(`${path} (${value.slice(6)})`);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        walk(child, path ? `${path}.${key}` : key);
      }
    }
  };

  walk(LEGAL_ENTITY, '');
  return found;
}

/* -------------------------------------------------------------------------
 * Document versions
 *
 * A legal document is only enforceable against the version somebody agreed to,
 * so each carries a version and the date it took effect. Bump `version` and
 * `effectiveDate` together whenever a change alters rights or obligations; a
 * typo fix moves `lastUpdated` alone.
 * ---------------------------------------------------------------------- */

export interface DocumentVersion {
  version: string;
  /** ISO date the version became binding. */
  effectiveDate: string;
  /** ISO date of the last edit of any kind. */
  lastUpdated: string;
}

export const TERMS_VERSION: DocumentVersion = {
  version: '1.0',
  effectiveDate: '2026-09-11',
  lastUpdated: '2026-09-11',
};

export const PRIVACY_VERSION: DocumentVersion = {
  version: '1.1',
  effectiveDate: '2026-10-01',
  lastUpdated: '2026-10-01',
};

/** "11 September 2026" — the form Indian legal documents are written in. */
export function formatLegalDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/* -------------------------------------------------------------------------
 * Retention periods
 *
 * Mirrors the API's `*_RETENTION_DAYS` settings. A privacy policy that quotes
 * a retention period the server does not honour is a false statement, so these
 * are kept beside the numbers rather than written into prose in two places.
 * Update both together — see `.env.example` on the API.
 * ---------------------------------------------------------------------- */

export const RETENTION = {
  /** `IDENTITY_RETENTION_DAYS` — Aadhaar, PAN, Voter ID and GSTIN checks. */
  identityVerificationDays: 730,
  /** `VEHICLE_LOOKUP_RETENTION_DAYS` — cached RC register responses. */
  vehicleLookupDays: 365,
  /** `LICENCE_LOOKUP_RETENTION_DAYS` — cached driving licence responses. */
  licenceLookupDays: 365,
} as const;

/** "24 months", "12 months" — days read as a duration a person can hold. */
export function formatRetention(days: number): string {
  if (days % 365 === 0) {
    const years = days / 365;
    return years === 1 ? '12 months' : `${years * 12} months`;
  }
  if (days % 30 === 0) return `${days / 30} months`;
  return `${days} days`;
}
