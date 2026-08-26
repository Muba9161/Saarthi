# SAARTHI — Feature Expansion Specification (Batch 2)
## Version 1.0 — Eight New Capabilities on the Existing Platform

> **Source:** handwritten requirement sheet, 8 numbered items.
> **Purpose:** integrate all eight into the *existing* Saarthi codebase — additively,
> backward-compatibly, and with no parallel application, no second website and no
> duplicate account system.

---

## 0. The eight requirements

| # | Requirement (as written) | Becomes |
|---|---|---|
| 1 | *Images everywhere in the project for any account type and to be displayed everywhere.* | **Universal Media Library** (§2) |
| 2 | *Stock and Item availability by supplier.* | **Supplier Inventory & Availability** (§3) |
| 3 | *Introducing marketplace for selling old vehicles listed on the system as per RBAC, no external user.* | **Vehicle Resale Marketplace** (§4) |
| 4 | *Profile builder for profile settings.* | **Profile Builder** (§5) |
| 5 | *QR generation for both driver & truck.* | **QR Identity** (§6) |
| 6 | *Return order for Trucks so they never return empty handed.* | **Return Loads / Backhaul** (§7) |
| 7 | *If there is no entry, then small pickup can connect with these trucks to deliver item inside city.* | **City Access & Last-Mile Relay** (§8) |
| 8 | *To show live traffic lights, speed cameras or police checking on the route of the truck.* | **Route Intelligence** (§9) |

---

# 1. IMPLEMENTATION RULES

Saarthi is an **already-built** monorepo. These eight features are extensions.

## 1.1 Non-negotiables

1. **Nothing existing is removed, renamed or repurposed.** Every column, endpoint,
   permission string, enum value, route and component that exists today keeps working
   exactly as it does today.
2. **Every schema change is additive.** New models, new nullable columns, new enum
   *values*. No column drops, no type narrowing, no required column without a default
   on a populated table.
3. **One platform.** No new app, no new login, no new nav tree. Features slot into the
   existing shell, the existing navigation model and the existing role-based redirects.
4. **The API is the only authority.** The frontend hides what a user cannot use as a
   courtesy; every route re-checks permission, tenancy and entitlement server-side.
5. **Tenant isolation via the existing helpers** — `tenantScope(auth)`,
   `assertTenantAccess(auth, record.organizationId)`. No hand-rolled org filters.
6. **Contracts live in `@saarthi/shared`.** Enums mirror `schema.prisma` exactly; Zod
   schemas are the single validation source for both API and client.
7. **No new native dependencies.** Image processing happens in the browser before
   upload (canvas), not with `sharp`. The only new runtime dependency is `qrcode`
   (pure JavaScript, no build step).
8. **Audit everything** that changes ownership, money, stock or identity.

## 1.2 Existing building blocks to reuse — do not reinvent

| Need | Existing thing |
|---|---|
| File persistence | `apps/api/src/providers/storage` (`storageProvider`, magic-byte sniffing, traversal-safe keys) |
| Auth context | `apps/api/src/auth/context.ts` → `AuthContext` |
| Guards | `requireAuth`, `requireOrganizationId`, `requirePermission`, `requireFeature`, `requireRole`, `requirePlatformAdmin`, `assertTenantAccess`, `tenantScope` |
| HTTP helpers | `ok`, `created`, `noContent`, `paginated`, `parseBody`, `parseQuery`, `parseParams`, `parseInput`, `skipTake` |
| Errors | `errors.*` in `apps/api/src/lib/errors.ts` |
| Audit | `auditFromRequest`, `AuditAction` |
| Notifications | `notification.service.ts` → `notifyUser`, `notifyOrganization` |
| Realtime | `realtime.service.ts` + `RealtimeChannel` / `RealtimeEvent` in shared |
| Geo maths | `distanceKm`, `LatLng`, bounding boxes in `shared/domain/geo.ts` |
| Background work | `apps/api/src/jobs/index.ts` (driver-agnostic queue) |
| Pagination | `buildPaginationMeta`, `skipTake` |
| Map layers | `apps/web/src/features/maps/*` (Mapbox GL, `map-layers.ts`, `fleet-map.tsx`) |
| Tables / states | `components/common/data-table.tsx`, `states.tsx`, `status-badge.tsx` |

## 1.3 Definition of done, per feature

- Prisma models + migration; `npm run db:generate` clean.
- Shared enums + Zod schemas + types exported from `@saarthi/shared`.
- Service layer with tenancy, validation and business rules.
- Fastify routes mounted in `server/routes.ts`, guarded by permission + entitlement.
- RBAC grants for every affected role.
- Seed data so the feature is demonstrable after `npm run db:seed`.
- Frontend route, navigation entry, page with loading / empty / error states, responsive.
- Notifications and realtime events where the feature is time-critical.
- Audit entries for state changes.
- Tests: domain unit tests for pure logic, API integration tests for routes.

---

# 2. FEATURE 1 — UNIVERSAL MEDIA LIBRARY

> *"Images everywhere in the project for any account type and to be displayed everywhere."*

## 2.1 Problem with today's state

Images are ad-hoc strings: `User.avatarUrl`, `Organization.logoUrl`,
`Material.imageUrl`. There is no upload path for any of them, no ownership model, no
access control, no thumbnails and no galleries — and nothing at all for trucks,
drivers, incidents, deliveries, listings or hazards. The `Document` table *can* hold
images but it is a compliance artefact (versioned, verifiable, expiring, private),
which is the wrong shape for a truck photo or an avatar.

## 2.2 Design

One new subsystem, `media`, that any entity can attach images to.

```text
MediaAsset --owner--> USER | ORGANIZATION | DRIVER | VEHICLE | MATERIAL |
                      INVENTORY_LOCATION | ORDER | TRIP | SOS_INCIDENT |
                      MAINTENANCE_RECORD | FUEL_RECORD | VEHICLE_LISTING |
                      TRAVEL_PACKAGE | ROUTE_HAZARD | RELAY_DELIVERY |
                      TRANSFER_HUB | NEARBY_PLACE | PETROL_STATION |
                      ASSOCIATION | DEVICE
```

**Why no variants table:** without a native image library there is no server-side
resize. The browser produces both renditions before upload (a capped full-size
rendition and a square thumbnail) and the server stores the two objects against one
row. Uploads stay small on a 3G link, the API stays dependency-free, and every list
view still gets a cheap thumbnail.

### Prisma models

```prisma
enum MediaOwnerType {
  USER
  ORGANIZATION
  DRIVER
  VEHICLE
  MATERIAL
  INVENTORY_LOCATION
  ORDER
  TRIP
  SOS_INCIDENT
  MAINTENANCE_RECORD
  FUEL_RECORD
  VEHICLE_LISTING
  TRAVEL_PACKAGE
  ROUTE_HAZARD
  RELAY_DELIVERY
  TRANSFER_HUB
  NEARBY_PLACE
  PETROL_STATION
  ASSOCIATION
  DEVICE
}

enum MediaPurpose {
  AVATAR
  LOGO
  COVER
  GALLERY
  PRODUCT
  VEHICLE_EXTERIOR
  VEHICLE_INTERIOR
  VEHICLE_DAMAGE
  ODOMETER
  PROOF_OF_PICKUP
  PROOF_OF_DELIVERY
  HANDOVER
  INCIDENT
  HAZARD_EVIDENCE
  INSPECTION
  SIGNATURE
  ATTACHMENT
}

enum MediaVisibility {
  PRIVATE        // uploader + platform admin only
  ORGANIZATION   // the owning tenant
  PLATFORM       // any signed-in Saarthi account
  PUBLIC         // servable unauthenticated (marketing only)
}

enum MediaModerationStatus {
  APPROVED
  PENDING_REVIEW
  REJECTED
}

model MediaAsset {
  id             String          @id @default(uuid()) @db.Uuid
  organizationId String?         @db.Uuid
  ownerType      MediaOwnerType
  ownerId        String          @db.Uuid
  purpose        MediaPurpose    @default(GALLERY)
  visibility     MediaVisibility @default(ORGANIZATION)

  storageKey String
  fileName   String
  mimeType   String
  fileSize   Int
  width      Int?
  height     Int?
  checksum   String?

  thumbnailStorageKey String?
  thumbnailWidth      Int?
  thumbnailHeight     Int?
  thumbnailFileSize   Int?

  altText   String?
  caption   String?
  sortOrder Int     @default(0)
  isPrimary Boolean @default(false)

  /// Where the photo was taken, when the client offers it (damage, POD, hazards).
  latitude   Float?
  longitude  Float?
  capturedAt DateTime?

  moderationStatus MediaModerationStatus @default(APPROVED)
  moderationNote   String?
  uploadedById     String    @db.Uuid
  deletedAt        DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@index([ownerType, ownerId, deletedAt, sortOrder])
  @@index([organizationId, purpose])
  @@index([uploadedById])
  @@map("media_assets")
}
```

`isPrimary` is enforced by the service, not the database: setting a new primary clears
the previous one for the same `(ownerType, ownerId, purpose)` inside a transaction. A
partial unique index is deliberately avoided so a soft-deleted row can never block a
re-upload.

### Legacy mirroring (backward compatibility)

When a primary `AVATAR` is set for a `USER`, the service also writes
`User.avatarUrl = /api/v1/media/{id}/file?variant=thumb`. Same for
`Organization.logoUrl` (`LOGO`) and `Material.imageUrl` (`PRODUCT`). Every existing
consumer of those three columns keeps working unchanged; new code reads `MediaAsset`.

## 2.3 Upload pipeline

```text
Browser                                   API
-------                                   ---
pick / camera capture
  |
  +- decode to canvas
  +- correct EXIF orientation
  +- crop (square for avatar/logo)
  +- downscale -> max 1600px long edge -> WebP q0.82  --+
  +- downscale -> 320px square          -> WebP q0.75  --+
                                                         |
                       POST /media (multipart: file, thumbnail, metadata)
                                                         |
        +------------------------------------------------+-------------+
        | 1. permission + entitlement guard                            |
        | 2. owner exists and belongs to the caller's tenant           |
        | 3. magic-byte sniff (reuse detectMimeType)                   |
        | 4. reject non-image mime for image purposes                  |
        | 5. parse intrinsic dimensions from the bytes                 |
        | 6. per-owner count cap                                       |
        | 7. storageProvider.upload() x2                               |
        | 8. MediaAsset row + legacy mirror + audit                    |
        +--------------------------------------------------------------+
```

**Dimension parsing** uses a small dependency-free reader for PNG (IHDR), JPEG (SOFn),
WebP (VP8 / VP8L / VP8X) and GIF headers in
`providers/storage/image-metadata.ts`. Unknown geometry stores `null` — never a guess.

**Accepted types:** the existing `ALLOWED_MIME_TYPES` minus PDF for image purposes.
`ATTACHMENT` purpose may keep PDF.

**New env:**

```text
MEDIA_MAX_FILE_SIZE=5242880        # 5 MB per rendition
MEDIA_MAX_PER_OWNER=24             # gallery items per entity
MEDIA_THUMBNAIL_MAX_SIZE=524288    # 512 KB
```

## 2.4 Serving

`GET /api/v1/media/:id/file?variant=original|thumb`

- Visibility resolution: `PUBLIC` → no auth; `PLATFORM` → any session;
  `ORGANIZATION` → `assertTenantAccess`; `PRIVATE` → uploader or platform admin.
- `ETag` = checksum, `304` on `If-None-Match`.
- `Cache-Control`: `public, max-age=31536000, immutable` for `PUBLIC` / `PLATFORM`;
  `private, max-age=300` for `ORGANIZATION`; `private, no-store` for `PRIVATE`.
- `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`.

## 2.5 API surface

| Method | Path | Permission |
|---|---|---|
| `POST` | `/media` | `media.upload` |
| `GET` | `/media` | `media.read` (`ownerType`, `ownerId`, `purpose`) |
| `GET` | `/media/:id` | `media.read` |
| `GET` | `/media/:id/file` | visibility-based |
| `PATCH` | `/media/:id` | `media.upload` (altText, caption, sortOrder, visibility) |
| `POST` | `/media/:id/primary` | `media.upload` |
| `POST` | `/media/reorder` | `media.upload` |
| `DELETE` | `/media/:id` | `media.delete` |
| `GET` | `/media/owner/:ownerType/:ownerId` | `media.read` |
| `POST` | `/media/:id/moderate` | `media.moderate` |

## 2.6 Frontend

New components under `apps/web/src/features/media/`:

| Component | Purpose |
|---|---|
| `use-media.ts` | queries, upload mutation, browser resize pipeline |
| `image-uploader.tsx` | drag/drop + camera capture, progress, client validation |
| `avatar-editor.tsx` | square crop + zoom, used by the profile builder |
| `entity-image.tsx` | one image with skeleton, initials/icon fallback |
| `media-gallery.tsx` | responsive grid, primary badge, reorder, delete confirm |
| `media-lightbox.tsx` | full-screen viewer with keyboard navigation |

**"Displayed everywhere" — the wiring checklist:**

- App shell user menu, organization switcher, auth/brand areas.
- Fleet: truck list rows, truck detail hero, fleet-map popups.
- Drivers: list, detail hero, score page, achievements, driver app home.
- Marketplace: material cards (browse + supplier catalogue), order detail material strip.
- Orders / trips: proof-of-pickup and proof-of-delivery strips on the timeline.
- SOS: incident photos on incident detail and the association alert view.
- Maintenance: damage photos per record. Fuel: receipt photos.
- Vehicle resale: listing gallery and cards (§4).
- Route hazards: evidence thumbnail in the hazard popup (§9).
- Relay: handover photos (§8).
- Admin: organization and user tables, verification queue.
- Profile builder: avatar and cover (§5).

## 2.7 Entitlement & RBAC

- Feature key `MEDIA_LIBRARY` — **Basic tier and above** (images are table stakes).
- Permissions: `media.read`, `media.upload`, `media.delete`, `media.moderate`.
- Grants: `media.read` to every role. `media.upload` to every role except
  `ASSOCIATION_RESPONDER` (read-only by design) — a driver must be able to photograph
  damage, a supplier a product, a customer a delivery problem. `media.delete` to owners
  and managers. `media.moderate` to `PLATFORM_ADMIN` only.

---

# 3. FEATURE 2 — SUPPLIER INVENTORY & ITEM AVAILABILITY

> *"Stock and Item availability by supplier."*

## 3.1 Problem with today's state

`Material.availableQuantity` is a single mutable float with no ledger, no reservations
and no locations. Two customers can order the same 30 tonnes; nothing decrements on
delivery; nobody is told when stock runs low; and a supplier with three yards cannot
say *where* the material actually is.

## 3.2 Design

A real inventory model, with `Material.availableQuantity` retained as a **denormalised
aggregate** so every existing screen and query keeps working.

```text
Supplier
  +-- InventoryLocation (yard / warehouse / depot)   1..n
        +-- StockItem  (material x location)         1..n
              +-- StockMovement   (append-only ledger)
              +-- StockReservation (order -> quantity held)
```

### Availability formula

```text
available   = onHand - reserved - damaged
sellable    = available + (allowBackorder ? incoming : 0)
status      = OUT_OF_STOCK  when sellable <= 0
              LOW_STOCK     when sellable <= lowStockThreshold
              IN_STOCK      otherwise
              MADE_TO_ORDER when availabilityMode = MADE_TO_ORDER (ignores stock)
              ON_REQUEST    when availabilityMode = ON_REQUEST
```

`Material.availableQuantity` is recomputed as `sum(sellable)` across the material's
locations inside the same transaction as every movement, so the legacy column can never
drift.

### Prisma additions

```prisma
enum InventoryLocationKind {
  YARD
  WAREHOUSE
  DEPOT
  QUARRY
  PLANT
  RETAIL_COUNTER
  TRANSIT
}

enum StockMovementType {
  OPENING_BALANCE
  RECEIPT
  ISSUE
  RESERVE
  RELEASE
  CONSUME
  ADJUSTMENT
  TRANSFER_IN
  TRANSFER_OUT
  RETURN_IN
  DAMAGE
  COUNT_CORRECTION
}

enum StockReservationStatus {
  HELD
  CONFIRMED
  CONSUMED
  RELEASED
  EXPIRED
}

enum MaterialAvailabilityMode {
  IN_STOCK        // sold from tracked stock
  MADE_TO_ORDER   // produced on demand, lead time applies
  ON_REQUEST      // price/availability quoted per enquiry
}

enum StockAvailabilityStatus {
  IN_STOCK
  LOW_STOCK
  OUT_OF_STOCK
  MADE_TO_ORDER
  ON_REQUEST
  DISCONTINUED
}

model InventoryLocation {
  id             String                @id @default(uuid()) @db.Uuid
  organizationId String                @db.Uuid
  supplierId     String                @db.Uuid
  name           String
  code           String
  kind           InventoryLocationKind @default(YARD)
  addressLine    String?
  city           String?
  state          String?
  postalCode     String?
  latitude       Float?
  longitude      Float?
  contactName    String?
  contactPhone   String?
  /// Loading window, minutes from midnight. Null = round the clock.
  openFromMinutes Int?
  openToMinutes   Int?
  isDefault      Boolean  @default(false)
  active         Boolean  @default(true)
  archivedAt     DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([organizationId, code])
  @@index([supplierId, active])
  @@map("inventory_locations")
}

model StockItem {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String   @db.Uuid
  materialId     String   @db.Uuid
  locationId     String   @db.Uuid
  onHandQuantity   Float  @default(0)
  reservedQuantity Float  @default(0)
  incomingQuantity Float  @default(0)
  damagedQuantity  Float  @default(0)
  lowStockThreshold Float @default(0)
  reorderLevel      Float?
  reorderQuantity   Float?
  binReference      String?
  lastCountedAt     DateTime?
  lastMovementAt    DateTime?
  nextRestockAt     DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([materialId, locationId])
  @@index([organizationId, materialId])
  @@map("stock_items")
}

model StockMovement {
  id             String            @id @default(uuid()) @db.Uuid
  organizationId String            @db.Uuid
  stockItemId    String            @db.Uuid
  materialId     String            @db.Uuid
  locationId     String            @db.Uuid
  type           StockMovementType
  /// Signed against on-hand: RECEIPT positive, ISSUE negative, RESERVE zero.
  quantity       Float
  unit           MaterialUnit
  onHandAfter    Float
  reservedAfter  Float
  referenceType  String?
  referenceId    String?  @db.Uuid
  unitCost       Decimal? @db.Decimal(12, 2)
  reason         String?
  note           String?
  actorUserId    String?  @db.Uuid
  occurredAt     DateTime @default(now())
  createdAt      DateTime @default(now())

  @@index([stockItemId, occurredAt])
  @@index([organizationId, occurredAt])
  @@index([materialId, occurredAt])
  @@index([referenceType, referenceId])
  @@map("stock_movements")
}

model StockReservation {
  id             String                 @id @default(uuid()) @db.Uuid
  organizationId String                 @db.Uuid
  stockItemId    String                 @db.Uuid
  materialId     String                 @db.Uuid
  orderId        String?                @db.Uuid
  quantity       Float
  unit           MaterialUnit
  status         StockReservationStatus @default(HELD)
  expiresAt      DateTime?
  releasedAt     DateTime?
  consumedAt     DateTime?
  note           String?
  createdById    String?  @db.Uuid
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([orderId])
  @@index([stockItemId, status])
  @@index([organizationId, status, expiresAt])
  @@map("stock_reservations")
}

model MaterialPriceTier {
  id           String   @id @default(uuid()) @db.Uuid
  materialId   String   @db.Uuid
  minQuantity  Float
  pricePerUnit Decimal  @db.Decimal(12, 2)
  createdAt    DateTime @default(now())

  @@unique([materialId, minQuantity])
  @@map("material_price_tiers")
}
```

### New columns on `Material` (all nullable or defaulted)

| Column | Type | Meaning |
|---|---|---|
| `sku` | `String?` | supplier's own item code |
| `hsnCode` | `String?` | tax classification |
| `brand` | `String?` | brand / grade |
| `stockTracked` | `Boolean @default(false)` | opt into the ledger; `false` = legacy behaviour |
| `availabilityMode` | `MaterialAvailabilityMode @default(IN_STOCK)` | |
| `availabilityStatus` | `StockAvailabilityStatus @default(IN_STOCK)` | denormalised for list filters |
| `lowStockThreshold` | `Float @default(0)` | material-level default |
| `leadTimeDays` | `Int?` | for made-to-order |
| `maximumOrderQty` | `Float?` | cap per order |
| `allowBackorder` | `Boolean @default(false)` | |
| `nextRestockAt` | `DateTime?` | shown to customers when out of stock |
| `reservedQuantity` | `Float @default(0)` | denormalised aggregate |
| `onHandQuantity` | `Float @default(0)` | denormalised aggregate |

`stockTracked = false` keeps the current behaviour exactly: `availableQuantity` is
edited by hand and no ledger is written. Turning it on creates an
`OPENING_BALANCE` movement from the current `availableQuantity` at the default location.

## 3.3 Order integration

| Order transition | Stock action |
|---|---|
| `REQUESTED` with a `materialId` | soft check: reject if `sellable < quantity` and backorder is off |
| `CONFIRMED` | `RESERVE` — create `StockReservation(HELD)`, bump `reservedQuantity` |
| `ASSIGNED` / `PICKUP` | reservation → `CONFIRMED` |
| `DELIVERED` | `CONSUME` — `ISSUE` movement, decrement on-hand, reservation → `CONSUMED` |
| `CANCELLED` / `FAILED` | `RELEASE` — reservation → `RELEASED`, free the quantity |

Reservations carry `expiresAt` (default 72 h, configurable). A sweep releases expired
holds so an abandoned order cannot lock stock forever.

## 3.4 API surface

| Method | Path | Permission |
|---|---|---|
| `GET` | `/inventory/locations` | `inventory.read` |
| `POST` | `/inventory/locations` | `inventory.manage` |
| `PATCH` | `/inventory/locations/:id` | `inventory.manage` |
| `DELETE` | `/inventory/locations/:id` | `inventory.manage` |
| `GET` | `/inventory/stock` | `inventory.read` (filters: material, location, status) |
| `GET` | `/inventory/stock/:id` | `inventory.read` |
| `POST` | `/inventory/stock` | `inventory.manage` (open a stock record) |
| `PATCH` | `/inventory/stock/:id` | `inventory.manage` (thresholds, bin, restock date) |
| `POST` | `/inventory/stock/:id/receipt` | `inventory.manage` |
| `POST` | `/inventory/stock/:id/adjust` | `inventory.manage` (reason required) |
| `POST` | `/inventory/stock/:id/count` | `inventory.manage` (physical count) |
| `POST` | `/inventory/transfer` | `inventory.manage` (location → location) |
| `GET` | `/inventory/movements` | `inventory.read` |
| `GET` | `/inventory/summary` | `inventory.read` (KPIs: value, low, out, reserved) |
| `GET` | `/inventory/low-stock` | `inventory.read` |
| `GET` | `/inventory/reservations` | `inventory.read` |
| `POST` | `/inventory/reservations/:id/release` | `inventory.manage` |
| `GET` | `/marketplace/materials/:id/availability` | `materials.read` (buyer view) |

Buyer-facing availability never exposes exact on-hand for a competitor: the customer
view returns `status`, `sellableQuantity` bucketed (`>100`, `50-100`, `<50`),
`nextRestockAt`, `leadTimeDays` and the pickup location city — not the ledger.

## 3.5 Notifications & jobs

- New `NotificationType`: `STOCK_LOW`, `STOCK_OUT`, `STOCK_RESTOCKED`,
  `STOCK_RESERVATION_EXPIRING`.
- Job `runLowStockSweep()` — hourly; one digest per supplier organization per day
  per material, so a low item does not notify 24 times.
- Job `runStockReservationSweep()` — every 15 min; releases expired holds and writes
  a `RELEASE` movement.

## 3.6 Frontend

- `/supplier/inventory` — stock table: material, location, on-hand, reserved,
  available, status badge, threshold, quick receipt / adjust actions.
- `/supplier/inventory/locations` — location CRUD with map picker.
- `/supplier/inventory/movements` — ledger with filters and CSV export.
- Supplier dashboard: low-stock and out-of-stock KPI cards.
- `/supplier/materials` — availability column, stock-tracking toggle, price tiers.
- `/browse` (customer) — availability badge, "restocks on", lead-time chip, and an
  "in stock only" filter.
- New order form — inline availability check with an explicit warning when the
  requested quantity exceeds sellable stock.

## 3.7 Entitlement & RBAC

- Feature `INVENTORY_MANAGEMENT` — **Basic and above** (a supplier's core job).
- Permissions: `inventory.read`, `inventory.manage`.
- Grants: `SUPPLIER` both; `PLATFORM_ADMIN` both; `FLEET_OWNER` / `FLEET_MANAGER` /
  `CUSTOMER` get `inventory.read` only where they already hold `materials.read`
  (they see the buyer-safe projection, never the ledger).

---

# 4. FEATURE 3 — VEHICLE RESALE MARKETPLACE

> *"Introducing marketplace for selling old vehicles listed on the system as per RBAC,
> no external user."*

## 4.1 Reading of the requirement

- **"old vehicles listed on the system"** — the seller lists a vehicle that already
  exists as a `Truck` row. This is what makes Saarthi's resale market credible: the
  odometer, the service history, the fuel records, the RC lookup and the driver-score
  history are already in the database and become the listing's evidence.
- **"as per RBAC"** — visibility and every action are permission-gated.
- **"no external user"** — there is no public/anonymous surface. No unauthenticated
  route, no share-to-web link, no SEO page. Only signed-in Saarthi accounts see
  listings.

## 4.2 Design

```text
Truck (existing)
  +-- VehicleListing            (one active listing per vehicle)
        +-- MediaAsset[]        (gallery, purpose VEHICLE_*)
        +-- VehicleListingOffer (buyer offers / counters)
        +-- VehicleInspectionRequest
        +-- VehicleListingEvent (timeline)
        +-- VehicleListingWatch (saved by an org)
        +-- VehicleTransfer     (ownership handover on sale)
```

### Prisma models

```prisma
enum VehicleListingStatus {
  DRAFT
  PENDING_REVIEW
  PUBLISHED
  RESERVED
  SOLD
  WITHDRAWN
  REJECTED
  EXPIRED
}

enum VehicleListingVisibility {
  ORGANIZATION   // internal disposal — own tenant only
  ASSOCIATION    // members of the seller's truck association
  PLATFORM       // every verified Saarthi organization (still signed-in only)
}

enum VehicleCondition {
  EXCELLENT
  GOOD
  FAIR
  NEEDS_REPAIR
  NON_RUNNING
}

enum VehicleOfferStatus {
  OFFERED
  COUNTERED
  ACCEPTED
  REJECTED
  WITHDRAWN
  EXPIRED
}

enum VehicleInspectionStatus {
  REQUESTED
  SCHEDULED
  COMPLETED
  DECLINED
  CANCELLED
}

enum VehicleTransferStatus {
  PENDING
  DOCUMENTS_PENDING
  PAYMENT_PENDING
  COMPLETED
  CANCELLED
}

enum VehicleListingEventType {
  CREATED
  UPDATED
  SUBMITTED
  PUBLISHED
  REJECTED
  PRICE_CHANGED
  OFFER_RECEIVED
  OFFER_COUNTERED
  OFFER_ACCEPTED
  OFFER_REJECTED
  INSPECTION_REQUESTED
  INSPECTION_COMPLETED
  RESERVED
  SOLD
  WITHDRAWN
  EXPIRED
  TRANSFER_STARTED
  TRANSFER_COMPLETED
  NOTE
}

model VehicleListing {
  id             String                   @id @default(uuid()) @db.Uuid
  reference      String                   @unique   // VL-2026-000123
  organizationId String                   @db.Uuid  // seller tenant
  vehicleId      String                   @db.Uuid
  status         VehicleListingStatus     @default(DRAFT)
  visibility     VehicleListingVisibility @default(PLATFORM)

  title       String
  description String?
  askingPrice Decimal  @db.Decimal(12, 2)
  negotiable  Boolean  @default(true)
  minimumPrice Decimal? @db.Decimal(12, 2)   // seller-only, never serialised to buyers

  condition          VehicleCondition @default(GOOD)
  odometerKm         Float
  ownershipCount     Int      @default(1)
  accidentHistory    Boolean  @default(false)
  accidentNote       String?
  majorRepairsNote   String?
  tyreConditionPercent Int?
  engineConditionNote  String?
  insuranceValidTill DateTime?
  fitnessValidTill   DateTime?
  permitType         String?
  permitValidTill    DateTime?
  loanOutstanding    Boolean  @default(false)
  hypothecationNote  String?

  city      String?
  state     String?
  latitude  Float?
  longitude Float?

  availableFrom DateTime?
  expiresAt     DateTime?
  viewCount     Int      @default(0)
  offerCount    Int      @default(0)

  submittedAt DateTime?
  publishedAt DateTime?
  reviewedById String?  @db.Uuid
  reviewedAt   DateTime?
  rejectionReason String?

  reservedForOrganizationId String?  @db.Uuid
  soldToOrganizationId      String?  @db.Uuid
  soldPrice                 Decimal? @db.Decimal(12, 2)
  soldAt                    DateTime?
  withdrawnAt               DateTime?
  withdrawalReason          String?

  createdById String   @db.Uuid
  archivedAt  DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  vehicle     Truck                     @relation(fields: [vehicleId], references: [id])
  offers      VehicleListingOffer[]
  inspections VehicleInspectionRequest[]
  events      VehicleListingEvent[]
  watches     VehicleListingWatch[]
  transfer    VehicleTransfer?

  @@index([status, visibility, publishedAt])
  @@index([organizationId, status])
  @@index([vehicleId])
  @@index([city, state])
  @@map("vehicle_listings")
}
```

`VehicleListingOffer`, `VehicleInspectionRequest`, `VehicleListingEvent`,
`VehicleListingWatch` and `VehicleTransfer` follow the same conventions (uuid PK,
tenant column, indexes on the hot query, `createdAt`/`updatedAt`).

One active listing per vehicle is enforced in the service (`status NOT IN (SOLD,
WITHDRAWN, REJECTED, EXPIRED)`), not by a unique index, so history is preserved.

## 4.3 Lifecycle

```text
DRAFT --submit--> PENDING_REVIEW --approve--> PUBLISHED
  |                     |                        |
  |                     +--reject--> REJECTED    +--offer accepted--> RESERVED
  |                                                    |
  +--withdraw--> WITHDRAWN                             +--transfer complete--> SOLD
                                                       +--buyer walks--> PUBLISHED
PUBLISHED --expiresAt passes--> EXPIRED
```

Platform review is on by default (`RESALE_REVIEW_REQUIRED=true`) because a resale
listing is a financial representation about a vehicle. With review disabled, submit
publishes directly.

**Gates before publishing:**

1. The vehicle belongs to the seller's organization.
2. The vehicle is not on an active trip and has no `ACTIVE` `TruckAssignment`.
3. `verificationStatus = VERIFIED` for the vehicle, or platform-admin override.
4. At least three `VEHICLE_EXTERIOR` media assets, and one `ODOMETER` photo.
5. The seller organization is `VERIFIED`.

## 4.4 Evidence pack (what makes this different from a classifieds site)

Assembled read-only from records Saarthi already holds:

- Service history — `MaintenanceRecord` count, last service, total spend, open items.
- Fuel economy — `FuelRecord` derived litres/100 km trend.
- Distance run — `Trip.actualDistanceKm` sum, `odometerKm`.
- Compliance — live `Document` validity for RC / insurance / fitness / permit / PUC.
- Telemetry health — latest `TelemetryReading` and open `TelemetryAlert` counts
  (only when the seller opts in).
- Incidents — count of `SosIncident` involving the vehicle.
- RC snapshot — the stored `VehicleLookup`, if one exists.

Sellers can disable individual evidence blocks; the buyer view then shows
"not shared by the seller", never a fabricated value.

## 4.5 Ownership transfer

On offer acceptance a `VehicleTransfer` is created and drives the handover:

1. `PENDING` → both parties confirm terms.
2. `DOCUMENTS_PENDING` → RC transfer reference, NOC, insurance transfer recorded as
   `Document` rows against the vehicle.
3. `PAYMENT_PENDING` → recorded via the existing `Payment` model
   (`PaymentPurpose.VEHICLE_PURCHASE`, a new enum value).
4. `COMPLETED` → **inside one transaction:**
   - end any `ACTIVE` `TruckAssignment`;
   - unassign devices (`DeviceAssignment` → `ENDED`);
   - set `Truck.organizationId` to the buyer, `status = AVAILABLE`,
     `currentDriverId = null`, `currentTripId = null`;
   - write a `TruckEvent` of type `OWNERSHIP_TRANSFERRED` with both org ids;
   - re-point vehicle-owned `Document` and `MediaAsset` rows to the buyer tenant,
     except driver-personal documents, which stay with the seller;
   - listing → `SOLD`, `soldPrice`, `soldAt`, `soldToOrganizationId`;
   - audit both tenants.

Historical `Trip`, `FuelRecord`, `MaintenanceRecord` and `TruckLocation` rows keep the
seller's `organizationId` — the new owner must not gain retrospective visibility into
the previous operator's business. The buyer sees an aggregate summary only (the
evidence pack they bought on).

## 4.6 API surface

| Method | Path | Permission |
|---|---|---|
| `GET` | `/resale/listings` | `resale.browse` (visibility-filtered) |
| `GET` | `/resale/listings/:id` | `resale.browse` |
| `POST` | `/resale/listings` | `resale.manage` |
| `PATCH` | `/resale/listings/:id` | `resale.manage` |
| `POST` | `/resale/listings/:id/submit` | `resale.manage` |
| `POST` | `/resale/listings/:id/withdraw` | `resale.manage` |
| `POST` | `/resale/listings/:id/review` | `resale.review` |
| `GET` | `/resale/listings/:id/evidence` | `resale.browse` |
| `GET` | `/resale/listings/mine` | `resale.manage` |
| `POST` | `/resale/listings/:id/offers` | `resale.offer` |
| `GET` | `/resale/listings/:id/offers` | seller `resale.manage` / own offer |
| `POST` | `/resale/offers/:id/counter` | `resale.manage` |
| `POST` | `/resale/offers/:id/accept` | `resale.manage` |
| `POST` | `/resale/offers/:id/reject` | `resale.manage` |
| `POST` | `/resale/offers/:id/withdraw` | `resale.offer` |
| `POST` | `/resale/listings/:id/inspections` | `resale.offer` |
| `PATCH` | `/resale/inspections/:id` | `resale.manage` |
| `POST` | `/resale/listings/:id/watch` | `resale.browse` |
| `DELETE` | `/resale/listings/:id/watch` | `resale.browse` |
| `GET` | `/resale/transfers` | `resale.transfer` |
| `POST` | `/resale/transfers/:id/advance` | `resale.transfer` |
| `GET` | `/resale/summary` | `resale.manage` |

Every route sits behind `app.authenticate`. **No public route exists** — that is the
"no external user" requirement in code.

## 4.7 Frontend

- `/resale` — buyer browse: filters (type, body, price, year, capacity, city,
  condition, fuel), sort, card grid with gallery, watch toggle.
- `/resale/:id` — listing detail: gallery/lightbox, spec table, evidence pack
  accordion, offer panel, inspection request, seller card, similar listings.
- `/resale/mine` — seller console: listings by status, offers inbox, inspection
  calendar, transfer tracker.
- `/resale/new` and `/resale/:id/edit` — creation wizard: pick vehicle → condition →
  photos → price/visibility → evidence toggles → review.
- `/admin/resale` — review queue for platform admins.
- Truck detail gains a **"List for sale"** action when the RBAC and gates pass.

## 4.8 Entitlement & RBAC

- Feature `RESALE_MARKETPLACE` — **Basic** to browse and buy, **Pro** to publish
  (`RESALE_PUBLISH`). Selling is a monetisable action; buying grows the network.
- Permissions: `resale.browse`, `resale.manage`, `resale.offer`, `resale.transfer`,
  `resale.review`.
- Grants:
  - `FLEET_OWNER` — browse, manage, offer, transfer.
  - `FLEET_MANAGER` — browse, manage (no transfer, no offer: cannot spend money).
  - `DISPATCHER`, `DRIVER` — browse only.
  - `SUPPLIER`, `CUSTOMER` — browse, offer (they buy vehicles too).
  - `ASSOCIATION_ADMIN` — browse (association-visibility listings).
  - `SUPPORT_AGENT` — browse.
  - `PLATFORM_ADMIN` — everything, including `resale.review`.

---

# 5. FEATURE 4 — PROFILE BUILDER

> *"Profile builder for profile settings."*

## 5.1 Problem with today's state

`/settings` is a 73-line page with first name, last name and password. Identity data is
spread across `User`, `Organization`, `Driver`, `Supplier`, `Customer`,
`ServiceProviderProfile` and `AssociationProfile`, with no single place to complete it,
no sense of progress and no notion of what a *complete* profile is for a given account
type.

## 5.2 Design

A **blueprint-driven** builder. The blueprint lives in shared code as data, so the same
definition drives the API's validation, the UI's rendering and the completion maths.

```text
PROFILE_BLUEPRINTS: Record<ProfileAudience, ProfileSection[]>

ProfileSection {
  key, title, description, icon, appliesTo (roles/org types),
  weight,                      // contribution to completion %
  fields: ProfileField[]
}

ProfileField {
  key, label, help, kind, required, target
}

kind:   TEXT | TEXTAREA | EMAIL | PHONE | NUMBER | DATE | SELECT | MULTI_SELECT
      | BOOLEAN | ADDRESS | GEO | IMAGE | DOCUMENT | TAGS | URL
target: user.* | organization.* | driver.* | supplier.* | customer.*
      | userProfile.* | organizationProfile.* | media:PURPOSE | document:CODE
```

### Sections by audience

| Audience | Sections |
|---|---|
| Everyone | Photo & cover, Identity, Contact, Address, Preferences, Security, Visibility |
| Driver | Licence & experience, Emergency contact, Medical & blood group, Vehicle preferences, Documents, Achievements showcase |
| Fleet owner / manager | Business identity, Fleet profile, Service areas, Operating hours, Documents, Bank/billing contact |
| Supplier | Business identity, Material categories, Yards & pickup points, Delivery terms, Documents |
| Customer | Business identity, Delivery addresses, Purchase preferences, Documents |
| Association | Association identity, Coverage areas, Responders, Contact escalation |
| Mobility provider | Services offered, Vehicles, Languages, Cancellation policy |
| Platform admin | Identity, Contact, Preferences |

### Prisma models

```prisma
enum ProfileVisibility {
  PRIVATE       // only me / my org
  PLATFORM      // any signed-in Saarthi account
  PARTNERS      // orgs I have transacted with
}

model UserProfile {
  id       String @id @default(uuid()) @db.Uuid
  userId   String @unique @db.Uuid
  headline String?
  bio      String?
  /// Spoken languages, for driver/passenger matching.
  languages String[]
  skills    String[]
  dateOfBirth DateTime?
  gender      String?
  /// Free-form links keyed by platform; validated as URLs.
  socialLinks Json?
  addressLine String?
  city        String?
  state       String?
  postalCode  String?
  latitude    Float?
  longitude   Float?
  emergencyContactName  String?
  emergencyContactPhone String?
  /// UI/locale preferences: locale, timezone, units, theme, mapStyle.
  preferences Json?
  /// Per-section visibility overrides.
  visibility  ProfileVisibility @default(PLATFORM)
  fieldVisibility Json?
  publicSlug  String? @unique
  completionPercent Int @default(0)
  completedSections String[]
  lastBuiltAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_profiles")
}

model OrganizationProfile {
  id             String @id @default(uuid()) @db.Uuid
  organizationId String @unique @db.Uuid
  tagline     String?
  about       String?
  foundedYear Int?
  employeeCount Int?
  website     String?
  socialLinks Json?
  /// Cities/districts served, used by discovery and last-mile matching.
  serviceAreas String[]
  specialities String[]
  certifications String[]
  operatingHours Json?
  supportEmail String?
  supportPhone String?
  billingContactName  String?
  billingContactPhone String?
  billingEmail        String?
  visibility     ProfileVisibility @default(PLATFORM)
  fieldVisibility Json?
  publicSlug     String? @unique
  completionPercent Int @default(0)
  completedSections String[]
  lastBuiltAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@map("organization_profiles")
}
```

Both rows are created lazily on first read, so no backfill migration is needed.

## 5.3 Completion engine

Pure function in shared code, unit-testable:

```ts
computeProfileCompletion(blueprint, values) -> {
  percent: number,
  sections: Array<{ key, percent, missingRequired: string[], total, filled }>,
  nextBestAction: { sectionKey, fieldKey, label } | null,
}
```

- A section's score is `filled required / total required`, falling back to optional
  fields when a section has no required ones.
- Overall percent is the weighted mean of section scores.
- `nextBestAction` powers a single "finish this next" prompt rather than a wall of
  red — the highest-weight incomplete section's first missing field.
- Verification-relevant sections carry the highest weight, so completing the profile
  moves the user toward `VERIFIED` rather than being cosmetic.

## 5.4 API surface

| Method | Path | Permission |
|---|---|---|
| `GET` | `/profile/builder` | authenticated (own profile) |
| `PATCH` | `/profile/builder/:sectionKey` | authenticated (own profile) |
| `GET` | `/profile/completion` | authenticated |
| `GET` | `/profile/me` | authenticated |
| `PATCH` | `/profile/me` | authenticated |
| `GET` | `/profile/organization` | `org.read` |
| `PATCH` | `/profile/organization` | `org.update` |
| `GET` | `/profile/directory` | `profile.directory` (signed-in only) |
| `GET` | `/profile/:slug` | `profile.directory` |

`PATCH /profile/builder/:sectionKey` fans one payload out to the right tables in a
transaction: `user`, `userProfile`, `driver`, `organization`, `organizationProfile`,
`supplier`, `customer`. Every field is validated against the blueprint — an unknown
field key is a `400`, not a silent ignore, and a field whose `target` the caller is not
permitted to write is a `403`.

There is **no public profile page**: the directory requires a session, consistent with
the "no external user" posture of §4.

## 5.5 Frontend

`/settings` becomes a tabbed shell, keeping the existing three controls intact on the
"Account" tab so nothing regresses:

```text
/settings
  +- Profile builder      <- new default tab
  +- Account              <- existing name + password form, unchanged
  +- Organization         <- existing read-only card, now editable
  +- Notifications        <- channel/type preference matrix
  +- Appearance           <- theme, map style, units, locale
  +- Sessions & security  <- active sessions, sign out others
  +- Subscription         <- links to the existing page
```

Profile builder UI:

- Left rail: section list with per-section rings and a green tick when complete.
- Header: overall completion ring, "next best action" call to action.
- Body: one section at a time, autosaved on blur with an inline saved indicator.
- Photo section: avatar cropper + cover uploader from §2.
- Documents section: embeds the existing `document-panel.tsx`.
- Mobile: the rail collapses into a horizontal stepper.

A dismissible completion banner appears on the dashboard and driver home while the
profile is under 80% complete.

## 5.6 Entitlement & RBAC

- **Not entitlement-gated.** Every account type on every plan gets the builder.
- New permission `profile.directory` for the internal people/organization directory,
  granted to every role except `DRIVER` and `ASSOCIATION_RESPONDER` (who see only
  their own organization).

---

# 6. FEATURE 5 — QR IDENTITY FOR DRIVERS & TRUCKS

> *"QR generation for both driver & truck."*

## 6.1 Design

A QR code is a **capability token**, not a printed database id. It carries an opaque
random token; every scan is resolved server-side, authorised against the scanner's
RBAC, scoped to what that scanner may see, and logged.

```text
QrCode { subjectType, subjectId, token, scopes[], status, expiresAt, allowPublicResolve }
   +-- QrScan { scannedBy, purpose, location, result }
```

Encoded payload is a URL: `{FRONTEND_URL}/q/{token}` — so any phone camera opens
Saarthi, and the app resolves it. Nothing sensitive is ever inside the QR itself.

### Prisma models

```prisma
enum QrSubjectType {
  DRIVER
  VEHICLE
  USER
  TRIP
  ORDER
  VEHICLE_LISTING
  INVENTORY_LOCATION
  TRANSFER_HUB
  RELAY_DELIVERY
}

enum QrCodeStatus {
  ACTIVE
  REVOKED
  EXPIRED
}

enum QrScope {
  IDENTITY          // name, photo, verification badge
  CONTACT           // phone (permissioned)
  VEHICLE_SUMMARY   // registration, type, capacity, fleet
  DRIVER_SUMMARY    // experience, score band, achievements
  COMPLIANCE        // document validity flags (not the files)
  ASSIGNMENT        // current truck/driver pairing
  TRIP_STATUS       // current trip status and ETA
  ORDER_STATUS
  EMERGENCY         // blood group, emergency contact — SOS scans only
  HANDOVER          // relay/POD confirmation capability
}

enum QrScanResult {
  ALLOWED
  DENIED
  NOT_FOUND
  REVOKED
  EXPIRED
  RATE_LIMITED
}

enum QrScanPurpose {
  IDENTITY_CHECK
  ASSIGNMENT
  CHECKPOINT
  PICKUP
  DELIVERY_HANDOVER
  INSPECTION
  EMERGENCY
  PUBLIC_VIEW
}

model QrCode {
  id             String        @id @default(uuid()) @db.Uuid
  organizationId String?       @db.Uuid
  subjectType    QrSubjectType
  subjectId      String        @db.Uuid
  /// 32 random bytes, base64url. Unique, unguessable, never derived from the id.
  token          String        @unique
  version        Int           @default(1)
  status         QrCodeStatus  @default(ACTIVE)
  scopes         QrScope[]
  label          String?
  /// When true, an unauthenticated scan gets the minimal public projection.
  allowPublicResolve Boolean   @default(false)
  expiresAt     DateTime?
  revokedAt     DateTime?
  revokedById   String?  @db.Uuid
  revokeReason  String?
  lastScannedAt DateTime?
  scanCount     Int      @default(0)
  createdById   String   @db.Uuid
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  scans QrScan[]

  @@index([subjectType, subjectId, status])
  @@index([organizationId, status])
  @@map("qr_codes")
}

model QrScan {
  id            String        @id @default(uuid()) @db.Uuid
  qrCodeId      String        @db.Uuid
  scannedByUserId String?     @db.Uuid
  scannedByOrganizationId String? @db.Uuid
  purpose       QrScanPurpose @default(IDENTITY_CHECK)
  result        QrScanResult
  scopesGranted QrScope[]
  latitude      Float?
  longitude     Float?
  ipAddress     String?
  userAgent     String?
  note          String?
  createdAt     DateTime @default(now())

  qrCode QrCode @relation(fields: [qrCodeId], references: [id], onDelete: Cascade)

  @@index([qrCodeId, createdAt])
  @@index([scannedByUserId, createdAt])
  @@map("qr_scans")
}
```

## 6.2 Rendering

Server-side with `qrcode` (pure JS, added to `apps/api`):

- `GET /qr/:id/image.svg` — vector, for screen and print.
- `GET /qr/:id/image.png?size=512` — raster, for WhatsApp and stickers.
- `GET /qr/:id/badge.svg` — a print-ready badge: QR + subject name + registration or
  licence + "Verified on Saarthi" mark + the short token for manual entry.
  Two presets: `driver-card` (85×54 mm ID card) and `vehicle-sticker` (100×100 mm).
- Error correction level **Q** — restores up to ~25% of *codewords*, which measures
  out as a contiguous blot of roughly 14% of the symbol area. A windscreen sticker
  gets dirty, and that is the figure to design against.
- Quiet zone 4 modules, minimum module size 4 px at 512 px.

## 6.3 Resolution & scoping

`GET /qr/resolve/:token` — the single scan entry point.

```text
scanner is ...                    receives
------------------------------    ---------------------------------------------
same organization                 everything in the code's scopes
platform admin / support          everything in the code's scopes
another Saarthi org, authorised   IDENTITY + VEHICLE_SUMMARY + COMPLIANCE flags
an SOS responder on that incident + EMERGENCY (blood group, emergency contact)
a relay partner on that delivery  + HANDOVER capability
signed in, no relationship        IDENTITY only (name, photo, verified badge)
unauthenticated                   404 unless allowPublicResolve, then minimal
```

- Rate limited per token and per IP (`QR_RESOLVE_RATE_LIMIT_MAX`, default 20/min) —
  an unguessable token still deserves a brake.
- Every attempt writes a `QrScan`, including `NOT_FOUND`, which is how token-guessing
  becomes visible.
- `EMERGENCY` scope is never returned outside an active SOS incident the scanner is a
  responder on. That rule lives in the service, not the UI.

## 6.4 Operational uses (all wired, not theoretical)

| Use | Flow |
|---|---|
| Driver ID card | Driver app → "My QR" → badge; fleet prints from driver detail |
| Vehicle windscreen sticker | Truck detail → "QR sticker" → print |
| Assign driver to truck | Scan the truck QR from the driver app → confirm → `TruckAssignment` |
| Gate / checkpoint | Scan → identity + compliance flags + current trip; logged with GPS |
| Pickup confirmation | Supplier scans the truck QR at the yard → order event `PICKED_UP` |
| Delivery handover | Customer scans the truck QR → order event `DELIVERED` + POD photo |
| Relay handover (§8) | Pickup partner scans the truck QR at the hub → custody transfer |
| Resale inspection (§4) | Buyer scans the vehicle QR → the evidence pack |
| SOS identification | Responder scans → emergency scope |

## 6.5 API surface

| Method | Path | Permission |
|---|---|---|
| `POST` | `/qr` | `qr.manage` |
| `GET` | `/qr` | `qr.read` (filters: subjectType, subjectId, status) |
| `GET` | `/qr/:id` | `qr.read` |
| `GET` | `/qr/:id/image.svg` / `.png` | `qr.read` |
| `GET` | `/qr/:id/badge.svg` | `qr.read` |
| `POST` | `/qr/:id/rotate` | `qr.manage` (revoke + reissue, version + 1) |
| `POST` | `/qr/:id/revoke` | `qr.manage` |
| `GET` | `/qr/:id/scans` | `qr.audit` |
| `GET` | `/qr/resolve/:token` | scan-scoped (see above) |
| `POST` | `/qr/resolve/:token/action` | scan-scoped (assignment / handover / checkpoint) |
| `GET` | `/qr/subject/:subjectType/:subjectId` | `qr.read` (ensure-and-get) |

`GET /qr/subject/...` is idempotent: it returns the active code for the subject and
creates a default one if none exists, so the UI never has to think about provisioning.

## 6.6 Frontend

- `apps/web/src/features/qr/` — `qr-badge-dialog.tsx` (view / download / print),
  `qr-scanner.tsx` (camera scan via `BarcodeDetector`, with manual token entry
  fallback), `use-qr.ts`.
- Driver app: "My QR code" card on `/driver`.
- Truck detail and driver detail: a **QR** action in the header.
- `/q/:token` — the resolve page, which works both when a phone camera opens it and
  when it is scanned in-app; it renders exactly the scopes the API returned.
- `/scan` — the in-app scanner with purpose selection.

## 6.7 Entitlement & RBAC

- Feature `QR_IDENTITY` — **Basic and above**.
- Permissions: `qr.read`, `qr.manage`, `qr.audit`.
- Grants: `FLEET_OWNER` / `FLEET_MANAGER` all three; `DISPATCHER` read + manage;
  `DRIVER` read (own driver + assigned truck) — the service scopes a driver's list to
  their own subjects; `SUPPLIER` / `CUSTOMER` read (for handover scanning);
  `SUPPORT_AGENT` read + audit; `PLATFORM_ADMIN` all.

---

# 7. FEATURE 6 — RETURN LOADS (BACKHAUL)

> *"Return order for Trucks so they never return empty handed."*

## 7.1 Design

Two halves:

1. **Supply side** — a truck (or its dispatcher) declares "I will be free at X on date
   D and want to end up at Y". That is a `ReturnLoadRequest`.
2. **Demand side** — the existing open orders on the marketplace. A matching engine
   scores each order against each request and surfaces both directions.

```text
Trip (outbound) --arrives--> ReturnLoadRequest (auto or manual)
                                 |
                       matching engine (geo + time + capacity + detour)
                                 |
                       ReturnLoadMatch --accept--> OrderQuote --> Order --> Trip(RETURN)
```

Matching is deliberately expressed as an `OrderQuote` on acceptance, so the entire
existing order → quote → accept → trip pipeline is reused rather than duplicated.

### Prisma models

```prisma
enum ReturnLoadStatus {
  OPEN
  MATCHED
  BOOKED
  EXPIRED
  CANCELLED
  COMPLETED
}

enum ReturnLoadMatchStatus {
  SUGGESTED
  OFFERED
  ACCEPTED
  REJECTED
  EXPIRED
}

enum TripLegType {
  PRIMARY
  RETURN
  RELAY_LAST_MILE
}

model ReturnLoadRequest {
  id             String           @id @default(uuid()) @db.Uuid
  reference      String           @unique   // RL-2026-000123
  organizationId String           @db.Uuid
  truckId        String           @db.Uuid
  driverId       String?          @db.Uuid
  /// The outbound trip this return is planned against, when there is one.
  outboundTripId String?          @db.Uuid
  status         ReturnLoadStatus @default(OPEN)

  /// Where the truck becomes free (usually the outbound destination).
  originAddress   String
  originLatitude  Float
  originLongitude Float
  /// Where it wants to end up (usually the fleet's base city).
  destinationAddress   String
  destinationLatitude  Float
  destinationLongitude Float

  availableFrom  DateTime
  availableUntil DateTime
  capacityTons   Float
  truckType      TruckType?
  /// How far off the straight line home the driver will divert, in km.
  detourToleranceKm Float   @default(50)
  /// Willingness to accept less than a full load.
  acceptsPartialLoad Boolean @default(true)
  minimumPrice   Decimal? @db.Decimal(12, 2)
  autoMatch      Boolean  @default(true)
  notes          String?
  matchedOrderId String?  @db.Uuid
  createdById    String   @db.Uuid
  cancelledAt    DateTime?
  completedAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  matches ReturnLoadMatch[]

  @@index([status, availableFrom])
  @@index([organizationId, status])
  @@index([truckId, status])
  @@index([originLatitude, originLongitude])
  @@map("return_load_requests")
}

model ReturnLoadMatch {
  id                  String                @id @default(uuid()) @db.Uuid
  returnLoadRequestId String                @db.Uuid
  orderId             String                @db.Uuid
  status              ReturnLoadMatchStatus @default(SUGGESTED)
  /// 0-100, explainable via the components below.
  score               Float
  distanceToPickupKm  Float
  detourKm            Float
  directionAlignment  Float   // cosine of bearing agreement, -1..1
  capacityFitPercent  Float
  timingFitHours      Float
  estimatedRevenue    Decimal? @db.Decimal(12, 2)
  /// Human-readable reasons, rendered in the UI verbatim.
  reasons             String[]
  quoteId             String?  @db.Uuid
  notifiedAt          DateTime?
  respondedAt         DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  request ReturnLoadRequest @relation(fields: [returnLoadRequestId], references: [id], onDelete: Cascade)

  @@unique([returnLoadRequestId, orderId])
  @@index([orderId, status])
  @@index([status, score])
  @@map("return_load_matches")
}
```

### Additive columns

| Table | Column | Purpose |
|---|---|---|
| `Order` | `isReturnLoad Boolean @default(false)` | this order was filled as a backhaul |
| `Order` | `returnLoadRequestId String?` | the request it filled |
| `Order` | `parentOrderId String?` | round-trip pairing |
| `Trip` | `legType TripLegType @default(PRIMARY)` | |
| `Trip` | `parentTripId String?` | outbound trip for a return/relay leg |
| `Trip` | `returnLoadRequestId String?` | |
| `Truck` | `acceptsReturnLoads Boolean @default(true)` | owner opt-out |
| `Truck` | `homeBaseAddress/Latitude/Longitude` | the default "want to end up here" |

## 7.2 Scoring

Pure, unit-tested function in `shared/domain/return-loads.ts`:

```text
score = 100
      * w_pickup    * clamp(1 - distanceToPickupKm / maxPickupKm)
      * w_detour    * clamp(1 - detourKm / detourToleranceKm)
      * w_direction * normalise(directionAlignment)     // homeward bearing agreement
      * w_capacity  * capacityFit                        // penalise both over and under
      * w_timing    * clamp(1 - timingGapHours / windowHours)
      * w_price     * priceFit                           // vs minimumPrice
      * w_trust     * customerRatingFactor
```

Weights are constants in shared code so the UI can explain a score, and hard filters
run first (truck type mismatch, capacity overflow, window miss, blacklisted customer).

`detourKm` is computed as
`d(free point → order origin) + d(order origin → order destination) + d(order destination → home) − d(free point → home)`
using the existing haversine helper. Road-network detour via Mapbox Directions is used
when the map token is configured, with the straight-line figure as the fallback — and
the response says which one it used.

## 7.3 Automation

- When a trip reaches `ARRIVED` (or `LOADING` on the outbound, if the fleet enables
  early matching), `ensureReturnLoadRequest(trip)` creates an `OPEN` request from the
  destination back to the truck's home base — but only if `Truck.acceptsReturnLoads`.
- `runReturnLoadMatchSweep()` — every 10 minutes: recompute matches for `OPEN`
  requests inside their window, notify on new matches above a score threshold, expire
  stale requests.
- When a new order is posted, matching runs inline for that order against open
  requests, so a fleet with an empty truck nearby hears about it immediately.
- **Empty-return risk** on the dashboard: trips arriving in the next 48 h with no
  matched return load, with a one-click "find return load" action.

## 7.4 API surface

| Method | Path | Permission |
|---|---|---|
| `GET` | `/return-loads` | `returnloads.read` |
| `POST` | `/return-loads` | `returnloads.manage` |
| `GET` | `/return-loads/:id` | `returnloads.read` |
| `PATCH` | `/return-loads/:id` | `returnloads.manage` |
| `POST` | `/return-loads/:id/cancel` | `returnloads.manage` |
| `GET` | `/return-loads/:id/matches` | `returnloads.read` |
| `POST` | `/return-loads/:id/refresh-matches` | `returnloads.manage` |
| `POST` | `/return-loads/matches/:id/quote` | `orders.quote` (creates the `OrderQuote`) |
| `POST` | `/return-loads/matches/:id/reject` | `returnloads.manage` |
| `GET` | `/return-loads/opportunities` | `returnloads.read` (orders near my arriving trucks) |
| `GET` | `/return-loads/empty-risk` | `returnloads.read` |
| `GET` | `/orders/:id/return-candidates` | `orders.manage` (trucks that could take it) |

## 7.5 Frontend

- `/return-loads` — two tabs: **My requests** (with match counts) and
  **Opportunities** (open orders near arriving trucks), each with a map view.
- `/return-loads/:id` — the request with a map showing free point, home, and each
  match's pickup/drop, plus an explainable score breakdown per match.
- Trip detail: a "Plan return load" panel once the trip is `IN_TRANSIT` or later.
- Dashboard: "Empty return risk" stat card and a "Return load matches" list.
- Order detail (fleet view): "This order fills a return leg" badge with the saved
  empty kilometres.

## 7.6 Notifications & entitlement

- New `NotificationType`: `RETURN_LOAD_MATCH_FOUND`, `RETURN_LOAD_BOOKED`,
  `RETURN_LOAD_EXPIRING`, `EMPTY_RETURN_RISK`.
- Realtime: `returnload.match.created` on the fleet channel.
- Feature `RETURN_LOADS` — **Pro and above** (it is a margin feature).
- Permissions `returnloads.read`, `returnloads.manage`; granted to `FLEET_OWNER`,
  `FLEET_MANAGER`, `DISPATCHER`; read to `DRIVER` (they see their own truck's return
  plan); all to `PLATFORM_ADMIN`.

---

# 8. FEATURE 7 — CITY ACCESS & LAST-MILE RELAY

> *"If there is no entry, then small pickup can connect with these trucks to deliver
> item inside city."*

## 8.1 Design

Two connected pieces:

1. **City access intelligence** — know that a heavy vehicle cannot enter the
   destination area (permanently, or during certain hours), *before* dispatch.
2. **Relay delivery** — a small pickup takes over at a transfer hub and completes the
   delivery inside the city, with a verified custody handover.

```text
Order destination inside a restricted zone for the assigned vehicle
        |
        v
CityAccessRestriction match  ->  requiresLastMile = true
        |
        v
TransferHub suggestion (nearest usable hub outside the zone)
        |
        v
RelayDelivery  --broadcast-->  LastMilePartner[] --offers--> RelayOffer[]
        |
        +-- accept -> assigned pickup vehicle + driver
        +-- handover at hub (QR scan + photos + weight)
        +-- Trip(legType = RELAY_LAST_MILE) inside the city
        +-- POD -> parent Order -> DELIVERED
```

### Prisma models

```prisma
enum CityRestrictionKind {
  NO_ENTRY
  TIME_WINDOW
  PERMIT_REQUIRED
  WEIGHT_LIMIT
  HEIGHT_LIMIT
  AXLE_LIMIT
  ODD_EVEN
  ZONE_BAN
  CONGESTION_CHARGE
}

enum RelayStatus {
  DRAFT
  REQUESTED
  OFFERED
  ASSIGNED
  EN_ROUTE_TO_HUB
  AT_HUB
  LOADED
  IN_TRANSIT
  DELIVERED
  FAILED
  CANCELLED
}

enum RelayReason {
  CITY_NO_ENTRY
  TIME_WINDOW
  WEIGHT_LIMIT
  HEIGHT_LIMIT
  PERMIT_MISSING
  NARROW_ACCESS
  CUSTOMER_REQUEST
  MULTI_DROP_SPLIT
}

enum RelayOfferStatus {
  OFFERED
  ACCEPTED
  REJECTED
  WITHDRAWN
  EXPIRED
}

enum RelayEventType {
  CREATED
  REQUESTED
  OFFER_RECEIVED
  OFFER_ACCEPTED
  ASSIGNED
  ARRIVED_AT_HUB
  HANDOVER_STARTED
  HANDOVER_VERIFIED
  LOADED
  DEPARTED
  DELIVERED
  FAILED
  CANCELLED
  NOTE
}

model CityAccessRestriction {
  id          String              @id @default(uuid()) @db.Uuid
  /// Null organizationId = platform-maintained national rule.
  organizationId String?          @db.Uuid
  name        String
  description String?
  kind        CityRestrictionKind
  city        String
  district    String?
  state       String
  /// Zone as a centre + radius, or an explicit polygon when one is known.
  centerLatitude  Float
  centerLongitude Float
  radiusKm        Float?
  polygon         Json?
  /// Which vehicles the rule bites. Empty array = all goods vehicles.
  vehicleTypes    VehicleType[]
  truckTypes      TruckType[]
  minCapacityTons Float?          // rule applies at or above this payload
  maxHeightMetres Float?
  maxAxles        Int?
  /// 0 = Sunday .. 6 = Saturday. Empty = every day.
  daysOfWeek      Int[]
  /// Minutes from midnight, local time. Null/null = all day.
  startTimeMinutes Int?
  endTimeMinutes   Int?
  permitAuthority String?
  permitUrl       String?
  penaltyNote     String?
  source          String?
  sourceUrl       String?
  effectiveFrom   DateTime?
  effectiveTo     DateTime?
  active          Boolean  @default(true)
  createdById     String?  @db.Uuid
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([city, state, active])
  @@index([centerLatitude, centerLongitude])
  @@map("city_access_restrictions")
}

model TransferHub {
  id          String  @id @default(uuid()) @db.Uuid
  /// Null = platform-operated hub available to everyone.
  organizationId String? @db.Uuid
  name        String
  code        String  @unique
  addressLine String
  city        String
  state       String
  postalCode  String?
  latitude    Float
  longitude   Float
  /// Facilities: forklift, crane, covered, weighbridge, security, parkingSlots.
  facilities  Json?
  maxVehicleLengthMetres Float?
  parkingSlots Int?
  openFromMinutes Int?
  openToMinutes   Int?
  contactName  String?
  contactPhone String?
  handlingChargePerTon Decimal? @db.Decimal(10, 2)
  verified    Boolean  @default(false)
  active      Boolean  @default(true)
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  relays RelayDelivery[]

  @@index([city, state, active])
  @@index([latitude, longitude])
  @@map("transfer_hubs")
}

model LastMilePartner {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String   @unique @db.Uuid
  /// Cities this partner will deliver inside.
  serviceCities  String[]
  maxWeightTons  Float    @default(1.5)
  vehicleCount   Int      @default(0)
  minimumCharge  Decimal  @db.Decimal(10, 2)
  perKmRate      Decimal  @db.Decimal(10, 2)
  perTonRate     Decimal? @db.Decimal(10, 2)
  handlesFragile Boolean  @default(false)
  handlesRefrigerated Boolean @default(false)
  openFromMinutes Int?
  openToMinutes   Int?
  averageResponseMinutes Int?
  completedRelays Int     @default(0)
  rating         Float?
  ratingCount    Int      @default(0)
  active         Boolean  @default(true)
  verificationStatus VerificationStatus @default(PENDING)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([active, verificationStatus])
  @@map("last_mile_partners")
}

model RelayDelivery {
  id          String      @id @default(uuid()) @db.Uuid
  reference   String      @unique   // RD-2026-000123
  orderId     String      @db.Uuid
  /// Fleet tenant that owns the parent movement.
  organizationId String   @db.Uuid
  parentTripId String?    @db.Uuid
  transferHubId String?   @db.Uuid
  status      RelayStatus @default(DRAFT)
  reason      RelayReason
  restrictionId String?   @db.Uuid

  /// The partner and vehicle that won the leg.
  partnerOrganizationId String? @db.Uuid
  pickupVehicleId       String? @db.Uuid
  pickupDriverId        String? @db.Uuid
  relayTripId           String? @db.Uuid

  quantity     Float
  unit         MaterialUnit
  weightTons   Float?
  packageCount Int?
  fragile      Boolean @default(false)

  dropAddress   String
  dropLatitude  Float
  dropLongitude Float
  distanceKm    Float?
  price         Decimal? @db.Decimal(12, 2)
  handlingCharge Decimal? @db.Decimal(10, 2)

  requestedAt   DateTime?
  scheduledAt   DateTime?
  hubArrivalAt  DateTime?
  handoverAt    DateTime?
  /// QR scan that proved custody transfer.
  handoverQrScanId String? @db.Uuid
  departedAt    DateTime?
  deliveredAt   DateTime?
  failureReason String?
  cancelledAt   DateTime?
  notes         String?
  createdById   String   @db.Uuid
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  hub    TransferHub?  @relation(fields: [transferHubId], references: [id])
  offers RelayOffer[]
  events RelayEvent[]

  @@index([orderId])
  @@index([organizationId, status])
  @@index([partnerOrganizationId, status])
  @@index([status, scheduledAt])
  @@map("relay_deliveries")
}
```

`RelayOffer` and `RelayEvent` follow the `OrderQuote` / `OrderEvent` shape exactly.

### Additive columns

| Table | Column | Purpose |
|---|---|---|
| `Order` | `requiresLastMile Boolean @default(false)` | flagged by the access check |
| `Order` | `lastMileStatus RelayStatus?` | denormalised for list views |
| `Truck` | `lastMileCapable Boolean @default(false)` | this vehicle can do city relays |
| `VehicleType` | new value `PICKUP` | additive enum value |

## 8.2 The access check

`POST /city-access/check` with `{ destination, vehicleId | vehicleProfile, arrivalAt }`
returns:

```json
{
  "restricted": true,
  "restrictions": [{
    "id": "...", "name": "Bengaluru core no-entry (heavy goods)",
    "kind": "TIME_WINDOW", "appliesNow": true,
    "activeWindows": [{ "days": [1,2,3,4,5], "from": "06:00", "to": "22:00" }],
    "permitAuthority": "BBMP", "permitUrl": "...",
    "distanceToZoneKm": 0
  }],
  "recommendation": "RELAY",
  "suggestedHubs": [{ "id": "...", "name": "Nelamangala transfer yard",
                      "distanceFromZoneKm": 18.4, "detourKm": 6.1,
                      "facilities": { "forklift": true }, "openNow": true }],
  "suggestedPartners": [{ "organizationId": "...", "name": "...",
                          "estimatedPrice": 1850, "etaMinutes": 95, "rating": 4.6 }],
  "alternativeWindow": { "enterAfter": "22:00", "waitMinutes": 240 }
}
```

`recommendation` is one of `ALLOWED`, `WAIT_FOR_WINDOW`, `PERMIT_REQUIRED`, `RELAY`,
`REROUTE` — deterministic from the matched rules, so the same input always explains
itself the same way.

The check runs automatically at three points: order creation (warn the customer),
quote creation (so the fleet prices the relay in), and trip creation (block a dispatch
into a hard `NO_ENTRY` unless overridden with a reason, which is audited).

## 8.3 Custody handover

The weakest link in a relay is the moment goods change vehicles. Saarthi makes it
provable, reusing §6:

1. Big truck arrives at the hub → status `AT_HUB`, GPS-stamped.
2. Pickup driver scans the **truck QR** (`HANDOVER` scope) → creates a `QrScan` and
   `RelayEvent(HANDOVER_VERIFIED)` with both driver ids and coordinates.
3. Both drivers add photos (`MediaAsset` purpose `HANDOVER`) — load condition,
   package count, optional weighbridge slip.
4. Quantity and package count are confirmed; a mismatch requires a note and raises a
   `RelayEvent` discrepancy flag rather than being silently accepted.
5. Status → `LOADED`, then `IN_TRANSIT`; the relay trip tracks on the normal tracking
   pipeline, so the customer's live map keeps working with no special case.
6. Delivery → POD photo + customer QR/OTP → `DELIVERED`; the parent order transitions
   to `DELIVERED` only when every relay leg is delivered.

## 8.4 API surface

| Method | Path | Permission |
|---|---|---|
| `POST` | `/city-access/check` | `trips.read` or `orders.read` |
| `GET` | `/city-access/restrictions` | `cityaccess.read` |
| `POST` | `/city-access/restrictions` | `cityaccess.manage` |
| `PATCH` | `/city-access/restrictions/:id` | `cityaccess.manage` |
| `DELETE` | `/city-access/restrictions/:id` | `cityaccess.manage` |
| `GET` | `/transfer-hubs` | `relay.read` (near a point, or by city) |
| `POST` | `/transfer-hubs` | `relay.manage` |
| `PATCH` | `/transfer-hubs/:id` | `relay.manage` |
| `GET` | `/relay/deliveries` | `relay.read` |
| `POST` | `/relay/deliveries` | `relay.manage` |
| `GET` | `/relay/deliveries/:id` | `relay.read` |
| `POST` | `/relay/deliveries/:id/broadcast` | `relay.manage` |
| `POST` | `/relay/deliveries/:id/offers` | `relay.offer` (partner) |
| `POST` | `/relay/offers/:id/accept` | `relay.manage` |
| `POST` | `/relay/offers/:id/reject` | `relay.manage` |
| `POST` | `/relay/deliveries/:id/transition` | `relay.manage` or assigned partner |
| `POST` | `/relay/deliveries/:id/handover` | assigned partner driver |
| `GET` | `/relay/partners` | `relay.read` |
| `GET` | `/relay/partners/me` | `relay.offer` |
| `PUT` | `/relay/partners/me` | `relay.offer` |
| `GET` | `/relay/opportunities` | `relay.offer` (open relays in my cities) |

## 8.5 Frontend

- `/relay` — fleet view: relay legs by status, hub map, offers inbox.
- `/relay/:id` — timeline, handover evidence, both vehicles on one map.
- `/relay/opportunities` — partner view: open city deliveries, one-tap offer.
- `/relay/partner` — partner profile: cities, rates, capacity, hours.
- `/admin/city-access` — restriction registry with a zone map editor.
- Order/trip detail: a "City access" panel showing the check result, and a
  "Arrange last-mile delivery" action.
- Live map: restricted zones as a translucent red layer, hubs as a hub icon layer.
- New order form: an inline warning when the drop address sits in a restricted zone.

## 8.6 Entitlement & RBAC

- Feature `LAST_MILE_RELAY` — **Pro and above** for fleets; partners need only
  `Basic` (they are the supply side, and taxing supply kills the network).
- Feature `CITY_ACCESS_INTELLIGENCE` — **Basic and above** (a safety/compliance
  capability; withholding it would let a paying customer drive into a fine).
- Permissions: `cityaccess.read`, `cityaccess.manage`, `relay.read`, `relay.manage`,
  `relay.offer`.
- Grants: `cityaccess.read` to every operational role; `cityaccess.manage` to
  `PLATFORM_ADMIN` (national rules) and `FLEET_OWNER` (own private rules).
  `relay.read`/`relay.manage` to `FLEET_OWNER`, `FLEET_MANAGER`, `DISPATCHER`;
  `relay.offer` to `FLEET_OWNER` and `FLEET_MANAGER` (a small-pickup operator is a
  fleet owner with mini trucks) and to `PLATFORM_ADMIN`. `DRIVER` gets `relay.read`
  plus the handover action on their own leg. `CUSTOMER` gets `relay.read` scoped to
  their own order.

---

# 9. FEATURE 8 — ROUTE INTELLIGENCE

> *"To show live traffic lights, speed cameras or police checking on the route of the
> truck."*

## 9.1 Honesty about "live"

There is no national feed of live traffic-signal phases in India, and pretending
otherwise would put a wrong number in front of a driver at 60 km/h. Saarthi therefore
models three clearly distinguished tiers, and the API always says which tier a value
came from:

| Tier | Meaning | Example |
|---|---|---|
| `STATIC` | A fixed feature at a fixed place | signal junction, speed camera, toll plaza, weighbridge |
| `PREDICTED` | Computed from a known cycle or historical pattern, flagged `predicted: true` | signal phase from cycle timing, "police checking usually here 08:00–11:00" |
| `LIVE` | Reported now, decaying with age | driver-reported police checking 6 minutes ago, jam, accident |

Crowd reports from drivers are what makes police checking genuinely live — Saarthi
already has the fleet on the road and a trusted identity for every one of them.

### Prisma models

```prisma
enum RouteHazardKind {
  TRAFFIC_SIGNAL
  SPEED_CAMERA
  RED_LIGHT_CAMERA
  AVERAGE_SPEED_ZONE
  POLICE_CHECKPOINT
  RTO_CHECKPOST
  TOLL_PLAZA
  WEIGHBRIDGE
  BORDER_CHECKPOST
  SPEED_BREAKER
  SHARP_CURVE
  STEEP_GRADIENT
  ACCIDENT_PRONE_ZONE
  SCHOOL_ZONE
  RAILWAY_CROSSING
  NARROW_BRIDGE
  ROAD_WORK
  DIVERSION
  ACCIDENT
  TRAFFIC_JAM
  WATERLOGGING
  LANDSLIDE
  FOG_ZONE
  PROTEST_BLOCKADE
  ANIMAL_CROSSING
  UNLIT_STRETCH
}

enum RouteHazardTier {
  STATIC
  PREDICTED
  LIVE
}

enum RouteHazardSource {
  PLATFORM
  AUTHORITY
  PARTNER_FEED
  DRIVER_REPORT
  ASSOCIATION
  TELEMETRY_DERIVED
}

enum RouteHazardStatus {
  UNVERIFIED
  ACTIVE
  EXPIRED
  REMOVED
  REJECTED
}

enum HazardVote {
  CONFIRM
  REJECT
  CLEARED
}

model RouteHazard {
  id          String            @id @default(uuid()) @db.Uuid
  /// Null = platform-wide. Set = private to one tenant.
  organizationId String?        @db.Uuid
  kind        RouteHazardKind
  tier        RouteHazardTier   @default(STATIC)
  source      RouteHazardSource @default(PLATFORM)
  status      RouteHazardStatus @default(ACTIVE)
  severity    AlertSeverity     @default(INFO)

  name        String
  description String?
  latitude    Float
  longitude   Float
  /// Alert radius; also the dedupe radius for reports.
  radiusMeters Int    @default(150)
  /// Direction of travel the hazard applies to; null = both ways.
  headingDegrees Int?
  headingToleranceDegrees Int @default(60)

  speedLimitKph Int?
  city        String?
  district    String?
  state       String?
  highway     String?
  landmark    String?

  /// Signal cycle, for a PREDICTED phase. All null = phase not modelled.
  signalCycleSeconds  Int?
  signalGreenSeconds  Int?
  signalOffsetSeconds Int?
  signalReferenceAt   DateTime?

  /// Recurring active pattern, e.g. a checkpoint manned on weekday mornings.
  daysOfWeek       Int[]
  startTimeMinutes Int?
  endTimeMinutes   Int?

  /// Transient hazards expire.
  validFrom  DateTime?
  validUntil DateTime?

  confirmCount Int   @default(0)
  rejectCount  Int   @default(0)
  /// 0-1, decays with age for LIVE hazards.
  confidence   Float @default(1)
  lastConfirmedAt DateTime?
  lastReportedAt  DateTime?
  reportCount     Int @default(0)

  reportedByUserId String? @db.Uuid
  verifiedById     String? @db.Uuid
  verifiedAt       DateTime?
  sourceUrl        String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  reports RouteHazardReport[]
  alerts  TripHazardAlert[]

  @@index([latitude, longitude, status])
  @@index([kind, status])
  @@index([status, tier, validUntil])
  @@index([city, state])
  @@map("route_hazards")
}

model RouteHazardReport {
  id        String  @id @default(uuid()) @db.Uuid
  hazardId  String? @db.Uuid
  organizationId String? @db.Uuid
  kind      RouteHazardKind
  vote      HazardVote @default(CONFIRM)
  latitude  Float
  longitude Float
  headingDegrees Int?
  note      String?
  mediaId   String? @db.Uuid
  tripId    String? @db.Uuid
  vehicleId String? @db.Uuid
  driverId  String? @db.Uuid
  reportedByUserId String @db.Uuid
  createdAt DateTime @default(now())

  hazard RouteHazard? @relation(fields: [hazardId], references: [id], onDelete: SetNull)

  @@index([hazardId, createdAt])
  @@index([reportedByUserId, createdAt])
  @@index([latitude, longitude])
  @@map("route_hazard_reports")
}

model TripHazardAlert {
  id        String @id @default(uuid()) @db.Uuid
  tripId    String @db.Uuid
  hazardId  String @db.Uuid
  organizationId String @db.Uuid
  vehicleId String  @db.Uuid
  driverId  String? @db.Uuid
  distanceMeters Int
  speedAtAlertKph Float?
  severity  AlertSeverity
  /// True when the vehicle passed a speed-limited hazard above its limit.
  violated  Boolean  @default(false)
  acknowledgedAt DateTime?
  createdAt DateTime @default(now())

  hazard RouteHazard @relation(fields: [hazardId], references: [id], onDelete: Cascade)

  @@unique([tripId, hazardId])
  @@index([tripId, createdAt])
  @@index([organizationId, createdAt])
  @@map("trip_hazard_alerts")
}
```

## 9.2 Query paths

Two different shapes, because a map and a moving truck need different things:

1. **Viewport query** — `GET /route-intelligence/hazards?bbox=&kinds=&tiers=`
   Bounding-box filtered, capped at 500 features, returned as GeoJSON for a Mapbox
   source. Cached per rounded bbox for 60 s.
2. **Corridor query** — `POST /route-intelligence/route-hazards`
   Body is the trip's `plannedRoute` polyline (or origin/destination). Returns hazards
   within `corridorMeters` (default 300) of the line, ordered by distance along the
   route, each with `distanceAlongRouteKm` and `etaSeconds` so the driver app can
   announce them in order.

Corridor matching uses point-to-segment distance over the decimated polyline
(Douglas–Peucker at 50 m first, so a 1 200-km route is a few thousand segments, not
hundreds of thousands).

## 9.3 Live alerting on a trip

Hooked into the existing tracking pipeline, where each new `TruckLocation` already
lands:

```text
location ingested
  -> hazards within LOOKAHEAD_METERS (default 800) ahead of the heading
  -> filter: heading match, active-now pattern, confidence >= threshold
  -> not already alerted for this (trip, hazard)
  -> write TripHazardAlert
  -> realtime `route.hazard.alert` on trip + truck + driver channels
  -> NotificationType.ROUTE_HAZARD_AHEAD for CRITICAL only (no notification spam)
```

Speed cameras add a second pass: if the vehicle's speed at the alert exceeds
`speedLimitKph`, `violated = true`, and the existing driver-scoring engine receives a
`SPEED_VIOLATION` score event — the safety loop closes without a new subsystem.

Predicted signal phase is computed on read:

```text
elapsed = (now - signalReferenceAt) mod signalCycleSeconds
phase   = elapsed < signalGreenSeconds ? GREEN : RED
secondsToChange = ...
predicted = true    // always, for signals
```

## 9.4 Crowd reporting and decay

- One tap in the driver app reports a hazard at the current position, with optional
  photo and note. Reporting is throttled per driver (default 10/hour).
- A report within `radiusMeters` of an existing hazard of the same kind becomes a
  `CONFIRM` vote instead of a duplicate.
- `confidence` starts at 0.4 for a single `DRIVER_REPORT` and rises with confirmations
  from *distinct* organizations (not just distinct users — one fleet cannot manufacture
  consensus).
- `CLEARED` votes drop confidence sharply.
- `runHazardDecaySweep()` — every 15 min: decay `LIVE` confidence with a half-life
  (default 45 min), expire `validUntil`, retire hazards below 0.15, promote
  `UNVERIFIED` to `ACTIVE` at 0.7 with confirmations from two or more organizations.
- Platform admins verify/reject from a review queue; `AUTHORITY`-sourced hazards never
  decay.

## 9.5 API surface

| Method | Path | Permission |
|---|---|---|
| `GET` | `/route-intelligence/hazards` | `routeintel.read` |
| `POST` | `/route-intelligence/route-hazards` | `routeintel.read` |
| `GET` | `/route-intelligence/hazards/:id` | `routeintel.read` |
| `POST` | `/route-intelligence/hazards` | `routeintel.manage` |
| `PATCH` | `/route-intelligence/hazards/:id` | `routeintel.manage` |
| `DELETE` | `/route-intelligence/hazards/:id` | `routeintel.manage` |
| `POST` | `/route-intelligence/reports` | `routeintel.report` |
| `GET` | `/route-intelligence/reports` | `routeintel.manage` |
| `POST` | `/route-intelligence/hazards/:id/vote` | `routeintel.report` |
| `POST` | `/route-intelligence/hazards/:id/verify` | `routeintel.verify` |
| `GET` | `/route-intelligence/signal-phase/:id` | `routeintel.read` |
| `GET` | `/route-intelligence/trips/:tripId/alerts` | `trips.read` |
| `POST` | `/route-intelligence/alerts/:id/acknowledge` | `trips.drive` |
| `GET` | `/route-intelligence/summary` | `analytics.read` |

## 9.6 Frontend

- Map layers in `features/maps/hazard-layers.ts`: one symbol layer per kind group with
  distinct icons, a confidence-driven opacity ramp, and a legend. Toggles live in the
  existing `map-controls.tsx`.
- Trip detail: "Hazards on this route" list with distance-along-route and ETA.
- Driver app: a hazard strip above the navigation panel — next hazard, distance,
  countdown; large type, single glance. Optional speech via `SpeechSynthesis`.
- `/driver/report-hazard` — a big-button reporting sheet (kind grid, photo, submit),
  usable with gloves.
- `/admin/route-intelligence` — review queue and hazard CRUD with a map picker.
- Analytics: hazard exposure per route, speed-camera violations per driver.

## 9.7 Entitlement & RBAC

- Feature `ROUTE_INTELLIGENCE` — **Pro and above** for the map layer and route
  corridor. **Basic** gets driver-facing safety alerts only, because withholding a
  "police checkpoint ahead" or "school zone" warning from a paying customer to sell an
  upgrade is not a defensible product decision.
- Permissions: `routeintel.read`, `routeintel.report`, `routeintel.manage`,
  `routeintel.verify`.
- Grants: `routeintel.read` to every operational role; `routeintel.report` to
  `DRIVER`, `FLEET_OWNER`, `FLEET_MANAGER`, `DISPATCHER`, `ASSOCIATION_ADMIN`,
  `ASSOCIATION_RESPONDER`; `routeintel.manage` to `FLEET_OWNER` (private hazards) and
  `PLATFORM_ADMIN`; `routeintel.verify` to `PLATFORM_ADMIN` and `SUPPORT_AGENT`.

---

# 10. CROSS-CUTTING CHANGES

## 10.1 New permissions (all additive)

```text
media.read              media.upload           media.delete         media.moderate
inventory.read          inventory.manage
resale.browse           resale.manage          resale.offer
resale.transfer         resale.review
profile.directory
qr.read                 qr.manage              qr.audit
returnloads.read        returnloads.manage
cityaccess.read         cityaccess.manage
relay.read              relay.manage           relay.offer
routeintel.read         routeintel.report      routeintel.manage    routeintel.verify
```

`PLATFORM_ADMIN` receives all of them automatically through `ALL_PERMISSIONS`.

## 10.2 New features (entitlements)

| Feature key | Minimum tier | Rationale |
|---|---|---|
| `MEDIA_LIBRARY` | Basic | Images are table stakes |
| `INVENTORY_MANAGEMENT` | Basic | A supplier's core job |
| `RESALE_MARKETPLACE` | Basic | Browsing/buying grows the network |
| `RESALE_PUBLISH` | Pro | Selling is the monetisable side |
| `QR_IDENTITY` | Basic | Identity and safety |
| `RETURN_LOADS` | Pro | Margin feature |
| `CITY_ACCESS_INTELLIGENCE` | Basic | Compliance safety net |
| `LAST_MILE_RELAY` | Pro | Operational depth |
| `ROUTE_INTELLIGENCE` | Pro | Map layer + corridor analysis |
| `PROFILE_BUILDER` | — | Not gated at all |

`PLAN_FEATURES` is extended, and `plan_features` rows are re-seeded from the
definition, so existing subscriptions inherit the new Basic features immediately.

## 10.3 New notification types

```text
STOCK_LOW                 STOCK_OUT                  STOCK_RESTOCKED
STOCK_RESERVATION_EXPIRING
LISTING_PUBLISHED         LISTING_OFFER_RECEIVED     LISTING_OFFER_ACCEPTED
LISTING_OFFER_REJECTED    LISTING_SOLD               LISTING_INSPECTION_REQUESTED
VEHICLE_TRANSFER_UPDATED
RETURN_LOAD_MATCH_FOUND   RETURN_LOAD_BOOKED         RETURN_LOAD_EXPIRING
EMPTY_RETURN_RISK
RELAY_REQUESTED           RELAY_OFFER_RECEIVED       RELAY_ASSIGNED
RELAY_HANDOVER_READY      RELAY_DELIVERED            CITY_ACCESS_BLOCKED
ROUTE_HAZARD_AHEAD        ROUTE_HAZARD_VERIFIED
PROFILE_INCOMPLETE        QR_CODE_ROTATED
MEDIA_MODERATION_REQUIRED
```

## 10.4 New realtime events & channels

```text
channels:  listing:{listingId}     relay:{relayId}     hazard:{city}
events:
  media.uploaded
  stock.updated              stock.low
  listing.updated            listing.offer.created
  returnload.match.created   returnload.updated
  relay.updated              relay.handover.verified
  route.hazard.created       route.hazard.alert       route.hazard.cleared
  qr.scanned
```

`channel-authorization.ts` is extended for the three new channel kinds with the same
"authorise before joining" rule as every existing channel.

## 10.5 New background jobs

| Job | Interval | Purpose |
|---|---|---|
| `runLowStockSweep` | 1 h | low/out-of-stock digests |
| `runStockReservationSweep` | 15 min | release expired holds |
| `runListingExpirySweep` | 6 h | expire listings, nudge sellers |
| `runReturnLoadMatchSweep` | 10 min | recompute matches, expire requests |
| `runEmptyReturnRiskSweep` | 1 h | flag trips arriving with no return load |
| `runRelayTimeoutSweep` | 15 min | re-broadcast unanswered relay requests |
| `runHazardDecaySweep` | 15 min | decay confidence, expire transients |
| `runProfileCompletionSweep` | 24 h | recompute completion, nudge under 60% |
| `runMediaOrphanSweep` | 24 h | purge soft-deleted media past retention |

## 10.6 New environment variables

```text
# Media
MEDIA_MAX_FILE_SIZE=5242880
MEDIA_THUMBNAIL_MAX_SIZE=524288
MEDIA_MAX_PER_OWNER=24
MEDIA_RETENTION_DAYS=30

# Inventory
STOCK_RESERVATION_TTL_HOURS=72
STOCK_LOW_DIGEST_HOUR=8

# Resale
RESALE_REVIEW_REQUIRED=true
RESALE_LISTING_TTL_DAYS=60
RESALE_OFFER_TTL_DAYS=7

# QR
QR_RESOLVE_RATE_LIMIT_MAX=20
QR_RESOLVE_RATE_LIMIT_WINDOW=1 minute
QR_DEFAULT_TTL_DAYS=0            # 0 = no expiry
QR_IMAGE_MAX_SIZE=1024

# Return loads
RETURN_LOAD_MAX_PICKUP_KM=150
RETURN_LOAD_MIN_SCORE=45
RETURN_LOAD_DEFAULT_WINDOW_HOURS=48

# Relay
RELAY_OFFER_TTL_MINUTES=45
RELAY_BROADCAST_RADIUS_KM=60

# Route intelligence
HAZARD_LOOKAHEAD_METERS=800
HAZARD_CORRIDOR_METERS=300
HAZARD_CONFIDENCE_HALF_LIFE_MINUTES=45
HAZARD_MIN_CONFIDENCE=0.25
HAZARD_REPORTS_PER_HOUR=10
HAZARD_VIEWPORT_MAX_FEATURES=500
```

Every one has a working default, so an existing `.env` keeps booting untouched.

## 10.7 New audit actions

```text
MEDIA_UPLOADED / MEDIA_DELETED / MEDIA_MODERATED
STOCK_RECEIVED / STOCK_ADJUSTED / STOCK_TRANSFERRED / STOCK_COUNTED
LISTING_CREATED / LISTING_PUBLISHED / LISTING_REVIEWED / LISTING_SOLD
VEHICLE_OWNERSHIP_TRANSFERRED
PROFILE_UPDATED
QR_CREATED / QR_ROTATED / QR_REVOKED / QR_SCANNED
RETURN_LOAD_CREATED / RETURN_LOAD_MATCHED
CITY_ACCESS_OVERRIDDEN / RELAY_CREATED / RELAY_HANDOVER_VERIFIED
HAZARD_CREATED / HAZARD_VERIFIED / HAZARD_REMOVED
```

`CITY_ACCESS_OVERRIDDEN` and `VEHICLE_OWNERSHIP_TRANSFERRED` are the two that matter
most — one is a deliberate compliance risk, the other moves an asset between tenants.

---

# 11. DATABASE MIGRATION PLAN

One migration per feature, applied in dependency order, so a failure is isolated and
reversible:

| Order | Migration | Contents |
|---|---|---|
| 1 | `media_library` | 4 enums, `media_assets` |
| 2 | `supplier_inventory` | 5 enums, 5 tables, 13 `materials` columns |
| 3 | `vehicle_resale` | 7 enums, 6 tables, `PaymentPurpose.VEHICLE_PURCHASE` |
| 4 | `profile_builder` | 1 enum, 2 tables |
| 5 | `qr_identity` | 4 enums, 2 tables |
| 6 | `return_loads` | 3 enums, 2 tables, `orders`/`trips`/`trucks` columns |
| 7 | `city_access_relay` | 5 enums, 5 tables, `VehicleType.PICKUP`, `orders`/`trucks` columns |
| 8 | `route_intelligence` | 5 enums, 3 tables |
| 9 | `expansion_notifications` | new `NotificationType` values |

**Safety rules:** every new column is nullable or defaulted; no existing column is
altered; new enum values are appended (never reordered — PostgreSQL enum ordinals are
positional); every foreign key is `SetNull` or `Cascade` deliberately, never left to
the default.

**Seed additions** (`prisma/seed/`): 3 demo media assets per demo entity, 2 inventory
locations with stock for the demo supplier, 2 published resale listings, QR codes for
the demo driver and truck, 1 open return-load request with matches, 2 city
restrictions (Bengaluru + Delhi) with 2 transfer hubs and 1 last-mile partner, and
~25 route hazards along the demo corridor.

---

# 12. FRONTEND INFORMATION ARCHITECTURE

New routes, folded into the existing navigation sections — no new top-level tree:

```text
Operations
  /return-loads                 Return loads          (Pro, fleet)
  /return-loads/:id
  /relay                        Last-mile relay       (Pro, fleet)
  /relay/:id
  /relay/opportunities          (partner)
  /relay/partner                (partner profile)

Fleet
  /resale                       Vehicle marketplace
  /resale/:id
  /resale/mine
  /resale/new
  /fleet/trucks/:id             + QR action, + "List for sale" action

Business (supplier)
  /supplier/inventory
  /supplier/inventory/locations
  /supplier/inventory/movements

Safety
  /route-intelligence           Road intelligence map
  /driver/report-hazard

Account
  /settings                     tabbed shell incl. Profile builder
  /profile/:slug                internal directory profile
  /q/:token                     QR resolve
  /scan                         in-app scanner

Platform
  /admin/resale                 listing review queue
  /admin/city-access            restriction registry
  /admin/route-intelligence     hazard review queue
  /admin/media                  moderation queue
```

Every page: `PageHeader`, loading skeletons, `EmptyState`, error state, mobile-first
responsive layout, and the existing `Card`/`DataTable`/`StatusBadge` vocabulary. No new
design language.

---

# 13. TESTING

## Domain unit tests (`packages/shared`)

- `computeAvailability` across all six availability statuses, including backorder.
- `computeProfileCompletion` — weights, missing required, next best action.
- Return-load scoring — hard filters, detour maths, bearing alignment, monotonicity.
- City-restriction matching — day/time windows, midnight-crossing windows, vehicle
  type and weight thresholds, polygon vs radius.
- Hazard corridor matching — point-to-segment distance, heading filter, decimation.
- Predicted signal phase — cycle wraparound, zero-cycle guard.
- Confidence decay — half-life, floor, multi-organization confirmation.
- QR scope resolution — every scanner class from §6.3.

## API integration tests (`apps/api/tests`)

- Media: upload rejects a non-image, rejects a spoofed content-type, enforces the
  per-owner cap, sets/clears primary, mirrors `avatarUrl`, denies cross-tenant read,
  serves `304` on `If-None-Match`.
- Inventory: reserve → consume → release ledger arithmetic; over-reservation refused;
  aggregate matches the ledger after 50 randomised movements; buyer projection hides
  exact on-hand.
- Resale: publish gates (assignment, verification, photo count); offer/counter/accept;
  ownership transfer moves the vehicle and does **not** leak the seller's trips;
  no unauthenticated route responds with a listing.
- Profile: section patch fans out correctly; unknown field is a 400; a driver cannot
  patch organization fields; completion recomputes.
- QR: rotate invalidates the old token; revoked token resolves as `REVOKED` and is
  logged; cross-tenant scan gets the reduced scope; `EMERGENCY` scope refused outside
  an SOS; rate limit trips.
- Return loads: match creation, quote conversion, expiry, tenant scoping.
- City access + relay: hard `NO_ENTRY` blocks trip creation; override is audited;
  relay offer/accept/handover; parent order only completes when the leg is delivered.
- Route intelligence: bbox cap, corridor ordering, duplicate report folds into a vote,
  alert dedupe per (trip, hazard), speed violation raises a score event.

## E2E scenarios

1. **Supplier stock** — receive stock → customer orders → reserve → deliver → consume →
   low-stock notification fires.
2. **Vehicle resale** — list a truck with photos → admin approves → another fleet
   offers → seller accepts → transfer completes → the vehicle appears in the buyer's
   fleet and is gone from the seller's.
3. **Return load** — outbound trip arrives → auto request → match found → quote →
   accepted → return trip runs with `legType = RETURN`.
4. **City relay** — order into a restricted zone → check flags `RELAY` → hub chosen →
   partner offers → accepted → QR handover with photos → city delivery → order
   delivered.
5. **Route hazard** — driver reports a police checkpoint → second fleet confirms →
   promoted to `ACTIVE` → a third truck approaching gets an alert on its trip channel.
6. **Profile + media** — new account completes the builder to 100% including avatar,
   and their photo appears in every listing surface.

---

# 13a. IMPLEMENTATION STATUS

Updated as phases land. "Done" means type-checked, linted, tested and building.

| Phase | Content | State |
|---|---|---|
| **A** | Shared contracts — 35 enum groups, 8 domain modules, 8 Zod modules, 30 permissions, 10 features | **Done** |
| **B** | Prisma schema + migration — 27 tables, 35 types, additive columns on `materials`/`orders`/`trips`/`trucks`/`users`/`organizations` | **Done** |
| **C** | Media library — image-metadata reader, service, routes, legacy mirroring, orphan sweep | **Done (API)** |
| **D** | Profile builder | Not started |
| **E** | QR identity | Not started |
| **F** | Supplier inventory | Not started |
| **G** | Vehicle resale | Not started |
| **H** | Return loads | Not started |
| **I** | City access + relay | Not started |
| **J** | Route intelligence | Not started |
| **K** | Jobs, notifications, realtime, seeds | Not started |
| **L** | Frontend for C–J | Not started |

**Verification at the end of phase C**

- `npm run typecheck` — passes (shared, api, web).
- `npm run build` — passes.
- `npm run test -w @saarthi/shared` — 153 pass (43 pre-existing + 100 new + 10 RC).
- `npm run test -w @saarthi/api` — 167 pass, none modified to accommodate new behaviour.
- Migration `20260822190133_expansion_...` — 27 `CREATE TABLE`, 35 `CREATE TYPE`, and
  every change to an existing table is `ADD COLUMN` with a default. No `DROP`, no
  `SET NOT NULL`, no type narrowing.

**Two defects the new tests caught, both fixed in the implementation:**

1. `computeProfileCompletion` marked a section with no required fields as complete
   even when untouched, so an empty profile showed green ticks on Preferences and
   Visibility. Such a section now completes only once something in it is answered.
2. `hazardsOnRoute` reported each hazard at the *start* of its matched segment,
   understating its position by up to a segment length and giving every hazard on
   the first segment an ETA of zero. It now projects onto the segment and adds the
   along-segment distance.

---

# 14. IMPLEMENTATION ORDER

Dependency-driven. Later phases consume earlier ones, so this order minimises rework.

| Phase | Content | Depends on |
|---|---|---|
| **A** | Shared contracts for all 8 (enums, Zod, domain functions) + permissions + features | — |
| **B** | Prisma models + migrations for all 8, one migration per feature | A |
| **C** | **Media library** end-to-end (API + storage + upload components) | B |
| **D** | **Profile builder** (blueprint, completion, settings shell) | C |
| **E** | **QR identity** (codes, rendering, resolution, badges, scanner) | C |
| **F** | **Supplier inventory** (locations, stock, ledger, order hooks, screens) | B |
| **G** | **Vehicle resale** (listings, offers, evidence, transfer, screens) | C, E |
| **H** | **Return loads** (requests, scoring, matching, automation, screens) | B |
| **I** | **City access + relay** (restrictions, hubs, partners, handover, screens) | E, H |
| **J** | **Route intelligence** (hazards, corridor, live alerts, map layers, driver UI) | B |
| **K** | Jobs, notifications, realtime, seeds, audit wiring for all of the above | C–J |
| **L** | Tests, README/docs refresh, plan re-seed | K |

Phases C–J are independently shippable: each leaves the tree type-checking, tested and
demonstrable on its own.

---

# 15. ACCEPTANCE CRITERIA

A feature is done when all of these hold:

1. `npm run typecheck` and `npm run build` pass at the repository root.
2. `npm test` passes, including the new tests, with no existing test modified to
   accommodate new behaviour.
3. `npm run db:reset && npm run db:seed` produces a database where every new feature is
   visibly populated for the four demo accounts.
4. Every new route rejects: no session (401), wrong permission (403), missing
   entitlement (402/403 with an upgrade hint), and another tenant's record (404).
5. Every new screen renders correctly at 360 px, 768 px and 1440 px, in light and dark
   themes, with loading, empty and error states.
6. No existing endpoint changed its response shape; no existing column changed type;
   no existing permission string changed meaning.
7. Every state transition that moves money, stock, ownership or identity writes an
   audit row.
8. Nothing shows a number it does not have: an unknown value renders as "not reported"
   or "not shared", never as `0`, and every predicted value is labelled as predicted.
