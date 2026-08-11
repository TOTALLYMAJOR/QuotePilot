# QuotePilot Staff Workspace Design System

Status: shipped in v0.5.0 (PR #50). This records the visual system, its
contracts, and the intentional decisions so future work extends it instead of
rediscovering it.

## Principles

- Calm neutral workspace: hierarchy comes from typography and spacing, not
  color or decoration. One restrained brand accent.
- Progressive disclosure: governance and evidence detail stays available but
  collapsed; screens lead with state and next action.
- Customer-facing surfaces (portal, proposal PDFs, marketing) keep their
  tenant-branded hospitality treatment and are NOT covered by this system.

## Tokens (src/styles.css `:root`)

- Surfaces: app background `#f6f6f4`, cards `#ffffff`, inset `#f4f4f2`.
- Ink: primary `#1f2023` (`--tone-ink-1`), secondary `#3b3d42`, muted
  `#5f6268`/`#6b6e74`. Muted text on white must use `#6b6e74` or darker
  (WCAG AA 4.5:1 — verified by e2e/accessibility.spec.js axe checks at
  1440px and 390px).
- Accent: gold `#8d611a` (`--tone-gold-3`) for primary actions, active
  states, and focus rings. White-on-`#8d611a` passes AA. No gradients.
- Hairlines: `#e4e4e0` borders, `#efefec` row separators.
- Radii: 8/10/14 (`--radius-sm/md/lg`). Shadows are soft and small
  (`--shadow-soft/panel/elevated`).
- Type: Manrope everywhere in the staff workspace (`--font-ui`,
  `--font-display`). Bodoni Moda serif is reserved for editorial/brand
  moments via `--font-editorial` (brand lockup, portal h1, event title,
  quote-summary total). 12px minimum font size.

## Layout contracts

- Sidebar shell: at `min-width: 1181px` the `.site-header` renders as a
  fixed 236px dark rail (`#17181c`); below that it is the light top bar.
  This is CSS-only — the header DOM is identical in both modes. e2e asserts
  same-column nav alignment at >=1181px and same-row below
  (customer-centered-workspace.spec.js "nearby widths" test).
- Focus: interactive focus rings are gold; route-heading and modal-card
  focus outlines are `2px solid rgba(141, 97, 26, 0.55)` (e2e asserts 2px).
  Never dim text with opacity to indicate disabled/locked state — use
  AA-safe muted colors instead (opacity dimming broke axe checks).
- Disclosure pattern: `.staff-evidence-disclosure` (native `<details>`)
  is the standard for demoting evidence/methodology copy — used by the
  staff evidence rail ("Data freshness"), the Quotes sheet ("Workspace
  data details"), and Reporting ("How these numbers are read"). Keep the
  status chip and one-sentence outcome visible; collapse the rest.
- Alert notes: `.error-note`/`.warning-note` are tinted bordered cards,
  not bare colored text.
- Event workspace (quote page): `.event-workspace-body` = main column +
  304px sticky side rail (quote summary from `quote.totals`, lifecycle).
  Readiness donut is a conic-gradient driven by the `--readiness-score`
  inline variable.

## Feature flag

`VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED` defaults ON (App.jsx); only an
explicit false/0/no/off restores the legacy modal shell. The default e2e
lane pins it off to keep the legacy contract tested; the flag-on suite
covers the production default.

## Known follow-ups

Tracked in DEV_TASKS.md: promote Catalog into primary sidebar nav
(admin-gated), a first-class Templates surface for event-type presets,
inline editing on the event workspace (requires simulate-pricing round
trips and change-authority integration), and a terminology pass on the
remaining expert labels (e.g. Decision Debt, Revenue Autopilot).
