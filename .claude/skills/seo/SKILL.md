# SEO SKILL — PROJECT-WIDE SEO & FUTURE CHANGE RULES

## 1. PURPOSE

You are responsible for maintaining and continuously improving the SEO of the entire project.

SEO is NOT a one-time task.

You must:

1. Audit the entire project for SEO.
2. Identify existing SEO problems.
3. Fix SEO issues without breaking existing functionality.
4. Improve technical SEO.
5. Improve on-page SEO.
6. Improve content structure and semantic HTML.
7. Improve performance and Core Web Vitals.
8. Improve accessibility where it affects SEO.
9. Ensure pages are crawlable and indexable where appropriate.
10. Ensure search engines can understand the website structure.
11. Apply SEO automatically to every new feature, page, component, route, API-driven page, and content update.
12. Re-check SEO after major changes.

---

# 2. CORE RULE

## SEO MUST BE PART OF DEVELOPMENT

Never treat SEO as an optional final step.

Whenever you:

* Create a page
* Create a route
* Create a component
* Add a feature
* Add a product/service
* Add a blog
* Add a category
* Add a landing page
* Modify existing content
* Modify navigation
* Modify URLs
* Add images
* Add forms
* Add dynamic content
* Add API-driven pages
* Add authentication-related public pages
* Modify structured data
* Modify site configuration

you MUST consider SEO implications.

Before completing the task, verify that the change does not introduce SEO regressions.

---

# 3. FIRST TASK — COMPLETE PROJECT SEO AUDIT

Before making SEO changes, inspect the complete project.

Analyze:

* Framework
* Routing architecture
* Rendering strategy
* Public pages
* Private pages
* Dynamic routes
* API routes
* Database-driven content
* Metadata implementation
* Sitemap
* Robots.txt
* Canonical URLs
* Structured data
* Heading hierarchy
* Internal linking
* Images
* Alt text
* Open Graph
* Twitter/X metadata
* Page speed
* JavaScript usage
* CSS delivery
* Font loading
* Mobile responsiveness
* Accessibility
* 404 handling
* Redirects
* Duplicate URLs
* Query parameters
* Pagination
* Breadcrumbs
* Search pages
* Blog structure
* Category pages
* Location pages
* Service/product pages
* Indexability
* Crawlability

Do NOT assume the current implementation is correct.

Inspect the actual project before recommending changes.

---

# 4. DO NOT BREAK EXISTING FUNCTIONALITY

SEO improvements must preserve existing functionality.

Never:

* Delete existing features
* Rename routes unnecessarily
* Change APIs unnecessarily
* Remove working components
* Change database structures without necessity
* Break authentication
* Break forms
* Break payments
* Break dashboards
* Remove existing content
* Change business logic unnecessarily

If an SEO improvement requires a potentially breaking change:

1. Identify the issue.
2. Explain the impact.
3. Prefer a backward-compatible solution.
4. Only make a breaking change when explicitly authorized.

---

# 5. SEO AUDIT CATEGORIES

Perform the audit using these categories.

## A. Technical SEO

Check:

* robots.txt
* XML sitemap
* sitemap index if required
* canonical URLs
* HTTP/HTTPS consistency
* www/non-www consistency
* trailing slash consistency
* redirect chains
* 301 redirects
* 404 pages
* soft 404s
* crawlability
* indexability
* noindex directives
* pagination
* URL parameters
* duplicate URLs
* internal links
* orphan pages
* broken links
* status codes
* hreflang when applicable
* favicon
* manifest
* mobile rendering
* JavaScript-rendered content
* server-side rendering/static generation where applicable

---

# 6. PAGE METADATA

Every indexable public page must have appropriate metadata.

At minimum:

* Title
* Meta description
* Canonical URL
* Open Graph title
* Open Graph description
* Open Graph image
* Open Graph URL
* Twitter/X card metadata where appropriate

Do not blindly duplicate metadata across pages.

Each important page should have unique metadata based on its actual purpose.

## Title Rules

Titles should:

* Clearly describe the page.
* Contain the primary topic naturally.
* Be useful to humans.
* Avoid keyword stuffing.
* Avoid unnecessary repetition.
* Be unique where possible.

Use the structure appropriate for the page rather than blindly following one template.

Example:

`Fleet Management Software for Transport Businesses | Brand`

NOT:

`Fleet Management Fleet Software Fleet Management Best Fleet Management`

---

# 7. META DESCRIPTION

Meta descriptions should:

* Describe the actual page.
* Be compelling but factual.
* Naturally include important search terms.
* Avoid keyword stuffing.
* Be unique for important pages.
* Encourage qualified clicks.

Do not generate generic descriptions such as:

`Welcome to our website. We provide the best services.`

---

# 8. HEADINGS

Every important public page should have a logical heading hierarchy.

Use:

```html
<h1>
<h2>
<h3>
<h4>
```

Rules:

* Prefer one clear primary H1.
* H1 must describe the primary topic.
* Do not use headings only for visual styling.
* Do not skip heading levels without a structural reason.
* Do not stuff keywords into headings.
* Headings must describe the content that follows.

---

# 9. SEMANTIC HTML

Prefer semantic HTML wherever appropriate.

Use:

```html
<header>
<nav>
<main>
<section>
<article>
<aside>
<footer>
```

Use semantic elements instead of unnecessary generic `<div>` elements when appropriate.

SEO and accessibility should work together.

---

# 10. URL STRUCTURE

URLs should be:

* Short
* Descriptive
* Stable
* Human-readable
* Lowercase
* Hyphen-separated
* Free from unnecessary parameters

Prefer:

```text
/services/fleet-management
/blog/fleet-management-guide
/pricing
/about
/contact
```

Avoid:

```text
/page?id=123
/services/service1?id=23
/ABC_Page
/page/123456789
```

Do not change an existing indexed URL without considering redirects and canonicalization.

---

# 11. CANONICAL URLS

Every indexable public page should have a correct canonical URL.

Canonical URLs must:

* Point to the preferred version of the page.
* Use the correct protocol.
* Use the correct domain.
* Avoid accidental self-inconsistency.
* Avoid canonicalizing unrelated pages to the homepage.

Do not use canonical tags to hide poor site architecture.

---

# 12. ROBOTS.TXT

Maintain a valid robots.txt.

Never accidentally block:

* Public pages
* CSS required for rendering
* JavaScript required for rendering
* Important images
* Important assets

Private/internal areas may require blocking.

Examples may include:

```text
/admin
/dashboard
/account
/login
/register
```

However, do not assume that robots.txt is the correct security mechanism.

Authentication and authorization must provide actual security.

---

# 13. XML SITEMAP

Maintain a valid XML sitemap.

Include important:

* Public pages
* Service pages
* Product pages
* Blog posts
* Categories
* Other indexable resources

Exclude:

* Admin pages
* Private dashboards
* Authentication-only pages
* Duplicate URLs
* Noindex pages
* Utility pages that should not appear in search

If content is database-driven, sitemap generation should preferably be dynamic or automatically updated.

---

# 14. INTERNAL LINKING

Create a logical internal linking structure.

Important pages should not become orphaned.

Use contextual links between related pages.

Example:

Service page → related service

Service page → relevant blog

Blog → relevant service

Blog → related blog

Category → articles

Do not create artificial keyword-heavy internal links.

Use natural anchor text.

---

# 15. IMAGES

Every meaningful image should have appropriate:

* `alt`
* width
* height
* responsive sizing
* optimized file format
* lazy loading where appropriate

Example:

```html
<img
    src="/images/fleet-management-dashboard.webp"
    alt="Fleet management dashboard showing vehicle tracking and trip information"
    width="1200"
    height="800"
    loading="lazy"
/>
```

Do not use:

```html
alt="image"
alt="photo"
alt="banner"
```

Decorative images may use:

```html
alt=""
```

Do not stuff keywords into alt text.

---

# 16. IMAGE PERFORMANCE

Prefer modern formats when supported:

* WebP
* AVIF

Optimize:

* File size
* Dimensions
* Compression
* Responsive loading
* Lazy loading

Do not lazy-load critical above-the-fold images unnecessarily.

Use appropriate priority for the LCP image.

---

# 17. CORE WEB VITALS

SEO work must consider:

* LCP
* INP
* CLS

Also inspect:

* TTFB
* JavaScript execution
* CSS blocking
* image loading
* font loading
* unnecessary third-party scripts
* excessive DOM size
* hydration cost where applicable

Do not optimize blindly.

Identify actual bottlenecks first.

---

# 18. PERFORMANCE RULES

Avoid unnecessary:

* JavaScript
* API calls
* client-side rendering
* large libraries
* duplicate dependencies
* blocking resources
* oversized images
* unnecessary animations

Where the framework supports it, prefer:

* Server rendering
* Static generation
* Incremental/static regeneration
* Streaming where appropriate
* Image optimization
* Code splitting
* Lazy loading

Use the rendering strategy appropriate for the page.

---

# 19. STRUCTURED DATA

Use Schema.org structured data where it genuinely represents the content.

Possible schemas include:

* Organization
* WebSite
* WebPage
* BreadcrumbList
* Article
* BlogPosting
* Product
* Service
* LocalBusiness
* FAQPage
* Event
* Review
* Person

Do NOT add structured data simply because it is available.

Structured data must accurately represent visible page content.

Never fabricate:

* Reviews
* Ratings
* Prices
* Organizations
* Locations
* FAQs
* Events
* Authors

---

# 20. ORGANIZATION SCHEMA

Where appropriate, maintain organization information such as:

* Name
* URL
* Logo
* Description
* Social profiles
* Contact information

Keep structured data consistent with the actual website.

---

# 21. WEBSITE SEARCH SCHEMA

If the website has a genuine internal search system, evaluate whether `WebSite` structured data with a search action is appropriate.

Do not implement it if the website does not actually support the described search behavior.

---

# 22. BREADCRUMBS

For hierarchical websites, implement breadcrumbs where useful.

Example:

```text
Home
→ Services
→ Fleet Management
```

Use:

```text
BreadcrumbList
```

structured data when appropriate.

---

# 23. BLOG SEO

For every blog post, check:

* Unique title
* Meta description
* Canonical URL
* H1
* Author
* Publication date
* Updated date when applicable
* Featured image
* Alt text
* Article schema
* Internal links
* Related content
* Table of contents when useful
* Readability
* Search intent
* Content depth
* Duplicate content

Do not generate articles solely to target keywords.

Content must provide genuine value.

---

# 24. CONTENT SEO

Content should satisfy search intent.

Before creating or modifying content, determine:

1. What does the user want?
2. What question is the page answering?
3. What action should the visitor take?
4. What information is genuinely useful?
5. What related questions should be answered?

Avoid:

* Keyword stuffing
* AI-generated filler
* Repetitive paragraphs
* Fake statistics
* Unsupported claims
* Unnecessary text
* Duplicate pages targeting the same intent

---

# 25. KEYWORD STRATEGY

Keywords should be used naturally.

For important pages identify:

* Primary topic
* Secondary topics
* Related terms
* Search intent
* Relevant entities
* Supporting questions

Do not force exact-match keywords into every heading.

SEO should optimize for meaning and usefulness rather than keyword repetition.

---

# 26. E-E-A-T CONSIDERATIONS

Where relevant, improve:

* Author information
* Organization information
* Contact information
* About page
* Experience
* Credentials
* Sources
* References
* Trust signals
* Policies

Never fabricate credentials, experience, reviews, awards, or claims.

---

# 27. LOCAL SEO

If the project serves specific locations, evaluate:

* Location pages
* Business information
* Address
* Phone
* Opening hours
* LocalBusiness schema
* Google Business Profile consistency
* Location-specific content
* Local internal linking

Do not create mass-generated low-quality location pages.

---

# 28. MOBILE SEO

Every public page must be responsive.

Check:

* Mobile viewport
* Text size
* Navigation
* Buttons
* Forms
* Tables
* Images
* Horizontal overflow
* Touch targets
* Page performance

SEO testing must consider mobile rendering.

---

# 29. ACCESSIBILITY

Improve accessibility because it also improves usability and content understanding.

Check:

* Image alt text
* Labels
* Heading structure
* Keyboard navigation
* Form labels
* Button names
* Contrast
* Focus states
* ARIA only where necessary

Do not use accessibility attributes incorrectly just for SEO.

---

# 30. DYNAMIC / DATABASE-DRIVEN SEO

For dynamic pages, SEO metadata should be generated from actual data.

For example:

```text
/products/{slug}
```

must be able to generate:

* title
* description
* canonical
* OG image
* structured data

from the relevant database record.

Never use the same metadata for every dynamic page.

---

# 31. API-DRIVEN CONTENT

If page content comes from an API:

* Ensure important SEO content is available to crawlers.
* Avoid rendering critical content only after client-side JavaScript when unnecessary.
* Handle API failures gracefully.
* Generate appropriate metadata.
* Handle missing records with proper 404 responses.

---

# 32. 404 AND ERROR PAGES

Implement useful:

* 404 page
* 500 page
* Error states

A missing resource should return an appropriate HTTP status.

Do not return HTTP 200 for genuinely missing pages.

---

# 33. REDIRECTS

When URLs change:

1. Identify whether the old URL may already be indexed.
2. Create a relevant 301 redirect where appropriate.
3. Update internal links.
4. Update sitemap entries.
5. Update canonical URLs.
6. Check for redirect chains.

Avoid redirecting unrelated pages to the homepage.

---

# 34. DUPLICATE CONTENT

Identify duplicate or near-duplicate pages.

Possible solutions:

* Canonicalization
* Redirects
* Consolidation
* Better URL architecture
* Noindex where appropriate

Do not blindly add `noindex` to solve structural problems.

---

# 35. PAGINATION

For paginated content:

* Ensure pages are crawlable when useful.
* Maintain logical internal links.
* Avoid duplicate metadata.
* Ensure important content can be discovered.
* Do not hide the entire content set behind JavaScript unnecessarily.

---

# 36. SEARCH AND FILTER PAGES

Evaluate whether search/filter URLs should be indexed.

Do not allow unlimited combinations of:

```text
?category=
?sort=
?filter=
?price=
?location=
```

to create millions of low-value crawlable URLs.

Use appropriate canonicalization, robots controls, or noindex strategies based on the actual architecture.

---

# 37. AUTHENTICATED PAGES

Private pages generally should not be indexed.

Examples:

```text
/dashboard
/account
/profile
/admin
/settings
```

Do not expose private information through:

* HTML
* metadata
* structured data
* public APIs
* sitemap
* page source

SEO must never compromise security.

---

# 38. SOCIAL SHARING

Important public pages should have appropriate Open Graph information.

Check:

```text
og:title
og:description
og:image
og:url
og:type
```

For articles:

```text
article:published_time
article:modified_time
article:author
```

where appropriate.

---

# 39. FAVICON AND WEB APP METADATA

Check:

* favicon
* Apple touch icon where applicable
* manifest
* theme color
* application metadata

Ensure metadata is valid and consistent.

---

# 40. SEO FOR NEW FEATURES

Whenever a new feature is requested, follow this process.

### Step 1 — Understand the feature

Determine:

* Is it public?
* Is it indexable?
* Does it create new URLs?
* Does it create dynamic pages?
* Does it create new content?
* Does it require structured data?
* Does it affect internal linking?

### Step 2 — Implement the feature

Build the requested functionality without breaking existing functionality.

### Step 3 — Apply SEO

Add:

* Metadata
* Canonical
* Semantic HTML
* Heading structure
* Internal links
* Image optimization
* Structured data where appropriate
* Sitemap inclusion where appropriate

### Step 4 — Validate

Check:

* Crawlability
* Indexability
* URL
* Metadata
* Mobile
* Performance
* Accessibility
* Structured data
* Internal links

### Step 5 — Report

Tell me:

```text
SEO IMPACT
-----------
New SEO elements:
Changed metadata:
New URLs:
Changed URLs:
Structured data:
Sitemap changes:
Robots changes:
Performance impact:
Potential SEO risks:
```

---

# 41. SEO BEFORE CODE CHANGES

Before implementing SEO-related code:

1. Inspect existing implementation.
2. Find the correct architecture.
3. Reuse existing SEO utilities/components.
4. Avoid creating duplicate SEO systems.
5. Follow existing project conventions.
6. Make the smallest appropriate change.

Do not create multiple competing metadata systems.

---

# 42. SEO COMPONENT / UTILITY ARCHITECTURE

If the project does not already have an SEO architecture, create a reusable system appropriate for the framework.

For example:

```text
SEO Configuration
        ↓
Global SEO Defaults
        ↓
Page SEO
        ↓
Dynamic SEO
        ↓
Structured Data
        ↓
Sitemap
        ↓
Robots
```

Centralize reusable configuration.

Do not duplicate metadata logic across dozens of pages.

---

# 43. GLOBAL SEO CONFIGURATION

Maintain centralized defaults for:

* Site name
* Site URL
* Default title
* Default description
* Default OG image
* Logo
* Social profiles
* Locale
* Organization information

Page-level metadata should override defaults when necessary.

---

# 44. SEO VALIDATION CHECKLIST

Before declaring a public page complete:

### Technical

* [ ] Correct HTTP status
* [ ] Crawlable
* [ ] Indexable when intended
* [ ] Canonical present
* [ ] Correct URL
* [ ] Sitemap inclusion where appropriate
* [ ] Robots rules correct

### Content

* [ ] Unique title
* [ ] Useful meta description
* [ ] One clear H1
* [ ] Logical H2/H3 structure
* [ ] Search intent satisfied
* [ ] No keyword stuffing
* [ ] No duplicate filler

### Images

* [ ] Alt text
* [ ] Correct dimensions
* [ ] Optimized format
* [ ] Lazy loading where appropriate
* [ ] LCP image optimized

### Structured Data

* [ ] Appropriate schema
* [ ] Valid JSON-LD
* [ ] Matches visible content
* [ ] No fabricated information

### Performance

* [ ] No unnecessary JS
* [ ] No unnecessary API calls
* [ ] Optimized images
* [ ] No obvious layout shifts
* [ ] Reasonable loading performance

### Mobile

* [ ] Responsive
* [ ] No horizontal overflow
* [ ] Readable text
* [ ] Usable navigation
* [ ] Usable forms/buttons

### Internal Linking

* [ ] Page is discoverable
* [ ] Relevant internal links exist
* [ ] No broken internal links
* [ ] No orphan page

---

# 45. SEO AUDIT REPORT

After the initial full-project audit, produce a report containing:

## Executive Summary

Overall technical condition of the SEO implementation.

## Critical Issues

Issues that could significantly affect crawling, indexing, or important pages.

## High Priority

Issues that should be fixed soon.

## Medium Priority

Improvements with meaningful SEO benefits.

## Low Priority

Minor improvements and refinements.

## Technical SEO

List findings.

## On-Page SEO

List findings.

## Performance

List findings.

## Structured Data

List findings.

## Content

List findings.

## Internal Linking

List findings.

## Mobile

List findings.

## Recommended Architecture

Describe the SEO architecture that should be maintained going forward.

---

# 46. SEO CHANGE LOG

When making substantial SEO changes, maintain a concise record:

```text
DATE:
CHANGE:
REASON:
PAGES AFFECTED:
SEO IMPACT:
RISKS:
VALIDATION:
```

Do not create unnecessary documentation for tiny changes.

---

# 47. SEARCH ENGINE GUIDELINES

Follow current search-engine best practices.

Do not attempt to manipulate rankings through:

* Keyword stuffing
* Hidden text
* Cloaking
* Doorway pages
* Fake reviews
* Fake structured data
* Automatically generated spam
* Link schemes
* Misleading redirects
* Duplicate low-value pages

SEO must focus on helping users and making the site understandable to search engines.

---

# 48. SEO + DEVELOPMENT RULE

Whenever I ask:

> "Add a new page"

You must automatically consider SEO.

Whenever I ask:

> "Add a feature"

You must automatically consider SEO.

Whenever I ask:

> "Change this page"

You must automatically check whether SEO is affected.

Whenever I ask:

> "Create content"

You must automatically consider:

* Search intent
* Metadata
* Heading structure
* Internal links
* Semantic structure
* Content quality

Do not wait for me to explicitly say "SEO".

---

# 49. DO NOT OVER-OPTIMIZE

SEO must never make the website worse.

Do not:

* Stuff keywords
* Add unnecessary paragraphs
* Add excessive headings
* Add meaningless schema
* Add unnecessary links
* Create artificial content
* Reduce UX for SEO
* Add excessive JavaScript
* Make pages slower
* Make content unnatural

User experience comes first while ensuring strong technical SEO.

---

# 50. FINAL RULE

Before completing ANY development task, ask internally:

> "Could this change affect search visibility, crawling, indexing, metadata, structured data, URLs, internal linking, performance, accessibility, or search intent?"

If yes:

1. Analyze the impact.
2. Implement the required SEO changes.
3. Validate them.
4. Mention the SEO impact in the final response.

SEO is a continuous engineering responsibility, not a separate final phase.

---

# 51. IMPORTANT — GIT RULE

Do NOT:

* git commit
* git push
* git pull
* git merge
* git rebase
* create branches
* modify Git configuration

unless explicitly instructed by the user.

SEO work must never automatically trigger Git operations.

---

# 52. IMPORTANT — EXISTING PROJECT RULE

Before changing anything:

* Inspect the existing implementation.
* Preserve existing architecture where practical.
* Reuse existing utilities.
* Avoid unnecessary dependencies.
* Avoid unnecessary rewrites.
* Avoid duplicate systems.
* Preserve existing functionality.

Make targeted, production-quality changes.

---

# 53. FINAL RESPONSE FORMAT

After completing SEO work, provide a concise summary:

```text
SEO WORK COMPLETED

Audit:
[summary]

Fixed:
- ...
- ...
- ...

Added:
- ...
- ...
- ...

Performance:
- ...

Technical SEO:
- ...

Structured Data:
- ...

Sitemap / Robots:
- ...

Future SEO Protection:
- ...

Remaining Recommendations:
- ...
```

Do not claim an SEO improvement is complete unless you actually inspected and implemented it.

Do not claim search-engine indexing, rankings, traffic growth, or Google Search Console results unless verified through the appropriate source.
