# QuotePilot Design Contract

Last updated: 2026-08-20 19:13:17 CDT

Status: governing product contract for staff and customer commercial workflows.

## Purpose

This contract turns QuotePilot's design principles into repeatable decisions for
the path from event inquiry to booked work. It governs how commercial state,
money, authority, blockers, and next actions appear. It is not a replacement
token library or a copied visual identity.

Use these authorities in order:

1. Product truth, authorization, pricing, payment, and provider boundaries in
   code and domain policy.
2. `DESIGN_PRINCIPLES.md` for product judgment and hard constraints.
3. This contract for commercial workflow composition and interaction.
4. `DESIGN_SYSTEM.md` and the tokens in `src/styles.css` for visual execution.

If they conflict, the higher authority wins. No visual treatment may imply that
a quote saved, a message delivered, a payment settled, or an event booked when
the authoritative service has not established that state.

## Product Archetype

QuotePilot is a **hospitality commercial operating system**. Its primary object
is an event opportunity moving through a governed transaction:

`inquiry → quote composition → authoritative pricing → saved version → proposal → customer decision → deposit evidence → booked work`

It is not a generic analytics dashboard, CRM skin, document editor, or payment
terminal. Each surface should help an operator answer:

- Which commercial object am I working on?
- What is its authoritative state?
- What value or obligation matters now?
- What blocks progress?
- What is the one useful next action?
- What evidence will exist after I act?

## Repository Fit

Decision: **integrate the reference logic, preserve the runtime, and converge
the design authorities.**

| Area | Decision | Contract |
| --- | --- | --- |
| React and Vite runtime | Preserve | No framework, routing, or state-management replacement for design work. |
| Local components and CSS | Preserve | Extend existing components and tokens before adding abstractions. |
| Typography and brand | Preserve | Bodoni Moda for rare brand moments, Manrope for working UI, DM Mono for document and financial evidence. |
| Visual system | Integrate | Use warm paper, ink, hairlines, restrained elevation, and one primary action as composition principles. |
| Design documentation | Converge | This file owns the commercial workflow contract; `DESIGN_SYSTEM.md` owns execution details; `DESIGN_PRINCIPLES.md` owns judgment. |
| Browser and accessibility proof | Preserve | Continue real-route Playwright and Axe checks at the required viewports. |

Do not add a second token system, component library, browser-test hierarchy, or
parallel application shell to implement this contract.

## Reference Decision

The closest Refero Styles reference is **Automate Supplier Payments / Apron**.
Its warm financial workspace, ink-led hierarchy, hairline structure,
ledger-like numerical treatment, and one emphasized action align with a
catering quote product better than a cool pipeline UI. It is a reference, not
a dependency or identity template.

| Candidate | Useful fit | Why it was not selected as the lead |
| --- | --- | --- |
| Apron | Warm hospitality-adjacent financial operations; paper and ledger logic; singular action emphasis | Selected; brand-specific type, color, and shape rules are not adopted. |
| Relate | Pipeline states and compact operational cards | Too cool, generic, and CRM-like for QuotePilot's document and hospitality identity. |
| Acctual | Invoice and financial clarity | Strong transaction fit, but weaker event and hospitality character. |
| Mews | Hospitality context and operational confidence | Strong domain adjacency, but its louder brand treatment would compete with commercial evidence. |

Refero recommends treating extracted styles as starting material for a real
implementation review. QuotePilot follows that model: observe, explain the
benefit, transform it for this workflow, and retain only what improves a
commercial decision.

## Transfer Rules

| Observed pattern | Why it works | QuotePilot transformation |
| --- | --- | --- |
| Warm paper canvas and dark ink | Makes financial work feel tangible and calm | Keep the existing cream, paper, and ink tokens; do not copy Apron's literal colors. |
| Hairline borders with little elevation | Structure remains visible without card noise | Use existing borders for durable grouping; reserve shadows for floating or transient UI. |
| One chromatic primary action | Makes the next move obvious | Use QuotePilot gold only for the context's primary action or ready recommendation. |
| Ledger-style aligned figures | Improves scan accuracy for money | Use DM Mono for totals, deposits, versions, quantities, timestamps, and document artifacts—not body copy. |
| Spacious group rhythm | Separates decisions without decorative chrome | Keep summary, work, evidence, and action zones distinct; use current spacing tokens. |
| Plain financial hierarchy | Keeps consequences legible | Show subtotal, adjustments, total, deposit, balance, and margin authority in their real order. |

The reference's chunky slab display face, full-pill controls, oversized radii,
literal marigold palette, paired equal-weight calls to action, and prohibition
on semantic colors are rejected. They conflict with QuotePilot's typography,
restrained shape language, decision compression, and evidence semantics.

## Commercial Surface Anatomy

Every consequential staff workspace should use this hierarchy, omitting only
layers that do not exist for that object:

1. **Identity:** client, event, date, quote or version identifier.
2. **State:** draft, sent, viewed, changes requested, accepted, deposit pending,
   paid, booked, stale, or another domain-authoritative status.
3. **Outcome:** the commercial value or obligation most relevant now.
4. **Blocker:** one ranked reason progress cannot continue, with recovery.
5. **Work surface:** the content needed to make the current decision.
6. **Evidence:** provenance, freshness, version, delivery, or payment details.
7. **Next action:** one primary action with its consequence named.

Identity, state, outcome, blocker, and next action belong in the first useful
viewport at 390, 768, and 1440 pixels. Evidence detail may collapse; evidence
meaning may not disappear.

## Commercial Primitives

### Commercial object header

Show the event or quote identity, lifecycle state, current value, and one next
action. Tenant and role context remain visible when they affect authority.
Navigation and utility actions stay subordinate.

### Outcome strip

Summarize the result that changes the operator's next decision: quote total,
deposit due, margin evidence, readiness, expiration, customer response, or
version freshness. It must not become a row of decorative metrics.

### Document work surface

The proposal, BEO, quote, or package reads as a document with clear sections
and a stable reading order. Editing controls appear near the affected content;
document authority and staff-only evidence stay distinct from client preview.

### Money stack

Display money in a stable sequence: base items, additions or adjustments,
subtotal, taxes and fees, total, deposit, recorded payment, and balance. Preserve
currency, precision, source, and saved-version context. Staff-only cost and
margin never leak into customer artifacts.

### Commercial state label

Use exact text plus shape or icon; color is reinforcement only. Distinguish
draft, pending, recorded, verified, delivered, settled, accepted, expired,
failed, and unavailable. Similar-looking chips may not collapse different
authority states.

### Option comparison

Use comparable columns or rows for packages and tiers. Hold category order,
price basis, inclusions, exclusions, and consequence labels constant. Recommend
only when the recommendation has an explicit rule; never manufacture urgency.

### Readiness summary

Name what is ready, what blocks progress, and the next recovery action. A score
may summarize known inputs but may not replace the blocking facts or pretend to
be server validation.

### Client preview

Show exactly what the customer will receive, including tenant branding,
commercial terms, version identity, and proposed changes. Keep internal notes,
cost, margin, permissions, and provider metadata out of the preview.

### Action rail

Keep the one primary action reachable as content grows. A sticky rail must yield
to inline editing, the on-screen keyboard, validation, and mobile safe areas.
Secondary actions may not compete through equal color, size, or placement.

### Evidence disclosure

Place source, freshness, calculation, version, delivery, and payment detail
behind a labelled disclosure when it is not needed for the immediate decision.
The visible summary must still state whether the evidence is recorded,
verified, stale, unavailable, or pending.

### Exception notice

Explain the failed or uncertain state, what remains unchanged, and how to
recover. Never display missing source data as zero or convert a provider return
into delivery, settlement, acceptance, or booking evidence.

## Interaction Rules

1. **One context, one primary action.** Label it with the result: `Review quote`,
   `Save draft`, `Send proposal`, `Record payment`, or `Publish current BEO`.
2. **State the boundary before consequential actions.** Say what will change,
   who will see it, and what will not happen yet.
3. **Keep pricing server-authoritative.** Client calculations are previews.
   Stale catalog or version fences block persistence instead of being styled
   away.
4. **Separate intent from evidence.** `Send` is an instruction; `delivered` is a
   verified provider result. `Pay` is an attempt; `settled` is ledger evidence.
5. **Acknowledge immediately and truthfully.** Expose pending, success, failure,
   retry, and recovery states without optimistic completion.
6. **Preserve work across interruption.** Drafts, staged selections, inline
   edits, and unsaved changes need explicit save, cancel, revert, or conflict
   handling.
7. **Restore focus.** Dialogs, sheets, disclosures, and inline edits return
   focus to the initiating control or the next required field.
8. **Disclose progressively.** Lead with outcome and action; retain methods,
   audit history, and provenance on demand.
9. **Use motion only to explain change.** Animate the affected value, state, or
   action relationship; honor reduced motion and never delay task completion.
10. **Make recommendations inspectable.** State the objective and relevant
    evidence. A recommendation never gains mutation authority.

## Visual Contract

- Preserve the existing warm-neutral canvas, ink hierarchy, paper surfaces,
  gold accent, semantic evidence colors, and focus treatment in `src/styles.css`.
- Use Bodoni Moda only for brand or editorial moments, Manrope for working UI,
  and DM Mono for aligned commercial or document evidence.
- Prefer whitespace and hairlines over nested cards. A card must represent a
  distinct object, decision, or temporary layer—not merely group nearby text.
- Preserve the current restrained radius scale. Pills are for compact statuses,
  filters, or binary selections, not every button and container.
- Reserve elevation for menus, dialogs, anchored inspectors, sheets, and other
  genuinely floating surfaces.
- Do not add literal colors or new tokens when an existing semantic token
  expresses the role.
- Do not make gold the only carrier of meaning. Text, structure, and state
  semantics remain available in forced colors and without color perception.

## Staff and Customer Modes

Staff surfaces optimize for control: commercial authority, blockers, margin
evidence, version history, audit context, and recovery. Customer surfaces
optimize for confidence: hospitality, proposal clarity, comparison, terms,
decision consequences, and proof of the customer's own action.

They may share data and brand tokens, but they must not share private fields or
authority. Customer-facing proposal, portal, PDF, and email views never expose
internal cost, margin, notes, permissions, provider internals, or unrelated
client data.

## Responsive Contract

- **390px:** summary before detail; one column; sticky action that does not cover
  editing; dialogs become bounded sheets; comparison may scroll horizontally
  only when preserving column comparison is essential.
- **768px:** preserve the same information order; add a supporting rail only
  when it does not compress the work surface or create duplicate actions.
- **1440px:** constrain line length and working width; use additional space for
  persistent context or preview, not stretched forms and empty dashboards.

At every width, check for document overflow, clipped labels, covered focus
targets, awkward wrapping, unreachable recovery, and pointer targets below 44
pixels. Keyboard-sized mobile viewports are part of the contract.

## Copy and Evidence Language

Use the operator's nouns: event, client, covers, package, menu, services,
proposal, deposit, payment, BEO, version, and booking. Prefer observable state
and consequence:

- `Saved as version 4` instead of `All set`.
- `Delivery pending` instead of `Sent` before provider confirmation.
- `Payment recorded` or `Payment settled` according to the evidence available.
- `Price changed since this draft` instead of `Something went wrong`.
- `Review 2 changes before saving` instead of `Continue`.

Avoid internal architecture terms, generic success copy, fabricated proof,
unsupported growth claims, and labels whose meaning changes by context.

## Acceptance Checklist

A commercial UI change is ready for review only when all applicable answers are
yes:

- Is the commercial object and authoritative state immediately clear?
- Is one next action visually and verbally primary?
- Does the action label describe its consequence?
- Are money, pricing source, version, and freshness represented honestly?
- Are provider attempts separated from verified delivery or settlement?
- Are staff-only and customer-visible fields separated?
- Are pending, unavailable, empty, failure, conflict, and recovery states real?
- Does progressive disclosure reduce noise without hiding a consequential fact?
- Does the result preserve QuotePilot typography, tokens, and component
  conventions rather than importing the reference's identity?
- Does it work with keyboard, screen reader, reduced motion, forced colors, and
  the 390, 768, and 1440 pixel layouts?
- Has the real route been checked without claiming local proof is hosted or
  human acceptance?

## Explicit Rejections

Do not introduce generic card dashboards, cold CRM styling, equal-weight action
clusters, decorative metrics, fake urgency, unexplained scores, autonomous
provider sends, optimistic payment language, giant pill controls, a replacement
slab typeface, or a new yellow-only palette. Those patterns either weaken
QuotePilot's own identity or make commercial truth harder to read.
