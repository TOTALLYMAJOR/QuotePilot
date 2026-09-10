# Commercial Dependency Graph Architecture Decision

Last updated: 2026-09-10 12:09:03 CDT

Status: Accepted CWF-15A foundation; amended for current authoritative consumers
Date: August 9, 2026
Decision owners: QuotePilot maintainers

## Context

QuotePilot already has authoritative pricing, immutable quote versions,
provider-bound delivery, customer decisions, payments, booking, scheduling,
production checklists, and Kitchen BEO export. Those capabilities currently
react to changes independently. The product needs one deterministic contract
that can answer which commercial and operational outputs depend on a changed
fact without becoming a second pricing engine or a new source of truth.

The first CWF-15A implementation was deliberately narrow: a browser-generated
Kitchen BEO used the graph and fingerprint only as download-time provenance.
That original browser fingerprint still cannot prove retained freshness, actor
identity, server generation time, operational completion, or publication.

The current source now has separately governed consumers: Commercial Change
Authority, trusted Kitchen BEO generation/receipt/download, dependency
invalidation/reconciliation, and Decision Debt. Those consumers do not expand
the graph's authority. They reload canonical server data and create their own
versioned private receipts under `docs/COMMERCIAL_CHANGE_AUTHORITY_ADR.md`.

## Decision

Adopt a versioned, deterministic Commercial Dependency Graph as a pure platform
contract. Dependency edges describe which nodes consume other nodes. Graph
evaluation traverses downstream consequences only; it does not calculate
prices, mutate records, infer evidence, or decide that publication is safe.

CWF-15A consists of:

1. a versioned registry and validator;
2. deterministic downstream traversal with cycle and unknown-node rejection;
3. an internal canonical JSON contract and SHA-256 browser/Node parity fixture;
4. a Kitchen BEO input adapter and visible download-time fingerprint; and
5. no persistence, receipt, invalidation, reconciliation, or publication
   mutation.

## Registry ownership and schema evolution

The registry is owned as reviewed application source. Version 1 uses:

```js
{
  schemaVersion: 1,
  graphId: "quotepilot-commercial",
  graphVersion: "commercial-dependency-graph-v1",
  nodes: [
    {
      id: "fact.event.guest_count",
      kind: "fact",
      dependsOn: []
    },
    {
      id: "output.pricing.authoritative_total",
      kind: "output",
      dependsOn: ["fact.event.guest_count"]
    }
  ]
}
```

Allowed node kinds are `fact`, `output`, `artifact`, and `projection`.
`dependsOn` points upstream. Node IDs and dependencies are unique. Validation
rejects unsupported schema or graph versions, malformed records, duplicate
nodes, unknown dependencies, and cycles before evaluation.

An existing graph version is immutable after release. Adding or changing a
node or edge requires a new graph version and parity fixtures. Readers must
reject unsupported versions rather than partially interpret them. A future
compatibility adapter may map an older complete version to a newer one, but it
must be explicit, tested, and must not rewrite retained evidence in place.

## Deterministic traversal

Evaluation accepts one or more changed fact/node IDs, deduplicates and sorts
them, validates the complete registry, builds a reverse dependency index, and
traverses downstream. Results contain affected node ID, kind, minimum distance,
and the changed seeds that reach it. Changed seeds are not returned as their own
dependents. Results are ordered by minimum distance and then node ID.

Evaluation returns topology only. It contains no total, payment delta,
invalidation state, task completion, freshness conclusion, or safe-to-publish
decision.

## Canonical serialization and hashing

Fingerprint input uses the internal `qp-canonical-json-v1` contract. It is not
claimed to implement RFC 8785.

- Accepted values: `null`, booleans, strings, finite numbers, arrays, and plain
  objects.
- Object keys sort by JavaScript UTF-16 lexical order.
- Array order is preserved because selection and operational display order can
  be meaningful.
- Strings and finite numbers use `JSON.stringify` escaping/rendering.
- Negative zero normalizes to zero.
- `undefined`, sparse arrays, functions, symbols, bigint, non-finite numbers,
  cyclic references, dates, maps, sets, and class instances fail closed.
- Generic serialization performs no trimming or Unicode normalization. An
  artifact adapter owns its field-specific normalization.
- The canonical string is encoded as UTF-8 and hashed with SHA-256 to a
  lowercase 64-character hexadecimal digest.
- The browser adapter uses Web Crypto and fails closed when unavailable. The
  Node parity test uses `node:crypto` over the same canonical bytes.

## Pricing and evidence authority

The graph may consume server-authoritative pricing outputs as dependent facts;
it must never reimplement or adjust pricing. Only existing trusted quote-write
paths may establish authoritative totals and immutable quote versions.

A matching fingerprint proves only that the declared, normalized inputs are
byte-equivalent under the named schema. A trusted artifact service may combine
that match with an immutable successful server receipt and the absence of named
open invalidations to classify freshness, but the fingerprint alone does not
prove:

- provider acceptance, delivery, bounce, or recipient view;
- customer acceptance, decline, or requested changes;
- booking, payment, refund, or accounting revenue;
- artifact review, publication, operational completion, or currentness.

## Kitchen BEO provenance in CWF-15A

The BEO fingerprint covers the complete normalized BEO payload used for the
download, excluding its revision display block and the fingerprint itself. The
fingerprint document names its artifact type, graph version, input-schema
version, declared dependency nodes, and normalized inputs.

Commercial source revision resolves in this order:

1. canonical `activeVersionId`;
2. matching `versionMeta.versionId`;
3. a legacy number-only display label; or
4. explicit `legacy-unversioned`.

When `activeVersionId` and `versionMeta.versionId` differ, the active pointer is
the commercial source revision. Version creation time is omitted unless the
metadata describes that same revision. This is not an error: mutable booking
and production overlays can legitimately change after the commercial version
was activated.

The generated PDF includes the full fingerprint, graph and input-schema
versions, commercial source revision, and this disclaimer:

> Identifies the declared inputs used for this download. It is not retained
> freshness or completion evidence.

The browser persists none of this metadata. The UI and document must not use
`CURRENT`, `STALE`, `REVIEW`, receipt, or trusted-generation language in CWF-15A.

## Authoritative consumers and retained evidence

The current source implements the previously deferred authority through a
separate accepted architecture decision rather than by mutating this graph
contract:

- `simulateCommercialQuoteChange` reloads the exact quote, invokes existing
  authoritative pricing, evaluates graph impact, and writes an immutable
  simulation receipt without changing the quote.
- Sales may request and tenant admins may grant exact authorization. The
  existing trusted edit transaction can consume that still-current evidence
  and atomically write the quote/version, apply receipt, dependency state, and
  named invalidations. Both global and tenant enforcement gates remain
  independently default-off.
- `generateKitchenBeo` reloads canonical data, recomputes declared inputs and
  fingerprint, generates server PDF bytes, and binds actor/time/revision/schema/
  byte evidence in an immutable receipt. `downloadKitchenBeoReceipt` returns the
  exact retained bytes for a named current or prior receipt; it never regenerates
  history from today's quote. Generation replay and its final response both
  require strict base64 and exact agreement with the immutable receipt's stored
  byte length and SHA-256 digest.
- Kitchen BEO freshness requires the trusted receipt plus canonical fingerprint/
  revision comparison and qualifying invalidation state. It reports `CURRENT`,
  `STALE`, `REVIEW`, `NOT_GENERATED`, or `UNKNOWN` without turning the graph
  itself into freshness authority. `CURRENT` follows the current-artifact
  pointer to that exact immutable receipt and revalidates its retained bytes
  before deriving freshness.
- Dependency reconciliation resolves only exact named open invalidations under
  an allowed evidence class and creates a new immutable receipt. Derived
  `safeToPublish` remains eligibility only and performs no publication.
- Decision Debt reads persisted unresolved state and applies a versioned,
  bounded, non-predictive formula; it does not add graph edges or resolve nodes.

Browser-supplied digest, source revision, actor, time, payload, bytes, payment,
provider, or completion claims never become trusted evidence. Neither
generation nor reconciliation silently overwrites accepted versions, contracts,
payment/provider evidence, portal decisions, prior artifacts, or prior receipts.
The detailed transaction, role, UI, and recovery contracts live in
`docs/COMMERCIAL_CHANGE_AUTHORITY_ADR.md` and its linked design/UI documents.

## Security and productization

- No customer or quote content is placed in URLs or browser storage.
- The registry contains no tenant data, tokens, claims, secrets, or provider
  records.
- BEO status, generation, current/prior receipt download, and dependency state
  remain on staff-gated Quote record actions.
- The CWF-15A graph module itself adds no callable, Firestore write, rule, index,
  or pricing path. Its newer consumers have separately reviewed callable,
  transaction, rule, UI-state, Feature Matrix, and User Manual contracts.
- The CWF-14 manifest binds the pure graph and each user-relevant authoritative
  consumer independently, so a source helper cannot hide an orphan mutation.
- Local parity/unit/emulator/build/browser evidence remains distinct from
  deployed receipts, hosted operator acceptance, production data, gate
  promotion, and human acceptance.

## Rejected alternatives

- A second pricing calculator inside the graph: rejected because it would split
  commercial authority.
- Persisting browser-generated fingerprints as receipt truth: rejected because
  the browser does not own actor, time, tenant record, or generation authority.
- Fingerprinting only an immutable quote version: rejected for CWF-15A because
  the current BEO also consumes mutable operational overlays.
- Generic stable-stringify packages: deferred; the small explicit contract has
  a narrower attack and compatibility surface and requires no dependency.
- Treating a fingerprint match as freshness: rejected because undeclared
  dependencies, review, publication, and external evidence remain separate.

## CWF-15A acceptance criteria

- The production registry validates and cannot be mutated by evaluation.
- Guest-count, event-time, and accepted-revision changes traverse to exact
  deterministic descendants.
- Unknown nodes, unknown dependencies, unsupported versions, invalid canonical
  values, and cycles fail with stable error codes.
- Browser and Node parity fixtures produce identical canonical bytes, SHA-256,
  and traversal results.
- Relevant normalized BEO inputs change the digest; unrelated portal, workflow,
  conversation, and payment fields do not.
- The downloaded PDF contains the exact source revision, schemas, full digest,
  and proof-boundary disclaimer.
- No quote/version write, retained receipt, freshness state, or new authority is
  introduced by the CWF-15A graph/fingerprint module itself. Current authoritative
  consumers are specified and verified separately.

## Amendment history

| Date | Change |
|---|---|
| August 9, 2026 | Preserved the pure CWF-15A decision and documented the separately governed current Commercial Change, Kitchen BEO, reconciliation, and Decision Debt consumers. |
