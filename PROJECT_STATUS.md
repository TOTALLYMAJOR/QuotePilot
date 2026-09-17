# Project Status

Last updated: 2026-09-16 04:06:58 CDT

## Current evidence boundary

QuotePilot currently has a coordinated public frontend, Firebase backend, and
founder-pilot tenant configuration, but they retain separate deployment and
evidence receipts and must not be described as one artifact.

| Surface | Current recorded evidence | Boundary |
|---|---|---|
| Public Vercel edge | `v0.19.0`, exact SHA `bf9f48a00547e305fdf155c8d64bf3646198b705`, exact-main CI `34787753902` attempt 2, production workflow `34791516818`, immutable deployment `quoteflow-bgq2wztfk-mbmapps.vercel.app` | The protected workflow promoted the `all-qualified-features` browser build and verified `https://quotepilot.mbmapps.com`. A subsequent public request returned HTTP 200 and the deployed Inquiry chunk contained the reviewed site key, action, and customer-safe route copy. Authenticated role journeys and human acceptance remain open. |
| Firebase Functions | `v0.19.0`, exact SHA `bf9f48a00547e305fdf155c8d64bf3646198b705`, exact-main CI `34787753902` attempt 2, production workflow `34790618395` | Provider readback found 142 active Functions in `us-central1`. Inquiry callables, the hourly purge function, and `parseIntentDraft` are active; runtime readback pins the coordinated authorities and OpenAI `gpt-5-mini` to `mm05366-sandbox`, with Buyer Access, SMS, Revenue Autopilot sends, test bypasses, and hard App Check enforcement off. |
| Firebase Hosting fallback | `v0.19.0`, exact SHA and workflow shared with the Firebase Functions receipt above | `https://tonicatering.web.app` returned HTTP 200 and served the same reviewed Inquiry chunk. It remains the origin/fallback rather than the canonical Vercel public edge. |
| Production tenant authority | Protected workflow `34551712371` on main merge `2f4246846496f066e909d16fb46886cd0cc193fc` verified the exact current Firebase backend and Vercel browser receipts, then read back both `commercialChangeAuthorityEnabled` and `eventOperatingSpineEnabled` as `true` for `mm05366-sandbox` | Both fields were already true at the verified operation, so the run rebound the activation to current split-surface evidence without changing tenant data. It did not execute a commercial amendment, event command, provider send, payment, or automatic transition. |
| Authenticated production browser acceptance | On 2026-09-16 an authenticated administrator in `mm05366-sandbox` rendered Living Opportunity, Quote administration, Operations, Inventory, Library pricing, and privacy-bounded Session Diagnostics through `https://quotepilot.mbmapps.com`. Inventory reported server-confirmed location and ingredient projections; Library reported catalog revision 62 as confirmed while retaining a ten-change unpublished draft and 15 cost entries needing attention. Diagnostics reported zero errors and zero warnings. Desktop and 390-by-844 browser checks produced no page-level horizontal overflow or console errors. | This is a partial read-only acceptance receipt. The active identity appears to have platform-admin cross-organization bypass, so it cannot prove ordinary admin/sales tenant denial; no separate non-admin identity was exercised. No browser App Check header or token exchange was observed. Public headers and asset hashes did not identify an exact source SHA or immutable deployment. No Inventory recovery control appeared, and no Commercial Change authorization, Event command, provider action, or production write was issued. The phone-width Inventory table still compresses or clips multi-column evidence labels and needs a responsive presentation repair. |
| Isolated staging Event/Commercial profile | Exact SHA `2f5d123d9ba06153823def6f44b3f5ff89183023`, CI `34420973414`, Firebase Hosting version `31a0bcbf39d65ec2`, profile `staging-event-operating-spine` | The original deployment and recovery readback proved both runtime gates true, but a later Functions deployment replaced that runtime. Current readback at `2026-09-11T05:31Z` found Commercial Change false; the tenant fields remain true. Staging must be redeployed and read back before it is described as active. |
| Repository `origin/main` | Protected PR `#145` merged as exact tagged SHA `bf9f48a00547e305fdf155c8d64bf3646198b705` (`v0.19.0`) after all nine exact-head checks passed; exact-main CI run `34787753902` attempt 2 also passed all nine jobs | Repository, CI, deployment, hosted/provider behavior, production data, and human acceptance remain separate evidence classes. |
| Guided Inquiry and Model Assist | The dedicated managed Inquiry Turnstile widget is restricted to the two approved production hosts, its public site key is compiled on both browser targets, and its secret is bound only through Secret Manager. A fresh OpenAI Responses probe using the rotated production key returned HTTP 200; `parseIntentDraft` is active with secret version 2 and the exact tenant/model runtime fence. | This proves provider-key health and deployed configuration, not a model-authored customer or quote result. No Inquiry Showcase slug was automatically published, and no real Turnstile token, inquiry submission, staff conversion, notification, accessibility, or human-acceptance receipt exists yet. |
| Coordinated all-qualified production profile | Firebase workflow `34790618395` and Vercel workflow `34791516818` deployed the exact `v0.19.0` SHA for `mm05366-sandbox`, using separate rollback ancestors `b90fb5d539077c27e640ca58ee1438632d665cf9` and `3fb1443bb6e394133340ede3716548c92b24beea`. | The profile is active on both providers. Deployment did not publish a Showcase, execute an inquiry, invoke a model for a user, send a notification, mutate a quote/event, charge a payment, or establish human acceptance. |

The first production Inventory request exposed an App Check rollout mismatch:
the browser had no reviewed provider registration while the callable enforced a
token. `v0.18.1` changed the three Inventory callables to App Check monitoring
while retaining verified identity, role, exact-tenant, runtime, tenant-setting,
revision, receipt, and server-write controls. The denied request wrote nothing.
The 2026-09-16 authenticated browser read subsequently reached a current,
server-confirmed Inventory projection, but no recovery control was displayed,
so no retry or write was attempted. The observed authenticated Functions reads
still carried no App Check header. A receipt-backed Inventory command through
an eligible displayed workflow and human acceptance remain open.

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
- Production operating-fixture readback before the later recipe-cost seed:
  catalog revision 61; 14 total packages, 15 total add-ons, eight total
  rentals, 25 staff profiles and records, 32 customers, 16 quotes, eight
  Staffing plans, four workflow definitions, six workflow instances, and six
  event-operating ledgers.
- Production recipe-cost seed readback on 2026-09-15: catalog revision 62,
  current pricing confirmation, and 200 menu rows with recorded cost. The
  post-apply dry run found zero remaining eligible recipe-backed fixture rows;
  336 rows still lack complete qualifying recipe-cost projections and two
  unclassified rows remain protected and unmodified. These recorded costs are
  synthetic founder-pilot projections, not observed operating costs.
- Both targets read back current catalog-pricing confirmation and enabled
  Inventory and operational Staffing tenant settings. Commercial Change and
  Event Spine tenant settings are now also enabled for the exact founder-pilot
  tenant in both targets. A post-apply dry run in each target reported zero
  event quotes left to create.
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
- The coordinated production profile exposes **Library → Inquiry page** Showcase,
  public `/inquire/:slug` request, and callable-owned Opportunities inquiry
  queue. The Showcase is a presentation/reference layer over the existing
  catalog, not a second commercial catalog. Conversion reuses the existing
  server-pricing and atomic quote/customer/portal/version path.
- `/app/staff` owns people profiles; exact event Staffing plans and assignments
  remain their separate authority. Customer 360 remains `/app/customers/:id`.

The CWF-16 `EventWorkspaceView` remains deployed implementation provenance and
compatibility coverage. In the current Ambient-enabled source profile it is not
the ordinary exact-quote composition. Its proposal-readiness treatment must not
be promoted into event readiness, attendance, payment, Inventory, Staffing, or
BEO currentness.

## Open proof and operational risk

- The 2026-09-16 authenticated production administrator read journey is only
  partial. Ordinary admin/sales role denial, cross-tenant denial, exact source
  SHA/deployment binding, production command receipts, assistive-technology
  acceptance, and founder acceptance remain open.
- At 390-by-844, the Inventory evidence table avoids page-level overflow but
  compresses or clips multi-column labels instead of presenting a legible
  mobile record layout. Treat phone-width Inventory review as a UX backlog item.
- App Check hard enforcement remains blocked until reviewed browser provider
  registration and hosted token evidence exist.
- Commercial Change and Event Spine runtime and tenant gates are enabled only
  for exact tenant `mm05366-sandbox`. Provider readback proves configuration,
  not a successful amendment or Event command; those authenticated journeys
  and resulting receipts remain open.
- The isolated staging candidate's original receipt remains `partial` because
  the deploy process failed during its post-deploy Functions listing. Exact
  Hosting and Functions provider state was recovered through independent
  readback before the tenant transaction, but the original artifact was not
  rewritten as a completed receipt.
- Provider delivery, recipient behavior, payment settlement, usage, revenue,
  retention, and business outcomes remain separate and unverified where no
  corresponding receipt exists.
- Guided Inquiry is deployed and its global/runtime gates, dedicated Turnstile
  configuration, secret bindings, public route chunk, and hourly purge schedule
  are present. No unique production slug, fresh browser challenge, wrong-host
  or replay rejection, customer submission, notification-provider outcome,
  actual 90-day deletion, authenticated hosted conversion, accessibility scan,
  assistive-technology review, customer/staff human acceptance, or commercial
  outcome is recorded. An administrator must still curate and publish an
  immutable customer-safe Showcase version.

## Next proof event

First complete an authenticated `mm05366-sandbox` administrator journey
across Living Opportunity, Quote administration, Operations, Inventory,
Library pricing review, one governed Commercial Change simulation/authorization
path, one explicit Event Spine command, and exact readback. The receipt must
identify the source SHA and deployment, exercise role and cross-tenant denial,
show the Inventory App Check outcome, and keep provider, human, usage, and
commercial evidence separate. Then curate and preview one customer-safe Inquiry
Showcase, publish its immutable slug, and run a bounded customer/staff journey
that proves a fresh Turnstile token, wrong-host/action and replay rejection,
durable receipt/recovery, notification isolation, catalog/identity drift review,
and atomic conversion. No further fixture population or tenant-setting mutation
is authorized by this document.

Historical release narrative belongs in [`CHANGELOG.md`](CHANGELOG.md). Open
work belongs in [`DEV_TASKS.md`](DEV_TASKS.md), and complete source capability
inventory belongs in [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md).
