/**
 * Where the legal documents live, and what to call them.
 *
 * Its own module, and a data-only one, because four unrelated places need it:
 * the public footer, the sign-in and registration chrome, the consent checkbox
 * in the registration wizard, and the documents themselves. Keeping it beside
 * the pages rather than inside the marketing chrome means the sign-in screens
 * can link to the Terms without pulling the whole landing-page header into
 * their bundle.
 *
 * The labels are English source strings, the same form `t()` looks up - see
 * `features/i18n`. The documents are published in English only, but the link
 * to them appears on screens a driver reads in their own language, and the
 * label is the part they have to recognise.
 */

export interface LegalLinkSpec {
  to: string;
  /** English source text. Translate at the call site with `t()`. */
  label: string;
}

export const LEGAL_LINKS: readonly LegalLinkSpec[] = [
  { to: '/terms', label: 'Terms of Service' },
  { to: '/privacy', label: 'Privacy Policy' },
] as const;
