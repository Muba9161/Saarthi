# SAARTHI — PROFILE & NAVIGATION CLEANUP + REFERRAL UI AUDIT

## Purpose

This document is an **audit and implementation specification for Claude Code**.

Claude must inspect the existing Saarthi project and determine how the current navigation, especially the **Profile area**, can be reorganized into a cleaner, more professional, less cluttered information architecture.

The project already contains many modules and role-specific workflows. The goal is **not to remove functionality**. The goal is to place functionality in the most logical locations so the primary navigation remains clean.

A new generic **Referral / Refer & Earn** feature must also be integrated into this structure.

> **First audit the current project. Do not blindly redesign or create duplicate navigation systems.**

---

# 1. Core UI Principle

Saarthi should have a clean, premium and uncluttered navigation system.

The primary navigation should prioritize the user's **main operational workflows**.

Secondary, personal, account-management, preference, support, and informational functions should be considered for placement under:

```text
Profile / Account
```

The Profile area should become a properly organized secondary navigation hub rather than an unstructured collection of links.

---

# 2. Referral UI Requirement

Saarthi is introducing a generic referral system.

Any eligible Saarthi user can have a referral code and share it with another person.

Conceptually:

```text
Existing Saarthi User
        ↓
Referral Code / Link
        ↓
New User
        ↓
Referral Attribution
        ↓
Qualifying Subscription
        ↓
Commission
```

The commission amount/rule is **not finalized yet**.

Therefore:

- Do not hardcode a commission amount.
- Do not advertise a specific percentage.
- Do not display a fixed earnings promise.
- Make commission rules configurable.
- Referral attribution and commission architecture can be prepared now.
- Final commission calculation can be configured later.

---

# 3. Referral UI Placement

Referral must **not** be presented as a major public-homepage feature.

Do not add:

- Large homepage referral banners
- Homepage popup
- Primary homepage CTA
- Hero-section referral promotion
- Large referral card that competes with the main product CTA

The preferred entry point is inside the authenticated product.

Recommended structure:

```text
Profile
   ↓
Refer & Earn / Referral Center
```

Possible naming:

```text
Refer & Earn
Referral Center
Referrals & Rewards
```

Use the terminology already established by the existing Saarthi UI/design system where appropriate.

The referral feature should be easy to discover for existing users but should not visually dominate the product.

---

# 4. Recommended Referral Page

The dedicated referral page should be clean and spacious.

Concept:

```text
┌─────────────────────────────────────────────────┐
│                                                 │
│  Refer & Earn                                   │
│  Share Saarthi with your network.               │
│  Earn rewards when referrals qualify.            │
│                                                 │
│  Your Referral Code                             │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ SARTHI-A7K92P                     Copy    │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│       [ Copy Link ]      [ Share ]              │
│                                                 │
│  ─────────────────────────────────────────────  │
│                                                 │
│  Referrals      Qualified      Pending          │
│      12              7            --             │
│                                                 │
│  Referral History                               │
│  ─────────────────────────────────────────────  │
│  User / Date / Status                            │
│                                                 │
└─────────────────────────────────────────────────┘
```

Do not invent commission values before the commercial rule is decided.

Use neutral wording such as:

> **Refer Saarthi and earn rewards when your referrals qualify.**

---

# 5. Profile Navigation Audit

Claude must inspect the **entire current navigation system** and specifically identify which existing navigation items should logically move under Profile/Account.

Do not assume everything that is not operational belongs under Profile.

Classify every navigation item into:

### A. Primary Operational Navigation

Core daily workflows.

Examples may include:

- Dashboard
- Vehicles
- Trips
- Orders
- Drivers
- Supplier operations
- Marketplace
- Relevant operational modules

These generally remain in primary navigation.

### B. Account / Profile Navigation

Items that primarily manage the user's account, identity, preferences, billing, security, or personal relationship with Saarthi.

Potential candidates:

- Profile
- Account details
- Personal information
- Security
- Password
- Login/security settings
- Verification/profile identity
- Billing
- Subscription
- Payment history
- Referral & Rewards
- Notifications/preferences
- Settings
- Help/support
- Legal/policies

Do NOT move an item merely because it is small. Determine its function.

### C. Resource / Operational Navigation

Items that belong to a user's business/resource management but are still operational.

Examples may include:

- Vehicles
- Drivers
- Documents
- Maintenance
- Hardware
- Cameras
- Trips
- Orders
- Fleet operations

These normally should **not** be buried under Profile simply to reduce menu length.

---

# 6. Do Not Put Operational Features Under Profile

Avoid structures like:

```text
Profile
 ├── Vehicles
 ├── Orders
 ├── Trips
 ├── Drivers
 ├── Fleet
 ├── Marketplace
 └── Telemetry
```

merely because the primary sidebar is crowded.

Profile is not a storage location for unrelated features.

Use Profile for things that are actually about:

```text
The User
The Account
Preferences
Security
Billing
Rewards
Support
```

Operational resources should remain discoverable in primary/secondary operational navigation.

---

# 7. Profile Information Architecture

Claude should inspect the current project and propose a clean structure such as:

```text
Profile / Account
│
├── My Profile
├── Verification / Identity
├── Billing & Subscription
├── Refer & Earn
├── Notifications
├── Security
├── Settings
└── Help & Support
```

This is a **candidate structure**, not an instruction to blindly create all these pages.

Only include items that already exist or are genuinely required by the existing product.

Avoid duplicate pages.

---

# 8. Billing Placement

Billing is a strong candidate for Profile/Account.

Review whether the current product has:

- Current Plan
- Subscription
- Trial status
- Renewal date
- Payment history
- Invoices
- Additional vehicle charges
- Tracker purchases
- Billing details

If these currently appear as scattered primary-navigation entries, determine whether they can be consolidated under:

```text
Profile
  → Billing & Subscription
```

Do not remove functionality.

Do not create duplicate billing pages.

---

# 9. Security Placement

Review existing:

- Password
- Sessions
- Login history
- Quick Login
- PIN
- Biometric settings
- Device/session management
- Security preferences

These should generally be candidates for:

```text
Profile
  → Security
```

However, preserve any existing high-priority security actions where they are currently required by the application.

---

# 10. Verification Placement

Review identity/account verification.

Potential structure:

```text
Profile
  → Verification / Identity
```

But distinguish between:

- Personal account verification
- Driver verification
- Business verification
- Supplier verification
- Vehicle/document verification

Do NOT combine different verification subjects into one confusing workflow.

The existing backend/RBAC and verification architecture remain authoritative.

---

# 11. Notifications

If notification preferences or notification management currently occupy primary navigation unnecessarily, consider:

```text
Profile
  → Notifications
```

However, live operational alerts may still need to remain globally accessible through the header/notification center.

Do not hide critical operational alerts merely to simplify navigation.

---

# 12. Settings

Review the current settings structure.

Determine whether settings are:

- Global account settings
- Role/business settings
- Vehicle settings
- Notification settings
- Security settings
- Application preferences

Only genuinely account-level/application-level settings should move under Profile.

Vehicle-specific settings should remain associated with the vehicle.

Business operational settings should remain associated with the business/workflow where appropriate.

---

# 13. Help & Support

If existing support items are currently occupying primary navigation and are not core operational features, consider:

```text
Profile
  → Help & Support
```

Do not move emergency/SOS functionality into Profile.

SOS and safety-related functionality must remain immediately accessible where the current product requires it.

---

# 14. Referral vs Salesman/GODID

The new generic referral system must remain conceptually separate from the specialized salesman/GODID system.

Generic referral:

```text
Saarthi User
 ↓
Referral Code
 ↓
New User
 ↓
Commission
```

Salesman/GODID:

```text
GODID
 ↓
Salesman
 ↓
Customer
 ↓
Subscription
 ↓
Sales Commission
```

Do not merge the UI into one confusing feature.

A common underlying commission engine may be possible, but the attribution sources must remain distinguishable.

For example:

```text
Referral Source
├── GENERIC_REFERRAL
└── SALESMAN_GODID
```

The current GODWeb project must not be modified.

---

# 15. Navigation Should Be Role-Aware

Navigation should be based on:

```text
Account Type
+
RBAC
+
Actual Resources
+
Current Workflow
```

It should NOT simply be:

```text
Plan
```

For example:

### Personal with no vehicle

Do not show meaningless vehicle telemetry content just because the account is paid.

### Personal with a vehicle

Vehicle-related navigation becomes relevant.

### Fleet Owner

Fleet/truck/driver/telemetry-related operational navigation is relevant.

### Mobility Provider

Mobility/tour/travel/vehicle navigation is relevant.

### Supplier

Material/order/supplier functionality is relevant.

### Driver

Driver-specific operational navigation is relevant.

---

# 16. Plan Does Not Control Referral Visibility

Referral should not be implemented as:

```text
Business → Refer
Personal → No Refer
```

unless a future business rule explicitly changes this.

The generic referral system should be treated separately from plan-based billing.

If eligibility is restricted in the future, make that an explicit business rule rather than deriving it from Plan accidentally.

---

# 17. Profile Menu UX

Inspect the existing Profile dropdown/menu.

The goal should be a compact, logical menu rather than a long unstructured list.

Example:

```text
┌────────────────────────────┐
│ Account                    │
│ My Profile                 │
│ Verification               │
│ Billing & Subscription     │
│ Refer & Earn               │
├────────────────────────────┤
│ Preferences                │
│ Notifications              │
│ Settings                   │
├────────────────────────────┤
│ Security                   │
│ Help & Support             │
├────────────────────────────┤
│ Sign Out                   │
└────────────────────────────┘
```

This is an example only.

Claude must first inspect the actual project and preserve its established design language.

---

# 18. Responsive Navigation

Audit navigation on:

- Desktop
- Laptop
- Tablet
- Mobile

Ensure the reorganized Profile menu is usable at all breakpoints.

Check:

- Sidebar collapse
- Mobile bottom navigation if present
- Header/profile menu
- Dropdown overflow
- Touch targets
- Long labels
- Nested menus
- Keyboard accessibility

Do not introduce a second competing navigation system.

---

# 19. Visual Design Requirements

The Profile and Referral experience should follow the existing Saarthi design system.

Desired qualities:

- Clean
- Premium
- Spacious
- Consistent
- Responsive
- Professional
- Minimal clutter
- Clear hierarchy
- Strong typography
- Consistent iconography
- Good empty states
- Good loading states
- Good error states

Do not overload the dashboard with referral promotions.

Avoid excessive cards, banners, badges, or decorative elements.

---

# 20. Full Existing Navigation Audit

Claude must inventory every navigation location:

- Desktop sidebar
- Header
- Profile dropdown
- Mobile navigation
- Mobile drawer
- Dashboard shortcuts
- Secondary tabs
- Context menus
- Settings navigation
- Breadcrumbs

For every navigation item record:

| Current Item | Current Location | Purpose | Role(s) | Resource Dependency | Recommended Location | Reason |
|---|---|---|---|---|---|---|

Do not move an item without understanding its purpose.

---

# 21. Identify Candidates for Profile

For each current navigation item ask:

1. Is this primarily about the user's account?
2. Is it primarily about billing/subscription?
3. Is it primarily about security?
4. Is it primarily a preference?
5. Is it primarily a reward/referral relationship?
6. Is it support/legal/informational?
7. Is it an operational resource?
8. Is it a daily business workflow?
9. Does it depend on a vehicle?
10. Does it depend on a specific Account Type?

Items answering mostly 1–6 are candidates for Profile.

Items answering mostly 7–10 should generally remain in operational navigation.

---

# 22. Detect Navigation Duplicates

Search for duplicate routes/components/menu definitions.

Look for cases where the same feature appears in:

- Sidebar
- Header
- Profile
- Dashboard
- Settings

without a clear reason.

Do not remove duplicates automatically.

Determine whether each duplicate is:

- intentional shortcut
- context action
- true duplicate
- legacy navigation

---

# 23. Preserve Existing Functionality

Do NOT:

- Delete features
- Delete routes
- Delete APIs
- Rename APIs unnecessarily
- Rebuild pages
- Create duplicate pages
- Break deep links
- Break bookmarks
- Break role navigation
- Change backend behavior unnecessarily

Navigation changes should primarily be an information-architecture/UI improvement.

If route changes are necessary, preserve compatibility where possible.

---

# 24. Full Project Inspection

Before implementation:

1. Read `CLAUDE.md`.
2. Read relevant project specification files.
3. Inspect repository structure.
4. Inspect frontend routing.
5. Inspect navigation components.
6. Inspect sidebar.
7. Inspect header/profile menu.
8. Inspect mobile navigation.
9. Inspect role-aware navigation.
10. Inspect RBAC.
11. Inspect account types.
12. Inspect plan logic.
13. Inspect billing/subscription pages.
14. Inspect verification pages.
15. Inspect settings/security.
16. Inspect referral-related existing code if any.
17. Inspect salesman/GODID functionality.
18. Inspect tests.

Do not modify anything during the audit.

---

# 25. Required Audit Report

Claude must produce:

## A. Current Navigation Map

Show the existing structure.

## B. Profile Audit

Show what currently exists under Profile and what is poorly organized.

## C. Candidate Items to Move

List which current navigation items could move under Profile and why.

## D. Items That Must Stay Operational

List items that should not be buried under Profile.

## E. Duplicate/Legacy Navigation

Identify duplicate or obsolete navigation.

## F. Referral Placement

Show exactly where the generic Referral Center should appear.

## G. Role-Aware Navigation

Verify navigation behavior for:

- Free Customer
- Free Driver
- Personal
- Fleet Owner
- Mobility Provider
- Supplier

## H. Responsive Audit

Verify desktop/mobile/tablet behavior.

## I. Accessibility Audit

Check keyboard navigation, focus, labels, touch targets and semantic structure.

## J. Implementation Recommendations

Only recommend changes necessary to create a clean and consistent navigation structure.

---

# 26. Required Referral Audit

Verify:

- Referral entry point exists in a clean authenticated location
- No oversized homepage referral promotion
- Referral code display
- Copy code
- Copy referral link
- Share action
- Referral history
- Referral status
- Commission status without hardcoded future amounts
- Responsive layout
- Empty states
- Loading states
- Error states
- Permission/eligibility handling

Do not implement commission rules until they are supplied.

---

# 27. Final Navigation Principle

Use this hierarchy:

```text
PRIMARY NAVIGATION
→ Core operational workflows

PROFILE / ACCOUNT
→ User, account, billing, security, preferences, rewards, support

RESOURCE CONTEXT
→ Vehicle, driver, documents, tracker, telemetry, maintenance, etc.

ROLE CONTEXT
→ Fleet Owner / Mobility Provider / Supplier / Customer / Driver workflows
```

Do not use Profile as a dumping ground.

Do not use Plan as a shortcut for Account Type.

Do not use the homepage as a dumping ground for secondary features.

The final navigation should make the product feel:

**simple on first view, powerful when needed.**

---

# 28. Implementation Rule

After completing the audit, Claude must wait for explicit authorization before making changes.

When authorized:

- Reuse existing components.
- Reuse existing routes where practical.
- Preserve existing functionality.
- Preserve RBAC.
- Preserve role-aware navigation.
- Avoid duplicate pages.
- Avoid duplicate navigation definitions.
- Follow the existing design system.
- Keep Referral modular.
- Keep commission rules configurable.
- Do not modify GODWeb.
- Do not introduce unrelated refactors.

## Final Acceptance Criteria

The implementation is acceptable only when:

1. Primary navigation is visibly cleaner.
2. Profile has a logical, grouped menu.
3. Referral is discoverable but not intrusive.
4. Operational features remain easy to access.
5. Account-level features are consolidated appropriately.
6. Plan and Account Type remain independent.
7. Role-aware navigation still works.
8. Vehicle-dependent navigation remains resource-aware.
9. No existing feature is accidentally removed.
10. No duplicate navigation system is introduced.
11. Mobile and desktop navigation remain usable.
12. Referral UI does not advertise an undefined commission amount.
