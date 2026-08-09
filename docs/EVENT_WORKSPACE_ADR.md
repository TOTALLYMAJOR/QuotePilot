# CWF-16 Event Workspace Architecture Decision

Status: Accepted for source implementation
Date: August 9, 2026

## Context

`/app/quotes/:quoteId` currently opens the entire routed Quotes table and adds a
focused handoff above it. That preserves authority but makes one event feel like
one row in an administration surface. QuotePilot already has bounded quote
history, status semantics, Workflow Attention, trusted edit routing, Schedule,
Customer 360, BEO, dependency state, and Decision Debt contracts.

## Decision

Make the detail route a presentation composition over those existing contracts.
Keep `QuoteHistoryView` as the loader and mutation owner for this first slice,
but render a dedicated `EventWorkspaceView` when an exact `focusQuoteId` is
present. Keep the full table on `/app/quotes` as the administration surface.

No new Firebase contract or persisted event aggregate is introduced. One pure
presentation selector translates the selected quote, existing Workflow summary,
existing proposal-readiness result, and missing-authority facts into
event-workspace sections plus stable reason codes. UI components do not
calculate new commercial authority or operational readiness. Unsupported
Flexibility and Alignment conclusions return explicit unavailable states.

## Rationale

- Reuses the bounded source and existing exact route identity.
- Preserves every mutation gate by leaving dense administration in Quotes.
- Avoids a second event/customer read and avoids a cached denormalized record.
- Lets CWF-17 later replace only the synthesis boundary, not the route shell.

## Alternatives rejected

- **New Event collection/read model:** duplicates mutable quote/customer facts
  before a justified authority contract exists.
- **Restyle the full table:** cannot create the event-first hierarchy or mobile
  scanability shown in the approved concept.
- **New event-wide readiness/flexibility/alignment scores:** manufacture
  precision and cross into CWF-17/CWF-18 without their required facts. Reusing
  the existing proposal-readiness selector is allowed only with a visible
  proposal-completeness boundary.

## Consequences

- The first slice still loads bounded quote history to resolve one record; a
  future server detail read may optimize this only with a separate contract.
- Advanced actions require one click back to Quotes.
- Existing local/Firebase evidence boundaries and role/status semantics remain
  unchanged.
