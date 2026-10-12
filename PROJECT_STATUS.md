# Project Status

Last updated: 2026-10-11 23:14:06 CDT

## v0.21.0 integration qualification — local candidate (October 11, 2026)

The isolated release candidate includes exact source `f3ff212a` and the other
authorized recent development lines. Its first combined Ambient build exceeded
the existing aggregate ceiling by 12,896 bytes. Compile-time boundaries now
remove dormant quote-completion, decision-packet, and analytics integration
from the production graph, reducing the candidate by 6,197 bytes. The remaining
4,975,456 / 385,181-byte graph is 9,363 aggregate bytes above `f3ff212a` in the
same local environment and retains active Inventory, opportunity, reporting,
customer, and actuals behavior. The reviewed 4,978,120 / 445,422 temporary
ceilings preserve the previous 2,664-byte aggregate environment margin and add
no percentage or future-growth headroom. Full release-lane, protected exact-PR,
merge, deployment, hosted-role UAT, adoption, and outcome evidence remain open.
The same integration also contains concurrent analytics provider rejection for
every caller while preserving the queued batch for retry; a focused regression
test reproduces the prior overlap and verifies one provider attempt.

## Browser and route-budget qualification — local work (October 11, 2026)

The `release/v0.20.0-open-work` checkout is at committed HEAD
`216431a256d31c585be97be719e1fabbeec68d93` plus the current uncommitted browser
and measurement repairs. Component fixtures now explicitly load workspace CSS;
responsive Inventory tests cover the existing phone cards and wider tables.
Ambient geometry has its own flag profile and dependency cache, while quote
tests wait for the actual onboarding/catalog state rather than an early header.

The route runner is being qualified against an isolated demo Auth/Firestore
tenant, real Inventory-generated projections, and three secret-free read-only
Functions handlers. Invalid or unavailable routes cannot produce proposed
ceilings. The first post-repair Now and Clients visits passed; the failing
Inventory arrival exposed a missing Inventory entry in the catalog/settings
read allow-list. Owner-authorized bounded source inspection established the
readiness cycle; the one-line repair preserves tenant and role gates and passes
45 focused tests. The next calibration exposed a denied 201-record ingredient
query against the existing 200-record read bound. The client now displays 199
records plus one lookahead within that bound, preserving pagination; 140 focused
client/component/runtime tests pass. Rules are unchanged. The harness also
rejects recorded browser errors or unexpected external requests after final UI
assertions (ten focused checks pass, including rejection of profiled diagnostic
samples from budget aggregation). A diagnostic browser run stopped after
50 passes and three failures: mobile stepper clipping and two save-flow tests
sharing a menu-selection race. The three reproduced failures now pass focused
browser verification: the rail recenters after lazy loading, and test helpers
wait for committed step changes. A retained 390 px screenshot confirms the
active step and pricing remain visible.

The next full browser run passed 89 scenarios, skipped 314 profile-gated cases,
and exposed one remaining Workflow → Edit quote focus race. App and LegacyApp
now retain the request until the matching, hydrated, visible editor attaches;
stale requests and scheduled frames are cancelled. The unchanged focused browser
assertion passes (1/1), and independent bounded source review found no blocking
defect. The next two-worker full run passed 88 scenarios and skipped 314; all
four quote repairs passed, but two other tests sampled lazy-loading surfaces
too early. Accessibility now waits for the existing visible task panel before
auditing, and typography waits for the actual Now heading before reading styles.
The original accessibility and typography assertions remain intact. The fresh
full regression run passes: 90 passed, 314 profile-gated skips, zero failures,
two workers, and no retries (11.5 minutes). All six reproduced failures are
covered by that green run.

The fresh five-run calibration passed 20/20 browser scenarios. All 20 samples,
profile/build identity, and independently checked p75-plus-10% ceilings are
retained in `docs/performance/route-performance-calibration.json`; the reviewed
ceilings are adopted in `docs/performance/route-performance-budget.json`.
Independent three-run verification used the identical build hash and passed all
12 browser scenarios, but the budget result is **FAIL**: Now, Clients and every
byte ceiling pass; Inventory core/supplemental medians are 2,994.8/2,994.9 ms
against 2,155/2,155 ms, and quote review is 2,488.5/2,489.3 ms against
2,462/2,464 ms. The failed verification is retained alongside calibration; no
ceiling was raised. Shared-host load was elevated, but that does not establish
the cause or excuse the gate. Route durations exclude document/bootstrap time;
full document-to-core calibration p75 is 5.388–6.650 seconds across the routes.
One diagnostic-only Inventory trace observed 753 ms before its chunk request,
267 ms downloading it, and 814 ms from download completion to usable core.
CPU pressure was present, but no code hotspot or cause of the failed median
was established. Its 1,834 ms route-to-core result is excluded from qualification.
Fresh full units pass (6,255 passed, 100 skipped), as do the compatibility build
and its unchanged bundle ceiling (3,477,038 aggregate JavaScript bytes).
The Ambient build also passes at 4,964,850 bytes against the unchanged
4,968,757-byte ceiling. The standard homepage Lighthouse gate passes locally
(performance 93, LCP 2.012 s, CLS 0.0173, TBT 276.741 ms); 136 truthloop tests
and all ten route-gate tests pass.
Branch-wide documentation governance against `origin/main...HEAD` fails on
14 previously committed documents whose timestamps were not advanced; those
files are unchanged by this repair. Working-tree governance against `HEAD`
passes separately and does not erase that branch-wide failure.
The predeclared final three-run check of the focus-repaired candidate passes
all 12 visits and all route-byte/core/supplemental ceilings without changing
the budget. Core medians are Now 498.2 ms, Clients 662.5 ms, Inventory 1,083.2 ms,
and quote review 1,689 ms. Receipt `XiQcPO` is retained under
`candidateVerifications` alongside the earlier failed `2oWf32` check, not in
place of it. This establishes local timing qualification for that measured
candidate; it does not explain the earlier variance or establish a causal
improvement. The branch-wide documentation gate remains a release blocker.
Previous source checkpoints below are historical, not this run's results.
No release, push, deployment, hosted-role acceptance, physical stock, or product
outcome is established by this work.

## Progressive performance and operability — local candidate (October 10, 2026)

The dirty `release/v0.20.0-open-work` checkout at indexed HEAD
`7b4a3ddf26ff7a51e19e834713d8705e3e52aad4` now defers public film and optional
workspace code, publishes independent route data, bounds/deduplicates reads,
and records route-start, usable-core, and supplemental-complete separately.
The same candidate adds the declared layout/accessibility refinements, exact
commercial-consequence navigation and safe return, bounded Inventory
traceability, and multi-line receiving that keeps one existing request and
receipt identity per line. Ambient and compatibility shells share the same
recoverable loading boundary.

The October 10 Ambient bundle passed at 4,964,683 bytes against the unchanged
4,968,757-byte exception ceiling. Focused browser checks cover selected
390/768/1440 geometry and public media behavior; the Firestore emulator rules
suite passes 96 tests. The route-performance gate is repeatable, but Inventory
and quote review remain uncalibrated because this local production profile has
no authorized Inventory or catalog fixture. UAT v5 now fails closed unless one
exact hosted candidate supplies distinct administrator, sales, customer, and
cross-tenant results, but no such hosted run occurred here. This is local,
uncommitted evidence: no push, deployment, production behavior, human
acceptance, or outcome improvement is claimed.

## Inventory traceability and dependency review — local candidate (October 10, 2026)

The dirty working candidate adds an administrator-only, on-disclosure trace for
one ingredient's verified movement summaries and reconciled exact event
commitments. Movement reads use bounded stable compound cursors and preserve
successful workspace evidence when one trace or later page fails. The Library
recipe editor separately requires a bounded affected-menu review for the exact
draft before publication. Browser and direct population paths pass only the
server-issued digest, and the server rechecks the dependency evidence inside
the write transaction.

This state is source/local only. Focused runtime, client, component, and
population-script tests exercise tenant/revision fences, equal-time pagination,
malformed evidence, local retry/focus, stale responses, commitment totals, and
dependency drift. The disposable demo-project Firebase emulator acceptance also
passes the reviewed recipe publication and later dependent cost update through
real callable and Firestore transactions. The composite movement-history index
exists in `firestore.indexes.json` but has not been deployed or read back.
Authenticated hosted use, assistive-technology and human review, physical
Inventory, production behavior, baseline/outcome evidence, commit, push, and
deployment remain open.

## Safety and loading tranche — local candidate (October 10, 2026)

The working candidate adds recursive diagnostic sanitization, deferred staff
and quote-builder code, demand-loaded Client 360 proposal histories, and
independently settling Now/Reporting reads. The detailed source behavior is in
[System Architecture](docs/SYSTEM_ARCHITECTURE.md#loading-and-diagnostic-boundaries).
This work does not change pricing, Inventory, approval, or provider authority.

Validation remains local to source HEAD
`7b4a3ddf26ff7a51e19e834713d8705e3e52aad4` plus preserved working changes.
Environment, capability-surfacing, product-intelligence, and project-state checks
pass. Both Ambient and compatibility production builds pass. The isolated demo-project Firestore emulator
rules suite passes all 96 tests with a 60-second setup timeout and a 15-second
per-test timeout; the emulator exits cleanly. These are local rules assertions,
not hosted or production authorization proof. The final full unit run passes
504 files and 6,026 tests; three files and 100 tests are skipped. This supersedes
the earlier run's corrected eager-import assertion. A sandbox-restricted run
was stopped after CLI subprocess tests hit EPERM; the complete rerun with
required subprocess permissions exits successfully. The 17 JSX transform
regressions are included in this final full-suite count.

Completion planner `recordedAt`: `2026-10-10T20:20:11.453Z`, using the same task
and eight-path scope as the start record. This records the local handoff, not a
green release gate. `GRAPH_COVERAGE_BLOCKED` limits complete graph impact claims
for partial/stale edited paths; the owner-authorized source fallback, focused
tests, builds, and local browser checks supply the bounded implementation proof.

The production manifest's static homepage JavaScript closure decreased from
398,186 to 195,893 raw bytes, and the WorkspaceRoute closure decreased from
1,699,300 to 878,073 bytes. Neither final closure includes the quote builder.
These are artifact dependency sizes, not measured load times. The follow-up
removed the full Ambient projection dependency from the compatibility quote
workspace, preserving displayed identity and guest count through its smaller
event presentation. Compatibility JavaScript decreased by 218,954 raw bytes,
from 3,729,880 to 3,510,926, passing its unchanged 3,652,845-byte ceiling.
The subsequent production-only classic JSX transform resolves the Ambient
overrun. Under the same CI flag matrix, Ambient decreases from 4,987,091 to
4,835,913 raw JavaScript bytes (151,178 fewer); compatibility totals 3,356,057.
Both profiles pass their unchanged aggregate ceilings, and their largest chunk
remains 385,181 bytes. Development and test builds retain automatic JSX and
its diagnostics. No budget exception was expanded. The final Ambient homepage
static JavaScript closure is 189,763 bytes; it excludes workspace and builder
code. The WorkspaceRoute static JavaScript closure is 871,110 bytes and still
excludes quote composition. These are emitted artifact sizes, not timing gains.

Local Chromium checks rendered the homepage and sign-in page at 1440 and 390
pixels without page overflow or unexpected browser errors, and neither requested
the App, ProposalComposer, or WizardSteps chunks. Fixture workspace checks
rendered Now, quote composition, Client 360, and Reporting. Client 360 also fit
768 pixels; keyboard history navigation retained focus as versions appeared.
After a deliberately failed WizardSteps import, **Try again** recovered the
builder with both edited draft values retained. These checks do not measure
Core Web Vitals or prove hosted authentication. The shared catalog settings gate
remains ahead of route feature eligibility.

The follow-up fixes both scanners to skip Git-confirmed deletions during
content reads while retaining deletion-related documentation obligations and
failing on other read errors or missing canonical documents. Eight isolated
scanner regressions pass; the unrelated `.claude/agents/slice-implementer.md`
deletion is preserved. The maintainer quick runner, documentation governance,
and product-intelligence checks now pass. Three focused quote-workspace suites
pass all 55 tests, including 20 parity cases for the reduced summary.
A local Chromium quote fixture also renders its identity, 175 guests, and
$19,475 total at 1440, 768, and 390 pixels without page-level horizontal
overflow or browser errors; the 390-pixel capture was visually inspected.
Follow-up completion planner `recordedAt`: `2026-10-10T21:28:42.904Z`.
That earlier handoff retained the then-failing Ambient budget; the production
JSX follow-up above now passes both bundle budgets. Full release qualification
still requires separate release evidence.

The JSX follow-up adds 17 passing transform checks using the actual Vite
configuration: element keys/refs, children, fragments, default props, spread
precedence and evaluation order, plus retained development/test automatic JSX.
Production homepage/sign-in checks preserve the lazy request boundary. A
missing-Firebase production fixture correctly remains blocked by Library
recovery. A separate local-fallback fixture, explicitly enabled only in its
scratch build, renders Now, quote composition, populated Living Opportunity,
and Reporting at 390/768/1440 without page overflow or browser errors. Guided
builder input retains focus and the entered guest count across resize. This
is local compiler/UI evidence, not hosted authentication or tenant authorization.

The final local Lighthouse comparison ran sequentially after the unit/build
workload completed. Both baseline and final artifacts pass unchanged assertions
with performance score 86 and zero measured Total Blocking Time. Final LCP is
3,475.77 ms and CLS is 0.05136; baseline LCP is 3,504.05 ms and CLS is 0.04652.
The earlier concurrent-workload run failed (score 43, TBT 6,874.70 ms), so its
resource-contended result is retained but is not the final qualification run.
Single local runs establish neither a causal timing improvement nor hosted CWV.
Final production JSX planner `recordedAt`: `2026-10-10T22:13:07.797Z`.
Environment/maintainer, both production builds and bundle guards, full unit,
documentation governance, product-intelligence, project-state, and whitespace
checks pass locally. Changed implementation is limited to `vite.config.js` and
its new transform regression test; canonical architecture/status/changelog
record the evidence. The candidate remains uncommitted and undeployed.

Browser timing, hosted authenticated journeys,
production deployment, human acceptance, and measured catering outcomes remain
separate, unclaimed proof classes. Existing deployment receipts below do not
cover this unreleased tranche.

## Quote-to-Confidence candidate qualification

The isolated `codex/quote-to-confidence` worktree contains five implementation
slices with separately default-off quote-completion, decision-packet,
exception-first Inventory, supply-plan, mobile-capture and learning gates.
Local verification is recorded in `task-5-report.md`; this candidate has no
hosted activation, deployment, provider, production-user, human-acceptance or
outcome evidence. Six required local Firebase web configuration values remain
absent from the isolated worktree. Existing production receipts below are
historical and do not apply to this candidate. Event-bound receiving attribution
and compatible template/workflow learning-adoption receipts remain integration
gaps; physical inventory valuation policy remains unresolved.
Broader gate-off browser probes also retain Ambient inspector overflow and
Library/legacy workspace navigation or assertion failures documented in the
Task 5 report. Focused journey evidence is not a repository-wide browser-green
or release-readiness claim.
## Current evidence boundary

QuotePilot currently has a coordinated public frontend, Firebase backend, and
founder-pilot tenant configuration, but they retain separate deployment and
evidence receipts and must not be described as one artifact.

| Surface | Current recorded evidence | Boundary |
|---|---|---|
| Local v0.20 source candidate | QPR-005 source head `dc3cdb1a33c6f75c3cff993f4a4bd9db382bf6c6` packages the current product and release-test cohorts; QPR-006 synchronizes this state, capability, performance, and release documentation against that source. | Local source and validation evidence only. QPR-007 still owns one clean exact-SHA candidate proof; push, exact-head CI, deployment, hosted/provider behavior, production data, accessibility, human acceptance, and outcomes remain open. |
| Public Vercel edge | `v0.19.0`, exact SHA `bf9f48a00547e305fdf155c8d64bf3646198b705`, exact-main CI `34787753902` attempt 2, production workflow `34791516818`, immutable deployment `quoteflow-bgq2wztfk-mbmapps.vercel.app` | The protected workflow promoted the `all-qualified-features` browser build and verified `https://quotepilot.mbmapps.com`. A subsequent public request returned HTTP 200 and the deployed Inquiry chunk contained the reviewed site key, action, and customer-safe route copy. Authenticated role journeys and human acceptance remain open. |
| Firebase Functions | `v0.19.0`, exact SHA `bf9f48a00547e305fdf155c8d64bf3646198b705`, exact-main CI `34787753902` attempt 2, production workflow `34790618395` | Provider readback found 142 active Functions in `us-central1`. Inquiry callables, the hourly purge function, and `parseIntentDraft` are active; runtime readback pins the coordinated authorities and OpenAI `gpt-5-mini` to `mm05366-sandbox`, with Buyer Access, SMS, Revenue Autopilot sends, test bypasses, and hard App Check enforcement off. |
| Firebase Hosting fallback | `v0.19.0`, exact SHA and workflow shared with the Firebase Functions receipt above | `https://tonicatering.web.app` returned HTTP 200 and served the same reviewed Inquiry chunk. It remains the origin/fallback rather than the canonical Vercel public edge. |
| Production tenant authority | Protected workflow `34551712371` on main merge `2f4246846496f066e909d16fb46886cd0cc193fc` verified the exact current Firebase backend and Vercel browser receipts, then read back both `commercialChangeAuthorityEnabled` and `eventOperatingSpineEnabled` as `true` for `mm05366-sandbox` | Both fields were already true at the verified operation, so the run rebound the activation to current split-surface evidence without changing tenant data. It did not execute a commercial amendment, event command, provider send, payment, or automatic transition. |
| Authenticated production browser acceptance | On 2026-09-16 an authenticated administrator in `mm05366-sandbox` rendered Living Opportunity, Quote administration, Operations, Inventory, Library pricing, and privacy-bounded Session Diagnostics through `https://quotepilot.mbmapps.com`. Inventory reported server-confirmed location and ingredient projections; Library reported catalog revision 62 as confirmed while retaining a ten-change unpublished draft and 15 cost entries needing attention. Diagnostics reported zero errors and zero warnings. Desktop and 390-by-844 browser checks produced no page-level horizontal overflow or console errors. | This is a partial read-only acceptance receipt. The active identity appears to have platform-admin cross-organization bypass, so it cannot prove ordinary admin/sales tenant denial; no separate non-admin identity was exercised. No browser App Check header or token exchange was observed. Public headers and asset hashes did not identify an exact source SHA or immutable deployment. No Inventory recovery control appeared, and no Commercial Change authorization, Event command, provider action, or production write was issued. The phone-width Inventory table still compresses or clips multi-column evidence labels and needs a responsive presentation repair. |
| Isolated staging Event/Commercial profile | Exact SHA `2f5d123d9ba06153823def6f44b3f5ff89183023`, CI `34420973414`, Firebase Hosting version `31a0bcbf39d65ec2`, profile `staging-event-operating-spine` | The original deployment and recovery readback proved both runtime gates true, but a later Functions deployment replaced that runtime. Current readback at `2026-09-11T05:31Z` found Commercial Change false; the tenant fields remain true. Staging must be redeployed and read back before it is described as active. |
| Repository `origin/main` | Protected PR `#145` merged as exact tagged SHA `bf9f48a00547e305fdf155c8d64bf3646198b705` (`v0.19.0`) after all nine exact-head checks passed; exact-main CI run `34787753902` attempt 2 also passed all nine jobs | Repository, CI, deployment, hosted/provider behavior, production data, and human acceptance remain separate evidence classes. |
| Guided Inquiry and Model Assist | The dedicated managed Inquiry Turnstile widget is restricted to the two approved production hosts, its public site key is compiled on both browser targets, and its secret is bound only through Secret Manager. A fresh OpenAI Responses probe using the rotated production key returned HTTP 200; `parseIntentDraft` is active with secret version 2 and the exact tenant/model runtime fence. A disposable local emulator lane now passes five browser tests across tenant denial, publication lifecycle, recovery/idempotency, quotas, and atomic conversion. | Provider-key and deployed-configuration evidence remain separate from the local emulator receipt. No production Showcase slug, real hosted Turnstile challenge, production inquiry/conversion, provider notification outcome, accessibility, or human-acceptance receipt exists yet. |
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

- Staff read completeness and Living Opportunity final-count timing now use
  operator-facing **pending decision review** and **final-count decision** copy
  instead of the internal **Decision Debt** product name. The internal read
  identity, exact Workflow task handoff, server bounds, and attendance and
  commercial authority are unchanged. This is source/local automated language
  evidence, not hosted, assistive-technology, human-comprehension, usage, or
  outcome proof.

- The default-off Create intake surface now loads only when its quote-new gate
  is active, through the same recoverable lazy contract used by other workspace
  tools. The complete local feature-flag graph reduces its shared Workspace
  chunk from 461,976 to 432,767 bytes and stays below the unchanged 445,422-byte
  chunk ceiling. The current exact-source graph measures 4,968,733 aggregate
  bytes and is bounded by a 4,968,757-byte temporary ceiling, preserving 24
  aggregate bytes and 10,200 largest-chunk bytes. This is source/local packaging
  evidence, not CI, Core Web Vitals, hosted, production, human-acceptance, or
  outcome proof.

- The source/local Import Studio candidate can now translate the first exact
  receipt-bound menu-item change into an administrator-only Library review
  target. The editor waits for the recorded event type and menu section, clears
  incompatible filters, focuses only the exact record, and reports recovery
  instead of substituting another item when the receipt target is unavailable.
  This is local automated evidence; it is not deployed, hosted, provider,
  production-data, assistive-technology, human-acceptance, or outcome proof.

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

- The current source candidate carries the administrator's exact first-quote
  menu intent from Library into Import Studio and offers a deterministic,
  header-only menu CSV template. Existing staged review, server preflight, and
  Menu Builder handoff remain authoritative; the template creates no catalog
  IDs, records, save, publication, cost proof, or Inventory evidence. Focused
  tests plus local 390/768/1440 route checks prove the exact handoff, template
  download name, page containment, unchanged local catalog, and zero axe
  violations after repairing the file-input label, embedded main/heading
  structure, and horizontal progress rail's keyboard access. Durable post-
  publication provenance is now retained as sanitized operator-declared file,
  source-kind, batch, type, and row context through preflight, shared-draft
  receipts, publication lineage, and the active record. It is excluded from
  business conflict hashes and does not establish provider truth. Focused
  client/server tests cover that shared-draft path. A disposable connected
  Firebase-emulator lane now proves the bounded local path from starter
  publication through routed menu import, asynchronous current-section
  discovery, exact receipt-bound draft review, a second governed publication,
  and one server-authoritative saved quote/version from an initially empty
  quote history. The selected item ID, name, and price snapshot are checked
  against the imported active record. This does not prove proposal delivery,
  customer acceptance, booking, payment, recipe truth, physical Inventory,
  hosted/production behavior, assistive-technology use, human acceptance,
  activation timing, or outcomes.
- The current source candidate places the Library readiness rail before the
  catalog in DOM and focusable-control order at every viewport while preserving
  the desktop catalog-left/readiness-right composition. Focused component and
  local 390/768/1440 browser checks pass, including axe and geometry checks.
  Hosted deployment binding, assistive-technology use, operator comprehension,
  and human acceptance remain open.
- Business Setup Center now reports incomplete-but-quote-eligible setup as
  `quote-ready`, reserving aggregate `ready` for complete setup and retaining
  `attention` for quote-blocking gaps. Focused component checks cover all three
  states; hosted semantics, assistive-technology interpretation, and human
  comprehension remain open.
- A disposable Firebase-emulator administrator journey now proves the Library
  continuation opens `/app/quotes/new` without creating an authoritative quote:
  the organization quote-ID baseline is empty immediately before the action and
  remains the identical empty set after navigation. This is local automated
  no-save evidence, not hosted-role, human-comprehension, completion-time, or
  commercial-outcome proof.- The 2026-09-16 authenticated production administrator read journey is only
  partial. Ordinary admin/sales role denial, cross-tenant denial, exact source
  SHA/deployment binding, production command receipts, assistive-technology
  acceptance, and founder acceptance remain open.
- The current source candidate repairs the observed phone-width Inventory table
  defect with a named, keyboard-focusable contained-scroll region, persistent
  overflow guidance, and fixed columns preserving all seven evidence axes.
  Component-browser checks pass at 390, 768, and 1440 pixels, including full
  final-column visibility and forced-colors focus width/color. Complementary
  route checks prove the route stays unavailable when tenant authority is
  absent and renders the seven-axis table for an authenticated Firebase-
  emulator administrator when the tenant gate is enabled. The 2026-09-16 hosted
  observation above remains historical truth; deployment-bound, assistive-
  technology, operator-comprehension, and founder-acceptance evidence remain
  open.- App Check hard enforcement remains blocked until reviewed browser provider
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
  are present. A disposable emulator journey proves cross-tenant callable
  denial, exact publication pinning, idempotent recovery, tenant/IP quota
  rejection without inquiry authority artifacts, stale conversion rejection,
  and one atomic quote artifact set under a concurrent duplicate. No unique
  production slug, fresh hosted browser challenge, wrong-host
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
