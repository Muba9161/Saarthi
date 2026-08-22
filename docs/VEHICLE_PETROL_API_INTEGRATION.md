# Claude Code — Vehicle RC + Petrol Station Integration

You are working on my **existing software project**. Do not rebuild the application from scratch.

First inspect the entire codebase and understand the current architecture. Then integrate the following functionality cleanly into the existing application without breaking existing features.

---

## Integrations

### 1. Vehicle Registration Lookup

Use **Way2API Vehicle RC Text + PDF API**.

Documentation:

https://app.way2api.com/documentation/vehicle-rc-text-pdf

The user enters an Indian vehicle registration number such as:

```text
UP32AB1234
```

The application should retrieve:

* Registration number
* Registration date
* Registration status
* Owner information, where permitted
* Vehicle category/class
* Manufacturer
* Model
* Fuel type
* Colour
* Engine information, where permitted
* Chassis information, where permitted
* Cubic capacity
* Seating capacity
* Weight information
* RTO
* Insurance
* Insurance validity
* PUCC
* PUCC validity
* Fitness
* Fitness validity
* Tax
* Permit
* Financer/hypothecation
* Blacklist/NOC information
* Other fields returned by Way2API

Do not invent missing fields.

If a field is unavailable, return `null`.

---

## 2. RC PDF

Use the **Way2API Text + PDF endpoint** so that the vehicle lookup returns both structured information and the PDF URL.

The backend should handle the PDF rather than exposing the third-party API directly to the frontend.

Preferred flow:

```text
User
  ↓
Registration Number
  ↓
Your Backend
  ↓
Way2API
  ↓
Vehicle JSON + PDF URL
  ↓
Your Backend
  ↓
User
```

Provide a **Download RC** button in the UI.

If the PDF URL is temporary, download/store it appropriately rather than assuming the third-party URL is permanent.

If the existing project already has file/object storage, reuse it.

---

# 3. Petrol Station Integration

Use the **SSR Innovation Lab Petrol Pumps API**.

Documentation:

https://api.ssrinnovationlab.com/api/test/18/

The application already has a map.

**Do NOT replace the existing map.**

Add petrol station data as an additional map layer.

Retrieve, where available:

* Station name
* Brand/company
* Latitude
* Longitude
* Address
* City
* District
* State
* Petrol
* Diesel
* CNG
* Petrol price
* Diesel price
* CNG price
* Station timings
* Other useful station metadata returned by the API

Only use fields actually provided by the API.

---

# 4. Existing Map

The existing map must remain unchanged.

Add petrol pump markers to it.

Use the existing map provider, marker system, popup system, bottom sheet, side panel, and UI components wherever possible.

When a petrol station marker is selected, display:

```text
Station Name
Brand
Address

Petrol: Available/Not listed
Petrol Price: ₹...

Diesel: Available/Not listed
Diesel Price: ₹...

CNG: Available/Not listed
CNG Price: ₹...

Opening Hours
```

Do not claim real-time fuel inventory unless the API explicitly provides it.

For example:

```text
has_petrol = true
```

should NOT automatically be displayed as:

```text
Petrol currently available
```

Instead interpret it as the station offering/providing petrol unless the provider documentation confirms real-time availability.

Do not invent:

* litres remaining
* tank capacity
* live inventory
* dispenser status

---

# 5. Backend API

Do not call third-party APIs directly from the frontend.

Create backend service endpoints following the existing project's API conventions.

### Vehicle

```http
POST /api/vehicles/lookup
```

Request:

```json
{
  "registrationNumber": "UP32AB1234"
}
```

### Petrol stations

For example:

```http
GET /api/petrol-stations?lat=26.8467&lng=80.9462&radius=10
```

Use whatever route naming convention already exists in the project.

---

# 6. Vehicle Registration Normalization

Normalize registration numbers before sending them to Way2API.

Requirements:

* trim whitespace
* uppercase
* remove unnecessary spaces
* remove unnecessary hyphens
* validate that it resembles an Indian registration number

Do not make the validation excessively restrictive because Indian registration formats vary.

Example:

```text
up32 ab 1234
```

should normalize appropriately to:

```text
UP32AB1234
```

---

# 7. API Key Security

Never expose third-party API keys to the browser.

Use environment variables.

For example:

```env
WAY2API_API_KEY=
WAY2API_BASE_URL=https://app.way2api.com

SSR_PETROL_API_BASE_URL=
SSR_PETROL_API_KEY=
```

If SSR does not require an API key, do not add fake authentication.

Use the existing configuration/environment architecture if one already exists.

Never commit real API keys.

Update `.env.example`.

---

# 8. Provider Abstraction

Do not tightly couple the application to third-party response formats.

Create provider/service modules.

For example:

```text
services/
├── way2api/
│   └── vehicleRcService
└── petrolStations/
    └── ssrPetrolStationService
```

Adapt the structure to the existing project.

The rest of the application should use our own normalized models/interfaces.

This makes it possible to replace Way2API or SSR later without rewriting the frontend.

---

# 9. Vehicle Response Model

Create a normalized internal model similar to:

```typescript
interface Vehicle {
  registrationNumber: string | null;
  registrationDate: string | null;
  registrationStatus: string | null;

  ownerName: string | null;

  vehicleCategory: string | null;
  vehicleClass: string | null;

  maker: string | null;
  model: string | null;
  fuelType: string | null;
  color: string | null;

  engineNumber: string | null;
  chassisNumber: string | null;

  cubicCapacity: number | null;
  seatingCapacity: number | null;

  grossVehicleWeight: number | null;
  unladenWeight: number | null;

  rto: string | null;
  rtoCode: string | null;

  insuranceValidUntil: string | null;
  puccValidUntil: string | null;
  fitnessValidUntil: string | null;

  tax: unknown;
  permit: unknown;

  financer: string | null;
  hypothecation: unknown;

  blacklist: unknown;
  noc: unknown;
}
```

Adapt this to the project's language/types.

Only expose sensitive fields when required and authorized.

---

# 10. Petrol Station Model

Create a normalized internal station model similar to:

```typescript
interface PetrolStation {
  id: string;
  externalId: string | null;

  name: string | null;
  company: string | null;

  latitude: number;
  longitude: number;

  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;

  hasPetrol: boolean | null;
  hasDiesel: boolean | null;
  hasCng: boolean | null;

  petrolPrice: number | null;
  dieselPrice: number | null;
  cngPrice: number | null;

  timings: string | null;
}
```

Use actual provider fields and types where appropriate.

---

# 11. Petrol Station Map Performance

Do not load the entire petrol station database into the browser.

Only request stations relevant to the current map viewport or user's location.

Prefer:

```text
latitude
longitude
radius
```

or viewport/bounding-box queries if supported.

Implement caching.

Example:

```text
Map viewport changes
        ↓
Check cached station data
        ↓
Cached?
 ├── YES → return cache
 └── NO  → call SSR API
              ↓
          normalize
              ↓
            cache
              ↓
          return data
```

Reuse the existing caching system if available.

---

# 12. Database

First inspect the existing database and ORM.

If there is already a suitable database, create appropriate models/tables.

Potential station model:

```text
petrol_stations
----------------
id
external_id
name
company
latitude
longitude
address
city
district
state
fuel_types
prices
timings
raw_data
created_at
updated_at
```

Potential vehicle cache:

```text
vehicle_lookups
----------------
id
registration_number
response_data
pdf_location
created_at
updated_at
expires_at
```

Do not create duplicate tables/models if equivalent structures already exist.

---

# 13. Caching

Use caching where appropriate.

### Petrol stations

Station data can be cached for a configurable period.

### Vehicle data

Vehicle/RC data should have a shorter and configurable TTL.

Use:

```env
VEHICLE_CACHE_TTL=
PETROL_STATION_CACHE_TTL=
```

Do not store sensitive vehicle information indefinitely.

---

# 14. Security & Privacy

Vehicle RC information may contain personal information.

Implement:

* authentication
* authorization
* rate limiting
* server-side API keys
* secure PDF access
* input validation
* audit logging where appropriate
* no sensitive data in logs
* no API keys in frontend code
* minimum necessary data storage

Do not expose owner/address/chassis/engine information to unauthorized users.

Do not assume that an API returning a field means the application is automatically allowed to display or retain it.

Follow the project's existing privacy/security architecture.

---

# 15. Error Handling

Handle:

* invalid registration number
* vehicle not found
* provider authentication error
* provider rate limit
* provider timeout
* provider unavailable
* malformed provider response
* PDF unavailable
* PDF download failure
* station API failure
* empty station results

Example application response:

```json
{
  "success": false,
  "error": {
    "code": "VEHICLE_NOT_FOUND",
    "message": "No vehicle was found for this registration number."
  }
}
```

Never expose:

* API keys
* internal stack traces
* raw provider credentials
* unnecessary provider internals

---

# 16. Frontend Vehicle UI

Add a vehicle lookup interface that matches the existing design system.

Flow:

```text
Enter registration number
        ↓
Search
        ↓
Loading
        ↓
Vehicle information
        ↓
Download RC
```

Example:

```text
┌───────────────────────────────────┐
│ Vehicle Registration              │
│                                   │
│ [ UP32AB1234              ]       │
│                                   │
│ [ Search Vehicle ]                │
└───────────────────────────────────┘
```

Vehicle result:

```text
┌───────────────────────────────────┐
│ UP32AB1234                         │
│                                   │
│ Maruti Suzuki Swift               │
│ Petrol                            │
│ Registration: 2022                │
│ Status: ACTIVE                    │
│                                   │
│ Insurance     ✓ Valid             │
│ PUC           ✓ Valid             │
│ Fitness       ✓ Valid             │
│                                   │
│ [ Download RC ]                   │
└───────────────────────────────────┘
```

Reuse existing components and styling.

---

# 17. Frontend Petrol Station UI

Add petrol station markers to the existing map.

On marker click:

```text
┌───────────────────────────────────┐
│ BPCL                              │
│                                   │
│ Station Name                      │
│ Lucknow, Uttar Pradesh            │
│                                   │
│ Petrol       ₹XX.XX               │
│ Diesel       ₹XX.XX               │
│ CNG          ₹XX.XX               │
│                                   │
│ Petrol       ✓                    │
│ Diesel       ✓                    │
│ CNG          ✓                    │
│                                   │
│ Open: 24 hours                    │
└───────────────────────────────────┘
```

Use the existing map popup/card/bottom-sheet system.

---

# 18. Loading States

Vehicle:

```text
Checking vehicle registration...
Fetching RC details...
Preparing RC document...
```

Stations:

```text
Finding nearby petrol stations...
```

Use the existing loading components.

Do not freeze the UI.

---

# 19. Empty States

Vehicle:

```text
No vehicle information found for this registration number.
```

Stations:

```text
No petrol stations found in this area.
```

Provider error:

```text
Data is temporarily unavailable. Please try again.
```

Use existing notification/toast/error components.

---

# 20. Tests

Add automated tests using the project's existing testing framework.

### Vehicle tests

Test:

* valid registration
* lowercase registration
* whitespace
* invalid registration
* vehicle not found
* provider timeout
* provider rate limit
* malformed provider response
* PDF returned
* PDF download failure
* cache hit
* cache miss

### Petrol station tests

Test:

* valid coordinates
* station results
* multiple stations
* no stations
* API failure
* timeout
* malformed response
* cache hit
* cache miss
* duplicate station handling
* map marker rendering

Mock external APIs.

Do not make paid API calls during automated tests.

---

# 21. Documentation

Update the project's README/developer documentation.

Document:

## Vehicle

```http
POST /api/vehicles/lookup
```

Request:

```json
{
  "registrationNumber": "UP32AB1234"
}
```

## Petrol stations

```http
GET /api/petrol-stations?lat=26.8467&lng=80.9462&radius=10
```

Document:

* request parameters
* response schema
* authentication requirements
* environment variables
* caching
* error codes
* development setup
* testing

---

# 22. Before Writing Code

**Do not immediately modify files.**

First inspect the project and identify:

1. Frontend framework
2. Backend framework
3. Database
4. ORM
5. Existing API architecture
6. Authentication
7. Existing map provider
8. Existing map components
9. File/object storage
10. Cache
11. Environment/configuration
12. UI/component library
13. Testing framework
14. Existing service/provider architecture

Then provide a concise implementation plan based on the actual codebase.

After the plan, proceed with implementation.

---

# 23. Important Rules

* Do not rebuild the application.
* Do not replace the existing map.
* Do not rewrite unrelated code.
* Do not introduce unnecessary dependencies.
* Reuse existing components and utilities.
* Follow existing project conventions.
* Keep third-party integrations isolated.
* Keep API keys server-side.
* Do not use fake production data.
* Do not fabricate missing fields.
* Do not claim live fuel inventory unless actually supplied by the API.
* Do not expose sensitive vehicle information unnecessarily.
* Add tests.
* Add proper error handling.
* Keep the implementation production-ready.

---

# 24. Final Report

After implementation, report:

1. Files created
2. Files modified
3. Environment variables required
4. Database migrations
5. API endpoints added
6. Way2API integration details
7. SSR petrol station integration details
8. PDF download implementation
9. Caching implementation
10. Security/privacy considerations
11. Tests added
12. How to run locally
13. How to test vehicle lookup
14. How to test petrol stations
15. Any limitations or assumptions

**Most important: inspect first, plan second, implement third, and preserve the existing project architecture.**