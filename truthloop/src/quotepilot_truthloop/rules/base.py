"""Shared scaffolding for reconciliation rules.

Every rule answers one question about one record and returns exactly one
``Finding``. Rules never mutate the record, never call out, and never depend on
wall-clock time -- the evaluation instant is an input to the engine, not
something a rule reads.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from ..contracts import (
    ChainLink,
    EvidenceRef,
    EvidenceStatus,
    Finding,
    Severity,
    Status,
)
from ..model import CommercialRecord


class Rule:
    """Base class for a single reconciliation rule."""

    rule_id: str = ""
    chain_link: ChainLink = ChainLink.AUTHORIZED_QUOTE
    #: Human-readable statement of what this rule can detect. Surfaced in the
    #: rule catalog so an operator can see the loop's coverage without reading
    #: source.
    detects: str = ""

    def evaluate(self, record: CommercialRecord) -> Finding:  # pragma: no cover
        raise NotImplementedError

    # -- finding builders -------------------------------------------------

    def explained(
        self,
        summary: str,
        narrative: str,
        *,
        evidence: Sequence[EvidenceRef] = (),
        amounts_cents: Mapping[str, int] | None = None,
        details: Mapping[str, object] | None = None,
    ) -> Finding:
        return Finding(
            rule_id=self.rule_id,
            chain_link=self.chain_link,
            status=Status.EXPLAINED,
            severity=Severity.INFO,
            summary=summary,
            narrative=narrative,
            evidence=tuple(evidence),
            amounts_cents=dict(amounts_cents or {}),
            details=dict(details or {}),
        )

    def discrepancy(
        self,
        summary: str,
        narrative: str,
        *,
        severity: Severity = Severity.ATTENTION,
        evidence: Sequence[EvidenceRef] = (),
        amounts_cents: Mapping[str, int] | None = None,
        details: Mapping[str, object] | None = None,
    ) -> Finding:
        return Finding(
            rule_id=self.rule_id,
            chain_link=self.chain_link,
            status=Status.DISCREPANCY,
            severity=severity,
            summary=summary,
            narrative=narrative,
            evidence=tuple(evidence),
            amounts_cents=dict(amounts_cents or {}),
            details=dict(details or {}),
        )

    def unverifiable(
        self,
        summary: str,
        missing_node_id: str,
        *,
        narrative: str = "",
        details: Mapping[str, object] | None = None,
    ) -> Finding:
        """Report that the rule could not reach a verdict.

        This is not a pass. It leaves the record outside
        ``fullyReconciled`` and names the exact evidence that would close it.
        """
        return Finding(
            rule_id=self.rule_id,
            chain_link=self.chain_link,
            status=Status.UNVERIFIABLE,
            severity=Severity.ATTENTION,
            summary=summary,
            narrative=narrative or (
                f"{summary} Supply {missing_node_id} to reconcile this record."
            ),
            evidence=(
                EvidenceRef(
                    node_id=missing_node_id,
                    status=EvidenceStatus.ABSENT,
                    detail="Required evidence was not present in the bundle.",
                ),
            ),
            details=dict(details or {}),
        )
