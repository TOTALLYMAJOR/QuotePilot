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
