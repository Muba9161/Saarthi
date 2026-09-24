# Marketing Playbook — source

Generates [`docs/Saarthi_Marketing_Playbook.pdf`](../Saarthi_Marketing_Playbook.pdf): 23 A4-landscape
pages for the marketing team.

```bash
node docs/marketing-playbook/build.mjs            # build the PDF
node docs/marketing-playbook/build.mjs --check    # report any page or card that overflows
node docs/marketing-playbook/build.mjs --shot 6 9 # PNG of pages 6 and 9, into .build/
```

## Layout

| Path | What it is |
| --- | --- |
| `pages/*.html` | Page partials, concatenated in filename order. One `<section class="page">` per page. |
| `styles.css` | The print design system — palette, typography, cards, chips, tables. |
| `build.mjs` | Copies assets, caches the webfont, assembles `index.html`, renders through headless Chrome. |
| `.build/` | Generated. Git-ignored. |
| `fonts/` | Cached webfont. Generated on first build. Git-ignored. |

Imagery is copied in from `apps/web/public/marketing/` and the logo from
`apps/web/public/`, so the PDF cannot drift from the site's art. The palette follows
[`MARKETING_VISUAL_DIRECTION.md`](../MARKETING_VISUAL_DIRECTION.md).

## Two things that will bite you

**Run `--check` after every edit.** A page box clips silently — a card pushed off the
bottom or a table column pushed off the right edge looks fine in the browser and is simply
missing from the PDF. The check measures both axes, on every page and every card.

**Grid tracks are `minmax(0, 1fr)`, never `1fr`.** A bare `1fr` floors at the column's
min-content width, so one long unbreakable label silently pushes the last column off the
page. Same reason `table-layout: fixed` is set on the KPI tables: the default
`td.k { white-space: nowrap }` widens a table past its card.

## Keeping it true

Every price, claim and capability in the PDF was taken from the product, mostly from
`packages/shared/src/domain/entitlements.ts`. When plans, limits or pricing change, pages
2, 6, 10, 16, 17 and 22 all state figures and must be re-checked together. Competitor
figures on page 9 are dated and labelled as reported rather than verified — re-confirm them
before they reach a customer-facing asset.
