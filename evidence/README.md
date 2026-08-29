# Commercial Truth Loop evidence exporter

Read-only projection of authoritative QuotePilot records into the canonical
reconciliation bundle consumed by `truthloop/`.

- Architecture decision and authority boundary: [`docs/COMMERCIAL_TRUTH_LOOP_ADR.md`](../docs/COMMERCIAL_TRUTH_LOOP_ADR.md)
- End-to-end walkthrough, supply chain, availability states, provenance, producers: [`docs/COMMERCIAL_TRUTH_LOOP_DESIGN.md`](../docs/COMMERCIAL_TRUTH_LOOP_DESIGN.md) (start at “How it works”)
- Shared rule/evidence contract: [`docs/truthloop-evidence-contract.json`](../docs/truthloop-evidence-contract.json)

## What this is not

It has no write path, no credential, and no network access. It does not read a
clock: the evaluation instant is a required input, which is what makes two runs
over the same source state byte-identical. It does not read Firestore either —
callers supply already-read documents, keeping tenant isolation and role checks
in the tier that already owns them.

## Use

```bash
npm run truthloop:export -- --source <sources.json> \
  --evaluated-at 2026-08-21T14:00:00.000Z --out bundle.json
npm run truthloop:coverage -- --source <sources.json> \
  --evaluated-at 2026-08-21T14:00:00.000Z
```

## Layout

```
src/
  availability.mjs    the availability vocabulary and envelope guards
  provenance.mjs      per-section and per-field provenance stamping
  canonical.mjs       deterministic serialization and digests
  schemaDrift.mjs     refuses source schemas this exporter does not know
  exporterCore.mjs    the pure projection; no I/O
  coverage.mjs        structural and observed evidence coverage
  producers/          payout, fee schedule, and consumption producers
testing/
  authoritativeRecords.mjs  builds documents through the REAL writer modules
  buildFixtures.mjs         generates the reconciler's checked-in fixtures
```

Tests live in `src/lib/__tests__/commercialEvidenceExporter*.test.js` because
vitest only discovers under `src/**`.

## The two rules for a new producer

1. **Return an envelope, never a throw and never a null.** A producer that
   cannot answer must say which of `missing`, `not_applicable`,
   `not_yet_available`, `blocked_by_integration`, `contradictory`, or
   `schema_drift` applies, and carry provenance for the source it consulted.
2. **Never fabricate evidence to make a record reconcile.** That is the single
   failure this whole tier exists to prevent. If a policy value is needed, it is
   an operator declaration with a declaring actor and timestamp — never a rate
   derived from history and applied as policy.
