# TESTING & QUALITY ASSURANCE SKILL

## 1. PURPOSE

You are responsible for ensuring that the entire project remains:

- Functional
- Stable
- Reliable
- Performant
- Secure
- Maintainable
- Modular
- Responsive
- Accessible
- SEO-friendly
- Consistent with the project architecture
- Consistent with all rules and skills defined in `CLAUDE.md`

Testing is NOT a final step.

Testing is part of every development task.

Whenever you build, modify, refactor, optimize, or remove anything, you must verify that:

1. The requested change works correctly.
2. Existing functionality still works.
3. Related features still work.
4. The implementation follows `CLAUDE.md`.
5. The implementation follows all applicable project skills.
6. The implementation does not introduce unnecessary technical debt.
7. The implementation is optimized for production use.

---

# 2. PRIMARY RULE

## NEVER CONSIDER A FEATURE COMPLETE WITHOUT TESTING IT

A feature is complete only when:

```text
Implementation
      ↓
Functional Testing
      ↓
Regression Testing
      ↓
Integration Testing
      ↓
UI/UX Testing
      ↓
Performance Testing
      ↓
Security Testing
      ↓
SEO Testing
      ↓
Architecture / Code Quality Review
      ↓
Final Validation
      ↓
Complete
```

Do not simply assume that code that compiles is working code.

---

# 3. READ THE PROJECT RULES FIRST

Before implementing or testing a feature:

1. Read `CLAUDE.md`.
2. Read relevant project skills.
3. Understand the project's architecture.
4. Understand the affected feature.
5. Identify dependencies.
6. Identify potentially affected existing functionality.

All testing decisions must respect the project's existing rules.

If `CLAUDE.md` contains additional testing requirements, those requirements take precedence.

---

# 4. TESTING PRINCIPLE

Every change must be evaluated from two perspectives:

## A. Feature Validation

Does the newly requested functionality work?

## B. Regression Validation

Did the change break anything that was already working?

Both are mandatory.

---

# 5. BEFORE CHANGING CODE

Before implementing a feature:

### Inspect

- Existing implementation
- Related components
- Routes
- APIs
- Database models
- Services
- Utilities
- Authentication
- Authorization
- Existing tests
- Existing documentation
- Existing project skills

### Identify

```text
Feature
├── Direct dependencies
├── Indirect dependencies
├── Shared components
├── Shared services
├── Shared database tables
├── Shared APIs
├── Shared state
├── Shared styling
└── Shared business logic
```

The larger the dependency surface, the broader the regression testing must be.

---

# 6. TESTING LEVELS

Use the appropriate testing levels for the project.

## Unit Testing

Test isolated:

- Functions
- Utilities
- Hooks
- Services
- Validators
- Business logic
- Helpers
- Calculations
- Parsers

Examples:

```text
Input → Function → Expected Output
```

Test:

- Valid input
- Invalid input
- Empty input
- Null/undefined input where applicable
- Boundary values
- Unexpected values
- Error conditions

---

# 7. COMPONENT TESTING

For reusable UI components test:

- Rendering
- Props
- State
- User interaction
- Loading state
- Empty state
- Error state
- Disabled state
- Responsive behavior
- Accessibility
- Conditional rendering

Examples:

```text
Button
├── Normal
├── Hover
├── Focus
├── Disabled
└── Loading

Form
├── Empty
├── Valid
├── Invalid
├── Submission
├── API failure
└── Success
```

---

# 8. INTEGRATION TESTING

Test how multiple systems work together.

Examples:

```text
Frontend
   ↓
API
   ↓
Service
   ↓
Database
```

Verify:

- Request
- Validation
- Authentication
- Authorization
- Business logic
- Database operation
- Response
- UI update

Do not test only the frontend mock if the real integration is available.

---

# 9. END-TO-END TESTING

For important user journeys, test the complete flow.

Examples:

```text
Registration
→ Verification
→ Login
→ Dashboard
→ Create Record
→ Update Record
→ Delete Record
→ Logout
```

Or:

```text
User
→ Search
→ Select
→ Submit
→ Payment
→ Confirmation
→ Database update
→ Notification
```

The exact flow depends on the project.

---

# 10. FEATURE TESTING

Every new feature should have a dedicated test checklist.

Example:

```text
FEATURE: Vehicle Registration

[ ] Page loads
[ ] Form renders
[ ] Required fields work
[ ] Validation works
[ ] Invalid data rejected
[ ] Valid data accepted
[ ] API request succeeds
[ ] Database record created
[ ] Success state displayed
[ ] Error state displayed
[ ] Duplicate record handled
[ ] User permissions respected
[ ] Mobile UI works
[ ] Existing vehicle features still work
```

---

# 11. REGRESSION TESTING

After implementing a change, identify what could have been affected.

Test:

- Directly related features
- Shared components
- Shared APIs
- Shared database operations
- Authentication
- Navigation
- Forms
- Global state
- Search
- Filtering
- Notifications
- Payments
- File uploads
- Permissions
- Public pages
- Existing workflows

Do not blindly test the entire application every time.

Use risk-based regression testing.

---

# 12. RISK-BASED TESTING

Prioritize testing based on impact.

### Critical

Test immediately and thoroughly:

- Authentication
- Authorization
- Payments
- Financial calculations
- Database migrations
- Data deletion
- User permissions
- Security
- Core business logic

### High

- Core workflows
- API changes
- Shared components
- Navigation
- Important dashboards
- Search
- File uploads

### Medium

- Secondary features
- Filters
- UI interactions
- Notifications
- Reports

### Low

- Cosmetic changes
- Minor text changes
- Non-functional styling

The larger the risk, the broader the test coverage.

---

# 13. NEGATIVE TESTING

Do not only test successful scenarios.

Always test failure conditions.

Examples:

- Invalid input
- Empty input
- Missing required fields
- Incorrect credentials
- Unauthorized user
- Expired session
- Missing database record
- API timeout
- API failure
- Network failure
- Duplicate submission
- Duplicate records
- Invalid file
- Oversized file
- Unsupported file type
- Invalid URL
- Missing parameters
- Unexpected server response

The application should fail gracefully.

---

# 14. EDGE CASE TESTING

Identify edge cases specific to the feature.

Examples:

```text
0
1
-1
Maximum allowed value
Minimum allowed value
Very long text
Empty string
Null
Undefined
Special characters
Unicode
Emoji
Duplicate values
Large datasets
No results
One result
Many results
```

Do not assume ideal user input.

---

# 15. DATABASE TESTING

When database-related functionality changes, verify:

- Record creation
- Record retrieval
- Record updates
- Record deletion
- Relationships
- Foreign keys
- Constraints
- Unique constraints
- Null handling
- Transactions
- Rollbacks
- Data integrity
- Migration correctness
- Seed data where applicable

Never leave orphaned or inconsistent records.

---

# 16. API TESTING

For every affected API verify:

### Request

- Method
- URL
- Parameters
- Headers
- Authentication
- Payload

### Response

- Status code
- Response structure
- Data
- Validation errors
- Error format

### Failure

- Unauthorized
- Forbidden
- Not found
- Validation failure
- Conflict
- Server failure
- Rate limiting where applicable

APIs must return predictable responses.

---

# 17. AUTHENTICATION TESTING

When authentication is involved, test:

```text
Register
Login
Logout
Session
Refresh
Password reset
Email verification
Expired session
Invalid credentials
Unauthorized access
```

Also test:

- Protected routes
- Public routes
- Role-based access
- Session persistence
- Session invalidation

Never expose protected information.

---

# 18. AUTHORIZATION TESTING

Authentication and authorization are different.

Verify that users can only perform actions allowed by their role.

Test:

```text
Role A → Allowed
Role A → Forbidden action
Role B → Allowed
Role B → Forbidden action
Admin → Allowed
Unauthenticated → Blocked
```

Never rely only on frontend permission checks.

Server-side authorization must also be enforced.

---

# 19. UI/UX TESTING

Every user-facing feature must be checked visually and functionally.

Check:

- Layout
- Spacing
- Typography
- Buttons
- Forms
- Icons
- Cards
- Tables
- Modals
- Dropdowns
- Navigation
- Loading states
- Empty states
- Error states
- Success states
- Animations
- Transitions

Follow the project's design skills and UI rules.

Do not introduce a visual style that conflicts with the existing design system.

---

# 20. RESPONSIVE TESTING

Test important pages at:

- Mobile
- Tablet
- Laptop
- Desktop
- Large desktop

Check:

- No horizontal overflow
- Navigation
- Forms
- Tables
- Cards
- Modals
- Images
- Typography
- Buttons
- Touch targets

Responsive behavior must be intentional.

---

# 21. ACCESSIBILITY TESTING

Check:

- Keyboard navigation
- Focus states
- Semantic HTML
- Form labels
- Button names
- Image alt text
- Heading hierarchy
- Contrast
- Screen-reader compatibility where applicable
- Accessible error messages

Do not use accessibility attributes incorrectly.

---

# 22. PERFORMANCE TESTING

Every feature must be evaluated for performance impact.

Check:

- Initial page load
- JavaScript bundle size
- API response time
- Database queries
- Rendering performance
- Image sizes
- Network requests
- Memory usage
- Unnecessary re-renders
- Large DOM trees
- Blocking operations

Do not optimize blindly.

Identify the actual bottleneck.

---

# 23. DATABASE PERFORMANCE

Check for:

- N+1 queries
- Missing indexes
- Unnecessary queries
- Duplicate queries
- Large result sets
- Inefficient joins
- Unnecessary database calls
- Missing pagination
- Unbounded queries

Use appropriate:

- Indexes
- Pagination
- Caching
- Query optimization
- Eager loading
- Batching

Only where justified.

---

# 24. API PERFORMANCE

Check:

- Response size
- Number of requests
- Duplicate requests
- Slow endpoints
- Unnecessary polling
- Caching opportunities
- Pagination
- Request batching

Avoid creating performance problems through excessive API calls.

---

# 25. FRONTEND PERFORMANCE

Check:

- Unnecessary re-renders
- Large components
- Large bundles
- Duplicate dependencies
- Heavy libraries
- Unnecessary client-side processing
- Image loading
- Font loading
- Animations
- Event listeners

Follow the project's frontend optimization skill.

---

# 26. SEO TESTING

Every public/indexable feature must also be checked against the project's SEO skill.

Verify where applicable:

- Title
- Meta description
- Canonical
- H1
- Heading structure
- Semantic HTML
- Open Graph
- Sitemap
- Robots
- Structured data
- Internal links
- Image alt text
- Page performance
- Mobile behavior
- Indexability

Never allow a feature to silently introduce an SEO regression.

---

# 27. SECURITY TESTING

Every feature involving user input, authentication, APIs, files, or sensitive data must be reviewed for security.

Check for:

- Authentication bypass
- Authorization bypass
- Injection
- XSS
- CSRF where applicable
- Unsafe redirects
- File upload vulnerabilities
- Sensitive data exposure
- Insecure API endpoints
- Improper validation
- Missing rate limiting where required
- Secrets exposed to frontend
- Excessive error information

Never expose:

- API secrets
- Private keys
- Passwords
- Tokens
- Sensitive user data

---

# 28. FORM TESTING

Every form must be tested for:

### UI

- Correct fields
- Labels
- Placeholder
- Validation messages
- Required fields
- Loading state
- Success state
- Error state

### Data

- Valid input
- Invalid input
- Empty input
- Boundary values
- Special characters

### Submission

- Duplicate submission
- Network failure
- Server failure
- Successful submission

---

# 29. FILE UPLOAD TESTING

Where applicable:

- Valid file
- Invalid file
- Wrong extension
- Wrong MIME type
- Large file
- Empty file
- Corrupted file
- Duplicate file
- Unauthorized upload
- Unauthorized download

Verify storage and access permissions.

---

# 30. REAL-TIME FEATURES

For WebSocket, Socket.IO, WebRTC, or other real-time systems test:

- Connection
- Reconnection
- Disconnect
- Network interruption
- Duplicate events
- Event ordering
- Authentication
- Unauthorized access
- Multiple users
- Concurrent connections
- Browser refresh
- Session expiration

Do not assume a real-time feature works simply because it works with one browser tab.

---

# 31. CONCURRENCY TESTING

For operations that can happen simultaneously:

Test:

```text
User A → Action
User B → Same Action
```

Check:

- Race conditions
- Duplicate records
- Duplicate payments
- Double submissions
- Data overwrites
- Locking
- Transaction integrity

---

# 32. ERROR HANDLING

Every important feature must have predictable error handling.

Check:

```text
Loading
→ Success
→ Empty
→ Error
→ Retry
```

Do not leave:

- Blank screens
- Infinite spinners
- Unhandled exceptions
- Broken UI
- Console errors

---

# 33. CONSOLE AND LOG TESTING

Before considering a frontend feature complete:

Check for:

- JavaScript errors
- React warnings where applicable
- Failed network requests
- Missing assets
- Hydration errors where applicable
- Unhandled promise rejections

For backend:

Check:

- Exceptions
- Failed queries
- Unexpected warnings
- Incorrect status codes
- Excessive logging
- Sensitive information in logs

---

# 34. BUILD TESTING

After significant changes, verify:

- Development build
- Production build
- Type checking
- Linting
- Tests
- Static analysis
- Framework-specific validation

Fix genuine errors.

Do not suppress errors simply to make the build pass.

---

# 35. TYPE SAFETY

Where TypeScript is used:

Check:

- Type errors
- `any` usage
- Incorrect interfaces
- Nullable values
- API response types
- Component props
- Database types

Avoid unnecessary `any`.

Do not weaken type safety merely to bypass an error.

---

# 36. CODE QUALITY

Check:

- Duplication
- Dead code
- Unused imports
- Unused variables
- Large components
- Large functions
- Tight coupling
- Poor naming
- Inconsistent patterns
- Missing error handling
- Unnecessary abstractions

Follow the project's modular architecture rules.

---

# 37. MODULARITY

New functionality should be implemented in the appropriate layer.

Avoid putting:

- Business logic inside UI components
- Database logic inside UI code
- API logic everywhere
- Repeated validation everywhere
- Repeated SEO logic everywhere

Prefer reusable modules where appropriate.

Do not over-engineer simple functionality.

---

# 38. DESIGN SYSTEM CONSISTENCY

When testing UI changes, verify that the implementation follows the existing design system.

Check:

- Colors
- Typography
- Spacing
- Border radius
- Shadows
- Buttons
- Inputs
- Cards
- Icons
- Responsive patterns
- Animations

Do not introduce arbitrary design patterns.

---

# 39. CROSS-BROWSER TESTING

For important public-facing functionality, consider:

- Chromium-based browsers
- Firefox
- Safari where applicable
- Mobile browsers

Focus especially on:

- Forms
- Authentication
- Payments
- File uploads
- Camera
- Microphone
- Location
- WebRTC
- PWA functionality

---

# 40. PWA TESTING

If the project uses PWA functionality, test:

- Manifest
- Service worker
- Installation
- Offline behavior where intended
- Cache behavior
- Update behavior
- Icons
- Splash screen
- Network recovery
- Authentication state

Do not cache sensitive/private information incorrectly.

---

# 41. ENVIRONMENT TESTING

Do not assume local development equals production.

Where practical, verify:

```text
Development
→ Test
→ Production-like build
```

Check:

- Environment variables
- API URLs
- Database configuration
- Storage
- Authentication
- CORS
- Cookies
- HTTPS requirements
- Build configuration

Never expose production secrets.

---

# 42. TEST DATA

Use realistic but safe test data.

Do not use real sensitive user information.

Test with:

- Normal data
- Empty datasets
- Large datasets
- Invalid datasets
- Boundary values
- Multiple users
- Multiple roles

---

# 43. TESTING AFTER REFACTORING

Refactoring is NOT automatically safe.

After refactoring:

1. Run relevant unit tests.
2. Run integration tests.
3. Run affected end-to-end flows.
4. Compare behavior before and after.
5. Check performance.
6. Check UI.
7. Check API behavior.
8. Check database behavior.

The output should remain functionally equivalent unless the change intentionally modifies behavior.

---

# 44. TESTING AFTER DEPENDENCY CHANGES

When adding, removing, or upgrading dependencies:

Check:

- Build
- Type checking
- Tests
- Bundle size
- Runtime behavior
- Browser compatibility
- Existing components
- Security implications

Do not add a dependency for functionality that can reasonably be implemented using existing project capabilities.

---

# 45. REGRESSION MATRIX

For significant features, create a lightweight regression matrix:

```text
Feature                  Status
---------------------------------
New Feature              PASS
Authentication           PASS
Navigation               PASS
Related API              PASS
Database                 PASS
Existing Dashboard       PASS
Forms                    PASS
Responsive UI            PASS
SEO                      PASS
Performance              PASS
Security                 PASS
Build                    PASS
```

Only mark something PASS after actually validating it.

Use:

```text
PASS
FAIL
BLOCKED
NOT APPLICABLE
NOT TESTED
```

Never convert `NOT TESTED` into `PASS`.

---

# 46. TEST FAILURE HANDLING

If a test fails:

1. Determine whether the failure is caused by the current change.
2. Reproduce the problem.
3. Identify the root cause.
4. Fix the underlying issue.
5. Re-run the failed test.
6. Re-run related regression tests.
7. Re-check the original feature.

Do not simply remove or weaken the test.

---

# 47. FLAKY TESTS

If a test intermittently fails:

- Identify the cause.
- Do not blindly increase timeouts.
- Do not disable the test.
- Do not ignore it.

Fix the underlying synchronization, environment, or data problem.

---

# 48. TEST COVERAGE

Coverage is useful, but coverage percentage alone does not prove quality.

Prioritize coverage around:

- Core business logic
- Authentication
- Authorization
- Payments
- Data integrity
- Important APIs
- Critical user journeys

Do not write meaningless tests solely to increase coverage numbers.

---

# 49. AUTOMATED TESTS

Use automated tests whenever practical.

Prioritize automation for:

- Repeated workflows
- Critical business logic
- Regression-prone features
- Authentication
- APIs
- Forms
- Calculations
- Important user journeys

Use the testing tools already established by the project before introducing new tools.

---

# 50. MANUAL TESTING

Manual testing is still required where automation cannot reliably validate:

- Visual quality
- UX
- Responsive layout
- Complex interactions
- Browser-specific behavior
- Camera
- Microphone
- Location
- Real-time behavior
- Animations
- PWA installation

---

# 51. DO NOT FAKE TEST RESULTS

Never claim:

- Test passed
- Build passed
- Performance improved
- Security verified
- SEO verified
- Feature works

unless it was actually checked.

If something cannot be tested in the current environment, clearly state:

```text
NOT TESTED — reason
```

---

# 52. TESTING PRIOR TO COMPLETION

Before marking a task complete, perform:

```text
1. Code review
2. Type check
3. Lint
4. Unit tests
5. Integration tests
6. Feature test
7. Regression test
8. UI test
9. Responsive test
10. Performance check
11. Security review
12. SEO review
13. Build validation
```

Not every project requires every category for every tiny change.

Use judgment based on risk.

---

# 53. FINAL QUALITY GATE

A feature can be considered complete only when:

```text
[✓] Requested functionality works
[✓] Existing related functionality works
[✓] No known regression introduced
[✓] Error states handled
[✓] Edge cases considered
[✓] UI is consistent
[✓] Responsive behavior verified
[✓] Performance considered
[✓] Security considered
[✓] SEO considered where applicable
[✓] Architecture follows project rules
[✓] Code is modular and maintainable
[✓] Build/type/lint checks pass where applicable
```

If an important item fails, do not declare the feature complete.

---

# 54. CLAUDE.MD COMPLIANCE

After implementation, explicitly verify:

> Does this implementation follow every applicable rule defined in `CLAUDE.md` and the project's installed skills?

Check:

- Architecture
- Tech stack
- UI/UX
- SEO
- Performance
- Security
- Modularity
- Naming
- File organization
- Documentation
- Development workflow
- Git restrictions
- Any project-specific requirements

Do not override project rules merely because a different implementation seems easier.

---

# 55. CROSS-SKILL VALIDATION

When multiple project skills exist, test the feature against all relevant skills.

For example:

```text
New Feature
    │
    ├── Testing Skill
    ├── SEO Skill
    ├── Frontend Skill
    ├── Performance Skill
    ├── Security Skill
    ├── Accessibility Skill
    ├── Modular Architecture Skill
    └── CLAUDE.md
```

The feature must satisfy all applicable requirements.

---

# 56. CONTINUOUS QUALITY

The goal is not simply:

> "Does this feature work?"

The goal is:

> "Does this feature work correctly, efficiently, securely, consistently, and without damaging the rest of the project?"

Always think beyond the immediate task.

---

# 57. WHEN A USER REQUESTS A NEW FEATURE

Use this workflow:

```text
Understand
    ↓
Inspect Existing Architecture
    ↓
Identify Dependencies
    ↓
Implement
    ↓
Run Static Checks
    ↓
Test New Feature
    ↓
Test Failure Cases
    ↓
Test Related Features
    ↓
Regression Testing
    ↓
Performance Check
    ↓
Security Check
    ↓
SEO Check
    ↓
UI/Responsive Check
    ↓
CLAUDE.md Compliance
    ↓
Final Quality Gate
```

---

# 58. WHEN A USER REQUESTS A BUG FIX

Do not immediately patch the visible symptom.

First:

1. Reproduce the bug.
2. Identify the root cause.
3. Understand why it happened.
4. Implement the smallest appropriate fix.
5. Test the original failure.
6. Test related functionality.
7. Run regression tests.
8. Check whether similar bugs exist elsewhere.

Avoid fixing symptoms while leaving the underlying architectural problem.

---

# 59. WHEN A USER REQUESTS OPTIMIZATION

Do not assume optimization means rewriting code.

First:

1. Measure.
2. Identify bottleneck.
3. Optimize the bottleneck.
4. Measure again.
5. Verify functionality.
6. Verify regression.
7. Compare before/after where possible.

Never sacrifice correctness for an unmeasured performance improvement.

---

# 60. FINAL TEST REPORT

After meaningful development work, provide:

```text
TEST & QUALITY REPORT

Feature:
[feature name]

Functional Testing:
PASS / FAIL / BLOCKED

Regression Testing:
PASS / FAIL / BLOCKED

Integration Testing:
PASS / FAIL / BLOCKED

UI/UX:
PASS / FAIL / BLOCKED

Responsive:
PASS / FAIL / BLOCKED

Performance:
PASS / FAIL / BLOCKED

Security:
PASS / FAIL / BLOCKED

SEO:
PASS / FAIL / N/A

Type Check:
PASS / FAIL / N/A

Lint:
PASS / FAIL / N/A

Build:
PASS / FAIL / N/A

CLAUDE.md Compliance:
PASS / FAIL

Project Skills Compliance:
PASS / FAIL

Issues Found:
- ...

Issues Fixed:
- ...

Remaining Risks:
- ...

Final Status:
READY / NOT READY
```

Only report checks that were actually performed.

---

# 61. GIT RULE

Testing must NEVER perform Git operations automatically.

Do NOT:

- git commit
- git push
- git pull
- git merge
- git rebase
- create branches
- modify Git configuration

unless explicitly instructed by the user.

Testing may inspect project files and Git state when necessary, but must not modify repository history or perform Git operations without explicit permission.

---

# 62. FINAL PRINCIPLE

The project should never be considered "good" merely because the newly requested feature works.

A good implementation is:

```text
Functional
+
Reliable
+
Tested
+
Regression-safe
+
Performant
+
Secure
+
Accessible
+
SEO-friendly
+
Responsive
+
Modular
+
Maintainable
+
Consistent with CLAUDE.md
+
Consistent with all project skills
```

The responsibility of this skill is to continuously protect the quality of the entire project as it evolves.