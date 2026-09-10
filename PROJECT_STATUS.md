# Project Status

Last updated: 2026-09-10 17:15:07 CDT

## Current evidence boundary

QuotePilot currently has a coordinated public frontend, Firebase backend, and
founder-pilot tenant configuration, but they retain separate deployment and
evidence receipts and must not be described as one artifact.

| Surface | Current recorded evidence | Boundary |
|---|---|---|
| Public Vercel edge | `v0.18.2`, exact SHA `3fb1443bb6e394133340ede3716548c92b24beea`, exact-main CI `34530609347`, production workflow `34532297958`, immutable deployment `quoteflow-c8t2j8jk0-mbmapps.vercel.app` | The protected workflow verified `https://quotepilot.mbmapps.com`, and an independent staff-portrait request returned HTTP 200 `image/png`. Authenticated role journeys and human acceptance remain open. |
| Firebase Functions | `v0.18.1`, exact SHA `8bada8d16300a9f897df5f7a640e07b4830ab7ce`, CI `34430375712`, production deployment `34431964494` | Provider readback found 128 active Functions on the `ragnakok-operations` profile. This does not prove browser reachability or operator success. |
| Firebase Hosting fallback | `v0.16.3` static release | It is an origin/fallback, not the current public edge or backend version. |
| Repository `origin/main` | Contains the v0.18.2 release source plus protected PR `#137` customer-claim provenance and PR `#138` receipt-safe staff-retry corrections | Repository state is not runtime state; the two post-release corrections affect the privileged population script, not the deployed browser runtime. |

The first production Inventory request exposed an App Check rollout mismatch:
the browser had no reviewed provider registration while the callable enforced a
token. `v0.18.1` changed the three Inventory callables to App Check monitoring
while retaining verified identity, role, exact-tenant, runtime, tenant-setting,
revision, receipt, and server-write controls. The denied request wrote nothing.
A successful hosted operator retry and human acceptance remain open.

## Founder-pilot data state

The `ragnakok-realistic-v1` population operation was applied and provider-read
back for `mm05366-sandbox` in both live targets.

- Isolated staging: 525 menu items, five kitchen locations, 132 ingredients,
  132 stock states, 132 cost states, and 200 recipe/menu-cost projections.
- Production: 538 menu items, six total locations, 132 ingredients, 132 stock
  states, 132 cost states, and 200 recipe/menu-cost projections. The
  pre-existing Chicken identity and location were preserved.

These are synthetic planning records. They are not physical counts, receiving,
supplier acknowledgement, purchase orders, allocation, consumption, customer
acceptance, provider delivery, or human acceptance.

The follow-on `ragnakok-operations-v1` fixture was applied and read back in both
targets after protected PR `#137` corrected trusted customer-claim provenance
and PR `#138` made complete receipt-backed fixture staff pairs replay-safe.

- Isolated staging readback: catalog revision 27; 14 total packages, 16 total
  add-ons, eight total rentals, 20 staff profiles and records, 13 customers and
  quotes, eight Staffing plans, four workflow definitions, six workflow
  instances, and six event-operating ledgers.
- Production readback: catalog revision 61; 14 total packages, 15 total
  add-ons, eight total rentals, 25 staff profiles and records, 32 customers,
  16 quotes, eight Staffing plans, four workflow definitions, six workflow
  instances, and six event-operating ledgers.
- Both targets read back current catalog-pricing confirmation and enabled
  Inventory and operational Staffing tenant settings. A post-apply dry run in
  each target reported zero event quotes left to create.
- Twenty generated staff portraits are published under
  `/fixtures/ragnakok-staff/`; the fixture contributes eight Offers, eight
  add-ons, five rentals, eight Event Templates, four Configuration Rules, 20
  staff profiles, ten event quotes, eight Staffing plans, four workflow
  definitions, and six event/workflow ledgers. Higher total collection counts
  include preserved pre-existing non-fixture records.

That population operation is a privileged exact-tenant fixture migration, not
an ordinary operator workflow. Its apply/readback receipts prove only the
declared synthetic writes and settings. They do not create physical Inventory,
employee qualification, supplier action, customer consent, provider truth, or
human acceptance.

## Current capability placement

- `/app/quotes/:quoteId` is the Ambient-enabled **Living Opportunity**: exact
  opportunity identity, bounded condition and next action, sold scope,
  commercial lifecycle, and contextual evidence.
- `?view=administration` on the exact quote opens the role-gated Quote
  administration surface for provider, payment, booking, portal, contract, and
  other authoritative quote actions.
- `/app/quotes/:quoteId/edit` owns ordinary draft editing or a governed
  commercial amendment for accepted/booked work. It must preserve current,
  proposed, difference, consequence, authority, receipt, and recovery.
- `/app/operations` owns Calendar-first accepted/booked planning, selected-event
  preflight, staffing and production context, conflicts, and run of show.
- `/app/inventory` owns administrator ingredient stock, recorded purchase cost,
  receipts, allocations, consumption, and projections. Sold rentals remain
  quote scope; they are not ingredient Inventory.
- Library owns Offers, components, Event Templates, Configuration Rules,
  versioned recipes, and menu-cost projections. It does not own physical stock
  or quote lifecycle.
- `/app/staff` owns people profiles; exact event Staffing plans and assignments
  remain their separate authority. Customer 360 remains `/app/customers/:id`.

The CWF-16 `EventWorkspaceView` remains deployed implementation provenance and
compatibility coverage. In the current Ambient-enabled source profile it is not
the ordinary exact-quote composition. Its proposal-readiness treatment must not
be promoted into event readiness, attendance, payment, Inventory, Staffing, or
BEO currentness.

## Open proof and operational risk

- Authenticated hosted role journeys, responsive and assistive-technology
  acceptance, and founder acceptance are not recorded for v0.18.2.
- App Check hard enforcement remains blocked until reviewed browser provider
  registration and hosted token evidence exist.
- Commercial Change and Event Spine mutation gates remain independent and off;
  neither the Vercel release nor either fixture population activated them.
- Provider delivery, recipient behavior, payment settlement, usage, revenue,
  retention, and business outcomes remain separate and unverified where no
  corresponding receipt exists.

## Next proof event

Complete an authenticated `mm05366-sandbox` administrator journey on v0.18.2
across Living Opportunity, Quote administration, Operations, Inventory,
Library pricing review, and exact readback. The receipt must identify the source
SHA and deployment, exercise role and cross-tenant denial, show the Inventory
App Check outcome, and keep provider, human, usage, and commercial evidence
separate. No further fixture population or tenant-setting mutation is
authorized by this document.

Historical release narrative belongs in [`CHANGELOG.md`](CHANGELOG.md). Open
work belongs in [`DEV_TASKS.md`](DEV_TASKS.md), and complete source capability
inventory belongs in [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md).
