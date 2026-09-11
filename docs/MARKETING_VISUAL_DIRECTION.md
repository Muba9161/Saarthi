# Marketing site — visual direction and image brief

Everything the public site at `/` needs in order to stop looking like
documentation and start looking like a product. Nine images, one folder, one
lighting language.

## Where the files go

Full-resolution sources into `design/marketing/`, named after the slot
(`hero-highway.png`). Then:

```
node tools/prepare-marketing-images.mjs
```

That cuts every source to the exact box the page expects and writes WebP into
`apps/web/public/marketing/`. It uses ffmpeg's libwebp, reports the file size
against a budget, and skips any slot with no source — so land the frames one at
a time. `--only <slot>` redoes a single frame, `--quality <1-100>` overrides the
default 82.

**Not `public/vehicles/`.** That folder is a contract the running app depends
on: one transparent cut-out per vehicle class, normalised to 900x450, consumed
by `PHOTO_BY_SILHOUETTE` in `src/components/common/vehicle-art.tsx` and cropped
by callers to `VEHICLE_ART_ASPECT`. A cinematic hero shot in there breaks every
vehicle card in the product.

## Both kinds of vehicle

Saarthi models six classes — goods and passenger — and `/vehicles/` already
carries all six: truck, tipper, bus, SUV, sedan, auto-rickshaw. Photography that
shows only trucks would contradict the product, so passenger vehicles appear in
four of the nine frames, and `fleet-lineup` carries the whole range explicitly.

> Worth deciding separately: the hero headline still reads *"the operating
> system for your trucking business."* No image fixes that — if travel
> operators are a real segment, that line needs rewording, and it is your call
> rather than mine.

## The one rule that makes this work

**Photographic bands are dark in both themes.** The site is token-driven and
flips light/dark; a photograph is one fixed exposure. Rather than shipping two
of every image, the five photographic bands (hero, coverage, brand, safety,
closing call) are fixed near-black stages that look identical in either theme,
and every other band stays token-driven exactly as it is.

So every prompt below is lit for near-black. Nothing here should come back
bright.

The brand band needs no photograph at all — the **VorldX Saarthi** lockup is
filled with the logo's own gradient (`.brand-logo-gradient`, sampled from the
navy of the V and the saffron of the X), and "Saarthi" writes itself out
underneath in each of the 23 scripts from `LANGUAGE_CATALOGUE`.

> **One thing needs a human check before this goes to customers.** The
> renderings of "Saarthi" live in `SAARTHI_IN_SCRIPT` in
> `apps/web/src/features/marketing/knockout-band.tsx`. The Devanagari,
> Bengali-Assamese, Gujarati, Gurmukhi, Kannada, Malayalam, Odia, Tamil, Telugu
> and Urdu forms are standard and safe. The **Meitei Mayek** (Manipuri), **Ol
> Chiki** (Santali), **Kashmiri** and **Sindhi** forms are transliterations I
> could not verify to the same confidence — get a native reader to confirm
> those four. A wrong one is visible to exactly the people it is meant to
> welcome.

## Palette to hold every image to

| Role | Value | Use in the frame |
| --- | --- | --- |
| Ground | `#18181B` | Sky, asphalt, shadow — the scene's black point |
| Navy | `#062A66` → `#2360BE` | Cold rim light, dusk sky, wet-road reflection |
| Saffron | `#E8590F` → `#FF8C2E` | Marker lamps, tail lights, the single warm accent |

Both taken from `vorldx-mark.png`. Two light sources, always: **cold navy-blue
from behind or above, one warm saffron practical in the scene.** That pairing is
what makes nine separately generated images look like one shoot.

## Subject

Unbranded **Indian-market** vehicles — flat-front cabover trucks and tippers of
the shape already in `design/vehicles/`, and ordinary Indian sedans, SUVs, buses
and auto-rickshaws. Not long-nose American tractors, not Euro aero sleepers.
Every prompt ends with a negative clause stripping badges, liveries, number
plates and text, both because the audience recognises the local shapes and
because generated brand marks are a legal problem.

## The manifest

| # | Slot | Ratio | Generate at | Band | Vehicles |
| --- | --- | --- | --- | --- | --- |
| 1 | `hero-highway` | 16:9 | 2560x1440 | Hero, desktop | Truck + SUV |
| 2 | `hero-highway-portrait` | 3:4 | 1350x1800 | Hero, mobile | Truck + SUV |
| 2a | `coverage-india` | 16:9 | 2560x1440 | Coverage, desktop | Truck |
| 2b | `coverage-india-portrait` | 3:4 | 1350x1800 | Coverage, mobile | Truck |
| 3 | `safety-night` | 4:5 | 1400x1750 | Safety band | Truck |
| 4 | `cta-dusk` | 2:1 | 2400x1200 | Closing band | Mixed |
| 5 | `fleet-lineup` | 4:1, alpha | 2800x700 | Proof stats | All six |
| 5a | `edge-truck` | 4:3, alpha | 1600x1200 | Pillars, left edge | Truck |
| 5b | `edge-suv` | 4:3, alpha | 1600x1200 | Roles, right edge | SUV |
| 6 | `step-01-post` | 16:9 | 1600x900 | How it works 1 | — |
| 7 | `step-02-quote` | 16:9 | 1600x900 | How it works 2 | Mixed |
| 8 | `step-03-assign` | 16:9 | 1600x900 | How it works 3 | Truck |
| 9 | `step-04-track` | 16:9 | 1600x900 | How it works 4 | Cab interior |

Generate a little larger than the target if your tool prefers round numbers —
the script scales down and centre-crops to the exact box.

---

## Prompts

Paste each whole. `--ar` is Midjourney syntax; on Flux, Ideogram, Imagen or
Gemini, drop that line and set the ratio in the UI.

### 1. `hero-highway` — 16:9

> Cinematic wide advertising photograph of an unbranded Indian-market
> flat-front cabover haulage truck with a covered open body, and a dark SUV
> travelling a little ahead of it in the next lane, both seen three-quarter from
> behind, low camera close to wet asphalt, on an empty four-lane national
> highway at blue hour. Both vehicles sit together in the RIGHT THIRD of the
> frame and are driving away from camera; the LEFT TWO-THIRDS is empty wet road,
> low ground mist and open sky, held almost black and almost featureless so that
> large headline text can be placed over it. Near-black scene, RGB 24 24 27,
> lifted only by a cold navy-blue #2360BE rim light along the top edge of the
> cab and the SUV's roofline, and by warm saffron #FF8C2E marker lamps and tail
> lights. Volumetric haze, specular reflections on wet tarmac, no other traffic,
> no roadside clutter. Shot on 35mm at f/2.8, high dynamic range, fine film
> grain, deep blacks with detail retained. Editorial automotive advertising
> photography.
>
> Negative: no text, no lettering, no logos, no badges, no brand marks, no
> number plate, no watermark, no people, no bright sky, no daylight, no
> oversaturated colour.
>
> `--ar 16:9`

**Check before accepting:** the left 60% must be dark and empty enough to read
white text over. If the vehicles drift to centre, regenerate — the headline
lives there.

### 2. `hero-highway-portrait` — 3:4

Generate separately rather than cropping #1 — a centre-crop puts the vehicles
off-frame on a phone.

> Cinematic vertical advertising photograph of an unbranded Indian-market
> flat-front cabover haulage truck with a covered open body and a dark SUV
> alongside it, seen three-quarter from behind on an empty wet national highway
> at blue hour. Both sit low in the BOTTOM THIRD of the tall frame, small in
> scale; the UPPER TWO-THIRDS is empty misted sky and darkness, almost
> featureless, reserved for headline text. Near-black scene, RGB 24 24 27, cold
> navy-blue #2360BE rim light on the cab roof and body edge, warm saffron
> #FF8C2E tail lights. Volumetric ground haze, wet tarmac reflections, no other
> traffic. 35mm, f/2.8, high dynamic range, fine film grain. Editorial
> automotive advertising photography.
>
> Negative: no text, no lettering, no logos, no badges, no number plate, no
> watermark, no people, no bright sky, no daylight.
>
> `--ar 3:4`

### 2a / 2b. `coverage-india`, `coverage-india-portrait` — 16:9 and 3:4

The reach band, between the counted facts and the pillars. A relief India lit
by the same two sources as everything else here, with one truck on an elevated
ribbon crossing it.

**No pins, no arcs, no city names, no numerals.** Every claim is live DOM over
the top — the site writes itself in 23 scripts, and a label baked into a WebP
is English forever. Nothing is registered to the map either: this is a
full-bleed `Backdrop`, cropped differently at every viewport, so a pin placed
against it slides off the coast on the next screen size.

> Cinematic wide advertising render of a three-dimensional relief map of India
> as a dark matte sculptural landmass floating just above a near-black void,
> seen from a high three-quarter angle. A continuous elevated highway ribbon
> sweeps out of the misted horizon, curves across the landmass and runs toward
> camera; a single unbranded Indian-market flat-front cabover haulage truck
> with a covered open body travels along the ribbon in the near foreground,
> three-quarter front, small in scale against the map. The landmass and the
> ribbon sit together in the RIGHT HALF of the frame; the LEFT HALF is empty
> haze and dark sky, almost featureless, held for headline text. Near-black
> scene, RGB 24 24 27. The landmass reads as dark slate with a cold navy-blue
> #2360BE rim light along its coastline and northern ridges, and the same cold
> rim along the top edge of the truck cab. Warm saffron #FF8C2E glow tracing
> the highway ribbon's edges, in the truck's marker lamps and headlights, and
> one warm burst low on the horizon where the ribbon reaches the vanishing
> point. Volumetric haze pooling over the terrain, soft falloff to pure black
> at every frame edge. Clean uninterrupted surface: no borders drawn, no state
> divisions, no cities marked, no pins, no dotted lines. Photoreal 3D product
> render, 50mm, f/4, high dynamic range, fine film grain, deep blacks with
> detail retained.
>
> Negative: no text, no lettering, no numerals, no labels, no city names, no
> map pins, no markers, no dotted route lines, no compass, no flags, no
> political borders, no logos, no badges, no number plate, no watermark, no
> people, no bright sky, no daylight, no oversaturated colour, no white
> background.
>
> `--ar 16:9`

The portrait cut is generated separately — a centre-crop of the landscape frame
puts half the country off a phone screen.

> Cinematic vertical advertising render of a three-dimensional relief map of
> India as a dark matte sculptural landmass floating above a near-black void,
> seen from a high three-quarter angle, occupying the BOTTOM TWO-THIRDS of the
> tall frame. An elevated highway ribbon curves down across the landmass with a
> single unbranded Indian-market flat-front cabover truck travelling along it,
> three-quarter front, small in scale. The UPPER THIRD is empty misted
> darkness, almost featureless, reserved for headline text. Near-black scene,
> RGB 24 24 27, cold navy-blue #2360BE rim light along the coastline and the
> cab roof, warm saffron #FF8C2E glow along the ribbon edges and in the truck's
> lamps. Volumetric haze, soft falloff to pure black at every edge, clean
> unmarked map surface. Photoreal 3D product render, 50mm, f/4, high dynamic
> range, fine film grain.
>
> Negative: no text, no lettering, no numerals, no labels, no city names, no
> map pins, no markers, no dotted lines, no political borders, no flags, no
> logos, no badges, no number plate, no watermark, no people, no bright sky, no
> daylight, no white background.
>
> `--ar 3:4`

**Check before accepting:** the left half of the landscape cut and the upper
third of the portrait cut must be dark and empty enough to read white text
over, and the map surface must come back clean — any pin or line the model
draws will fight the copy laid over it.

> **Decide before this goes to customers.** Generative models do not draw
> India's boundary correctly, and in India a published map showing it wrongly
> is a legal exposure rather than a cosmetic one. The frames in the repo read
> as sculpted terrain rather than as a surveyed map, which is the safer of the
> two readings, but a boundary claim is not a thing to leave to a model. If
> this band is ever used in print or in an ad, replace the silhouette with a
> correct outline from an official source.

### 3. `safety-night` — 4:5

The band it sits on is already dark, so this is the one frame allowed to be
nearly pure black. Expanding SOS rings are drawn over it in the browser, so keep
the right half clear.

> Low-key advertising photograph of the front quarter of a single unbranded
> Indian-market flat-front cabover truck, matte black, standing still in heavy
> night fog on a deserted highway shoulder. Tight crop — the cab fills the left
> half of the tall frame and bleeds off the top and left edges; the right half is
> nothing but fog and darkness. One warm saffron #FF8C2E marker lamp is lit on
> the cab corner, throwing a small pool of light into the mist; a faint cold
> navy-blue #2360BE rim traces the roofline. Everything else falls to near-black,
> RGB 24 24 27. Wet gritty asphalt in the lower foreground. Volumetric fog,
> extreme contrast, mostly shadow, minimal detail. Moody cinematic product
> photography.
>
> Negative: no text, no logos, no badges, no number plate, no watermark, no
> people, no additional light sources, no bright areas, no daylight.
>
> `--ar 4:5`

### 4. `cta-dusk` — 2:1

The page's closing note, so this one is allowed some warmth — it should feel
like a shift starting, not ending. Mixed fleet, because this is the last thing a
visitor sees before signing up.

> Wide cinematic advertising photograph of a mixed Indian fleet pulling out of a
> transport yard in a loose staggered line at first light — two unbranded
> flat-front cabover trucks, an intercity coach and an SUV — seen from a low
> three-quarter front angle. The vehicles are grouped in the RIGHT HALF of the
> wide frame; the LEFT HALF is open yard, ground mist and dark sky held almost
> black and clear of detail for text. Predominantly near-black, RGB 24 24 27,
> with a cold navy-blue #2360BE dawn gradient low on the horizon and warm saffron
> #FF8C2E headlamps and marker lights cutting through the mist. Wet ground, long
> reflections, atmospheric haze. 50mm, f/4, high dynamic range, fine film grain.
> Editorial automotive advertising photography.
>
> Negative: no text, no logos, no badges, no number plates, no watermark, no
> people, no bright sky, no daylight, no clutter.
>
> `--ar 2:1`

### 5. `fleet-lineup` — 4:1, transparent

The only cut-out, and the page's one explicit statement that Saarthi carries
goods *and* passengers. It sits on a band that follows the theme, so it **must**
have a genuine alpha channel — a white background becomes a white slab in dark
mode.

Six vehicles, matching the six classes in `/vehicles/`.

> Studio cut-out product photograph of six unbranded Indian-market vehicles
> arranged in one wide evenly spaced row, all in clean side profile facing right,
> all standing on the same ground line at consistent scale: a flat-front cabover
> haulage truck, a tipper, an intercity bus, an SUV, a sedan and an
> auto-rickshaw, in that order left to right. Even neutral studio lighting from
> above and slightly front, soft gradient falloff along the flanks, subtle cold
> navy-blue #2360BE reflection in the glass and upper panels. Complete isolated
> cut-out on a pure transparent background, no ground shadow, no floor, no
> backdrop, sharp clean edges around wheels and mirrors.
>
> Negative: no background, no shadow, no floor, no reflection under the wheels,
> no text, no logos, no badges, no number plates, no watermark, no people.
>
> `--ar 4:1`

**On transparency:** most models will not give you real alpha. Generate on a
flat mid-grey backdrop and cut it out — the existing `design/vehicles/*.png`
were made the same way, so match their treatment. If six in one frame comes back
badly proportioned, generate each vehicle separately and composite them onto a
single 2800x700 canvas at a shared ground line. The shared canvas is what stops
the auto-rickshaw and the bus arriving at different visual weights.

### 5a / 5b. `edge-truck`, `edge-suv` — 4:3, transparent

The emerging pair. Only the **front** of the vehicle is in the file; the body
runs off the frame's cut edge, and the page positions that cut outside the
section so it is clipped by the page edge. The vehicle therefore has no visible
end — it reads as driving in from off-screen rather than as a picture that
stops. Get the direction wrong and the vehicle reverses into the page.

**`edge-truck`** — enters from the LEFT of the Pillars band, so it faces right.

> Studio cut-out product photograph of the FRONT PORTION ONLY of an unbranded
> Indian-market flat-front cabover haulage truck in clean side profile, facing
> RIGHT. The cab and front wheels sit in the right half of the frame; the cargo
> body extends leftward and is cut off flat by the LEFT edge of the frame,
> continuing out of shot. Even neutral studio lighting from above and slightly
> front, soft gradient falloff along the flank, subtle cold navy-blue #2360BE
> reflection in the windscreen and upper panels, warm saffron #FF8C2E glint on
> the marker lamp. Complete isolated cut-out on a pure transparent background,
> no ground shadow, no floor, no backdrop, sharp clean edges around the wheels
> and mirror.
>
> Negative: no background, no shadow, no floor, no text, no logos, no badges,
> no number plate, no watermark, no people, no complete vehicle, no rear of the
> vehicle in frame.
>
> `--ar 4:3`

**`edge-suv`** — enters from the RIGHT of the roles band, so it faces left.

> Studio cut-out product photograph of the FRONT PORTION ONLY of an unbranded
> Indian-market SUV in clean side profile, facing LEFT. The bonnet, windscreen
> and front wheel sit in the left half of the frame; the body extends rightward
> and is cut off flat by the RIGHT edge of the frame, continuing out of shot.
> Even neutral studio lighting from above and slightly front, soft gradient
> falloff along the flank, subtle cold navy-blue #2360BE reflection in the glass
> and upper panels, warm saffron #FF8C2E glint in the headlamp. Complete
> isolated cut-out on a pure transparent background, no ground shadow, no floor,
> no backdrop, sharp clean edges around the wheel and mirror.
>
> Negative: no background, no shadow, no floor, no text, no logos, no badges,
> no number plate, no watermark, no people, no complete vehicle, no rear of the
> vehicle in frame.
>
> `--ar 4:3`

### 6–9. `step-0N-*` — 16:9

Four supporting frames for the lifecycle band. They sit beside body copy at
about 600px wide, so they must read instantly. Keep them darker than the page
and the subject in the middle third.

**Shared tail — append verbatim to each of the four:**

> Near-black scene, RGB 24 24 27, cold navy-blue #2360BE key light with a single
> warm saffron #FF8C2E practical in frame. Shallow depth of field, atmospheric
> haze, high dynamic range, fine film grain. Editorial documentary advertising
> photography. Negative: no text, no lettering, no logos, no badges, no number
> plates, no watermark, no recognisable faces, no bright areas, no daylight.
> `--ar 16:9`

**6. `step-01-post` — "Post what needs moving"**

> A heaped mound of construction sand and aggregate in a dark supplier yard at
> night, a loader bucket resting at the edge of frame, measuring stakes in the
> ground, seen from a low angle.

**7. `step-02-quote` — "Verified fleets compete"**

> Four unbranded Indian-market vehicles parked side by side and nose-on in a dark
> transport yard at night — two flat-front cabover trucks, a coach and an SUV —
> seen straight on in one row, identical framing, their marker lamps lit in a
> line.

**8. `step-03-assign` — "Accept, and the trip exists"**

> Close crop of a driver's hand pulling open the door of an unbranded flat-front
> cabover truck cab at night, seen from outside and behind the shoulder, cab
> interior glowing warm through the gap, face not visible.

**9. `step-04-track` — "Watch it arrive"**

> Over-the-shoulder view from inside a vehicle cab at night looking out through
> the windscreen at an empty highway unspooling ahead, dashboard instruments
> glowing softly out of focus in the foreground, driver not visible.

---

## Delivery checklist

1. Generate at or above the size in the manifest, RGB, 8-bit.
2. Put the full-resolution file in `design/marketing/`, named after the slot.
3. Run `node tools/prepare-marketing-images.mjs`.
4. `fleet-lineup` is the only frame that keeps an alpha channel.
5. The script prints each output against a size budget. The page already ships
   several `blur-[140px]` gradient layers; heavy images on top of those is what
   will cost the first paint.
