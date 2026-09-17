# Domain Docs

Last updated: 2026-09-16 18:04:49 CDT

QuoteFlow uses the single-context domain-document layout.

## Before exploring

Read:

- `CONTEXT.md` at the repository root when it exists.
- Relevant accepted decisions under `docs/adr/`.
- The canonical authority documents identified by `docs/DOC_SYSTEM.md` and the task orchestration plan.

If `CONTEXT.md` does not exist, proceed silently. Do not create it preemptively. Domain-modeling workflows create it when domain terms are actually resolved.

## Layout

```text
/
├── CONTEXT.md        # Created lazily when a domain glossary is needed
├── docs/adr/         # System-wide architectural decisions
└── src/
```

## Vocabulary

Use terms as defined in `CONTEXT.md`. Do not replace established concepts with convenient synonyms.

If a required concept is absent, first reconsider whether the proposed language matches QuoteFlow. Record a genuine vocabulary gap for domain modeling.

## ADR conflicts

Surface conflicts with accepted ADRs explicitly instead of silently overriding them:

> Contradicts ADR-0007, but may be worth reopening because…
