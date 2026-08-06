# QuotePilot Landing Page

Last updated: July 26, 2026

## Purpose

Create the public QuotePilot landing page for catering owners, sales teams, and event operators. The page should feel specific to hospitality, immediately explain the customer value, and preserve QuotePilot's proof boundaries.

Use the hospitality-first composition of the approved Magic Patterns reference as a design specification:

- Reference: https://project-cosmic-jellyfish-840.magicpatterns.app/
- Brand: QuotePilot by MBMApps
- Primary route: `/`
- Prospect CTA: `https://mbmapps.com/contact`
- Staff CTA: `/app`

Do not copy generated prototype code, product mockups, tracking attributes, or unverified claims.

## Design Direction

Build an editorial B2B SaaS page with:

- warm ivory surfaces, near-black text, and QuotePilot amber accents;
- generous typography and an asymmetric hospitality hero;
- real QuotePilot interface captures in the feature, portal, and operations sections;
- clear separation between prospect education and staff access;
- restrained entrance and section-reveal motion;
- complete reduced-motion, keyboard-focus, mobile, and dark-mode behavior.

Design dials:

- variance: 6 of 10;
- motion: 4 of 10;
- density: 4 of 10.

The page structure is:

1. Responsive header with product navigation, demo CTA, and staff login.
2. Hospitality hero with original catered-event imagery.
3. Three compact product outcomes.
4. Feature bento using real product screenshots.
5. Quote-to-event workflow.
6. Customer proposal and decision section.
7. Event-operations section.
8. Final demo CTA and footer.

## Copy and Product Truth

Lead with the customer problem:

> Build confident catering quotes without the spreadsheet chase.

Explain that QuotePilot guides a team from structured event details and live pricing to a proposal, a recorded customer decision, and an operational handoff.

Keep these facts distinct everywhere:

- proposal acceptance is not payment;
- payment is not booking;
- booking is not production readiness;
- checklist completion does not prove inventory availability;
- configured integrations are not universal provider readiness.

Avoid guaranteed outcome claims, an unverified free-signup offer, and claims that portal delivery or provider integrations are production-operational for every customer.

Use QuotePilot and MBMApps branding only. Do not use QuoteFlow, Tony Catering, or Toni Catering as customer-facing names.

## Real Assets

Use the existing QuotePilot captures:

- `src/assets/marketing/quotepilot/quote-builder.png`
- `src/assets/marketing/quotepilot/scenario-compare.png`
- `src/assets/marketing/quotepilot/customer-decision.png`
- `src/assets/marketing/quotepilot/sales-workflow.png`
- `src/assets/marketing/quotepilot/event-production.png`

The hero image is an original generated asset:

- `src/assets/marketing/quotepilot/catering-event-hero.webp`
- Prompt direction: a photorealistic, professionally catered outdoor dinner at golden hour, showing hospitality preparation and guest service with an ivory, charcoal, green, and amber palette; no text, logos, or watermarks.

## Preserved Landing Page

The previous dark, system-oriented landing page remains part of the product rather than being deleted:

- Route: `/system`
- Component: `src/components/SystemMarketingPage.jsx`
- Styles: `src/marketing.css`
- Supporting captures: `src/assets/marketing/quotepilot/*.png`

The preserved baseline is commit `d961a19be56caf4a03457a59877d34b3d9a113c3`. The `/system` page and the authenticated workspace are lazy-loaded so their heavier product and provider code does not have to initialize on the default customer landing page.

Routing must continue to preserve:

- `/app` for the staff workspace;
- `/?portal=<token>` and `/app?portal=<token>` for customer proposal links;
- portal query precedence over public landing-page rendering.

## Acceptance Criteria

- `/` presents the hospitality-first QuotePilot page.
- `/system` presents the saved dark landing page with its feature drawer intact.
- All CTAs have truthful, real destinations.
- The page contains no legacy catering identity or QuoteFlow brand copy.
- Real interface screenshots are identified as QuotePilot interfaces, not abstract prototype mockups.
- Desktop and mobile layouts do not overflow.
- Keyboard focus is visible, the skip link works, images have dimensions and alternative text, and below-fold images are lazy-loaded.
- Motion becomes effectively immediate when `prefers-reduced-motion: reduce` is active.
- Environment checks, the production build, focused browser tests, governance, and performance guards pass before publication.
