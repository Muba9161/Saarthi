# RTO lookups & petrol station directory

Three external integrations sit behind Saarthi's own models:

| Capability | Provider | Where the vendor is known |
| --- | --- | --- |
| Vehicle registration (RC) record + certificate PDF | [Way2API](https://app.way2api.com/documentation/vehicle-rc-text-pdf) | `apps/api/src/providers/vehicle-rc/` |
| Driving licence (DL) record | [Way2API](https://app.way2api.com/documentation/driving-license) | `apps/api/src/providers/driving-licence/` |
| Petrol / CNG station directory + published fuel prices | [SSR Innovation Lab](https://api.ssrinnovationlab.com/api/test/18/) | `apps/api/src/providers/petrol-stations/` |

Nothing outside those two folders knows a provider's field names, URL shape or
status vocabulary. The rest of the platform — routes, services, client, tests —
uses `VehicleRcRecord`, `DrivingLicenceRecord` and `PetrolStation` from
`@saarthi/shared`, so a vendor can be replaced by adding one file and changing
one line in a factory.

Neither provider is ever called from the browser. Both keys are server-side.

---

## 1. Vehicle registration lookup

### `POST /api/v1/vehicles/lookup`

**Auth:** bearer access token · **Permission:** `vehicles.lookup` ·
**Plan feature:** `fleet.basic` · **Rate limit:** `VEHICLE_LOOKUP_RATE_LIMIT_MAX`
per user per window, on top of the global limit.

> **Scope: your own vehicles only.** The registration number must belong to a
> non-archived vehicle in the caller's organization, or the request is refused
> with `FORBIDDEN` and **no provider call is made**. Without that rule this
> endpoint would be an open RTO search — anyone with an account could pull the
> registered owner's name, address and phone number for any plate they saw on
> the road. Platform admins are exempt so support can act for a tenant, and
> that access is audited like any other lookup.
>
> The check runs before the cache as well as the provider, so a vehicle that
> leaves the fleet stops returning its owner's details from a warm cache entry.

```json
{
  "registrationNumber": "UP32AB1234",
  "refresh": false
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `registrationNumber` | string | yes | Normalised before use — see below. |
| `refresh` | boolean | no (`false`) | Bypass the cached record and pay for a fresh provider call. |

**Response** — `{ success: true, data: VehicleLookupResult }`:

```json
{
  "success": true,
  "data": {
    "lookupId": "6f1c…",
    "registrationNumber": "UP32AB1234",
    "cached": false,
    "retrievedAt": "2026-08-22T18:30:00.000Z",
    "expiresAt": "2026-08-23T18:30:00.000Z",
    "pdfAvailable": true,
    "providerReference": "W2A1739512345abcdef01",
    "vehicle": {
      "registrationNumber": "UP32AB1234",
      "registrationDate": "2022-03-20",
      "registrationStatus": "ACTIVE",
      "owner": {
        "name": "…", "fatherName": null, "serialNumber": "1",
        "mobileNumber": null, "presentAddress": "…", "permanentAddress": "…"
      },
      "vehicleCategory": "LMV",
      "vehicleClass": "Motor Car(LMV)",
      "bodyType": "SALOON",
      "maker": "MARUTI SUZUKI INDIA LTD",
      "model": "SWIFT VXI",
      "variant": null,
      "fuelType": "PETROL",
      "color": "PEARL ARCTIC WHITE",
      "emissionNorms": "BHARAT STAGE VI",
      "manufacturedOn": "2022-01",
      "engineNumber": "…",
      "chassisNumber": "…",
      "cubicCapacity": 1197,
      "cylinders": 4,
      "seatingCapacity": 5,
      "sleeperCapacity": 0,
      "standingCapacity": 0,
      "wheelbaseMm": 2450,
      "grossVehicleWeight": 1355,
      "unladenWeight": 875,
      "rto": "LUCKNOW RTO, Uttar Pradesh",
      "rtoCode": null,
      "insurer": "…",
      "insurancePolicyNumber": "…",
      "insuranceValidUntil": "2029-03-18",
      "puccNumber": "…",
      "puccValidUntil": "2026-11-02",
      "fitnessValidUntil": "2037-03-19",
      "tax": { "validUntil": "2037-03-19", "paidUntil": "2037-03-19" },
      "permit": {
        "number": null, "type": null, "issuedOn": null,
        "validFrom": null, "validUntil": null,
        "national": { "number": null, "validUntil": null, "issuedBy": null }
      },
      "financed": true,
      "financer": "…",
      "blacklistStatus": null,
      "nocDetails": null,
      "nonUse": { "status": null, "from": null, "to": null },
      "challanDetails": null,
      "dataAsOf": "2026-08-11",
      "partialRecord": false,
      "maskedByProvider": { "ownerName": false, "chassisNumber": false, "engineNumber": false },
      "redacted": false
    }
  }
}
```

**Every field is nullable.** A field the RTO did not publish comes back `null` —
it is never guessed, defaulted, or inferred from a neighbouring field. Blank
provider strings (`""`, `"NA"`) are normalised to `null`.

### `GET /api/v1/vehicles/lookups/latest?registrationNumber=...`

The record Saarthi **already holds**, or `null`. Free and idempotent: no
provider call, no charge, no budget consumed.

This is what the vehicle's Registration tab calls when it opens, which is what
makes a fetched record survive a page refresh instead of having to be bought
again. A record past its cache window is still returned - stale RC data with a
visible "retrieved on" date beats a blank panel - and the caller decides whether
to spend a lookup refreshing it.

### `GET /api/v1/vehicles/lookups/:lookupId/document`

Streams Saarthi's **own stored copy** of the RC certificate.
`?disposition=inline` renders in-browser instead of downloading.

Same permission and feature gates as the lookup. Responds
`private, no-store`. Returns `PDF_UNAVAILABLE` (404) when the provider produced
no document for that lookup.

The provider's `pdf_url` is temporary and is **never** sent to the browser. It
is fetched during the lookup, size-capped at `VEHICLE_RC_PDF_MAX_BYTES`,
verified by magic bytes (a non-PDF is discarded), and written through the
existing `StorageProvider`. If any of that fails the lookup still succeeds with
`pdfAvailable: false` — an unavailable document must not cost the caller the
record they already paid for.

### Registration number normalisation

`up32 ab 1234`, `UP-32-AB-1234` and `UP32AB1234` are one vehicle: one cache
entry, one billable lookup. Normalisation trims, uppercases and strips spaces
and hyphens (`normalizeRegistrationNumber`), then a deliberately permissive
shape check (`isPlausibleIndianRegistration`) rejects obvious rubbish before
money is spent. It accepts state series, Bharat series (`22BH1234AA`) and
defence formats — the provider remains the authority on whether a plate exists.

### Privacy

An RC record contains personal data. `owner` (name, father's name, phone, both
addresses), `engineNumber` and `chassisNumber` are stripped for any caller
without `vehicles.lookup.sensitive`, and the response sets `redacted: true` so
the UI can say so rather than showing silent blanks.

| Role | `vehicles.lookup` | `vehicles.lookup.sensitive` |
| --- | --- | --- |
| Platform admin | ✅ | ✅ |
| Fleet owner | ✅ | ✅ |
| Fleet manager | ✅ | — |
| Dispatcher | ✅ | — |
| Driver, supplier, customer | — | — |

Both the lookup and every document read are written to the audit log
(`vehicle.rc_lookup`, `vehicle.rc_pdf_downloaded`) with the registration number
and outcome only — never the RC payload. Logs carry a masked plate
(`UP••••34`), never the API key, and never owner details.

---

## 2. Driving licence lookup

### `POST /api/v1/drivers/licence/lookup`

**Auth:** bearer access token - **Permission:** `drivers.licence.lookup` -
**Plan feature:** `fleet.basic` - **Rate limit:**
`LICENCE_LOOKUP_RATE_LIMIT_MAX` per user per window.

```json
{
  "licenceNumber": "MH0320140001234",
  "dateOfBirth": "1992-06-15",
  "refresh": false
}
```

**Both fields are required.** The RTO verifies a licence number *against* a date
of birth - that is a second factor, not a formality, and it is what stops the
endpoint turning a photocopied licence into a stranger's home address.

> **Scope: your own drivers only.** The licence must belong to a non-archived
> driver in the caller's organization, or the request is refused with
> `FORBIDDEN` and **no provider call is made**. A driver may always look up
> their own licence - and only their own: the number must match the one on their
> profile. Platform admins are exempt, audited like any other lookup.

**Response** - `{ success: true, data: LicenceLookupResult }` whose `licence` is
a `DrivingLicenceRecord`:

```json
{
  "licenceNumber": "MH0320140001234",
  "state": "Maharashtra",
  "holder": {
    "name": "...", "fatherOrHusbandName": "...", "gender": "F",
    "dateOfBirth": "1992-06-15", "bloodGroup": "B+", "citizenship": null,
    "permanentAddress": "...", "permanentZip": "411001",
    "temporaryAddress": "...", "temporaryZip": "411001"
  },
  "issuingAuthority": "RTO PUNE",
  "issuingAuthorityCode": "MH032",
  "issuedOn": "2014-08-11",
  "validUntil": "2034-08-10",
  "transportIssuedOn": null,
  "transportValidUntil": null,
  "vehicleClasses": ["MCWG", "LMV-NT"],
  "hasPhotograph": true,
  "partialRecord": false,
  "redacted": false
}
```

The photograph itself is never retrieved - `hasPhotograph` only reports that the
RTO holds one.

### `GET /api/v1/drivers/licence/latest?licenceNumber=...`

The stored record, or `null`. Free, no provider call - this is what the driver's
Licence tab shows on open.

### Two provider quirks handled in the adapter

* `transport_doi` / `transport_doe` come back as **`1800-01-01`** when the
  licence carries no commercial entitlement. That sentinel is mapped to `null`;
  passing it through would tell a fleet manager their driver's transport licence
  expired two centuries ago.
* A **failed** verification still returns a `result` object full of nulls. The
  outcome flags decide, not the presence of a payload - otherwise every
  not-found would render as a licence with no name.

### Commercial entitlement

`hasTransportEntitlement()` reports whether the listed classes permit driving a
goods vehicle. It returns `null` - not `false` - when the RTO published no
classes at all, so a manager is never told a driver is unqualified because the
record happened to be silent.

### Privacy

The `holder` block (name, parentage, both addresses, blood group, gender) is
stripped for any caller without `drivers.licence.lookup.sensitive`, and
`redacted: true` is set so the UI can say so.

| Role | `drivers.licence.lookup` | `...sensitive` |
| --- | --- | --- |
| Platform admin | yes | yes |
| Fleet owner / mobility provider | yes | yes |
| Fleet manager, dispatcher | yes | - |
| Driver | yes (own only) | yes (own only) |
| Supplier, customer | - | - |

The audit entry (`driver.licence_lookup`) records the licence number and
outcome. Neither the holder's details **nor the date of birth used to verify**
ever reach the log; logs carry a masked number (`MH****34`).

---

## 3. Petrol stations

### `GET /api/v1/petrol-stations`

**Auth:** bearer access token · **Permission:** `nearby.read` ·
**Plan feature:** `nearby.services`.

Reuses the nearby-services gates: to a driver a fuel stop *is* a nearby
service, and a fleet that has paid for nearby services has paid for this.

| Parameter | Aliases | Type | Default | Notes |
| --- | --- | --- | --- | --- |
| `latitude` | `lat` | number | required | −90…90 |
| `longitude` | `lng`, `lon` | number | required | −180…180 |
| `radiusKm` | `radius` | number | `10` | 1…50 |
| `limit` | — | integer | `50` | 1…200 |
| `fuelType` | — | `petrol` \| `diesel` \| `cng` | — | Stations selling that fuel |
| `company` | — | string | — | Brand filter, e.g. `HP`, `BPCL` |

Both spellings work, so the documented shorthand and Saarthi's own convention
are interchangeable:

```http
GET /api/v1/petrol-stations?lat=26.8467&lng=80.9462&radius=10
GET /api/v1/petrol-stations?latitude=26.8467&longitude=80.9462&radiusKm=10
```

**Response** — `{ success: true, data: PetrolStationSearchResult, meta }`:

```json
{
  "success": true,
  "data": {
    "stations": [
      {
        "id": "ssr:81233",
        "externalId": "81233",
        "source": "ssr",
        "name": "U. P. Petrol Service Station",
        "company": "BPCL",
        "latitude": 26.846159,
        "longitude": 80.945557,
        "address": "Near Capitol Cinema, Hazratganj",
        "city": "Lucknow",
        "district": "Lucknow",
        "state": "Uttar Pradesh",
        "hasPetrol": true,
        "hasDiesel": true,
        "hasCng": false,
        "petrolPrice": 94.73,
        "dieselPrice": 87.86,
        "cngPrice": null,
        "timings": "24 Hours",
        "directionsUrl": "https://maps.google.com/maps?q=26.846159,80.945557",
        "distanceKm": 0.12,
        "direction": "SW"
      }
    ],
    "totalWithinRadius": 90,
    "radiusKm": 10,
    "cached": false,
    "stale": false,
    "retrievedAt": "2026-08-22T18:30:00.000Z"
  },
  "meta": { "cached": false, "stale": false, "count": 1 }
}
```

### What the fuel flags actually mean

`hasPetrol` / `hasDiesel` / `hasCng` mean **the directory lists this station as
selling that fuel**. They are not a live inventory, tank level or dispenser
signal. The UI therefore renders "Offered here" / "Not listed", never
"available now", and shows no litres, capacity or stock figure anywhere —
the provider publishes none, so Saarthi invents none.

Prices are the directory's published rate for the station's area. The provider
supplies no observation timestamp, so Saarthi publishes none; the UI labels
them "as published by the fuel directory, not live pump readings". A price of
zero is treated as *not published* (`null`), not as free fuel.

### Map performance

There is deliberately **no list-all endpoint** — a national directory must
never be pulled into a browser. Every request is bounded by point and radius,
and the client only asks for the current map area.

```
viewport / user location
        ↓
in-process cache  (PETROL_STATION_CACHE_TTL, key rounded to ~1 km)
        ↓ miss
SSR directory
        ↓
normalise → de-duplicate → sort by distance → limit
        ↓
mirror into `petrol_stations` (best-effort)
        ↓
return
```

The `petrol_stations` mirror is also the outage fallback: if the directory is
unreachable, previously seen stations for that area are returned with
`stale: true` and the UI says so, instead of showing an empty map. A stale
answer is cached for at most 120 s so the map recovers as soon as the directory
does.

Duplicates are collapsed on `source:externalId` and again on
`name + coordinates`, because the directory sometimes returns one site twice —
once under its own id and again as a dealer-level record.

---

## 4. Environment variables

All server-side. Copy from `.env.example`; never commit real keys.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WAY2API_BASE_URL` | `https://app.way2api.com` | RC provider base URL |
| `WAY2API_API_KEY` | *(empty)* | RC provider key. **Empty disables the feature** — no placeholder data is ever substituted. |
| `WAY2API_TIMEOUT_MS` | `20000` | Per-request timeout |
| `VEHICLE_RC_PDF_MAX_BYTES` | `8388608` | Largest RC PDF Saarthi will store |
| `VEHICLE_CACHE_TTL` | `86400` | Seconds a stored RC record is reused **and** its retention window |
| `VEHICLE_LOOKUP_BUDGET` | `0` | Hard ceiling on **billable** provider calls for this environment. `0` = uncapped. Cache hits do not count. |
| `VEHICLE_LOOKUP_RATE_LIMIT_MAX` | `10` | Lookups per user per window |
| `VEHICLE_LOOKUP_RATE_LIMIT_WINDOW` | `1 minute` | Window for the above |
| `VEHICLE_LOOKUP_RETENTION_DAYS` | `365` | How long an RC record may be held |
| `LICENCE_CACHE_TTL` | `86400` | Seconds a stored licence record is reused |
| `LICENCE_LOOKUP_RETENTION_DAYS` | `365` | How long a licence record may be held |
| `LICENCE_LOOKUP_BUDGET` | `0` | Ceiling on billable licence calls. `0` = uncapped |
| `LICENCE_LOOKUP_RATE_LIMIT_MAX` | `10` | Licence lookups per user per window |
| `SSR_PETROL_API_BASE_URL` | `https://api.ssrinnovationlab.com` | Station directory base URL |
| `SSR_PETROL_API_KEY` | *(empty)* | Optional. The directory serves unauthenticated reads today; sent as `X-api-key` only when set. |
| `SSR_PETROL_TIMEOUT_MS` | `12000` | Per-request timeout |
| `PETROL_STATION_CACHE_TTL` | `21600` | Seconds a station search is reused |

---

## 5. Caching & retention

Two different windows, deliberately:

* **`*_CACHE_TTL`** decides when a *fresh provider call* becomes worthwhile.
  Past it, the stored record is still shown - it is simply marked with when it
  was retrieved.
* **`*_RETENTION_DAYS`** decides how long Saarthi may hold the personal data at
  all. Past it the row is deleted outright.

Collapsing the two would mean either paying for a lookup every day or keeping
somebody's address for ever. They are separate settings for that reason.

| Data | Where | Reuse window | Retention |
| --- | --- | --- | --- |
| RC record + PDF | `vehicle_lookups` + object storage | `VEHICLE_CACHE_TTL` | `VEHICLE_LOOKUP_RETENTION_DAYS`, PDF bytes included |
| Licence record | `licence_lookups` | `LICENCE_CACHE_TTL` | `LICENCE_LOOKUP_RETENTION_DAYS` |
| Station search | in-process cache | `PETROL_STATION_CACHE_TTL` | Recomputed |
| Station records | `petrol_stations` (PostgreSQL) | — | Upserted on each refresh; kept as the outage fallback |

RC rows carry personal data, so `expiresAt` is both the cache boundary and the
retention boundary — nothing is held longer than the operator configured. The
retention sweep runs every 6 hours.

### Not spending a trial allowance by accident

Way2API bills per lookup and grants a small trial allowance per service (5 calls
for `rc_text_pdf` at the time of writing, $0.023/call after). Three mechanisms
keep development inside it:

1. **`VEHICLE_LOOKUP_BUDGET`** — a hard ceiling on billable calls. When it is
   reached the service refuses *before* contacting the provider and answers
   `PROVIDER_BUDGET_EXHAUSTED`. Set it to your remaining allowance locally; leave
   it `0` in production.
2. **The cache** — a repeat search of the same plate is served from
   `vehicle_lookups` and never touches the provider, so it neither costs money
   nor consumes budget. Only `refresh: true` forces a new billable call.
3. **`VEHICLE_LOOKUP_RATE_LIMIT_MAX`** — caps how fast a single user can spend.

Successful lookups report what is left in the response `meta`:

```json
{ "success": true, "data": { … }, "meta": { "budgetRemaining": 3 } }
```

The ceiling is counted from audit entries, which survive restarts and the
retention sweep. It is a development guard, not a billing ledger — the audit
write lands just after the call returns, so two genuinely simultaneous requests
could both pass the check. Way2API's own dashboard remains authoritative on what
was charged.

---

## 6. Error codes

Returned in the standard failure envelope:

```json
{ "success": false, "error": { "code": "VEHICLE_NOT_FOUND", "message": "No vehicle was found for this registration number." } }
```

| Code | HTTP | Cause |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Registration number or coordinates rejected locally (no provider call, no charge) |
| `UNAUTHENTICATED` | 401 | Missing or expired token |
| `FORBIDDEN` | 403 | Missing `vehicles.lookup` / `nearby.read`, **or the plate is not a vehicle in the caller's fleet** |
| `FEATURE_NOT_AVAILABLE` | 403 | Plan does not include the feature |
| `VEHICLE_NOT_FOUND` | 404 | Provider ran the lookup and found no record |
| `LICENCE_NOT_FOUND` | 404 | No licence matched that number and date of birth |
| `PDF_UNAVAILABLE` | 404 | No RC document was produced or stored for that lookup |
| `NOT_FOUND` | 404 | Unknown lookup id, or one belonging to another tenant |
| `PROVIDER_BUDGET_EXHAUSTED` | 429 | `VEHICLE_LOOKUP_BUDGET` reached — refused locally, no provider call made |
| `PROVIDER_RATE_LIMITED` | 429 | Provider rate limit reached |
| `RATE_LIMITED` | 429 | Saarthi's own per-user lookup limit reached |
| `PROVIDER_ERROR` | 502 | Malformed or incomplete provider response |
| `PROVIDER_UNAVAILABLE` | 503 | Provider down, pending, or **rejected Saarthi's credentials/balance** |
| `PROVIDER_NOT_CONFIGURED` | 503 | `WAY2API_API_KEY` is not set on this environment |
| `PROVIDER_TIMEOUT` | 504 | Provider exceeded the configured timeout |

Credential, balance and entitlement failures are operator problems, not user
problems: they are logged loudly for us and surfaced as a generic outage. API
keys, stack traces and provider internals never reach a client.

---

## 7. Database

Added by migration `20260822172159_petrol_stations_and_vehicle_lookups`.

```
petrol_stations                    vehicle_lookups
---------------                    ---------------
id                                 id
source            ─┐ unique        registration_number  ─┐ indexed with
external_id       ─┘               expires_at           ─┘ expires_at
name, company                      organization_id      ─┐ indexed with
latitude, longitude  (indexed)     created_at           ─┘
address, city, district, state     requested_by_id
has_petrol/diesel/cng              provider, provider_reference
petrol/diesel/cng_price            response_data        (normalised RC record)
timings, directions_url            pdf_storage_key / _file_name / _mime_type / _size
raw_data          (replay)         fetched_at, expires_at (indexed)
refreshed_at, created_at,          created_at, updated_at
updated_at
```

---

## 8. Running and testing locally

```bash
# 1. Configure — the petrol directory needs no key; RC lookup needs one.
cp .env.example .env      # then set WAY2API_API_KEY to enable RC lookup

# 2. Migrate
npm run db:migrate

# 3. Run
npm run dev               # API :4000, web :5173
```

**Vehicle lookup** — two ways in, both limited to vehicles you own:

* **From the vehicle.** Open a truck (**Fleet → Trucks → any truck**) and switch
  to the **Registration** tab. The plate is already filled in, so it is one
  press of *Get details*.
* **From the standalone page.** **Fleet → Vehicle registration**
  (`/fleet/rc-lookup`), type a registration number in any casing or spacing, and
  press *Search vehicle*. A plate that is not in your fleet is refused before
  any provider call. *Download RC* streams Saarthi's stored
copy. *Refresh* forces a fresh (billable) provider call. Signed in as a fleet
*manager* instead, owner and identifier fields are withheld and the panel says
so. With `WAY2API_API_KEY` empty the endpoint answers
`PROVIDER_NOT_CONFIGURED` rather than inventing data.

```bash
curl -X POST http://localhost:4000/api/v1/vehicles/lookup \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"registrationNumber":"up32 ab 1234"}'
```

**Petrol stations** — open **Safety → Nearby services** (`/nearby`), press
*Petrol stations*. Markers are added to the existing map as their own layer;
clicking one opens the station popup, and the list beside it mirrors the same
data. The fuel chips filter to petrol / diesel / CNG.

```bash
curl "http://localhost:4000/api/v1/petrol-stations?lat=26.8467&lng=80.9462&radius=10" \
  -H "authorization: Bearer $TOKEN"
```

### Automated tests

```bash
npm run test -w @saarthi/shared   # normalisation, validity bands, fuel labels
npm run test -w @saarthi/api      # tests/vehicle-lookup.test.ts, tests/petrol-stations.test.ts
npm run test -w @saarthi/web      # station card rendering
```

Both API suites stub `fetch`, so the whole route → guard → service →
normaliser → cache → storage path runs for real while **no paid provider call
is ever made**. They cover valid, lowercase and whitespace registrations,
invalid input, vehicle-not-found, provider timeout, rate limit, credential
failure, malformed responses, PDF stored / PDF download failure, cache hit,
cache miss, expiry, redaction and audit content; and for stations: normalisation,
multiple results ordered by distance, empty areas, directory 404 / 500 /
timeout / malformed body, duplicate collapsing, unmappable records, zero
prices, cache hit and miss, the database mirror and the stale fallback.
