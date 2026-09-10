# Project Status

Last updated: 2026-09-10 12:09:03 CDT

## Current evidence boundary

QuotePilot currently has a split release surface. The public browser, Firebase
backend, live tenant configuration, and this local branch are not the same
artifact and must not be described as one release.

| Surface | Current recorded evidence | Boundary |
|---|---|---|
| Public Vercel edge | `v0.16.6`, exact SHA `a350b72a1c6968be80c7c07ef9079084ceba0b07`, CI `33889897821`, deployment `33890996339` | Public reachability is recorded; current authenticated role journeys and human acceptance are open. |
| Firebase Functions | `v0.18.1`, exact SHA `8bada8d16300a9f897df5f7a640e07b4830ab7ce`, CI `34430375712`, production deployment `34431964494` | Provider readback found 128 active Functions on the `ragnakok-operations` profile. This does not prove browser reachability or operator success. |
| Firebase Hosting fallback | `v0.16.3` static release | It is an origin/fallback, not the current public edge or backend version. |
| Repository `origin/main` | `961e688b` documentation receipt for the v0.18.1 deployment | Repository state is not runtime state. |
| Current local branch | `feat/realistic-inventory-population` at `8c029f1b`, two commits ahead of `origin/main` before this documentation reconciliation | `ec2a7c83` adds the applied realistic Inventory population operation; `8c029f1b` adds a source-qualified operating-twin population operation. Neither local commit is a public frontend release. |

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
  132 stock states, 132 cost states, and 200 recipe/menu-cost projections at
  catalog revision 23.
- Production: 538 menu items, six total locations, 132 ingredients, 132 stock
  states, 132 cost states, and 200 recipe/menu-cost projections at catalog
  revision 60. The pre-existing Chicken identity and location were preserved.
- Both catalogs intentionally have pricing confirmation cleared after catalog
  import. A human Catalog pricing review is required before authoritative quote
  saves may rely on the new revision.

These are synthetic planning records. They are not physical counts, receiving,
supplier acknowledgement, purchase orders, allocation, consumption, customer
acceptance, provider delivery, or human acceptance.

The follow-on `ragnakok-operations-v1` fixture is source-complete and focused-
test qualified at local SHA `8c029f1b`. It plans eight Offers, eight add-ons,
five rentals, eight Event Templates, four Configuration Rules, 20 generated
staff profiles, ten event quotes, eight Staffing plans, four workflow
definitions, and six event/workflow ledgers. Hosted asset publication and exact
staging/production apply/readback have not occurred.

That population operation is a privileged exact-tenant fixture migration, not
an ordinary operator workflow. It can enable already-deployed Inventory and
Staffing tenant settings and reconfirm the exact advanced catalog revision.
Before any hosted apply, an authorized reviewer must confirm that those setting
and pricing transitions are intended, then preserve dry-run, apply, and
provider-readback evidence. The operation cannot create physical Inventory,
employee qualification, supplier action, customer consent, or provider truth.

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

- The public browser does not yet expose the v0.18 frontend/source cohort.
- Authenticated hosted role journeys, Inventory operator retry, responsive and
  assistive-technology acceptance, and founder acceptance are not recorded.
- App Check hard enforcement remains blocked until reviewed browser provider
  registration and hosted token evidence exist.
- Commercial Change and Event Spine mutation gates remain independent and are
  not activated by the Inventory population receipt.
- Provider delivery, recipient behavior, payment settlement, usage, revenue,
  retention, and business outcomes remain separate and unverified where no
  corresponding receipt exists.

## Next proof event

Qualify and promote one exact frontend candidate that matches the deployed
v0.18.1 backend, then complete an authenticated `mm05366-sandbox` administrator
journey across Living Opportunity, Quote administration, Operations, Inventory,
Library pricing review, and exact readback. The receipt must identify the source
SHA and deployment, exercise role and cross-tenant denial, show the Inventory
App Check outcome, and keep provider, human, usage, and commercial evidence
separate. No fixture population or tenant-setting mutation is authorized by
this document.

Historical release narrative belongs in [`CHANGELOG.md`](CHANGELOG.md). Open
work belongs in [`DEV_TASKS.md`](DEV_TASKS.md), and complete source capability
inventory belongs in [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md).
