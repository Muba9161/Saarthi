# Profile & Navigation Cleanup + Refer & Earn — Audit and Implementation Report

Companion to `SAARTHI_PROFILE_NAVIGATION_REFERRAL_AUDIT.md`. Records what the
audit found, what changed, and the decisions that still need a business owner.

---

## A. Navigation map (before)

| Location | Contents |
|---|---|
| Desktop sidebar | Role menu from `app/navigation.ts` (Fleet / Mobility / Supplier / Customer / Driver / Association / Sales / Admin), then an **account block**: Notifications, My profile, Business documents, Payouts & commission, Verification. Plan footer. |
| Header | Organization switcher, Live indicator, Vehicle marketplace icon, SOS (anyone with a driver profile), Notification bell, Language, Theme, Avatar menu. |
| Avatar menu | Name/email, **one item** ("Profile & settings"), Sign out. |
| Mobile | Bottom tab bar: first 4–5 items of the role menu. Drawer: the full sidebar, account block included. |
| Secondary tabs | Documents & costs strip (documents, fuel, loans, toll). Profile wizard steps (incl. Security/password). |
| Contextual links | Dashboard shortcuts (trips, drivers, orders, SOS…), upgrade prompts → `/settings/subscription`, QR page → `/settings/qr-privacy`. |
| Breadcrumbs | None app-wide. |

## B. Profile audit — what was poorly organized

1. **Billing had no menu entry at all.** `/settings/subscription` (plan, capacity, trackers, payments, autopay) was reachable only from an upgrade prompt.
2. **Two account menus.** Account items sat in the sidebar while the avatar menu held a single link — neither was the obvious home.
3. **Notifications appeared twice** — sidebar account block and header bell.
4. **Password change** existed only as the last step of the profile wizard, with no direct link.
5. Legal pages (`/terms`, `/privacy`) had no in-app entry point.

## C. Moved under Profile (avatar menu)

| Item | From | To | Reason |
|---|---|---|---|
| My profile | Sidebar account block | Profile → Account | About the user |
| Verification | Sidebar account block | Profile → Account | Account/identity verification |
| Billing & subscription | *(no entry)* | Profile → Account | Billing; gated by `subscription.read` |
| Refer & earn | *(new)* | Profile → Account | Rewards relationship with Saarthi |
| Business documents | Sidebar account block | Profile → Business | Business account paperwork (`requiresBusiness`) |
| Payouts & commission | Sidebar account block | Profile → Business | Business bank/payout account (`requiresBusiness`) |
| Change password | Profile wizard only | Profile → Security | Deep-links `/settings/profile?step=security` |
| Terms / Privacy | *(no in-app entry)* | Profile → Legal | Informational |
| Notifications | Sidebar + header bell | Header bell only | Live alerts stay global; duplicate removed |

## D. Stayed operational (not buried under Profile)

Vehicles/Trucks, Drivers, Trips, Orders, Live map, Bid on work, Maintenance,
Terminal arrivals, Documents & costs, SOS incidents, Telemetry alerts, Nearby,
Analytics, AI Copilot, Materials, Packages, Bookings, all driver screens, all
Sales and Admin screens. **SOS** stays in the header for anyone with a driver
profile. Driver *Documents* stays in the driver menu (resource, not account).

## E. Duplicate / legacy navigation

| Duplicate | Classification | Action |
|---|---|---|
| Notifications in sidebar + header bell | True duplicate | Sidebar entry removed |
| Sidebar account block + avatar menu | Competing systems | Merged into the avatar menu |
| `/settings` → `/settings/profile` | Legacy redirect | Kept (bookmarks) |
| `/marketplace` beside `/requirements/board` | Legacy, already documented | Kept (deep links) |
| Dashboard shortcuts to trips/orders/SOS | Intentional context actions | Kept |

## F. Referral placement

`Avatar menu → Account → Refer & earn` → `/referrals`. Nothing was added to the
dashboard, the marketing site, or any hero/banner/popup.

## G. Role-aware behaviour

The account menu runs through the same `useNavItemVisible` filter as the sidebar
(permissions, plan feature, roles, `excludeRoles`, `requiresBusiness`,
`personalOnly`). Operational menus are unchanged.

| Account | Account group | Business group |
|---|---|---|
| Free customer | Profile, Verification, Billing, Refer & earn | Business documents only when the organization is a business, not a personal seat (no payout permission) |
| Free / employed driver | Profile, Verification, Refer & earn (no `subscription.read`) | — |
| Personal | Profile, Verification, Billing, Refer & earn | — (personal seat) |
| Fleet owner | Profile, Verification, Billing, Refer & earn | Business documents, Payouts |
| Mobility provider | Profile, Verification, Billing, Refer & earn | Business documents, Payouts |
| Supplier | Profile, Verification, Billing, Refer & earn | Business documents, Payouts |
| Salesperson | Profile, Verification (Refer & earn hidden — uses GODID link) | — |

Plan tier is not an input to referral visibility.

## H. Responsive

- The avatar menu is in the header at every breakpoint, so the account area is
  reachable on phone, tablet and desktop without the drawer.
- Menu content is capped at Radix's measured available height and scrolls, with
  8px collision padding — Sign out stays reachable on short screens.
- Sidebar collapse, mobile drawer and bottom tab bar are unchanged; the drawer is
  shorter now the account block is gone.
- Referral page: code box and actions stack on mobile, stats go 1 → 3 columns,
  the history table hides "Qualified on" on mobile.

## I. Accessibility

- Menu items are real `<a>` links (Radix `asChild`) with `menuitem` semantics;
  arrow keys, type-ahead and Escape come from Radix.
- Each group is a labelled `role="group"`; icons are `aria-hidden`.
- Trigger keeps its translated `aria-label`; the code copy button has its own label.
- New labels are translated in all 18 catalogues (enforced by the i18n tests).

---

## Refer & Earn — implementation

**Flow.** User opens Referral Center → a `SAARTHI-XXXXXX` code is issued (once) →
link is `/register?ref=CODE` (the registration form already carries `?ref=`) →
registration records a `UserReferral` (SIGNED_UP) → the organization's first
successful **subscription** payment marks it QUALIFIED, storing the payment
reference and pre-GST amount.

**Fully automatic — decided by the business owner.** Code issue, signup
recording and qualification involve no admin approval at any step. When the
reward rule is supplied, it is to be applied automatically on qualification as
well, not routed through an approval queue.

**Separation from salesman/GODID.** Separate tables (`referral_program_codes`,
`user_referrals`), separate status enum, separate audit prefix
(`referral_program.*`). At registration a `SAARTHI-` code is handled by the
program and never tried as a GODID; anything else goes to the salesman channel
unchanged. No commission rows are created.

**Commission.** Not implemented, by design. No amount or percentage exists in
code. `REFERRAL_REWARD_SUMMARY` (optional env) sets the published wording; unset,
the page says rewards are announced separately. Stored qualifying amounts let a
rule agreed later be applied retroactively.

| Requirement (§26) | Status |
|---|---|
| Authenticated entry point, no homepage promotion | Done |
| Code display, copy code, copy link, share (Web Share → WhatsApp fallback) | Done |
| History with status and dates | Done |
| Stats: Referrals / Qualified / Pending | Done |
| No hardcoded reward | Done |
| Loading / error / empty states | Done |
| Eligibility handling (salesperson explained, API 403) | Done |

### Files

- Shared: `domain/referral-program.ts` (+ test), `UserReferralStatus` in `domain/enums.ts`.
- API: `modules/referral-program/*`, migration `20260925090000_referral_program`,
  hooks in `auth/auth.service.ts` and `modules/sales/qualification.ts`,
  config `REFERRAL_REWARD_SUMMARY`, audit actions, `tests/referral-program.test.ts`.
- Web: `app/navigation.ts`, `layouts/account-menu.tsx`, `layouts/use-nav-visibility.ts`,
  `layouts/app-shell.tsx`, `pages/referrals/referral-center.tsx`, route in `app/router.tsx`,
  `FormWizard.initialStepId`, profile `?step=` support, translations, tests.

---

## Open business decisions

1. **Reward rule** — amount/percentage, payout method, and whether it applies to
   already-qualified referrals.
2. **Salesperson eligibility** — currently excluded from Refer & Earn (one line:
   `REFERRAL_PROGRAM_EXCLUDED_ROLES`).
3. **Both channels on one customer** — a customer referred by a user can later
   also be attributed to a salesperson by a physical sale. Both are recorded
   today; decide whether one should block the other before rewards are paid.
4. **Qualifying event** — currently the first successful subscription payment
   only (trackers and top-ups do not qualify).
5. **Notification to the referrer** on qualification — not built (needs a new
   notification type).
