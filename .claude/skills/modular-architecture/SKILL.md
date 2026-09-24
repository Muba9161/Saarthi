# MODULAR ARCHITECTURE & PROJECT ORGANIZATION SKILL

## PURPOSE

This is a **mandatory architecture skill** for the entire project.

Claude MUST follow these architectural rules whenever it:

* Creates a file
* Creates a module
* Creates a feature
* Adds functionality
* Modifies existing functionality
* Refactors code
* Moves code
* Creates components
* Creates services
* Creates hooks
* Creates APIs
* Creates database logic
* Creates integrations
* Creates utilities
* Creates business logic

The objective is to keep the project:

* Modular
* Organized
* Scalable
* Maintainable
* Easy to navigate
* Easy to test
* Easy to optimize
* Easy for multiple developers/AI agents to understand

---

# 1. CORE ARCHITECTURAL PRINCIPLE

> **Organize the project around responsibilities and features, not around large files.**

A module should have a clear responsibility.

Avoid creating large files that contain unrelated functionality.

Prefer:

```text
Feature
├── UI
├── Logic
├── API
├── Types
├── Validation
├── Services
└── Utilities
```

where appropriate.

---

# 2. MODULAR-FIRST APPROACH

Claude MUST think modularly before writing significant code.

Before adding code, ask:

```text
What responsibility does this code belong to?

Does that responsibility already have a module?

Should this functionality be part of an existing feature?

Would this create an oversized file?

Can this be isolated into a reusable module?

Will this make the architecture easier or harder to understand?
```

Do not automatically put new code into the nearest existing file.

---

# 3. FILE SIZE LIMIT

## HARD GUIDELINE

No individual source-code file should normally exceed:

**800–1000 lines.**

Treat **1000 lines as the architectural upper limit**.

When a file approaches this size, Claude MUST evaluate whether it can be modularized.

If a file exceeds 1000 lines, Claude should generally refactor it into smaller logical modules unless there is a clear architectural reason why splitting it would make the system worse.

### Preferred target

Do not aim for:

```text
999 lines
```

The goal is not to stay just below the limit.

Prefer reasonably sized modules such as:

```text
100–300 lines
300–500 lines
500–700 lines
```

depending on the responsibility.

A coherent 700-line module can be better than five artificial 140-line files.

---

# 4. FILE SIZE IS NOT THE ONLY METRIC

Claude MUST NOT split files purely based on line count.

Also consider:

* Responsibility
* Complexity
* Coupling
* Number of dependencies
* Number of exports
* Number of functions
* Number of components
* Testability
* Reusability
* Domain boundaries

A file with 400 lines of highly unrelated logic may need splitting.

A file with 900 lines of one coherent generated/configuration structure may not.

Use engineering judgment.

---

# 5. WHEN A FILE EXCEEDS 800–1000 LINES

When a file becomes too large, Claude should inspect it and identify logical boundaries.

For example:

```text
Large File
│
├── Authentication Logic
├── Validation Logic
├── User Logic
├── Notification Logic
├── API Logic
└── Formatting Logic
```

Refactor into:

```text
auth/
├── authentication.service.ts
├── authentication.validation.ts
└── authentication.types.ts

users/
├── user.service.ts
├── user.validation.ts
└── user.types.ts

notifications/
├── notification.service.ts
└── notification.types.ts
```

The exact structure must follow the project's existing conventions.

---

# 6. NEVER SPLIT RANDOMLY

Bad modularization:

```text
large-file-part-1.ts
large-file-part-2.ts
large-file-part-3.ts
large-file-part-4.ts
```

This is NOT modular architecture.

Instead, split according to responsibility:

```text
vehicle/
├── vehicle.service.ts
├── vehicle.repository.ts
├── vehicle.validation.ts
├── vehicle.types.ts
├── vehicle.mapper.ts
└── vehicle.utils.ts
```

Each file should have a meaningful reason to exist.

---

# 7. FEATURE-BASED ORGANIZATION

Where practical, organize code around business domains/features.

For Saarthi, logical domains may include:

```text
drivers/
fleet/
vehicles/
customers/
suppliers/
marketplace/
orders/
bidding/
payments/
wallet/
subscriptions/
verification/
documents/
tracking/
maintenance/
loans/
sos/
maps/
telematics/
ai/
voice/
terminal/
notifications/
```

These are examples, not mandatory folder names.

Use the actual architecture already present in the project.

---

# 8. DOMAIN BOUNDARIES

Each domain should own its relevant functionality as much as practical.

For example:

```text
vehicles/
├── components/
├── hooks/
├── services/
├── types/
├── validations/
└── utils/
```

Vehicle-specific logic should not be unnecessarily scattered throughout unrelated global folders.

Similarly:

```text
tracking/
```

should contain tracking-specific logic rather than spreading tracking functionality across arbitrary files.

---

# 9. SHARED CODE

Create shared modules for genuinely shared functionality.

Examples:

```text
shared/
├── components/
├── hooks/
├── types/
├── utils/
├── validation/
└── constants/
```

But:

> **Do not put everything into `shared`.**

A shared module should only contain code that is genuinely shared.

Avoid turning:

```text
utils/
```

into a dumping ground.

---

# 10. THE "COMMON" FOLDER RULE

Do not create vague folders such as:

```text
common/
misc/
helpers/
stuff/
temporary/
```

unless the project already uses them intentionally.

Prefer specific modules.

Instead of:

```text
utils/helpers.ts
```

prefer:

```text
date/date.utils.ts
```

or:

```text
vehicle/vehicle.utils.ts
```

when appropriate.

---

# 11. COMPONENT MODULARITY

Large UI components must be decomposed when they contain multiple independent responsibilities.

For example:

```text
VehicleDashboard.tsx
```

should not become a 2000-line component containing:

```text
Header
Statistics
Map
Vehicle List
Maintenance
Documents
Trips
Alerts
Modals
Forms
```

Prefer:

```text
vehicle-dashboard/
├── VehicleDashboard.tsx
├── VehicleHeader.tsx
├── VehicleStats.tsx
├── VehicleMap.tsx
├── VehicleList.tsx
├── MaintenancePanel.tsx
├── DocumentsPanel.tsx
├── TripsPanel.tsx
├── AlertsPanel.tsx
└── hooks/
```

Only create these modules when the responsibilities genuinely exist.

---

# 12. BUSINESS LOGIC MUST NOT LIVE IN UI

Avoid putting large business workflows directly inside React components.

Bad:

```text
Component
├── UI
├── API requests
├── database transformations
├── validation
├── calculations
├── business rules
├── permissions
└── state management
```

Prefer:

```text
Component
    ↓
Hook / Controller
    ↓
Service
    ↓
API / Repository
```

The exact layers depend on the application's architecture.

---

# 13. SERVICES

Services should have focused responsibilities.

Avoid:

```text
SaarthiService.ts
```

containing:

* Vehicles
* Payments
* Drivers
* Marketplace
* Notifications
* Authentication
* Tracking

Instead, use domain-focused services where appropriate:

```text
vehicle.service.ts
driver.service.ts
payment.service.ts
tracking.service.ts
notification.service.ts
```

---

# 14. CONTROLLERS / ROUTE HANDLERS

Controllers and route handlers should remain relatively thin.

Prefer:

```text
Request
 ↓
Validation
 ↓
Authorization
 ↓
Controller / Handler
 ↓
Service
 ↓
Repository / Data Access
```

Avoid putting entire business workflows inside route handlers.

---

# 15. DATABASE / REPOSITORY MODULARITY

Database operations should be organized according to the project's existing data-access architecture.

Avoid a single massive file such as:

```text
database.service.ts
```

containing every query in the entire application.

Prefer domain-specific data access when appropriate:

```text
vehicles/
    vehicle.repository.ts

drivers/
    driver.repository.ts

orders/
    order.repository.ts
```

Do not introduce repositories solely because the pattern looks sophisticated.

Follow the project's existing architecture.

---

# 16. TYPES MUST BE ORGANIZED

Do not create one massive:

```text
types.ts
```

containing thousands of unrelated types.

Prefer domain-specific types:

```text
vehicles/
    vehicle.types.ts

drivers/
    driver.types.ts

orders/
    order.types.ts
```

Shared types should only contain genuinely shared concepts.

---

# 17. VALIDATION MUST BE MODULAR

Avoid one massive validation file containing every application's validation rule.

Prefer domain-oriented validation:

```text
vehicles/
    vehicle.validation.ts

drivers/
    driver.validation.ts

orders/
    order.validation.ts
```

Reuse shared validation where appropriate.

---

# 18. API CLIENT ORGANIZATION

Do not create one enormous API file containing every endpoint.

Avoid:

```text
api.ts
```

with hundreds of unrelated functions.

Prefer domain-specific API modules:

```text
api/
├── auth.api.ts
├── vehicles.api.ts
├── drivers.api.ts
├── orders.api.ts
├── payments.api.ts
└── tracking.api.ts
```

Follow the existing API architecture where one already exists.

---

# 19. HOOK ORGANIZATION

Avoid one massive:

```text
hooks.ts
```

containing unrelated application logic.

Prefer:

```text
hooks/
├── useAuth.ts
├── useVehicle.ts
├── useTracking.ts
├── useOrders.ts
└── useNotifications.ts
```

Or feature-local hooks:

```text
vehicles/
└── hooks/
    ├── useVehicle.ts
    └── useVehicleTracking.ts
```

Choose the structure that best fits reuse and ownership.

---

# 20. DEPENDENCY DIRECTION

Maintain predictable dependency flow.

Prefer:

```text
UI
 ↓
Feature/Application Logic
 ↓
Domain
 ↓
Infrastructure
```

Avoid uncontrolled dependencies such as:

```text
UI ↔ Database
UI ↔ Infrastructure
Utility ↔ Feature UI
Feature A ↔ Feature B ↔ Feature C ↔ Feature A
```

Avoid circular dependencies.

If two modules constantly depend on each other, reconsider their boundaries.

---

# 21. MODULE COUPLING

Modules should be as independent as reasonably possible.

A module should expose a clear public interface.

Avoid reaching deeply into another module's internal files.

Bad:

```text
featureA
→ featureB/internal/helpers/private-file
```

Prefer:

```text
featureA
→ featureB/public API
```

Internal implementation should remain internal.

---

# 22. BARREL FILES

Use barrel files carefully.

For example:

```text
index.ts
```

can be useful for public exports.

But avoid massive barrel files that:

* Export everything
* Create circular dependencies
* Make tree-shaking harder
* Hide dependency relationships

Use them only when they improve the architecture.

---

# 23. CIRCULAR DEPENDENCY RULE

Claude MUST actively watch for circular dependencies.

Examples:

```text
A → B → A
```

or:

```text
vehicles
 ↓
tracking
 ↓
vehicle
```

If a circular dependency appears, determine whether:

* Shared types should move
* A common abstraction is needed
* Responsibility is incorrectly placed
* A module boundary should change

Do not solve circular dependencies using hacks.

---

# 24. MODULE PUBLIC API

Each meaningful feature should expose only what other parts of the application actually need.

Prefer:

```text
feature/
├── index.ts
├── internal/
└── public/
```

where useful.

Do not expose internal implementation unnecessarily.

---

# 25. AVOID "GOD MODULES"

A God Module is a module that knows too much or does too much.

Examples:

```text
app.service.ts
global.utils.ts
system.service.ts
main.ts
dashboard.tsx
api.ts
```

with hundreds of unrelated responsibilities.

When a module becomes a central dumping ground, Claude MUST evaluate whether responsibilities should be separated.

---

# 26. AVOID "GOD COMPONENTS"

A component should not become the application's entire feature.

If a component contains:

* Multiple large sections
* Multiple independent workflows
* Multiple forms
* Multiple API calls
* Complex calculations
* Multiple modals
* Large state management

evaluate decomposition.

---

# 27. CONFIGURATION MODULARITY

Avoid one giant configuration file containing unrelated configuration.

Where appropriate separate:

```text
database
redis
authentication
storage
payments
maps
AI
notifications
```

But preserve the project's established configuration approach.

---

# 28. CONSTANTS

Avoid giant constant files containing unrelated values.

Prefer domain-specific constants when useful:

```text
vehicles.constants.ts
orders.constants.ts
tracking.constants.ts
```

Do not extract every string into a constant.

---

# 29. UTILITY RULE

Utilities must be:

* Small
* Generic enough to be reusable
* Independent where possible
* Clearly named

Avoid utilities that secretly contain business logic.

Bad:

```text
utils.ts
```

containing:

```text
calculateVehiclePrice()
validateDriver()
processPayment()
formatDate()
sendNotification()
```

These responsibilities belong to different domains.

---

# 30. DATABASE MODELS / ENTITIES

Models should represent their domain.

Do not create giant models containing unrelated business operations.

Keep domain responsibilities clear.

---

# 31. TEST ORGANIZATION

Tests should follow the same modular structure as the application where practical.

For example:

```text
vehicles/
├── vehicle.service.ts
└── vehicle.service.test.ts
```

or the project's established test structure.

Tests should be easy to locate.

---

# 32. TESTABILITY AS AN ARCHITECTURAL SIGNAL

If something is extremely difficult to test because it performs too many responsibilities, consider whether the module is too large or tightly coupled.

Difficulty testing a module can indicate poor boundaries.

---

# 33. REFACTORING LARGE FILES

When encountering a file above the recommended size:

### Step 1

Understand what the file does.

### Step 2

Group code by responsibility.

Example:

```text
File
├── Authentication
├── Validation
├── Formatting
├── API
├── State
└── UI
```

### Step 3

Identify natural module boundaries.

### Step 4

Extract logically independent responsibilities.

### Step 5

Update imports.

### Step 6

Run type checking.

### Step 7

Run tests.

### Step 8

Verify behavior.

### Step 9

Remove obsolete code.

---

# 34. SAFE EXTRACTION

When extracting a module:

Do not accidentally change:

* Function behavior
* State behavior
* API contracts
* Error handling
* Authentication
* Authorization
* Business rules
* Side effects

Refactoring should primarily change **structure**, not behavior.

---

# 35. DO NOT CREATE MICRO-MODULES

Bad:

```text
add.ts
subtract.ts
multiply.ts
divide.ts
```

when they naturally belong together.

Modularity means meaningful boundaries, not maximum file count.

---

# 36. MODULE SIZE TARGET

As a general guideline:

```text
0–300 lines
Excellent for most focused modules

300–500 lines
Generally healthy

500–800 lines
Review responsibility and complexity

800–1000 lines
Strong signal to evaluate decomposition

1000+ lines
Normally refactor into logical modules
```

These are architectural guidelines, not arbitrary laws.

---

# 37. FEATURE STRUCTURE

When a feature becomes sufficiently complex, prefer a structure similar to:

```text
feature/
├── components/
├── hooks/
├── services/
├── api/
├── types/
├── schemas/
├── utils/
├── constants/
├── tests/
└── index.ts
```

Do not create every directory automatically.

Only create directories that contain meaningful functionality.

---

# 38. SAARTHI DOMAIN ARCHITECTURE

The Saarthi project should be thought of as a collection of domain modules.

Possible high-level structure:

```text
Saarthi
│
├── Identity
├── Users
├── Drivers
├── Fleet
├── Vehicles
├── Tracking
├── Marketplace
├── Orders
├── Bidding
├── Payments
├── Wallet
├── Subscriptions
├── Documents
├── Verification
├── Maintenance
├── Loans
├── Notifications
├── SOS
├── Maps
├── Telematics
├── AI
├── Voice
├── Terminal
└── Administration
```

This is a conceptual model.

Do not force these exact folders if the existing project has a different but sound architecture.

---

# 39. SAARTHI FEATURE OWNERSHIP

When adding functionality, identify its domain first.

For example:

```text
Vehicle QR Pairing
→ Vehicles / Driver Assignment

Live Truck Location
→ Tracking

Driver Verification
→ Identity / Verification

Wallet Balance
→ Wallet

Order Bidding
→ Marketplace / Bidding

Gemini Voice Commands
→ AI / Voice

OBD Data
→ Telematics

Maintenance Record
→ Maintenance
```

Avoid placing domain logic in unrelated modules.

---

# 40. CROSS-DOMAIN FEATURES

Some features naturally involve multiple domains.

For example:

```text
Driver
+
Vehicle
+
Tracking
```

Do not duplicate the entire logic in all three domains.

Define clear ownership.

Example:

```text
Tracking
    owns location/tracking logic

Vehicle
    owns vehicle identity/state

Driver
    owns driver identity/state
```

Then allow controlled interaction between them.

---

# 41. SHARED DOMAIN CONCEPTS

When several domains genuinely share a concept, create a shared abstraction.

Examples:

```text
Pagination
API response
Money
Coordinates
User identity
Audit metadata
```

Do not create shared abstractions prematurely.

---

# 42. ARCHITECTURAL CHANGE RULE

Before making a structural change, ask:

```text
Does this improve responsibility boundaries?

Does this reduce coupling?

Does this improve testability?

Does this improve navigation?

Does this reduce duplication?

Does this improve scalability?

Does this preserve existing behavior?
```

If the answer is no to all of these, the restructuring probably isn't necessary.

---

# 43. DO NOT RESTRUCTURE THE WHOLE PROJECT UNNECESSARILY

Do not move hundreds of files simply to create a "perfect" folder structure.

Large structural migrations have risk.

Prefer incremental improvements:

```text
Current feature
↓
Identify problem
↓
Improve boundary
↓
Validate
↓
Continue
```

---

# 44. BACKWARD COMPATIBILITY

When reorganizing modules:

Preserve public interfaces where practical.

If an import path is widely used, consider a compatibility export rather than forcing unnecessary changes across the entire project.

Example:

```text
old import
    ↓
compatibility export
    ↓
new module
```

Use this only when useful.

---

# 45. NO DUPLICATED MODULES

Do not create:

```text
vehicle/
vehicles/
vehicle-management/
vehicleService/
vehicle-services/
```

for the same conceptual domain without a clear architectural reason.

Maintain one clear ownership model.

---

# 46. ARCHITECTURAL CLEANUP DURING FEATURE WORK

When adding a feature, Claude may improve the directly affected architecture if necessary.

For example:

```text
Adding Vehicle Tracking
        ↓
Existing VehicleService is 1400 lines
        ↓
Extract tracking responsibilities
        ↓
Implement feature
```

This is appropriate because the architecture directly affects the requested work.

However, do not use a feature request as an excuse to refactor unrelated systems.

---

# 47. ARCHITECTURAL TECHNICAL DEBT

When Claude discovers architectural debt that is outside the current task:

Do not automatically rewrite it.

Instead, document:

```text
Technical Debt:
Location:
Problem:
Impact:
Suggested future refactor:
```

Continue with the requested task unless the debt blocks safe implementation.

---

# 48. PERFORMANCE & MODULARITY

Modularity must not create unnecessary runtime overhead.

Do not create excessive:

* API layers
* Wrappers
* Network calls
* Serialization
* Database calls
* Abstraction layers

The goal is:

> **Logical modularity with efficient runtime behavior.**

---

# 49. CLEAN IMPORTS

After modularization:

* Remove unused imports.
* Remove obsolete exports.
* Avoid deep imports into internal modules.
* Avoid circular dependencies.
* Keep dependency direction clear.

---

# 50. ARCHITECTURAL VALIDATION

After significant restructuring, verify:

```text
Type checking
↓
Linting
↓
Tests
↓
Build
↓
Affected functionality
```

If possible, compare behavior before and after the structural change.

---

# 51. NEVER USE FILE SIZE AS AN EXCUSE TO BREAK LOGIC

Do not split a file in a way that makes the system:

* Harder to understand
* More tightly coupled
* More difficult to debug
* More difficult to test
* More repetitive

A slightly larger coherent module is preferable to artificial fragmentation.

---

# 52. FINAL ARCHITECTURAL CHECK

Before completing a significant change, Claude MUST ask:

### Structure

* Is this code in the correct module?
* Does the module have one clear responsibility?

### Size

* Is the file approaching 800–1000 lines?
* If above 1000, can it be meaningfully decomposed?

### Coupling

* Did this introduce unnecessary dependencies?
* Did this create a circular dependency?

### Reuse

* Did I duplicate existing functionality?

### Scalability

* Will this structure remain understandable as the project grows?

### Maintainability

* Can another developer quickly find and understand this functionality?

### Performance

* Did modularization introduce unnecessary runtime work?

### Safety

* Did the restructuring preserve existing behavior?

---

# 53. GOLDEN ARCHITECTURE RULE

The project should continuously move toward:

```text
                SAARTHI
                   │
        ┌──────────┴──────────┐
        │                     │
     FEATURES              SHARED
        │                     │
   ┌────┼────┐          ┌─────┼─────┐
   │    │    │          │     │     │
 Domain UI  Logic     Types  Utils  Infrastructure
   │    │    │
   └────┼────┘
        │
      APIs
        │
    Data Layer
        │
 Infrastructure
```

The exact implementation can differ, but responsibilities must remain clear.

---

# 54. FINAL INSTRUCTION

Treat modularity as a **continuous architectural requirement**.

Do not wait until the project becomes unmanageable.

Whenever a module grows substantially:

**Inspect → Identify responsibilities → Evaluate boundaries → Extract logically → Validate.**

Whenever a new feature is created:

**Identify domain → Find existing patterns → Reuse → Create focused module → Integrate cleanly.**

Whenever a file approaches or exceeds **800–1000 lines**:

**Stop and evaluate whether meaningful decomposition is required.**

Whenever code is moved:

**Preserve behavior.**

Whenever modules interact:

**Keep dependencies explicit and controlled.**

Whenever architecture is changed:

**Prefer incremental, safe improvements over massive rewrites.**

The ultimate goal is:

> **A large project that remains understandable because its complexity is divided into clear, meaningful, independently maintainable modules.**

The project must become:

```text
MORE MODULAR
MORE ORGANIZED
MORE PREDICTABLE
MORE SCALABLE
MORE TESTABLE
LESS COUPLED
LESS DUPLICATED
LESS CLUTTERED
LESS COMPLEX
```

Always address the user as **Sir**.

Never perform Git/GitHub operations unless Sir explicitly instructs you to do so.
