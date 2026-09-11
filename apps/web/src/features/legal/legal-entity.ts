/**
 * Who Saarthi is, legally — and how to reach that entity.
 *
 * Every company fact the Terms and the Privacy Policy state lives here and
 * nowhere else. Two documents that each spell out a registered address drift
 * the moment one of them is edited, and a legal document that contradicts its
 * sibling is worse than one that is merely out of date.
 *
 * Fields that still need real values carry `TODO`. `unresolvedLegalFields()`
 * below finds them, and the documents render a development-only banner listing
 * what is still missing — so an unfilled registered address is visible while
 * the site is being built rather than discovered by a regulator.
 */

/** Marks a value that has not been supplied yet. Never shown as real copy. */
const TODO = (hint: string): string => `TODO: ${hint}`;

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
  name: TODO('registered company name, e.g. VorldX Technologies Private Limited'),
  /** What the product is called in front of customers. */
  tradingName: 'VorldX Saarthi',
  /** Short form used mid-sentence. */
  shortName: 'Saarthi',
  /** Corporate Identity Number issued by the MCA. */
  cin: TODO('CIN from the MCA certificate'),
  /** GSTIN under which subscription invoices are raised. */
  gstin: TODO('GSTIN used for subscription invoicing'),
  registeredOffice: {
    line1: TODO('registered office address line 1'),
    city: TODO('city'),
    state: TODO('state'),
    postalCode: TODO('PIN code'),
    country: 'India',
  } satisfies PostalAddress,
  email: {
    support: TODO('support mailbox, e.g. support@vorldx.com'),
    privacy: TODO('privacy mailbox, e.g. privacy@vorldx.com'),
    legal: TODO('legal mailbox, e.g. legal@vorldx.com'),
    /** Must be monitored: the DPDP Act and the IT Rules both require it. */
    grievance: TODO('grievance officer mailbox, e.g. grievance@vorldx.com'),
  },
  phone: TODO('support telephone number in +91 format'),
  website: 'https://saarthi.vorldx.com',
  /**
   * The named Grievance Officer.
   *
   * Rule 3(2) of the IT (Intermediary Guidelines) Rules 2021 and section 13 of
   * the DPDP Act 2023 both require a named, contactable person — a role
   * mailbox alone does not satisfy either.
   */
  grievanceOfficer: {
    name: TODO('name of the appointed Grievance Officer'),
    designation: 'Grievance Officer',
  },
  /** Where a dispute is heard. */
  jurisdiction: {
    city: TODO('city whose courts have jurisdiction'),
    state: TODO('state'),
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
  version: '1.0',
  effectiveDate: '2026-09-11',
  lastUpdated: '2026-09-11',
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
