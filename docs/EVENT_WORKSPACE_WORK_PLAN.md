# Work Plan: CWF-16 Event Workspace

Created: August 9, 2026
Type: frontend feature
Authority impact: presentation/navigation only; no backend or data-authority change

## Objective

Implement the approved event-workspace concept on the exact quote-detail route
without changing quote mutation, pricing, provider, payment, booking, portal,
or BEO authority.

## Phases

### Phase 1: Pre-code contract

- [x] Repository capability/UX/intelligence/IA/reuse/path/risk/test audit.
- [x] PRD, UI spec, ADR, design document, and work plan.
- [x] User-approved visual direction.

### Phase 2: Pure presentation boundary

- [x] Add deterministic event-workspace presentation model.
- [x] Cover identity, attention, scope, lifecycle, partial, and negative claims.
- [x] Merge existing Workflow Attention and proposal-readiness intelligence
  into one central presentation contract with stable reason codes.
- [x] Return explicit unavailable Flexibility/Alignment states rather than
  estimating absent change-window or combined-integrity data.

### Phase 3: Route composition

- [x] Render Event Workspace only for `/app/quotes/:quoteId`.
- [x] Preserve `/app/quotes` administration and `/edit` authority.
- [x] Wire existing Workflow, Schedule, Customer, PDF, BEO, and conversation actions.

### Phase 4: Responsive design and QA

- [x] Match the approved desktop hierarchy using existing neutral-shell tokens.
- [x] Pass 390px containment, keyboard/focus, and reduced-motion checks.
- [x] Capture same-state desktop/mobile screenshots and pass `design-qa.md`.

### Phase 5: Repository qualification

- [x] Focused unit/component/browser tests.
- [x] Full maintainer, build, bundle, docs, secret, workflow, and diff gates.
- [x] Canonical docs synchronized with source/local evidence only.

## Completion boundary

Source completion does not establish merge, deployment, flag promotion, hosted
availability, production data behavior, or human acceptance. Those remain
separate authorized release gates.
