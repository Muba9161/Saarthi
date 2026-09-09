# SAARTHI VEHICLE DETAIL PAGE — UI/UX REDESIGN PROMPT

## Objective

Redesign the **existing VorldX Saarthi Vehicle Detail Page** using the first provided screenshot as the visual inspiration and the second screenshot/current implementation as the functional source of truth.

This is a **UI/UX redesign, not a feature rebuild**.

The result should feel:

- Modern
- Premium
- Clean
- Spacious
- Minimal
- Professional
- Data-rich without feeling cluttered
- Visually balanced
- Clearly Saarthi

**Do not remove, disable, hide permanently, replace, or break existing functionality.**

---

## 1. Mandatory Inspection Before Coding

Before changing anything:

1. Read `CLAUDE.md`.
2. Read all relevant Markdown documentation.
3. Inspect the current vehicle-detail route/page.
4. Inspect every component used by the page.
5. Inspect API calls and data models/types.
6. Inspect all existing actions.
7. Inspect RBAC/permissions.
8. Inspect all existing vehicle-detail tabs.
9. Inspect dialogs/modals/drawers.
10. Inspect loading/error/empty states.
11. Inspect existing design-system components.
12. Inspect existing responsive behavior.

Create an inventory of all current functionality before redesigning it.

Classify each item as:

- KEEP FUNCTIONALLY
- REDESIGN VISUALLY
- MOVE
- COMBINE VISUALLY
- PUT IN ACTION MENU IF APPROPRIATE
- DO NOT TOUCH

Do not rebuild existing business logic.

---

## 2. Visual Direction

Use the **first screenshot only as visual inspiration**.

Take inspiration from:

- Large vehicle hero image
- Clean light background
- Rounded cards
- Subtle borders and shadows
- Strong typography hierarchy
- Compact status badges
- Contextual quick actions
- Balanced columns
- Generous whitespace
- Premium SaaS/dashboard aesthetic
- Clean tab navigation
- Clear information cards

Do **not** copy:

- Volvo branding
- Volvo text
- Exact vehicle
- Exact content
- Exact colors
- Exact layout
- Rental/buy/sell business logic

The result must look like **VorldX Saarthi**, not a copy of the reference.

---

## 3. Existing Saarthi Functionality Is the Source of Truth

The current Vehicle Detail Page must remain functionally complete.

Preserve every existing capability, including applicable:

- Verify
- Assign Driver
- Vehicle QR Code
- Documents
- Registration
- Trips
- Maintenance
- Loan & Finance
- FASTag
- Hardware
- Cameras
- Driver History
- Location/map
- AI Assistant
- Existing edit actions
- Existing delete actions
- Existing dialogs/modals
- Existing API interactions

Do not assume a visually secondary feature is unimportant.

If an existing feature moves to another location, it must remain easily accessible.

---

## 4. Page Structure

Redesign the page around this general hierarchy:

```text
Global Saarthi Header / Sidebar
              ↓
Vehicle Detail Header
              ↓
Large Vehicle Hero
              ↓
Primary Actions + Secondary Actions / AI Assistant
              ↓
Key Vehicle Metrics
              ↓
Location + Usage + Operational Information
              ↓
Existing Overview Content
              ↓
All Existing Vehicle Tabs
              ↓
Existing Tab Content
```

Adapt this structure to the existing application where necessary.

---

## 5. Vehicle Detail Header

Create a clean, premium header.

Display prominently:

### Vehicle identity

- Vehicle registration number
- Vehicle type
- Make
- Model
- Year
- Other important existing identity information

Example:

```text
UP-78-JT-8612
Tata Prima · 2018 · Bus
```

### Status

Use compact badges for actual states such as:

- Available
- Active
- Pending
- Maintenance
- Offline
- Other existing states

Do not invent states.

### Actions

Preserve important current actions such as:

- Verify
- Assign Driver

Use:

- Primary button for the most important action
- Secondary button for supporting action
- Compact action menu for less frequent actions where appropriate

Do not make important functionality difficult to discover.

Respect existing permissions.

---

## 6. Hero Vehicle Section

Make the vehicle image a major visual element, similar in visual importance to the first reference.

Requirements:

- Large vehicle image
- Clean background
- Generous whitespace
- Rounded container
- Subtle shadow/reflection if appropriate
- Correct aspect ratio
- Responsive
- No distortion
- No unnecessary decoration

Use the existing vehicle image/data source.

Do not create a second image/media system.

The displayed vehicle should correspond to the actual vehicle type.

For example:

- Bus → bus
- Truck → truck
- Tipper → tipper
- SUV → SUV
- Car → car

If the image is unavailable, use the existing fallback or a polished empty state.

Never fabricate an incorrect vehicle image.

---

## 7. Quick Actions

Preserve existing vehicle actions.

Possible actions include:

- Verify
- Assign Driver
- QR Code
- Documents
- Registration
- Cameras
- Hardware
- Maintenance
- Other existing actions

Use compact, visually clear controls.

Example:

```text
[ Verify ] [ Assign Driver ] [ More ... ]
```

or a clean action-card layout.

Do not remove functionality just to make the page cleaner.

If an action is placed in an overflow menu, ensure it remains easy to access.

---

## 8. AI Assistant

If the existing Saarthi Vehicle Detail Page already has AI/Gemini functionality, preserve and visually integrate it.

Use a contextual assistant card inspired by the first reference.

Example:

```text
AI Assistant
How can I help with this vehicle?

[ Analysis ]
[ Maintenance ]
[ Documents ]
[ Vehicle Summary ]
```

Only expose actions supported by existing Saarthi functionality.

Do not create fake AI capabilities.

Do not create a second AI architecture.

Gemini/AI must continue using the existing backend/provider abstraction.

Do not give Gemini direct database access.

If no AI capability exists for a suggested action, do not add a fake button.

---

## 9. Key Metrics

The current page contains important information such as:

- Seats
- Odometer
- Lifetime Revenue
- Running Cost

These must remain available.

Redesign them into clean cards.

Example:

```text
┌──────────────┐
│ Seats        │
│ 40           │
│ Non AC       │
└──────────────┘

┌──────────────┐
│ Odometer     │
│ 5,00,000 km  │
└──────────────┘

┌──────────────┐
│ Revenue      │
│ ₹0           │
└──────────────┘

┌──────────────┐
│ Running Cost │
│ —            │
└──────────────┘
```

Use the actual current data.

Never invent values.

If unavailable, display:

- `—`
- `No data`
- `Not available`

as appropriate.

---

## 10. Location Card

Create a clean location card if location functionality exists.

Example:

```text
┌──────────────────────────────────────┐
│ Location                  View map ↗ │
│                                      │
│ Current / last known location        │
│                                      │
│             MAP PREVIEW              │
│                                      │
│ Last updated: ...                    │
└──────────────────────────────────────┘
```

Reuse the existing map provider/component.

Do not create a second map system.

Preserve existing map interactions.

Do not fabricate location data.

---

## 11. Usage Card

Use existing usage information.

Possible values:

- Lifetime distance
- Monthly distance
- Odometer
- Trip count
- Utilization
- Usage duration

Only display metrics that actually exist.

Example:

```text
Usage
Since 20 Jul 2024

5,00,000 km       10,250 km
Total distance    This month
```

Use the application's existing number-formatting conventions.

---

## 12. Operational Information Card

Use existing operational information.

Possible fields:

- Fuel level
- Running cost
- Maintenance state
- Operational status
- Connectivity
- Hardware/telematics status
- Other existing vehicle metrics

Do not assume every vehicle has every field.

Different vehicle types may have different available information.

Do not fabricate missing metrics.

---

## 13. Tabs

Preserve **ALL existing Vehicle Detail tabs**.

Known current tabs include:

- Overview
- Documents
- QR Code
- Registration
- Trips
- Maintenance
- Loan & Finance
- FASTag
- Hardware
- Cameras
- Driver History

Use the repository as the authoritative source if the actual list differs.

Do not delete tabs.

Do not break their routing or state.

Redesign the tab bar to be:

- Compact
- Premium
- Clear
- Horizontally scrollable when required
- Responsive
- Keyboard accessible
- Sticky where appropriate

Example:

```text
[ Overview ] Documents QR Code Registration Trips
Maintenance Loan & Finance FASTag Hardware Cameras Driver History
```

The active tab must be immediately obvious.

---

## 14. Overview Tab

Make Overview the premium vehicle workspace.

Suggested hierarchy:

```text
Vehicle Header
       ↓
Large Vehicle Hero
       ↓
Quick Actions / AI Assistant
       ↓
Key Metrics
       ↓
Location + Usage + Operational Info
       ↓
Existing Overview Content
```

Only use sections supported by the existing application.

Do not invent business logic.

---

## 15. Responsive Design

Support:

- Desktop
- Laptop
- Tablet
- Smaller browser widths

Desktop should prioritize the premium wide layout.

At smaller widths:

- Stack hero sections intelligently
- Stack information cards
- Collapse secondary actions appropriately
- Allow tab scrolling
- Keep primary actions accessible
- Prevent horizontal page overflow
- Keep vehicle image prominent

Do not ruin the desktop layout simply to make it responsive.

---

## 16. Design System

Reuse the existing Saarthi design system.

Inspect and reuse:

- Colors
- Typography
- Buttons
- Badges
- Cards
- Icons
- Spacing
- Modals
- Dropdowns
- Tooltips
- Form components

If Tailwind is already used, use the existing Tailwind configuration/tokens.

Do not introduce a new CSS framework.

Do not create a second design system.

---

## 17. Visual Style

Target:

- Premium
- Modern
- Minimal
- Clean
- Calm
- Professional

Use:

- Generous whitespace
- Rounded cards
- Subtle borders
- Soft shadows
- Strong typography hierarchy
- Muted secondary text
- Strong primary values
- Restrained accent colors
- Consistent iconography

Avoid:

- Excessive gradients
- Excessive glassmorphism
- Giant buttons
- Heavy shadows
- Excessive colors
- Dense layouts
- Tiny text
- Unnecessary animations
- Decorative clutter

---

## 18. Loading States

Preserve/improve existing loading states.

Use skeletons where appropriate for:

- Vehicle image
- Vehicle metadata
- Metrics
- Location
- Usage
- Operational information
- Tab content

Do not make the page jump dramatically while loading.

Reuse existing loading components.

---

## 19. Error States

Preserve existing error handling.

A failure in one section should not crash the entire page.

Example:

```text
Unable to load vehicle location
[ Retry ]
```

Do not hide API failures behind fake values.

---

## 20. Empty States

Create polished empty states for missing information.

Examples:

```text
No vehicle image
Add a vehicle image to personalize this vehicle.
[ Upload Image ]
```

```text
No trips yet
Trips associated with this vehicle will appear here.
```

```text
No hardware connected
Connect a supported device to see live vehicle data.
```

Only show actions that actually exist.

---

## 21. Permissions / RBAC

This is critical.

Preserve all existing permission checks.

A user who cannot currently:

- Verify
- Assign Driver
- Edit
- Delete
- Access Finance
- Access Documents
- Access Hardware
- Access Cameras
- etc.

must not gain access because of the redesign.

Reuse existing RBAC logic.

Do not create a second permission system.

Backend authorization remains authoritative.

---

## 22. Routing

Do not break:

- Existing vehicle-detail URL
- Deep links
- Tab navigation
- Browser refresh
- Back navigation
- Existing query/state behavior

Existing links to the Vehicle Detail page must continue working.

---

## 23. API Rules

This should primarily be a frontend redesign.

Reuse existing APIs.

Do not create new backend endpoints simply to support the new visual layout.

Reuse existing:

- Vehicle APIs
- Location APIs
- Trip APIs
- Maintenance APIs
- Document APIs
- Driver APIs
- Hardware APIs
- Camera APIs
- Finance APIs
- FASTag APIs
- AI APIs

If a missing capability genuinely requires backend work:

1. Search for an existing endpoint first.
2. Reuse it if possible.
3. Add the minimum required change only if necessary.
4. Preserve authentication.
5. Preserve RBAC.
6. Follow existing architecture.

Do not duplicate services.

---

## 24. Data Integrity

The redesign must never fabricate information.

Do not create fake:

- Revenue
- Running cost
- Fuel level
- Odometer
- Location
- Trips
- Maintenance
- Hardware status
- Driver information
- Vehicle information

If data is unavailable, show an intentional unavailable state.

---

## 25. Interaction Quality

Use subtle interaction states:

- Hover
- Active
- Focus
- Press
- Tab selection
- Modal transitions

Avoid excessive animation.

The page should feel fast and responsive.

---

## 26. Accessibility

Maintain:

- Keyboard navigation
- Visible focus states
- Semantic buttons
- Accessible labels
- Sufficient contrast
- Accessible tabs
- Accessible dialogs
- Screen-reader-friendly status labels

Do not rely only on color to communicate status.

Do not make icon-only buttons inaccessible.

---

## 27. Performance

Do not make the Vehicle Detail page slower.

Avoid:

- Duplicate API requests
- Duplicate vehicle fetching
- Repeated map initialization
- Repeated image downloads
- Unnecessary re-renders
- Large new dependencies

Reuse existing:

- caching
- query/state management
- hooks
- data providers

Lazy-load heavy secondary tab content if compatible with the existing architecture.

---

## 28. Implementation Strategy

Do NOT rewrite the page blindly.

Follow:

### Phase 1 — Audit

Understand every current component and feature.

### Phase 2 — Wireframe

Map existing functionality into the new hierarchy.

### Phase 3 — Component Redesign

Reuse existing components where possible.

A possible structure:

```text
VehicleDetailPage
│
├── VehicleDetailHeader
│   ├── BackButton
│   ├── VehicleIdentity
│   ├── StatusBadges
│   └── VehicleActions
│
├── VehicleHero
│   ├── VehicleImage
│   ├── QuickActions
│   └── AIAssistant
│
├── VehicleMetrics
│   ├── SeatsCard
│   ├── OdometerCard
│   ├── RevenueCard
│   └── RunningCostCard
│
├── VehicleInsights
│   ├── LocationCard
│   ├── UsageCard
│   └── OperationalInfoCard
│
├── VehicleTabs
│
└── ExistingDialogs / Modals
```

Only create components where it improves maintainability.

Do not over-componentize.

### Phase 4 — Functional Wiring

Connect redesigned UI to existing:

- Hooks
- APIs
- State
- Permissions
- Mutations
- Dialogs
- Routes

### Phase 5 — Regression Testing

Verify all existing functionality.

### Phase 6 — Responsive QA

Test multiple viewport sizes.

### Phase 7 — Visual Polish

Fix:

- Spacing
- Typography
- Alignment
- Overflow
- Loading states
- Empty states
- Accessibility
- Visual consistency

---

## 29. Functional Regression Checklist

Before declaring complete, verify every applicable existing action:

- [ ] Verify
- [ ] Assign Driver
- [ ] QR Code
- [ ] Documents
- [ ] Registration
- [ ] Trips
- [ ] Maintenance
- [ ] Loan & Finance
- [ ] FASTag
- [ ] Hardware
- [ ] Cameras
- [ ] Driver History
- [ ] Location
- [ ] Map
- [ ] AI Assistant
- [ ] Existing edit flows
- [ ] Existing delete flows
- [ ] Existing dialogs/modals
- [ ] Existing permission restrictions

Use the repository's actual functionality inventory as the final authority.

---

## 30. Acceptance Criteria

The redesign is successful when:

- Vehicle Detail looks substantially more modern.
- It has the premium visual quality of the first reference.
- It remains unmistakably Saarthi.
- Vehicle identity is easier to understand.
- Vehicle imagery has stronger visual prominence.
- Primary actions are easier to discover.
- Information hierarchy is significantly clearer.
- Metrics are easier to scan.
- Location/usage/operational information is better organized.
- All existing tabs remain functional.
- All existing actions remain functional.
- Existing APIs remain the source of truth.
- Existing RBAC remains intact.
- No fabricated data is introduced.
- Loading/error/empty states work.
- Responsive behavior works.
- Existing routes remain intact.
- Existing dialogs/modals remain intact.
- No duplicate backend systems are created.
- No unrelated business features are introduced.

---

## 31. Final Report

After implementation, provide:

### Files Changed
List every created/modified file.

### Existing Functionality Preserved
List what was reused.

### New UI Components
List newly created components.

### API Changes
Explicitly state:

- No API changes

OR

- Exact API changes and why they were necessary.

### Tabs
Confirm all existing Vehicle Detail tabs remain functional.

### Permissions
Confirm existing RBAC/permission behavior is preserved.

### Responsive QA
Report the viewport sizes tested.

### Tests
Report tests run and results.

### Build
Report:

- lint
- typecheck
- build

results.

### Regression
Report which existing Vehicle Detail actions were checked.

### Known Limitations
List anything that could not be verified.

---

# FINAL INSTRUCTION

**Do not sacrifice functionality for aesthetics.**

The current Saarthi Vehicle Detail Page is the functional source of truth.

The first screenshot is the visual inspiration.

The target is:

```text
CURRENT SAARTHI FUNCTIONALITY
            +
REFERENCE 1 VISUAL QUALITY
            +
SAARTHI BRANDING
            +
SAARTHI DATA
            =
PREMIUM SAARTHI VEHICLE DETAIL EXPERIENCE
```

Do not turn this into a different product.

Do not copy the reference literally.

Do not invent data.

Do not remove functionality.

Do not create duplicate systems.

Redesign the existing Saarthi Vehicle Detail Page, not the entire application.
