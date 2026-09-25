import SPELLINGS from './saarthi-in-script.json';

/**
 * "Saarthi", in the script of each locale the product offers.
 *
 * Keyed by locale code so it is checked against `LANGUAGE_CATALOGUE` rather
 * than sitting alongside it in a parallel array that silently falls out of
 * order. `marketing.test.tsx` asserts every catalogue entry is covered, which
 * is what turns adding a new language into a failing test rather than a
 * silent gap.
 *
 * The spellings live in JSON rather than here because two readers need them:
 * this module, and `tools/generate-ink-art.mjs`, which turns each one into
 * the outlines the band draws. A plain Node script cannot import TypeScript,
 * and a second copy of the list would be exactly the parallel array the keying
 * above exists to avoid.
 *
 * Kept in the marketing feature and not in `packages/shared`: this is brand
 * copy, and the shared language catalogue is product data that the API and
 * both mobile apps also read. A rendering of a trade name does not belong in
 * it.
 *
 * Every form here — Devanagari, Bengali-Assamese, Gujarati, Gurmukhi, Kannada,
 * Malayalam, Odia, Tamil, Telugu and Urdu — is the standard spelling.
 */
export const SAARTHI_IN_SCRIPT: Readonly<Record<string, string>> = SPELLINGS;
