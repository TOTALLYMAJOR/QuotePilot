"""The reconciliation engine.

Runs every rule against every record and assembles the versioned report. The
engine has no I/O, no clock, and no configuration: the evaluation instant and
the records are both inputs, so two runs over the same bundle produce
byte-identical output.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence

from .contracts import ReconciliationReport, RecordReconciliation
from .model import CommercialRecord
from .rules import RULES, Rule


def reconcile_record(
    record: CommercialRecord,
    evaluated_at_iso: str,
    *,
    rules: Sequence[Rule] = RULES,
) -> RecordReconciliation:
    """Run every rule against one commercial record."""
    return RecordReconciliation(
        organization_id=record.organization_id,
        quote_id=record.quote_id,
        quote_number=record.quote_number,
        evaluated_at_iso=evaluated_at_iso,
        findings=tuple(rule.evaluate(record) for rule in rules),
        has_commercial_chain=record.chain_started,
    )


def reconcile(
    records: Iterable[CommercialRecord],
    evaluated_at_iso: str,
    *,
    rules: Sequence[Rule] = RULES,
    rejected: Sequence[Mapping[str, object]] = (),
) -> ReconciliationReport:
    """Reconcile a batch of records into one report."""
    return ReconciliationReport(
        evaluated_at_iso=evaluated_at_iso,
        records=tuple(
            reconcile_record(record, evaluated_at_iso, rules=rules)
            for record in records
        ),
        rejected=tuple(dict(item) for item in rejected),
    )
