# Intent Intake ADR

Status: Accepted architecture for phase-2 source implementation; every runtime
lane is default-off
Date: August 10, 2026
Owner: QuotePilot maintainers
Parent design: [docs/POST_COMPETITIVE_DESIGN.md](POST_COMPETITIVE_DESIGN.md)
(Part 4.3.3, "CREATE — intent in, starting plan out")

## Decision

QuotePilot gains an intent-intake capability: free text (typed, pasted, or
dictated by the operator) is interpreted into a reviewable draft-quote
prefill. The capability is delivered in two lanes with one contract:

1. **Deterministic extraction (browser, always available).** A pure,
   versioned presentation-layer extractor (`intent-extraction-v1`) recognizes
   explicitly stated facts — guest counts with uncertainty phrasing, dates,
   times, durations, contact details, service-style and event-type keywords,
   dietary notes, budget mentions — from the operator's text. It runs
   entirely in the browser on data the operator just typed, performs no I/O,
   and invents nothing: every extracted fact carries the source excerpt it
   came from, a confidence tier, and an applied/needs-confirmation state.
2. **Model-assisted parsing (server, default off).** A future trusted
   callable (`parseIntentDraft`) may upgrade extraction quality using an LLM
   provider (Anthropic Claude API). It is server-owned: the provider key
   lives only in Firebase Secret Manager, bound only to that Function;
   browser code never holds provider credentials or calls a provider
   directly. The callable is governed by an independent server env gate
   (`INTENT_PARSER_ENABLED=false`, provider selector `none` by default) in
   the same posture as the existing Revenue Autopilot and Commercial Change
   gates. Its response uses the same fact/confidence/source-excerpt contract
   as the deterministic lane, so the surface does not change when the lane
   does. When the callable is disabled, unreachable, or slow, the surface
   degrades to the deterministic lane and says so; it never blocks quoting.

## Authority rules (non-negotiable)

- **Parsed output is a draft suggestion, never a record.** Intake prefills
  the same client-side draft form the five-step builder owns today. Quote
  creation authority is unchanged: only the existing trusted create/edit
  callables create or mutate quotes, and they re-price from current tenant
  data server-side. No intake lane writes to Firestore.
- **The operator reviews before anything becomes commercial.** Every applied
  value lands in ordinary editable draft fields. Low-confidence facts are
  not auto-applied; they are offered as one-tap confirmations.
- **No invention.** A fact without a source excerpt in the operator's text
  is not a fact. Absent values stay absent — the builder's existing
  validation and the readiness model already own "what is missing."
- **Honest degradation.** Facts the extractor cannot read remain visible as
  the operator's original text. A budget mention is surfaced as a note ("the
  builder has no budget field yet") rather than silently dropped or mapped
  onto an unrelated field.

## Privacy and tenancy

Intake text is tenant commercial data. The deterministic lane never
transmits it anywhere. The model-assisted lane, when a reviewed release
enables it, sends the intake text to the configured provider strictly for
parsing, stores no provider-side state QuotePilot depends on, and persists
nothing beyond the draft the operator chooses to save through the existing
trusted paths. No cross-tenant learning, retention, or aggregation is
introduced by this ADR. Provider terms review and any customer-facing
disclosure are release-gate concerns recorded in PROJECT_STATUS before the
server gate may be enabled.

## Gates

| Gate | Kind | Default | Meaning |
|---|---|---|---|
| `VITE_PILOT_CREATE_ENABLED` | browser build flag | off | Renders the intake canvas on the new-quote surface; purely presentational |
| `INTENT_PARSER_ENABLED` | server env (future) | `false` | Allows the trusted parse callable to run at all |
| `INTENT_PARSER_PROVIDER` | server env (future) | `none` | Provider selection; `none` keeps the callable deterministic-echo only |

Enabling the browser flag is not a deployment or acceptance decision.
Enabling the server gate additionally requires Secret Manager binding,
provider acceptance evidence, and the existing release governance; none of
that is claimed by this ADR or by source availability.

## Uncertainty (scope boundary for this ADR)

The extractor records uncertainty phrasing ("about 80", "100–130") as
structured facts: value, kind (`exact` | `approximate` | `range`), bounds,
and source excerpt. In phase-2 slice 1 the draft form receives a reviewable
point value (the stated number, or a range's midpoint rounded toward the
operator's phrasing) while the intake summary preserves the band. Carrying
typed uncertainty into the pricing preview (band totals) and, later, into
persisted assumptions is a separate slice with its own contract; nothing in
slice 1 claims band pricing or persisted assumption evidence.

## Rejected alternatives

- **Browser-held provider keys or direct browser→provider calls** — rejected
  outright; violates the repository's credential and authority posture.
- **Parser-created quotes** (parse straight into a Firestore draft) —
  rejected; it would create a second creation authority beside the trusted
  callables and an unreviewed commercial record.
- **A chat interface as the intake surface** — rejected by the parent
  design's character specification; intake is a canvas that structures
  material, not a conversation with a bot persona.
- **Blocking intake on the model lane** — rejected; the deterministic lane
  is the availability floor, and a caterer in a venue hallway with bad
  signal still gets a structured draft.

## Delivery and evidence expectations

Slice 1 (deterministic lane + canvas) is presentation-only source work:
component/selector tests, the existing gates, and CHANGELOG discipline
apply; no capability-surfacing contract is required because no backend
export changes. The future `parseIntentDraft` slice is a backend delivery:
it owns a capability-surfacing contract, callable tests, rules coverage for
any new private records, Feature Matrix and User Manual rows, and the
server gates above, before any hosted enablement question exists.
