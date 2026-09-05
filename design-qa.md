# QuotePilot v0.16 Calm Four design QA

Last updated: 2026-09-04 23:03:12 CDT

## Scope

This review compares the approved 19-screen visual contract in
`artifacts/design/v16-whole-app-mockups/` with the implementation captures in
`output/playwright/v16-calm-four-current/`. It covers desktop and mobile Now,
Opportunities, the opportunity workspace, Quick Updates states, Clients, Library,
and Workspace & tools.

The comparison treats authoritative fixture values, deliberately truthful-state
copy, and viewport-height differences as content or evidence differences rather
than visual defects. Every approved/current pair was reviewed side by side at its
captured viewport.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: minor copy wrapping, icon sizing, divider weight, and spacing differences
  remain within the approved shared visual system and do not impair hierarchy,
  interaction, responsiveness, or accessibility.

## Contract verification

- Calm Four is the only persistent primary navigation on desktop and mobile.
- New quote remains a global action; Search, Operations, workspace, account, and
  sign-out remain secondary utilities.
- Now uses the approved editorial hierarchy and landscape hospitality image with
  current priority and upcoming-work context.
- Opportunities provides a usable attention-ordered index and preserves identity
  when entering an opportunity workspace.
- Quick Updates is a contextual drawer/sheet with closed, open, dirty, exact-delta
  review, dismissal-guard, and explicit-save states.
- Clients preserves the approved sparse empty state and truthful populated-state
  hierarchy without zero-value dashboard chrome.
- Standalone and contextual Library states share the visual system while keeping
  opportunity context explicit only when invoked from an opportunity.
- Mobile captures demonstrate rather than assume the navigation, secondary tools,
  task actions, drawer/sheet, Clients, and Library behavior.

## Evidence

- Approved contract: `artifacts/design/v16-whole-app-mockups/`
- Current captures: `output/playwright/v16-calm-four-current/`
- Behavioral gate: `e2e/v16-calm-four-acceptance.spec.js`
- Acceptance ledger: `docs/acceptance/quotepilot-v16-calm-four-acceptance-matrix.md`

final result: passed

---

# Ambient Now decision-ledger design QA

Final comparison: 2026-09-04 23:03:12 CDT

## Comparison target

- Selected visual authority:
  `/home/administrator/.codex/generated_images/01a06d52-7d2c-7890-8137-dbbc614f1938/exec-1638bb79-e312-4905-869c-5f802960c156.png`
  at 1487×1058.
- Exact-viewport implementation:
  `output/playwright/ambient-now/ambient-now-reference-1487x1058.png`.
- Mandatory combined comparison input:
  `output/playwright/ambient-now/ambient-now-side-by-side.png`.
- Responsive implementation captures:
  `output/playwright/ambient-now/ambient-now-768.png` and
  `output/playwright/ambient-now/ambient-now-390.png`.

The exact implementation and reference were inspected together. Fixture names,
amounts, current dates, and the existing deterministic Workflow order are
authoritative content differences rather than presentation defects.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the product's evidence-authoritative order places the current customer
  request before the overdue follow-up, while the illustrative reference places
  overdue work first. Preserving the existing ranking authority is intentional.
  The explicit urgency count, warm attention field, consequence, and headline
  keep the overdue item perceptible without introducing a second sort.

The implementation reproduces the selected open editorial composition: a
decision-specific masthead, broad Needs-you ledger, secondary temporal/event
column, full-width Quiet-progress band, and quiet evidence footer. Decorative
numeric ranks, the former hospitality image, duplicate dashboard state, and
infrastructure-first copy are absent. Existing ProductIcons, tokens, type,
hairlines, and action grammar remain intact.

## Fidelity score

Local design score: **9.5/10 — GO**.

| Dimension | Weight | Result |
| --- | ---: | ---: |
| Selected composition and visual hierarchy | 3.0 | 3.0 |
| Evidence semantics and next-decision clarity | 2.0 | 2.0 |
| Responsive composition and scanability | 1.5 | 1.5 |
| Accessibility and interaction continuity | 1.5 | 1.5 |
| Pixel-level density and product finish | 2.0 | 1.5 |

This is a local visual-review judgment, not exact-head CI, hosted, production,
assistive-technology, or human acceptance.

## Behavioral and accessibility evidence

- `ambient-now.spec.js`: 2/2 local Chromium-admin cases.
- Exact Workflow request arrival and exact Operations event identity both pass.
- 390, 768, and 1487×1058 remain horizontally contained and retain the same
  semantic order.
- Serious/critical axe violations: zero in the audited Now region.
- Focused model/component cohort: 42/42.
- Production build: pass.

final result: passed

---

# Library commercial convergence design QA

Final comparison: 2026-09-04 21:33:00 CDT

## Comparison target

- Selected authority: Option 2 Library composition with Option 3 restraint.
- Candidate base: `7a139aa530da1ea66b1d86ec8c5190f7475c35e5`.
- Implementation commit: `b593fe4d2c45ff5db20bafe205461157952b9ab4`.
- Responsive overview captures:
  `output/playwright/ambient-intelligence-current/ambient-library-390.png`,
  `ambient-library-768.png`, and `ambient-library-1440.png`.
- Same-viewport desktop reference:
  `output/playwright/ambient-intelligence-current/ambient-library-reference-1487x1058.png`.
- Combined overview comparison:
  `output/playwright/ambient-intelligence-current/ambient-library-comparison-2974x1058.png`.
- Combined nested comparisons: `nested-comparison-offer.png`,
  `nested-comparison-rules.png`, `nested-comparison-pricing.png`, and
  `nested-comparison-template-mobile.png` in the same directory.

The exact 390, 768, and 1440 overview captures and the combined overview/nested
comparisons were inspected together against that exact rendered implementation.
This remains local worktree evidence.

## Findings

- P0: none.
- P1: none.
- P2: none.
- The broad commercial ledger remains primary and the right readiness rail is
  visibly secondary. Its semantic icons reinforce state, while adjacent text
  remains the authority.
- Offers keep selling identity, availability, inclusion, derived margin, and
  next decision prominent. Recorded choice groups are read-only projections.
- Add-ons and Rentals expose visible derived Usage and subordinate stable IDs.
- Templates use independent disclosures and the selected eight-group business
  hierarchy. Rules are structured-first with Advanced raw recovery. Pricing
  separates ordinary policy groups before Advanced policy.
- Mobile preserves object summaries and compact disclosure flow. Ordinary text
  remains at least 12px and interactive targets retain the 44px boundary.
- Recovery presents one owning save/retry action. Changing an embedded editor
  tab synchronizes the breadcrumb/title without remounting or draft loss.

## Fidelity score

Local design score: **9.5/10 — GO**.

| Dimension | Weight | Result |
| --- | ---: | ---: |
| Selected Option 2/3 composition and hierarchy | 3.0 | 3.0 |
| Nested commercial-object coherence | 2.0 | 2.0 |
| Information density and progressive disclosure | 1.5 | 1.5 |
| Responsive and accessibility execution | 1.5 | 1.5 |
| Visual finish and product specificity | 2.0 | 1.5 |

This is a local visual-review judgment, not exact-head CI, hosted, production,
assistive-technology, or human acceptance.

## Behavioral evidence

- `e2e/ambient-library.spec.js`: **17/17** local Chromium cases.
- `VITE_OPERATIONAL_STAFFING_ENABLED=true` with
  `e2e/v16-calm-four-acceptance.spec.js`: **10/10** local Chromium cases.
- The responsive captures cover 390, 768, and 1440 pixels; the nested capture
  inventory covers Offers, Components, Templates, Rules, Pricing, recovery, and
  sales read-only presentation.
- Existing catalog draft/save/revision/publication, Package, Template, Rule,
  server-pricing, and role authorities remain unchanged. **Your bundle** remains
  derived from one quote draft and has no independent record or save path.

final result: passed

---

# Calendar-first Operations selected-composition QA

Final comparison: 2026-09-04 18:01:21 CDT

## Comparison target

- Selected Month composition: `/home/administrator/.codex/generated_images/01a06d52-7d2c-7890-8137-dbbc614f1938/exec-de40cdfa-0b4e-41fa-989a-d9ae0abd04a6.png`
- Selected Week composition: `/home/administrator/.codex/generated_images/01a06d52-7d2c-7890-8137-dbbc614f1938/exec-9d59baa3-fa05-4b3f-b7c0-19675d5abd5d.png`
- Exact rendered source: `5dd97a20133b592f210d56e2454e699c17d45200`
- Month implementation: `output/playwright/ux-convergence-operations-fidelity/implementation-month-1487x1058-5dd97a20133b.png`
- Week implementation: `output/playwright/ux-convergence-operations-fidelity/implementation-week-1487x1058-5dd97a20133b.png`
- Month side-by-side input: `output/playwright/ux-convergence-operations-fidelity/comparison-month-selected-vs-5dd97a20133b.png`
- Week side-by-side input: `output/playwright/ux-convergence-operations-fidelity/comparison-week-selected-vs-5dd97a20133b.png`

Both selected references and both implementation captures are 1487×1058 at
device scale factor 1. The comparison uses the same browser-local administrator
fixture: Sunday, September 6, 2026 selected; Q-OPS-1 focused; Q-OPS-2
overlapping; capacity threshold exceeded. Each source and implementation pair
was placed in one side-by-side comparison input and inspected together.

## Findings

- P0: none.
- P1: none.
- P2: Month's five-week grid is about 60–70 pixels taller than the selected
  reference, so less of the lower conflict workflow appears in the first
  viewport. The required full-width-calendar-over-context relationship remains
  intact.
- P2: Month's lower workspace uses the existing inset panel token instead of
  the reference's near-full-bleed sheet edge. Its selected-day, focused-event,
  conflict, and collapsed-domain zones retain the selected composition.
- P2: Week's secondary rail is slightly narrower and denser than the selected
  reference, but remains subordinate to the temporal grid and keeps the focused
  event plus consequence visible.
- P2: Week omits the illustrative footer legend. Selection and conflict meaning
  remain explicit through labels, borders, `aria-pressed`, and the contextual
  conflict workflow.

None of these differences changes the selected spatial relationships, hides a
required action, creates another authority, or weakens responsive or accessible
use.

## Fidelity score

Local design score: **9.5/10**.

| Dimension | Weight | Result |
| --- | ---: | ---: |
| Defining Month/Week spatial composition | 4.0 | 4.0 |
| Temporal and conflict legibility | 2.0 | 2.0 |
| Information hierarchy and progressive disclosure | 1.5 | 1.5 |
| Interaction and authority continuity | 1.0 | 1.0 |
| Pixel-level density and finish | 1.5 | 1.0 |

This score is a local implementation/design-QA judgment, not hosted or human
acceptance.

## Contract verification

- Month gives the full horizontal content canvas to the reused month calendar;
  no permanent detail rail sits beside it.
- Selecting the conflict day reveals selected day, exact focused event,
  consequence, and collapsed Run of show, Production, Kitchen timing, and
  Staffing domains beneath the calendar.
- Week renders one vertical time axis, seven dated columns, and event geometry
  derived from real start time and duration. Q-OPS-1 and Q-OPS-2 occupy visible
  collision lanes in the same day column.
- The selected event is visually and semantically distinguished; the secondary
  rail retains exact event identity, consequence, conflict comparison, and
  Opportunity continuation.
- Month → Week → Month preserves the selected date and exact event.
- The 390px agenda consumes the same scheduled-event and conflict projection;
  it is not another Calendar implementation.
- The selected reference's manual **Mark as resolved** action was intentionally
  excluded. Derived conflicts clear only when authoritative Opportunity inputs
  change and the existing conflict model recomputes.
- The illustrative **Week Conflict Lens** title was not copied. Both
  presentations remain one canonical **Operations** workspace.

## Behavioral and accessibility evidence

- `e2e/ux-convergence-operations.spec.js`: 12/12 at exact rendered source,
  covering 390, 768, 1440, and 1487×1058; Month/Week geometry; selection
  continuity; capability gates; exact Now/Opportunity/Calendar handoffs;
  staffing/checklist persistence; route compatibility; browser history; and
  duplicate-navigation prevention.
- Serious/critical axe violations: zero at all four captured widths.
- Browser console errors: zero in all four responsive presentation cases.
- Focused Operations unit/route/shell cohort: 131/131.
- Independent authority review: one scheduled-event projection, one conflict
  derivation, and only the pre-existing staffing, kitchen, and checklist write
  paths.

## Comparison history

1. The preceding implementation inverted the selected compositions: Month used
   a permanent right rail and Week stacked detail below a non-temporal card
   layout. The owner rejected that mapping.
2. Month was corrected to calendar-first full width with contextual content
   below. Week was rebuilt only at the presentation layer as a true time grid
   with collision lanes and a secondary rail.
3. Exact 1487×1058 captures exposed density and viewport-position differences.
   Calendar cell density, collision stacking, canvas alignment, and capture
   scroll were tightened, then both side-by-side inputs were inspected again.

final result: passed

---

# Opportunities Option 1 Design QA

Final comparison: 2026-09-02 18:07:27 CDT

## Comparison target

- Source visual truth: `output/playwright/opportunities-editorial-work-queue/reference-option-1.png`
- Baseline implementation: `output/playwright/opportunities-editorial-work-queue/before-desktop.png`
- Final implementation: `output/playwright/opportunities-editorial-work-queue/after-desktop.png`
- Responsive evidence: `output/playwright/opportunities-editorial-work-queue/after-tablet.png` and `output/playwright/opportunities-editorial-work-queue/after-mobile.png`
- Combined comparison input: `output/playwright/opportunities-editorial-work-queue/comparison-full.png`
- State: authenticated administrator, browser-local three-opportunity fixture, Opportunities index, top of page, disclosures collapsed.

The source is 1487 × 1058 pixels and represents a 1440 × 1024 desktop canvas at an approximately 1.033 raster scale. The implementation is a 1440 × 1024 CSS viewport captured at device scale factor 1. The combined comparison renders both full views at equal displayed width. Tablet and phone captures use 768 × 900 and 390 × 844 CSS viewports at device scale factor 1.

## Findings

No actionable P0, P1, or P2 mismatch remains.

- Typography: the implementation keeps QuotePilot's existing Bodoni Moda editorial heading and event names with Manrope working copy. Scale, weight, wrapping, and hierarchy reproduce the selected direction without importing a new font or leaking display type into body copy.
- Spacing and layout rhythm: the masthead, group intervals, hairline rows, identity column, lifecycle chip, concise reason, action, and disclosure follow the reference composition. The existing app-level inset frame remains intentionally unchanged because normalizing every route frame is a separate cross-app contract, not an Opportunities-row decision.
- Colors and tokens: the existing near-white paper, ink, gold, teal, status, and hairline tokens match the selected direction. No gradient, new shadow language, or one-off decorative color was added.
- Image quality and assets: the target introduces no new raster content. The implementation preserves the production QuotePilot logo and the existing icon libraries; no placeholder, CSS drawing, handcrafted SVG, or replacement brand asset was introduced.
- Copy and content: the queue uses concise, state-specific projection copy while retaining the fuller exact arrival reason in the action contract. The illustrative target's “Staffing needs review” is not copied onto records that lack exact staffing-attention evidence; those records truthfully say “Ready for proposal review.”
- Icons and affordances: the production navigation icons remain intact. The one **Details** disclosure uses the existing icon library, exposes a 44-pixel target, rotates only to represent open state, and removes the duplicate generated disclosure cue.
- Responsiveness and accessibility: 768px preserves the editorial hierarchy without overflow. At 390px the reason stacks above the action, actions remain reachable, the fixed bottom navigation does not create horizontal overflow, focus is visible, and reduced motion removes the disclosure transition.

Focused crops were not needed: the 3000-pixel-wide combined comparison keeps each complete desktop canvas and its row-level type legible at approximately source scale. The original-resolution source, desktop implementation, tablet implementation, and mobile implementation were also inspected individually.

## Comparison history

1. Baseline comparison
   - P1: every row repeated a long generic “There isn’t…” explanation and exposed both **Opportunity details** and **Details**, making the queue slower to scan.
   - P2: the masthead and group rhythm were compressed relative to the selected editorial direction.
   - P2: the phone layout forced the reason and action into competing columns.
2. Fixes applied
   - Added a pure, lifecycle-aware `queueSummary` projection while keeping the exact action arrival reason and authority payload.
   - Reduced each row to one concise reason, one primary action, and one **Details** disclosure.
   - Increased editorial masthead and group spacing, then stacked the phone reason and action.
   - Settled browser captures on `document.fonts.ready` plus two paint frames and added geometry checks for the complete **New quote** label across routes and breakpoints.
3. Post-fix evidence
   - `comparison-full.png` shows the final desktop implementation beside the selected source.
   - The focused component/model suite passes 27 tests.
   - The full Calm Four browser suite passes 10 of 10 scenarios, including disclosure, focus, navigation, console, overflow, mobile stacking, and responsive **New quote** checks.

## Primary interactions checked

- Open and close an opportunity's **Details** disclosure.
- Focus and activate the single row action.
- Navigate to the exact opportunity and back to the exact list position.
- Reflow the same list at 1440, 768, and 390 pixels.
- Verify one complete **New quote** action after route changes and a 390-to-1440 resize.
- Check browser console and uncaught page errors: none observed.

## Follow-up polish

- P3: a later whole-app frame normalization may remove the current inset route border if that direction is approved across Now, Opportunities, Clients, and Library together.
- P3: the tablet shell leaves Search and Operations on a spacious second line; that is global-shell polish rather than an Opportunities-row defect.
- P3: the attention accent intentionally indents its priority row a few pixels farther than ordinary rows; retain it unless a later cross-route alignment pass removes that semantic gutter everywhere.

final result: passed
