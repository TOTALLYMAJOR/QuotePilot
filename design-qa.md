# QuotePilot v0.16 Calm Four design QA

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
