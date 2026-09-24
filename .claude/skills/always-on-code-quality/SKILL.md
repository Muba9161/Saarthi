# ALWAYS-ON PROJECT ENGINEERING SKILL

## PURPOSE

This is a **mandatory, always-active engineering skill** for the entire project.

Claude MUST follow these rules whenever it performs ANY development-related action in the repository.

This applies to:

* Creating files
* Editing files
* Modifying existing code
* Adding features
* Fixing bugs
* Refactoring
* Optimizing
* Reviewing code
* Changing APIs
* Changing database logic
* Changing UI
* Adding components
* Adding services
* Adding integrations
* Updating dependencies
* Writing tests
* Updating configuration
* Changing infrastructure

This is NOT a one-time cleanup instruction.

It is a permanent engineering standard.

---

# 1. PRIMARY RULE

> **Every change must leave the project equal to or better than it was before the change.**

A change must not introduce:

* Unnecessary complexity
* Duplicate code
* Dead code
* Unused dependencies
* Poor naming
* Poor structure
* Unnecessary files
* Unnecessary abstractions
* Performance regressions
* Security regressions
* Type-safety regressions
* Maintainability problems

If Claude cannot improve the relevant code without introducing unnecessary complexity, it should keep the implementation simple.

---

# 2. ALWAYS UNDERSTAND BEFORE MODIFYING

Before modifying any existing code, Claude MUST understand the surrounding implementation.

Never modify a file in isolation when its behavior depends on other parts of the application.

Before changing code, inspect:

```text
Current file
↓
Related files
↓
Imports / exports
↓
Callers
↓
Types
↓
API contracts
↓
Database interactions
↓
Business rules
↓
Tests
```

The amount of investigation should match the risk of the change.

A small text/style change does not require a repository-wide investigation.

A change to authentication, payments, database structure, fleet logic, or shared infrastructure requires significantly more investigation.

---

# 3. FOLLOW THE EXISTING ARCHITECTURE

Claude MUST understand and respect the existing architecture.

Do not introduce a new architecture merely because Claude prefers it.

Before introducing a new:

* Pattern
* Library
* Folder structure
* State-management approach
* API pattern
* Service layer
* Data-access pattern
* Component architecture

check whether an existing project pattern already solves the problem.

### Prefer consistency over personal preference.

If the project already has a standard way of doing something, use it.

---

# 4. EVERY CHANGE MUST HAVE A CLEAR RESPONSIBILITY

Every file, function, component, hook, service, and module should have a clear purpose.

Avoid:

```text
god components
god services
god controllers
god utilities
god hooks
god files
```

If a module is responsible for several unrelated concerns, consider separating them **only when the separation actually improves maintainability**.

Do not split code merely to reduce line count.

---

# 5. KEEP CODE CLEAN WHILE WRITING IT

Claude MUST NOT write messy code with the intention of cleaning it later.

Whenever code is created or modified:

* Remove unnecessary variables.
* Remove unnecessary imports.
* Use meaningful names.
* Avoid duplicate logic.
* Avoid unnecessary nesting.
* Avoid unnecessary comments.
* Avoid commented-out code.
* Avoid debug statements.
* Avoid temporary hacks.
* Avoid magic values where constants/configuration are appropriate.
* Follow existing formatting conventions.

The code should be clean **at the moment it is written**.

---

# 6. NO DUPLICATION

Before creating a new function, component, hook, service, utility, type, validation rule, API helper, or database operation, check whether an existing implementation already performs the same responsibility.

Prefer:

```text
Existing reusable implementation
        ↓
Reuse
```

instead of:

```text
Existing implementation
        +
New duplicate implementation
```

However:

> Do not force unrelated functionality into one abstraction just to eliminate a few repeated lines.

Duplication should be removed when the duplicated behavior is genuinely the same.

---

# 7. NO UNNECESSARY FILES

Before creating a new file, determine whether the functionality belongs in an existing module.

Create a new file when it provides a meaningful architectural or organizational benefit.

Do not create files such as:

```text
helper2
utils2
common2
service-new
temp
test-final
new-component
misc
```

unless the project architecture explicitly requires them.

---

# 8. NO DEAD CODE

Do not knowingly introduce dead code.

Never leave behind:

* Unused functions
* Unused variables
* Unused imports
* Unused components
* Unused hooks
* Unused types
* Unused API endpoints
* Commented-out implementations
* Temporary files

When modifying existing code, clean up obsolete code that is directly made unnecessary by the change.

For larger removal decisions, verify references first.

---

# 9. DO NOT DELETE UNCERTAIN CODE

Claude MUST NOT delete code simply because it appears unused.

Before deleting something, check:

* Imports
* Routes
* Dynamic imports
* Configuration
* Scripts
* API references
* Database references
* Build/deployment references
* External integrations
* Runtime references

If usage cannot be established confidently:

> Flag it instead of deleting it.

---

# 10. TYPESCRIPT RULES

Use TypeScript as a type-safety system, not merely as JavaScript with extensions.

Avoid:

```ts
any
```

unless there is a genuine technical reason.

Do not use:

```ts
as any
```

to silence an error.

Do not weaken types simply to make the build pass.

Prefer:

* Explicit types
* Type inference where appropriate
* Generics
* Type guards
* Discriminated unions
* Proper nullable handling
* Shared domain types
* Runtime validation where required

Before creating a new type, check whether an existing type already represents the same concept.

---

# 11. REACT RULES

For React code:

### Keep components focused.

Avoid components that simultaneously handle:

```text
UI
+
Business logic
+
API communication
+
Data transformation
+
Complex state management
+
Validation
```

Move responsibilities to appropriate existing patterns when necessary.

Avoid unnecessary:

* `useEffect`
* `useMemo`
* `useCallback`
* State
* Context
* Re-renders

Do not add memoization blindly.

Every optimization should have a reason.

---

# 12. NEXT.JS RULES

Use the project's established Next.js architecture.

Consider whether functionality belongs on:

* Server
* Client
* API
* Server action
* Shared module

Avoid `"use client"` unless client-side functionality is actually required.

Do not move server functionality to the client without a reason.

Minimize unnecessary JavaScript sent to the browser.

---

# 13. API RULES

When creating or modifying APIs:

* Reuse existing API conventions.
* Reuse existing authentication.
* Reuse existing authorization.
* Reuse existing validation.
* Reuse existing error handling.
* Avoid duplicate endpoints.
* Avoid inconsistent response formats.

Do not create multiple endpoints for the same responsibility unless there is a documented reason.

---

# 14. DATABASE RULES

Before changing database access:

Understand:

```text
Schema
↓
Relations
↓
Indexes
↓
Existing queries
↓
Consumers
↓
Transactions
```

Avoid:

* N+1 queries
* Repeated queries
* Unnecessary data fetching
* Fetching entire records when only a few fields are required
* Missing pagination
* Blind index creation

Database optimizations must preserve correctness.

---

# 15. REDIS / CACHE RULES

When Redis or another cache is involved:

Use consistent:

* Cache keys
* TTLs
* Serialization
* Invalidation

Do not cache data merely because Redis exists.

Before caching something, consider:

```text
Is it expensive?
Is it frequently accessed?
Can it become stale?
How will it be invalidated?
```

---

# 16. PERFORMANCE RULE

Every implementation should consider performance.

Ask:

```text
Does this create unnecessary database queries?
Does this create unnecessary API requests?
Does this cause unnecessary rendering?
Does this load unnecessary data?
Does this increase bundle size?
Does this increase memory usage?
Does this perform expensive work repeatedly?
```

Do not prematurely optimize trivial code.

Prioritize optimizations with meaningful impact.

---

# 17. SECURITY RULE

Security must never be sacrificed for convenience or performance.

Always consider:

* Authentication
* Authorization
* Input validation
* Output handling
* Sensitive data
* Secrets
* Tokens
* File uploads
* API exposure
* Permissions
* Rate limiting
* Injection vulnerabilities

Never expose secrets in:

* Source code
* Client bundles
* Logs
* Error messages
* API responses

---

# 18. ERROR HANDLING RULE

Never silently swallow errors.

Avoid:

```ts
try {
  ...
} catch {
}
```

unless intentionally justified.

Errors should be:

* Handled
* Logged appropriately
* Returned appropriately
* Displayed appropriately
* Propagated appropriately

Do not expose internal implementation details to end users.

---

# 19. LOGGING RULE

Development debugging must not become production clutter.

Remove unnecessary:

```text
console.log
console.debug
debugger
temporary logs
```

before completing a change.

Use the project's established logging mechanism where available.

Never log confidential information.

---

# 20. UI/CSS RULE

When modifying UI:

* Reuse existing components.
* Reuse existing design patterns.
* Reuse existing spacing.
* Reuse existing typography.
* Reuse existing responsive behavior.
* Avoid duplicate CSS.
* Avoid unnecessary inline styles.
* Avoid unnecessary arbitrary values.
* Keep mobile responsiveness intact.

Do not redesign existing UI unless explicitly requested.

---

# 21. RESPONSIVENESS RULE

Every UI change must consider:

```text
Mobile
Tablet
Desktop
Large screens
```

Do not solve a desktop problem by breaking mobile.

Do not solve a mobile problem by creating unnecessary duplicated markup.

---

# 22. ACCESSIBILITY RULE

Whenever UI is modified, preserve or improve:

* Semantic HTML
* Labels
* Keyboard accessibility
* Focus states
* Form accessibility
* Button semantics
* Link semantics
* Screen-reader compatibility

---

# 23. DEPENDENCY RULE

Before installing a new package:

1. Check whether the project already has a package capable of solving the problem.
2. Check whether native functionality can solve it.
3. Check whether the dependency is actually necessary.
4. Consider bundle size and maintenance cost.
5. Follow existing project conventions.

Do not add a package for trivial functionality.

---

# 24. CONFIGURATION RULE

Do not duplicate configuration.

Before adding:

```text
API URL
constant
environment variable
feature flag
configuration value
```

check whether an existing value already represents it.

Never hard-code environment-specific secrets.

---

# 25. COMMENTS RULE

Write comments only when they explain something that is not obvious from the code.

Good:

```ts
// Refresh token shortly before expiry to prevent session interruption.
```

Bad:

```ts
// Set user
setUser(user);
```

Never leave large blocks of commented-out code.

---

# 26. NAMING RULE

Names must describe what something actually does.

Avoid vague names:

```text
data
item
thing
helper
common
temp
result2
newData
```

Prefer meaningful names.

Consistency with existing project naming conventions is more important than personal preference.

---

# 27. BUSINESS LOGIC RULE

Do not change business behavior while performing technical cleanup unless explicitly instructed.

This includes, but is not limited to:

* Pricing
* Payments
* Wallets
* Subscriptions
* Bidding
* Orders
* Driver assignment
* Vehicle assignment
* Verification
* Permissions
* Marketplace rules
* Fleet rules
* Tracking
* Maintenance
* Loan logic

Technical refactoring must preserve existing business behavior.

---

# 28. SAARTHI SYSTEM PRESERVATION

The following areas must be treated as existing business-critical systems:

```text
Drivers
Fleet Owners
Customers
Suppliers
Mobility Providers

Vehicles
Vehicle Tracking
Driver Assignment
Vehicle QR Pairing

Identity Verification
Documents
Vehicle Passport
Driver License

Marketplace
Orders
Bidding
Payments
Wallet
Subscriptions

Maintenance
Loans
EMI Reminders

Petrol Pumps
Workshops
Dhabas
SOS

Truck Associations
Maps
Realtime Tracking

Telematics
Freematics
OBD

Gemini AI
Voice Commands

Saarthi Terminal
Marketing Website
```

Do not remove or redesign these systems during optimization unless explicitly requested.

---

# 29. FEATURE DEVELOPMENT RULE

When adding a new feature:

Do NOT simply append code to the nearest file.

First determine:

```text
Where does this feature belong?
What existing patterns does it follow?
What can be reused?
What shared logic already exists?
What types already exist?
What API conventions already exist?
What database patterns already exist?
```

Then implement it consistently.

---

# 30. BUG FIX RULE

When fixing a bug:

Do not patch symptoms if the underlying cause is clear.

Use:

```text
Reproduce
↓
Understand
↓
Identify root cause
↓
Fix root cause
↓
Check affected code
↓
Test
```

Avoid unrelated refactoring during a focused bug fix unless necessary.

---

# 31. REFACTORING RULE

Refactoring must improve at least one of:

* Readability
* Maintainability
* Performance
* Reliability
* Testability
* Architecture

Prefer small, controlled refactors.

Avoid large rewrites unless explicitly requested.

---

# 32. BEFORE CREATING CODE

Claude should mentally ask:

```text
Does this already exist?
Can I reuse it?
Where should this responsibility live?
Will this create duplication?
Will this increase complexity?
Is there a simpler solution?
Does this follow the existing architecture?
```

---

# 33. AFTER CREATING CODE

Claude must check:

```text
Is the code clean?
Are imports clean?
Are types correct?
Is anything duplicated?
Is anything unused?
Is the naming clear?
Is error handling correct?
Could this create a performance issue?
Could this introduce a security issue?
Does it follow existing patterns?
```

---

# 34. AFTER MODIFYING CODE

Claude must check the surrounding impact.

At minimum consider:

```text
Callers
Imports
Types
API contracts
Database interactions
Tests
UI consumers
Authentication
Authorization
```

The larger the change, the broader the check.

---

# 35. VALIDATION RULE

After meaningful code changes, run the appropriate project validation.

Possible checks:

```text
TypeScript
Lint
Formatter
Unit tests
Integration tests
E2E tests
Build
```

Do not claim something passed unless it was actually executed.

If a check cannot be run, state that clearly.

---

# 36. DO NOT CHEAT VALIDATION

Never fix a failing build by:

* Adding `any`
* Disabling lint rules
* Removing tests
* Skipping validation
* Commenting out code
* Hiding errors
* Removing functionality
* Suppressing warnings without justification

Fix the actual problem whenever reasonably possible.

---

# 37. CHANGE SCOPE RULE

Stay within the user's requested scope.

If the user asks:

> Fix the login bug.

Do not simultaneously:

* Redesign the dashboard
* Rewrite authentication
* Replace the API client
* Upgrade every dependency
* Restructure the database

unless those changes are necessary for the requested fix.

---

# 38. "WHILE YOU ARE HERE" RULE

Claude may perform small cleanup directly related to the code being changed.

For example:

```text
Editing a component
↓
Remove unused import in that component
```

Good.

But:

```text
Editing a component
↓
Rewrite unrelated authentication system
```

Not allowed.

---

# 39. NO COSMETIC REFACTORING DURING HIGH-RISK CHANGES

When working on:

* Authentication
* Payments
* Database migrations
* Authorization
* Identity verification
* Tracking
* Wallets
* Orders

keep the change focused.

Do not combine large cosmetic refactors with business-critical changes.

---

# 40. FILE SIZE & COMPLEXITY

Large files should be reviewed, but size alone is not a reason to split them.

Consider splitting when:

* Responsibilities are clearly unrelated.
* Testing is difficult.
* Navigation becomes difficult.
* Reuse is needed.
* Dependencies become excessive.
* Changes frequently affect unrelated areas.

Do not split a coherent module simply because it exceeds an arbitrary line count.

---

# 41. PROJECT-WIDE CONSISTENCY

When discovering an existing pattern, use it consistently.

For example, if the project uses:

```text
services/
hooks/
features/
schemas/
repositories/
```

do not introduce another pattern for a new feature without a reason.

The objective is to reduce cognitive load for future developers.

---

# 42. NEVER INTRODUCE CLUTTER

Do not leave:

```text
backup files
temporary files
debug files
generated artifacts
unused screenshots
experimental components
unused scripts
duplicate configs
```

in the repository unless they are intentionally part of the project.

---

# 43. GIT / GITHUB

Claude MUST NOT perform Git/GitHub operations unless Sir explicitly asks.

Never automatically:

* Commit
* Push
* Pull
* Merge
* Rebase
* Create branches
* Delete branches
* Modify history
* Create pull requests

Code changes and Git operations are separate responsibilities.

---

# 44. WHEN UNCERTAIN

If Claude is unsure whether a change could alter existing behavior:

> Stop and investigate before changing it.

If necessary, ask Sir for clarification.

Do not guess about business requirements.

---

# 45. DO NOT OVER-ENGINEER

The best implementation is generally:

> **The simplest implementation that is correct, maintainable, secure, performant, and consistent with the existing project.**

Do not introduce complexity simply because a more sophisticated solution exists.

---

# 46. ALWAYS-ON DECISION LOOP

For EVERY meaningful development task, follow:

```text
┌─────────────────────────────┐
│       UNDERSTAND TASK       │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ CHECK EXISTING IMPLEMENTATION│
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ CHECK PROJECT CONVENTIONS   │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ IDENTIFY REUSE OPPORTUNITIES│
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ CHOOSE SIMPLEST SAFE DESIGN │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ IMPLEMENT CLEANLY           │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ CHECK PERFORMANCE           │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ CHECK SECURITY              │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ CHECK DUPLICATION / CLUTTER │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ VALIDATE                    │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ REVIEW FINAL CHANGE         │
└─────────────────────────────┘
```

---

# 47. FINAL SELF-REVIEW

Before considering any meaningful task complete, Claude MUST review the change using these questions:

### Architecture

* Does this belong here?
* Does it follow the existing architecture?

### Code

* Is the code clean?
* Is it readable?
* Is it unnecessarily complex?

### Duplication

* Did I duplicate existing functionality?
* Can existing code be reused?

### Performance

* Did I introduce unnecessary work?
* Did I introduce unnecessary API/database requests?

### Security

* Did I expose anything sensitive?
* Did I weaken validation or authorization?

### Types

* Are types correct?
* Did I introduce unsafe `any` or casts?

### Maintainability

* Will another developer understand this?
* Are names meaningful?

### Scope

* Did I change anything unrelated?

### Validation

* Did I run the appropriate checks?
* Did I verify the affected functionality?

---

# 48. GOLDEN RULE

The project should continuously move toward:

```text
MORE ORGANIZED
MORE MODULAR
MORE READABLE
MORE PERFORMANT
MORE SECURE
MORE MAINTAINABLE
LESS DUPLICATED
LESS CLUTTERED
LESS COMPLEX
```

Every development task is an opportunity to maintain these qualities.

But:

> **Do not refactor for the sake of refactoring.**

> **Do not optimize for the sake of changing code.**

> **Do not sacrifice existing functionality for cleaner-looking code.**

> **Do not add complexity where simplicity is sufficient.**

---

# 49. FINAL INSTRUCTION TO CLAUDE

Treat this document as an **always-on engineering standard**, not a one-time task.

Whenever you touch the project, leave the affected area:

**cleaner, clearer, safer, more organized, and at least as functional as before.**

Before changing existing code:

**Understand it.**

Before creating new code:

**Search for reusable existing code.**

While writing code:

**Keep it clean.**

After writing code:

**Check duplication, performance, security, types, and architecture.**

After changing code:

**Validate it.**

When uncertain:

**Investigate rather than guess.**

When the requested task is complete:

**Do not expand scope unnecessarily.**

And:

> **Never perform Git/GitHub operations unless Sir explicitly instructs you to do so.**

Always address the user as **Sir**.
