# SAARTHI — SMART SELLER & CUSTOMER COMMERCE ENGINE

## Purpose

This specification covers **only the Seller + Customer smart commerce work discussed today**.

The goal is to introduce a scalable marketplace model where:

- **Seller** is the universal marketplace account type for anyone selling goods.
- Sellers are not divided into category-specific account types.
- Sellers can sell many types of products such as furniture, wood, sand, steel, etc.
- Seller product creation uses a **small, intelligent form**, not a large static form.
- Customers use the same intelligence approach when posting requirements.
- Seller products and Customer requirements use a **shared product/category taxonomy** so they can be matched.
- AI helps classify/extract information, but AI is not the source of truth.
- The system should ask users only for information that is actually missing.
- Existing project architecture must be inspected and reused.
- The communication boundary must remain:
  **Customer ↔ Fleet Owner ↔ Seller**
  with no direct Customer ↔ Seller communication.

This document should be used by Claude Code after first inspecting the existing Saarthi project.

> **Do not rebuild unrelated Saarthi systems. Do not modify payment, referral, verification, vehicle, tracker, telemetry, Driver App, or GODWeb functionality as part of this task unless an explicit dependency is discovered and reported.**

---

# 1. SELLER IS A UNIVERSAL ACCOUNT TYPE

The current customer-facing terminology should move toward:

**Seller**

instead of the narrower term:

**Supplier**

The purpose is to support a universal marketplace.

A Seller may sell:

```text
Sand
Furniture
Wood
Steel
Cement
Bricks
Electronics
Equipment
Agricultural goods
Spare parts
Other physical goods
```

Do NOT create account types such as:

```text
FURNITURE_SELLER
WOOD_SELLER
SAND_SELLER
STEEL_SELLER
```

There should be one operational role:

```text
ACCOUNT TYPE = SELLER
```

What the Seller sells belongs to a separate **category/product taxonomy**.

---

# 2. DO NOT CONFUSE ACCOUNT TYPE WITH PRODUCT CATEGORY

These are separate concepts.

```text
Account Type
└── SELLER
```

Then:

```text
Seller Category
├── Furniture
├── Construction Materials
├── Wood & Timber
├── Metal & Steel
├── Electronics
├── Agriculture
├── Industrial Equipment
├── Home & Kitchen
├── Automotive
├── Textiles
└── Other
```

Then:

```text
Product Category
```

can go deeper:

```text
Furniture
 └── Tables
      └── Dining Table
```

or:

```text
Construction Materials
 └── Sand
      └── River Sand
```

or:

```text
Wood & Timber
 └── Timber
      └── Teak Wood
```

A Seller may have products in multiple categories.

Example:

```text
Seller
 ├── Furniture
 ├── Wood & Timber
 └── Hardware
```

Do not create multiple Seller account types for this.

---

# 3. INTERNAL SUPPLIER → SELLER MIGRATION

Before changing an existing internal enum/model such as:

```text
SUPPLIER
```

to:

```text
SELLER
```

Claude must audit the entire project.

Inspect:

- Database enums
- Prisma/schema
- Migrations
- APIs
- Services
- RBAC
- Registration
- Onboarding
- Navigation
- Dashboard
- Marketplace
- Inventory
- Orders
- Tests
- Translations
- Notifications
- Existing documentation

Prefer a safe terminology migration.

Do not blindly perform a global text replacement.

If the existing `SUPPLIER` domain model is working correctly, determine whether:

```text
Internal = SUPPLIER
Display = SELLER
```

is safer as an intermediate step.

Only rename the internal domain when the audit confirms it can be done without breaking existing functionality.

---

# 4. DATA-DRIVEN CATEGORY ENGINE

Do NOT hardcode a different form for every product category.

Do NOT require Claude to be told manually:

> If Furniture, create these fields.

> If Wood, create those fields.

> If Sand, create different fields.

Instead build a **generic Category / Attribute Engine**.

Conceptually:

```text
CategoryDefinition
├── id
├── parentCategoryId
├── name
├── slug
├── description
└── status
```

and:

```text
CategoryAttribute
├── id
├── categoryId
├── name
├── label
├── type
├── required
├── unit
├── options
├── validation
└── sortOrder
```

The data model defines the schema.

The UI generates the appropriate small form from the schema.

---

# 5. CATEGORY HIERARCHY

The category system must support multiple levels.

Example:

```text
Furniture
  └── Tables
       └── Dining Tables
```

Example:

```text
Construction Materials
  └── Sand
       └── River Sand
```

Example:

```text
Wood & Timber
  └── Timber
       └── Teak Wood
```

The taxonomy must be extensible without creating new Account Types.

Support:

- Parent categories
- Child categories
- Product types
- Aliases/synonyms
- Category-specific attributes
- Units
- Validation rules
- Required/optional fields
- Active/inactive categories

---

# 6. SELLER PRODUCT ENTRY — SMALL FORM

The Seller should NOT see a large form containing every possible field.

The first interaction should be simple.

Example:

```text
Add Product

What are you selling?

[ Teak wood 6-seater dining table ]

[ Continue ]
```

The system then determines what is already known.

Possible structured result:

```text
Category:
Furniture

Subcategory:
Tables

Product Type:
Dining Table

Material:
Teak Wood

Capacity:
6 Seater
```

Then ask only for genuinely missing important fields:

```text
Price:
₹ ______

Available Quantity:
____
```

This should result in a very small and focused form.

---

# 7. PROGRESSIVE INFORMATION COLLECTION

Do not ask all questions at once.

Use:

```text
User Input
 ↓
Known Information
 ↓
Missing Required Information
 ↓
Ask Only Missing Information
 ↓
Confirm
 ↓
Save
```

Example:

Seller enters:

```text
Wooden dining table
```

Known:

```text
Furniture
Dining Table
Wood
```

Ask:

```text
What is the price?
How many are available?
```

If the user enters:

```text
Teak 6-seater dining table ₹25,000, 5 available
```

the system should recognize:

```text
Material = Teak
Capacity = 6
Price = ₹25,000
Stock = 5
```

and should NOT ask those questions again.

---

# 8. CUSTOMER REQUIREMENT ENTRY — SAME PRINCIPLE

Customers should also avoid large static forms.

Initial interaction:

```text
Post Requirement

What do you need?

[ I need 25 tons of river sand from Saharanpur to Lucknow within 3 days. ]

[ Continue ]
```

The system can derive:

```text
Category:
Construction Materials

Product:
Sand

Type:
River Sand

Quantity:
25

Unit:
Ton

Pickup:
Saharanpur

Delivery:
Lucknow

Required By:
3 days
```

Then ask only what is missing or ambiguous.

Example:

```text
What quality/grade do you need?
```

The user confirms the final structured requirement.

---

# 9. SAME ENGINE, DIFFERENT SCHEMA

Seller and Customer should share the same underlying commerce taxonomy, but their record types are different.

```text
SMART COMMERCE ENGINE
          │
    ┌─────┴─────┐
    ↓           ↓
 SELLER       CUSTOMER
    ↓           ↓
 Product     Requirement
 Schema       Schema
    │           │
    └─────┬─────┘
          ↓
   Shared Taxonomy
```

Seller creates:

```text
Product
```

Customer creates:

```text
Requirement
```

They should use compatible normalized fields so the marketplace can match them.

---

# 10. SHARED TAXONOMY ENABLES MATCHING

Example Customer requirement:

```text
I need 25 tons of river sand.
```

Structured:

```text
Construction Materials
→ Sand
→ River Sand
→ Quantity: 25 tons
```

Seller listing:

```text
Construction Materials
→ Sand
→ River Sand
→ Stock: 40 tons
→ Price: ₹2,000/ton
```

These can be matched using structured data.

Another example:

Customer:

```text
I need 20 teak dining tables.
```

Seller:

```text
Furniture
→ Dining Tables
→ Teak
→ Stock: 30
```

The engine should support this same approach for many categories.

---

# 11. AI'S ROLE

AI is an **intelligence layer**, not the source of truth.

AI can help with:

- Natural-language understanding
- Category classification
- Product classification
- Attribute extraction
- Requirement extraction
- Synonym interpretation
- Missing-information suggestions
- Ambiguity detection

AI must NOT:

- Invent production database schemas
- Create arbitrary database fields
- Change RBAC
- Change permissions
- Determine payment values
- Publish commercial data without confirmation
- Override backend validation

Correct architecture:

```text
User Input
 ↓
AI Suggestion / Extraction
 ↓
Existing Category & Attribute Schema
 ↓
Backend Validation
 ↓
User Confirmation
 ↓
Save
```

---

# 12. DETERMINISTIC-FIRST, AI-SECOND

Do not call AI for every product or requirement.

Use existing deterministic data first:

```text
Input
 ↓
Normalize
 ↓
Known aliases
 ↓
Existing taxonomy match
 ↓
High confidence?
 ├── YES → Continue without AI
 └── NO / AMBIGUOUS
       ↓
     AI
       ↓
 Structured suggestion
       ↓
 Backend validation
```

This keeps cost and latency under control.

Do not claim an exact AI savings percentage until real usage is measured.

---

# 13. AI USAGE COST CONTROL

Gemini may incur API usage cost.

Therefore implement:

## Rate Limiting

Limit intelligent classification/extraction requests by appropriate:

- User
- Account
- Time window
- IP/device where appropriate

## Caching

Cache safe repeated classifications.

Example:

```text
"river sand"
→ known taxonomy result
→ reuse
```

Do not cache sensitive personal information inappropriately.

## Token Minimization

Send only what is needed:

```text
User text
+
Relevant categories
+
Relevant schema
+
Expected output schema
```

Do NOT send:

- Entire Saarthi database
- Entire project
- Full user history
- Unnecessary personal data

---

# 14. STRUCTURED AI OUTPUT

AI should return structured data instead of uncontrolled prose.

Conceptual result:

```json
{
  "categoryId": "...",
  "productTypeId": "...",
  "attributes": {},
  "missingFields": [],
  "confidence": 0.94
}
```

The actual JSON schema must be defined by the existing backend.

Backend must validate the output before using it.

Malformed or unexpected fields must be safely rejected/ignored.

---

# 15. CONFIDENCE HANDLING

Use confidence to decide the UX.

### High confidence

```text
Prefill
```

### Medium confidence

```text
Suggestion
+
User confirmation
```

### Low confidence

```text
Ask the user directly
```

Do not silently publish low-confidence results.

---

# 16. CONFIRM BEFORE PUBLISH / POST

Commercially important information must be user-confirmed.

Seller:

```text
AI/Engine Result
 ↓
Seller Reviews
 ↓
Confirm
 ↓
Publish Product
```

Customer:

```text
AI/Engine Result
 ↓
Customer Reviews
 ↓
Confirm
 ↓
Post Requirement
```

The user remains in control of the final data.

---

# 17. GENERIC FALLBACK

The taxonomy will not know every product.

Provide:

```text
Other
```

with a generic fallback schema.

Example:

```text
Seller:
"I sell a specialized industrial item."
```

If the system cannot confidently classify it:

```text
Category:
Other
```

Then collect basic structured information.

An administrator can later create a formal category based on repeated demand.

AI must never dynamically alter the production database schema.

---

# 18. USER CORRECTION

Users must be able to correct AI-prepopulated information.

Example:

```text
Saarthi detected:
Material = Teak Wood

[ Edit ]
```

User can change it.

The final user-confirmed value becomes authoritative.

Do not silently override user corrections with a later AI request.

---

# 19. SELLER LISTING MODEL

A Seller product/listing should conceptually contain:

```text
Seller
 ↓
Product
 ↓
Category
 ↓
Product Type
 ↓
Attributes
 ↓
Price
 ↓
Stock
 ↓
Availability
 ↓
Media
```

Use existing project models where possible.

Do not create duplicate inventory/product systems.

---

# 20. CUSTOMER REQUIREMENT MODEL

A Customer requirement should conceptually contain:

```text
Customer
 ↓
Requirement
 ↓
Category
 ↓
Product Type
 ↓
Required Attributes
 ↓
Quantity
 ↓
Unit
 ↓
Location / Delivery Information
 ↓
Required Date / Window
```

Use the existing requirement model where possible.

Do not create a duplicate requirement engine if one already exists.

---

# 21. FLEET OWNER MARKETPLACE CONNECTION

The Smart Commerce Engine should support the existing Fleet Owner marketplace flow.

```text
Customer
 ↓
Posts structured requirement
 ↓
Fleet Owner sees requirement
 ↓
Fleet Owner searches matching Sellers
 ↓
Seller inventory
 ↓
Availability / Stock
 ↓
Seller price
 ↓
Fleet Owner calculates economics
 ↓
Fleet Owner bids Customer
```

The smart engine provides better structured matching.

It does not replace the Fleet Owner's business role.

---

# 22. COMMUNICATION BOUNDARY — NON-NEGOTIABLE

For freight/material marketplace:

```text
CUSTOMER
   ↕
FLEET OWNER
   ↕
SELLER
```

There is **NO direct Customer ↔ Seller communication**.

There is also **NO direct Customer ↔ Driver communication**.

The Fleet Owner is the commercial and operational bridge.

### Customer ↔ Fleet Owner

Allowed for:

- Requirement
- Clarifications
- Bid
- Price
- Delivery expectations
- Order
- Trip/order status
- Relevant transaction matters

### Fleet Owner ↔ Seller

Allowed for:

- Product/material
- Availability
- Stock
- Seller price
- Procurement
- Loading
- Supply coordination
- Relevant procurement matters

### Customer must not receive:

- Seller phone number
- Seller direct chat
- Seller WhatsApp
- Seller direct contact information

Likewise, Seller must not receive direct Customer contact unless a future explicit business rule changes this.

---

# 23. SMART MATCHING MUST NOT CREATE DIRECT CONTACT

Even when the engine identifies a highly relevant Seller:

```text
Customer Requirement
 ↓
Matching
 ↓
Potential Seller
```

this does NOT authorize:

```text
Customer → Seller
```

The correct flow remains:

```text
Customer
 ↓
Fleet Owner
 ↓
Seller
```

Matching and communication authorization are separate systems.

---

# 24. CATEGORY ENGINE SHOULD SUPPORT MULTIPLE SELLER PRODUCTS

A Seller may list multiple products across categories.

Example:

```text
Seller
├── Teak Dining Table
├── Office Chair
├── Wooden Cabinet
└── Plywood
```

Do not create a separate Seller account for each product category.

---

# 25. CATEGORY-SPECIFIC FIELDS SHOULD BE DYNAMIC

A furniture product may need fields relevant to furniture.

A sand listing may need fields relevant to material quantities.

A wood listing may need fields relevant to timber.

The form engine should obtain this from the category schema.

Do NOT hardcode:

```text
if furniture -> fields X
if sand -> fields Y
if wood -> fields Z
```

through scattered conditional UI code.

Prefer a reusable schema/attribute engine.

---

# 26. FORM DESIGN PRINCIPLE

The goal is:

> **Small input → intelligent interpretation → only missing information → confirmation.**

Not:

> **Large form → user manually fills everything.**

The UI should progressively reveal only what is relevant.

This applies to both:

```text
Seller Product Creation
```

and:

```text
Customer Requirement Creation
```

---

# 27. AI COST SHOULD BE INVISIBLE TO USERS

Do not display AI technical information in normal commerce UI.

Users should see:

```text
Detected Category
Detected Product
Detected Details
```

not:

```text
Gemini confidence 0.94
Tokens used
AI provider
```

Technical/usage metrics belong in admin/observability tooling.

---

# 28. ADMIN CATEGORY MANAGEMENT

The architecture should make it possible for authorized administrators to:

- Create category
- Edit category
- Create child category
- Add attribute
- Mark attribute required/optional
- Define units
- Define options
- Add aliases
- Disable a category
- Review "Other" usage

Do not allow ordinary Sellers or Customers to modify the global production taxonomy.

---

# 29. SEARCH / MATCHING

Search should use structured data where possible:

```text
Category
Product Type
Attributes
Location
Availability
Stock
Price
```

Free-text search can supplement structured matching.

Do not depend entirely on AI to find Sellers.

---

# 30. PERFORMANCE

The Smart Commerce Engine should be designed so basic known-category interactions work without unnecessary external AI requests.

Prefer:

```text
Local/Database
→ Fast match
→ AI only when necessary
```

Avoid blocking the entire form while unnecessary AI calls run.

Use appropriate loading states and fallbacks.

---

# 31. ERROR / FALLBACK UX

Handle:

- AI timeout
- AI provider failure
- Invalid AI response
- Unknown category
- Missing schema
- Missing required information
- User correction
- Duplicate product
- Duplicate requirement

When AI is unavailable, the system should still provide a usable fallback form.

AI must be an enhancement, not a single point of failure for marketplace operation.

---

# 32. PRIVACY

Send only the minimum information necessary to AI services.

Do not unnecessarily send:

- Identity documents
- Bank information
- Payment credentials
- Full user profiles
- Sensitive verification data
- Unrelated account history

The Smart Commerce Engine should operate primarily on:

- Product descriptions
- Requirement descriptions
- Relevant category/schema context

---

# 33. SECURITY

The backend remains authoritative for:

- Product ownership
- Requirement ownership
- Price
- Stock
- Quantity
- Category IDs
- Attribute values
- Publication state
- Account type
- Permissions
- Communication access

Never trust AI output or frontend state as authorization.

---

# 34. TESTING

## Seller

Test:

- Seller creates product
- Natural-language entry
- Known category
- Unknown category
- AI classification
- Missing-field detection
- User correction
- Confirmation
- Publication
- Multiple products/categories

## Customer

Test:

- Customer posts requirement
- Natural-language entry
- Known category
- Unknown category
- AI extraction
- Missing-field detection
- User correction
- Confirmation
- Requirement publication

## Matching

Test:

- Exact product match
- Category match
- Attribute match
- Stock sufficiency
- Availability
- Quantity
- Location where supported

## Communication

Test:

```text
Customer → Fleet Owner = Allowed
Fleet Owner → Seller = Allowed
Customer → Seller = Blocked
Customer → Driver = Blocked
Seller → Customer = Blocked
Driver → Customer = Blocked
```

Test both UI and direct APIs.

## AI

Test:

- High confidence
- Medium confidence
- Low confidence
- Malformed output
- Timeout
- Rate limit
- Cache
- User correction
- Fallback without AI

---

# 35. ACCEPTANCE CRITERIA

The Seller/Customer smart commerce implementation is complete when:

1. Seller is a universal marketplace Account Type.
2. Product categories are separate from Account Type.
3. A Seller can sell multiple product categories.
4. New categories do not require new Account Types.
5. Category definitions are data-driven.
6. Category attributes are schema-driven.
7. Seller forms are compact and progressive.
8. Customer requirement forms are compact and progressive.
9. Natural-language input can prefill known data.
10. Only missing important information is requested.
11. Seller and Customer use the same normalized taxonomy.
12. Structured data supports marketplace matching.
13. AI is used only where useful.
14. Deterministic matching is used first where possible.
15. AI usage is rate-limited.
16. Safe caching is used where appropriate.
17. AI prompts are token-minimized.
18. AI uses structured outputs.
19. Backend validates AI output.
20. User confirms important AI-generated commercial information.
21. Low-confidence results are not silently published.
22. Unknown products have a safe fallback.
23. AI failure does not break the core form flow.
24. Customer can interact with Fleet Owner.
25. Fleet Owner can interact with Seller.
26. Customer cannot directly contact Seller.
27. Customer cannot directly contact Driver.
28. The Smart Commerce Engine does not create communication bypasses.
29. Existing product/requirement systems are reused where possible.
30. No duplicate product, inventory, requirement, taxonomy, or AI engine is created.

---

# 36. CLAUDE CODE EXECUTION WORKFLOW

Claude must follow:

```text
READ
 ↓
UNDERSTAND
 ↓
AUDIT EXISTING PRODUCT/REQUIREMENT ARCHITECTURE
 ↓
AUDIT SUPPLIER/SELLER DOMAIN
 ↓
AUDIT NAVIGATION AND UI
 ↓
AUDIT SEARCH/MATCHING
 ↓
AUDIT EXISTING AI/GEMINI INTEGRATION
 ↓
AUDIT DATABASE
 ↓
AUDIT RBAC
 ↓
IDENTIFY REUSABLE SYSTEMS
 ↓
IDENTIFY GAPS
 ↓
PROPOSE MINIMUM SAFE IMPLEMENTATION
 ↓
IMPLEMENT ONLY REQUIRED CHANGES
 ↓
RUN TESTS
 ↓
VERIFY END-TO-END
 ↓
REPORT
```

Do not blindly create a new architecture if an equivalent system already exists.

---

# 37. FINAL DESIGN PRINCIPLE

Saarthi should make marketplace entry feel simple:

```text
SELLER

"What do you sell?"

User types naturally.

        ↓

Saarthi understands.

        ↓

Only missing information is requested.

        ↓

Seller confirms.

        ↓

Product is published.
```

And Customer should have the same simplicity:

```text
CUSTOMER

"What do you need?"

User types naturally.

        ↓

Saarthi understands.

        ↓

Only missing information is requested.

        ↓

Customer confirms.

        ↓

Requirement is posted.
```

Behind the simple UI:

```text
Shared Taxonomy
+
Category Schema Engine
+
Deterministic Matching
+
AI Classification/Extraction
+
Backend Validation
+
User Confirmation
```

The experience should be **simple for the user while remaining structured and scalable internally**.
