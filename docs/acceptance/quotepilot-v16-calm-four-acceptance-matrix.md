# QuotePilot v0.16 Calm Four Acceptance Matrix

Last updated: 2026-09-02 20:08:21 CDT

## Purpose and verdict rule

This is the canonical ten-scenario Phase 1 functional acceptance record for
the approved v0.16 Calm Four source candidate. It deliberately separates local
product behavior from later hosted/manual evidence and release authority.

The only classifications used here are:

- **PASS** — the applicable Phase 1 product contract has local automated or
  reproducible state evidence;
- **NOT APPLICABLE** — the stated behavior has no corresponding supported
  product/domain contract in this candidate;
- **BLOCKED** — an applicable Phase 1 product contract cannot currently be
  completed or evidenced;
- **HOSTED/MANUAL REQUIRED** — the local product contract passes, while a real
  hosted environment, device, assistive technology, provider, or human must
  still supply separate evidence; and
- **AUTHORITY REQUIRED** — the next action would require deployment,
  credentials, provider access, or another explicitly authorized operation.

Current Phase 1 verdict: **PASS — nine scenarios PASS, Test 7 is NOT
APPLICABLE, and no scenario is BLOCKED.** This verdict does not qualify a
release, deployment, hosted environment, provider outcome, or founder
acceptance. Those boundaries remain explicitly classified below rather than
being converted into product-test failures.

Tests 4–7 may not pass from screenshots. Their evidence must include automated
output or a reproducible authoritative state/API trace demonstrating draft,
save, recalculation, and persistence semantics.

## Evidence baseline

| Evidence | Result | Boundary |
|---|---|---|
| Current focused v0.16 component/server/state cohort | **73 passed, 0 failed** on the latest integrated candidate; the preceding broader integrated Quick Updates cohort passed **196/196** | Local source/component/server/state evidence only |
| Current integrated full `npm run test:unit` | **4,197 passed, 78 skipped; 369 files passed, 3 skipped** | Current broad local regression evidence; the sandboxed attempt could not spawn child processes, so the identical suite was rerun in the permitted host execution context and passed |
| Customer-centered/Ambient-enabled and safe-off `npm run build` | **Pass in both configurations** | Local production compilation only |
| Last recorded integrated `npm run lane:release` | **PASS**, including project state, environment, secret scan, workflow lint, capability surfacing, **4,194** unit tests, build, documentation governance, bundle, and Truth Loop **127/127** | Earlier exact-candidate local source/repository gate; it was not rerun for the current documentation slice and is not CI or provider evidence |
| Bundle budgets | Compatibility **3,214,012 / 385,130 bytes** under the source-approved **3,221,176 / 391,901** ceiling; exact production-equivalent Ambient **4,017,689 / 385,130 bytes** under **4,017,992 / 391,901** | Total JavaScript / largest chunk; the Ambient ceiling is the literal candidate plus only the previously observed 303-byte runner offset, while the largest-chunk ceiling remains unchanged |
| `e2e/v16-calm-four-acceptance.spec.js` | **10 passed, 0 failed, 0 skipped; 1.2 minutes** | Fresh isolated local ports with Customer-Centered, Ambient, Pilot Now, and Pilot Command gates; browser-local authority boundaries are exercised without presenting screenshots as persistence proof |
| `e2e/workspace-no-unintended-overlap.spec.js` | **81 passed, 0 failed, 0 skipped; 3.1 minutes** | Fresh Chromium-admin local evidence at 390px, 768px, and 1440px; the Calm Four routes derive from the shell navigation contract and stale selectors fail closed |
| Ambient Clients/Now/Library/Opportunities responsive and accessibility cohort | **26 passed, 0 failed; 1.3 minutes** | Fresh isolated local browser evidence across 390px, 768px, and 1440px representative widths |
| `npm run test:customer-centered-authority:emulator` | **PASS** — dormant receipt mismatch, catalog drift, and stale revision each produce zero writes; the successful path proves exact save/readback equivalence for total, deposit, staffing, and version | Reproducible local Firebase emulator persistence trace; not a hosted/provider claim |
| Side-by-side Product Design QA | **PASS; no actionable P0, P1, or P2 findings** | Approved/current visual comparisons recorded in `design-qa.md`; not hosted acceptance |
| `npm run test:rules:firestore` | **76 passed, 0 failed** | Local Firestore emulator proof for tenant and role enforcement; not hosted-provider evidence |
| Firebase/Vercel candidate receipts | **AUTHORITY REQUIRED** | No hosted or production claim; no provider action was taken during Phase 1 |
| Authenticated founder/UAT acceptance | **HOSTED/MANUAL REQUIRED** | No human-acceptance claim |

## Scenario matrix

| # | Acceptance scenario | Phase 1 status | Current evidence | Separate post-Phase-1 evidence |
|---:|---|---|---|---|
| 1 | Calm Four is the only primary navigation | **PASS** | Component and browser evidence proves Now, Opportunities, Clients, and Library are the only persistent primary destinations; New quote remains an action; Search, Operations, active-route state, Back/Forward, sign-out, and the mobile Workspace & tools surface remain reachable. Account settings is implemented locally as a focus-contained secondary modal/sheet with current identity/workspace context and an explicit password-reset action; opening it performs no reset. A principal has one organization in the current role/claim model, so same-account workspace switching is **NOT APPLICABLE**, not a missing control. Moving to another organization requires signing out and signing in with another authorized principal. | **HOSTED/MANUAL REQUIRED** — exercise the authenticated exact-candidate secondary utilities and confirm password-reset email delivery. Same-account workspace switching remains **NOT APPLICABLE** unless the identity model changes. |
| 2 | Opportunities index → workspace preserves exact object/context | **PASS** | Browser Test 2 starts from intentionally unordered fixtures, verifies state/date-derived order, Rivera identity/date/venue/guest/menu/staffing/pricing/proposal/activity context, Back to the index with practical scroll restoration, a different exact opportunity, and the usable mobile index. Unit arrival/model tests reject object substitution. | **HOSTED/MANUAL REQUIRED** — repeat with authenticated exact-candidate tenant data; candidate promotion itself is **AUTHORITY REQUIRED**. |
| 3 | Quick Updates opens contextually without navigation or mutation | **PASS** | Browser Test 3 records the URL and persisted quote/history before opening, expands/collapses Menu/Staffing/Pricing, verifies the underlying opportunity remains visible, closes, and proves byte-equivalent local authoritative state plus trigger focus restoration. Component tests additionally prove background isolation and focus trapping. | **HOSTED/MANUAL REQUIRED** — confirm the interaction and focus return in the authenticated exact-candidate workspace. |
| 4 | Quick Updates draft is local and visibly dirty | **PASS** | Automated component/state coverage proves write-free open/expand/collapse behavior, visible dirty state, draft survival across local panel interaction, exact-delta review enablement, and no save before confirmation. The Firebase emulator additionally proves zero writes for mismatched dormant receipts, catalog drift, and stale revisions. No screenshot is used as persistence proof. | **NOT APPLICABLE** — no additional provider outcome is part of local draft behavior. The immutable candidate must retain the same automated trace. |
| 5 | Every destructive dismissal protects the draft | **PASS** | Automated: `QuickUpdatesPanel.test.jsx` covers X, Cancel, Escape, backdrop, Library, external navigation, Keep editing, Discard, nested alertdialog focus, save-time blocking, and single discard continuation. `WorkspaceNavigationContext.test.jsx` covers dirty Back restore/replay, clean traversal, exact state/scroll payload, Forward, and busy blocking. | **HOSTED/MANUAL REQUIRED** — repeat the real mobile browser-back/gesture path that the local automation platform cannot synthesize reliably. |
| 6 | Review shows the exact delta and saves once | **PASS** | The browser-local fixture intentionally refuses authoritative Quick Updates saving and hands off to the full editor without mutation. Component/server tests prove exact persisted Before/After review, return-to-edit draft retention, pending duplicate-submit blocking, receipt/revision/catalog/policy fencing, mismatched-readback rejection, and recoverable failure. The Firebase emulator supplies the persistence trace: mismatch, drift, and stale-revision paths write nothing; one valid request produces one exact save and server readback with total, deposit, staffing, and version equivalence. Dirty state clears only after the authoritative quote read and list refresh succeed. | **HOSTED/MANUAL REQUIRED** — repeat the same exact-candidate save/readback contract in the authenticated hosted workspace. Screenshots alone remain insufficient. |
| 7 | Derived staffing/pricing uses existing domain authority | **NOT APPLICABLE** | Service style has no declared authoritative persisted rule that derives staffing or pricing; existing `STAFF_RULES` are advisory. The server simulation/save path delegates to the existing quote document/save/version/calculation authority, and the emulator proves exact trusted total, deposit, staffing, and version readback without a parallel drawer calculator. No unsupported derivation is invented to force this scenario to PASS. | **NOT APPLICABLE** until Quick Updates supports a field with a declared authoritative derived-effects rule; at that point an isolated cross-workflow equivalence trace becomes required. |
| 8 | Contextual and standalone Library share catalog authority without context leaks | **PASS** | Browser Test 8 compares IDs and rendered records for all six catalog groups in standalone and Rivera-contextual modes, proves the direct view has no Rivera context, verifies browsing/editor entry makes no opportunity write, returns to the exact Rivera opportunity, and confirms a later standalone visit has no leaked context. Component tests cover exact arrival/recovery and guarded editor persistence. | **HOSTED/MANUAL REQUIRED** — repeat against the authenticated exact-candidate organization catalog. |
| 9 | Clients is truthful, tenant-safe, and correctable | **PASS** | Browser Test 9 verifies recorded Rivera identity/contact/event/status, no `Truthful State`, exact Client 360 controls, and a second exact client without Rivera leakage. It then verifies the sparse empty state and canonical **Start an opportunity** route. The UI renders no AI-derived relationship memory, so its correction subcondition is **NOT APPLICABLE**. The 76-test Firestore emulator suite and arrival tests retain tenant/role and object-mismatch denial. | **HOSTED/MANUAL REQUIRED** — verify authenticated exact-candidate production-shaped data and role behavior. If derived memory is introduced later, source display, correction persistence, and cross-tenant denial become required. |
| 10 | Responsive, accessibility, loading/error, and permission behavior survives | **PASS** | The current responsive/accessibility cohort passes 26/26 at 390px, 768px, and 1440px, covering horizontal overflow, Calm Four targets, Quick Updates axe/focus behavior, keyboard controls, responsive secondary navigation, and representative role/state handling. Component/server tests cover loading, empty, error, retry, and a stale-revision conflict that preserves the draft without mutation. The full ten-scenario browser run passes 10/10. | **HOSTED/MANUAL REQUIRED** — actual screen-reader UAT, real-device navigation/back/dismissal, authenticated role/backend parity, and recoverable hosted 4xx/5xx/concurrent-edit exercises remain separate. |

## Executable evidence map

The browser contract is `e2e/v16-calm-four-acceptance.spec.js`. Its latest local
run passed all ten executable scenarios on fresh isolated ports with the
Customer-Centered, Ambient, Pilot Now, and Pilot Command gates
enabled. Existing focused browser suites remain additive,
especially
`e2e/ambient-intelligence-accessibility.spec.js`,
`e2e/ambient-opportunities-stream.spec.js`, `e2e/ambient-clients.spec.js`, and
`e2e/ambient-library.spec.js`.

For Tests 4–7, retain one of:

- exact automated output naming the tests above; or
- a reproducible trace that records tenant, opaque quote ID, active revision,
  persisted before state, local draft state, exact reviewed delta, one request
  identity, one definitive receipt or failure, and authoritative after-read.

Redact credentials, portal keys, provider secrets, private customer data, and
private staffing data. A UI screenshot, browser return, local optimistic state,
or generic green build never substitutes for the persisted-state trace.

## Release boundary

This matrix records repository evidence only. Phase 1 is complete with no
product scenario BLOCKED, but that result does not prove provider outcomes,
customer receipt, payment, production-data correctness, usability, or founder
acceptance.

- **HOSTED/MANUAL REQUIRED:** the scenario-specific items in the final column,
  including authenticated UAT, real-device and assistive-technology checks, and
  an authenticated hosted replay of the emulator-proven persistence contract
  for Test 6.
- **AUTHORITY REQUIRED:** freeze/promote an immutable candidate; operate CI,
  Firebase, Vercel, credentials, or provider surfaces; collect deployment and
  rollback receipts; and begin hosted acceptance. None of those actions is
  implied or authorized by this Phase 1 PASS record.

Production qualification remains pending until the governed release path binds
the exact candidate SHA to CI, Firebase and Vercel receipts, rollback evidence,
authenticated hosted UAT, and the founder's explicit acceptance.
