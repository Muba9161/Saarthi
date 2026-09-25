# Smart commerce engine — implementation

**Spec:** `SAARTHI_SMART_SELLER_CUSTOMER_COMMERCE_ENGINE.md`
**Migration:** `20260925140000_commerce_taxonomy` (additive)

---

## What changed, in one paragraph

A Seller is one account type whatever it sells; what it sells is a node in a shared, data-driven
taxonomy with an attribute schema. Sellers add a product and customers post a material need by
typing one line; the engine reads the category, details, price, stock, quantity, places and
deadline it can, asks only for what is missing, and the user reviews before anything is saved.
A fleet owner answers a customer's material need by sourcing from a seller listing — ranked for it
by structured matching — and the customer and seller never learn each other's contact details.

---

## Decisions taken

| Question | Decision |
|---|---|
| `SUPPLIER` → `SELLER` | **Display only.** `SUPPLIER` stays the internal role, organization type and plan tier; every user-facing label says Seller. |
| Communication boundary | **Enforced in full** — see below. |
| Starter taxonomy | Seeded, create-only (an administrator's edits survive every deploy). |
| Admin | API plus `/admin/commerce` page. |

---

## Taxonomy and schema

- `commerce_categories` (tree, `parentId`), `commerce_category_attributes`, `commerce_category_aliases`.
- A node inherits every ancestor's attributes; a child redefining a key overrides it. Attributes are
  scoped `BOTH | PRODUCT | REQUIREMENT`.
- `Other` is the fallback node. It cannot be disabled or given children.
- `Material` and `Requirement` gained `categoryId` + `attributes` (JSON). The free-text `category` /
  `materialCategory` columns are kept and derived from the node's name, so legacy filters still work.
- Values are validated by one function (`validateAttributeValues`) for typed, prefilled and
  AI-suggested values alike. Unknown keys are dropped — nobody can add a column by inventing a key.

## The engine — deterministic first, AI second

```
text → normalise → names + aliases → most specific node (head noun wins)
                                   ├─ confident            → done, no AI call
                                   └─ unknown / ambiguous  → AI suggestion → validated → merged
```

| Rule | Where |
|---|---|
| Classification, extraction, confidence bands, matching score | `packages/shared/src/domain/commerce*.ts` (pure, tested) |
| User-locked values are never overridden | `interpretCommerceText` precedence: locked > stated in text > suggested |
| AI result capped below HIGH — always a suggestion to confirm | `commerce-ai.service.ts` |
| AI sees the product line (phone/e-mail stripped) + candidate paths under opaque refs + attribute keys of the top five. No user, org or history. | `commerce-ai.service.ts` |
| JSON mode (Groq: `json_object`; Gemini: response schema); output re-validated with zod; category must be one of the candidates offered | `groq-ai.provider.ts`, `gemini-ai.provider.ts`, `commerce-ai.service.ts` |
| Provider chain: `AI_MODEL` → each of `AI_FALLBACK_MODELS` → local analyst. Failures move down the chain; a rate-limited model sits out 60 s. | `providers/ai/fallback-ai.provider.ts`, `providers/ai/index.ts` |
| Rate limit: `COMMERCE_INTERPRET_RATE_LIMIT`/min per user. Daily AI budget per user and per org. Timeout `COMMERCE_AI_TIMEOUT_MS`. Kill switch `COMMERCE_AI_ENABLED`. | `config/env.ts` |
| Cache: validated AI answers, keyed by scope + taxonomy version + hash of normalised text (never the text). 7 days. Taxonomy edits rotate the version. | `infra/cache-keys.ts` |
| Every call metered in `ai_usage` as `commerce.classify`, excluded from the copilot's plan allowance | `modules/ai/ai-usage.ts` |
| Any AI failure → deterministic result; the form keeps working | `suggestCategory` returns `null` |

Users see "Detected", "Is this right?" or "What is it?" — never a provider, token count or score.

## Communication boundary

`packages/shared/src/domain/communication.ts` — `canCommunicate` (contact channels) and
`mayKnowCounterparty` (identity). Blocked: Customer ↔ Seller (both), Customer ↔ Driver (contact).

| Path that existed | Now |
|---|---|
| Sellers bid `MATERIAL` straight to customers | No organization may bid `MATERIAL`; legacy bids cannot be awarded. Fleets answer with a delivered bid that must name a seller listing. |
| Sellers saw the requirement board | Seller role lost `requirements.read/bid`. |
| Customers browsed seller catalogues (`/browse`) | Customer role lost `materials.read`, `suppliers.read`, `inventory.read`; menu entry moved to fleets as *Find sellers*. |
| Customers ordered a seller listing directly | `createOrderSchema` no longer accepts `materialId`; a direct order is transport for the customer's own goods. |
| Customer could name a listing on a requirement | `materialDetail.materialId` removed. |
| Winner of a requirement got the customer's phone | Only if the winner may contact the customer (fleet / mobility provider). |
| Order and trip views showed seller ↔ customer names; trip showed driver phone to customer | Redacted per viewer in `order.service` / `trip.service`. |
| Directory profile exposed support phone/e-mail/website | Stripped across blocked pairs. |

Matching (`GET /commerce/requirements/:id/matches`) is fleet-only and names sellers because the
fleet deals with them. It authorises nothing.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/commerce/categories` | Sellers, customers |
| POST | `/commerce/interpret` | Sellers, customers (rate-limited) |
| GET | `/commerce/requirements/:id/matches` | Fleet owners / enterprises |
| GET, POST | `/admin/commerce/categories` | Platform admin |
| PATCH | `/admin/commerce/categories/:id` | Platform admin |
| POST | `/admin/commerce/categories/:id/attributes`, `/aliases` | Platform admin |
| PATCH, DELETE | `/admin/commerce/attributes/:id`; DELETE `/admin/commerce/aliases/:id` | Platform admin |
| GET | `/admin/commerce/other-usage` | Platform admin |

`POST/PATCH /marketplace/materials` and `POST /requirements` accept `categoryId` + `attributes`,
validate them against the schema, and refuse duplicates (409).

## Web

- `/supplier/materials/new` — "What are you selling?" → detected → only missing → review → publish.
- Requirement wizard, material step — "What do you need?"; quantity, cities and deadline carried
  into the later steps; no seller picker, no "collect it myself" switch.
- Bid dialog — delivered bid with a ranked seller-listing picker (stock, details, distance).
- `/admin/commerce` — tree, details, attributes, aliases, disable, "Filed under Other".
- Components live in `apps/web/src/features/commerce/`; forms are generated from the schema.

## Known follow-ups

- `pages/requirements/new-requirement.tsx` is still ~1,100 lines (was 1,139). Extracting the cab and
  tour detail bodies the way the material one was extracted would bring it under the limit.
- Editing an existing seller listing reuses the API but has no web screen yet.
- Legal pages still say "supplier"; changing legal copy needs legal review.
- Requirement coordinates are still typed by hand; cities are prefilled from the text, not geocoded.
