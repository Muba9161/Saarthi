# Marketing photography

Web-delivery WebP for the public landing page. Filenames are read by
`apps/web/src/features/marketing/imagery.tsx` — they are not discovered, so a
file only appears on the page under the exact name in the manifest.

The brief, including the generation prompt, ratio and required composition for
each frame, is in `docs/MARKETING_VISUAL_DIRECTION.md`. Full-resolution sources
belong in `design/marketing/`.

Do not put these in `public/vehicles/`: that folder is a contract with the
running app — one transparent cut-out per vehicle class on a shared 900x450
canvas — and every vehicle card in the product depends on it.

| File | Ratio |
| --- | --- |
| `hero-highway.webp` | 16:9 |
| `hero-highway-portrait.webp` | 3:4 |
| `knockout-landscape.webp` | 16:9 |
| `safety-night.webp` | 4:5 |
| `cta-dusk.webp` | 2:1 |
| `fleet-lineup.webp` | 3:1, alpha |
| `step-01-post.webp` | 16:9 |
| `step-02-quote.webp` | 16:9 |
| `step-03-assign.webp` | 16:9 |
| `step-04-track.webp` | 16:9 |

Every band renders correctly with its file absent, so they can land one at a
time.
