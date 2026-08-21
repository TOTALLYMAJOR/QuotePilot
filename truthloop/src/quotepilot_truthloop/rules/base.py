"""Shared scaffolding for reconciliation rules.

Every rule answers one question about one record and returns exactly one
``Finding``. Rules never mutate the record, never call out, and never depend on
wall-clock time -- the evaluation instant is an input to the engine, not
something a rule reads.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from ..contracts import (
    AVAILABILITY_REASON_CODES,
    Availability,
    ChainLink,
    EvidenceRef,
    EvidenceStatus,
    Finding,
    ReasonCode,
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
    #: Evidence sections this rule needs, matching
    #: ``docs/truthloop-evidence-contract.json``. A test asserts the two agree.
    requires: tuple[str, ...] = ()

    def evaluate(self, record: CommercialRecord) -> Finding:
        """Gate on evidence availability, then assess.

        Subclasses implement ``assess``, never ``evaluate``. Centralizing the
        gate here means a rule cannot forget to honour an unavailable section
        and quietly report a verdict it had no evidence for.
        """
        blocked = self.blocked_by_evidence(record)
        if blocked is not None:
            return blocked
        inapplicable = self.nothing_to_check(record)
        return inapplicable if inapplicable is not None else self.assess(record)

    def assess(self, record: CommercialRecord) -> Finding:  # pragma: no cover
        raise NotImplementedError

    def blocked_by_evidence(self, record: CommercialRecord) -> Finding | None:
        """Return an unverifiable finding when required evidence cannot resolve.

        Checked in the rule's declared order so the reported blocker is stable
        across runs rather than dependent on dict iteration.
        """
        for section_name in self.requires:
            section = record.section(section_name)
            if section.resolves:
                continue
            reason = AVAILABILITY_REASON_CODES.get(
                section.availability, ReasonCode.EVIDENCE_INCOMPLETE
            )
            return self.unverifiable_section(section_name, section, reason)
        return None

    def nothing_to_check(self, record: CommercialRecord) -> Finding | None:
        """Return an explained finding when a required input cannot apply.

        A rule whose evidence is genuinely inapplicable -- consumption before
        the event, a payout before any charge settles -- has nothing to assess.
        That is a pass, not a blocked record, and deciding it here keeps every
        rule from re-deriving the same judgement from empty values.

        The exporter only marks a section ``not_applicable`` for lifecycle
        reasons, never as a stand-in for evidence it could not obtain.
        """
        for section_name in self.requires:
            section = record.section(section_name)
            if section.availability is not Availability.NOT_APPLICABLE:
                continue
            return self.explained(
                f"There is nothing to check: {section_name} does not apply to this record.",
                section.detail or (
                    f"{section_name} cannot apply at this point in the record's "
                    "lifecycle, so this rule has nothing to assess."
                ),
                evidence=(
                    EvidenceRef(
                        node_id=section.provenance.get("nodeId", "") or section_name,
                        status=EvidenceStatus.ABSENT,
                        source=str(section.provenance.get("sourceObject", "")),
                        detail=section.detail,
                    ),
                ),
                details={"notApplicableSection": section_name},
            )
        return None

    def unverifiable_section(
        self,
        section_name: str,
        section,
        reason: ReasonCode,
    ) -> Finding:
        detail = section.detail or "No detail was supplied by the exporter."
        summary = (
            f"{section_name} evidence is {section.availability.value}, so this rule "
            "cannot reach a verdict."
        )
        return Finding(
            rule_id=self.rule_id,
            chain_link=self.chain_link,
            status=Status.UNVERIFIABLE,
            severity=Severity.ATTENTION,
            summary=summary,
            narrative=detail,
            evidence=(
                EvidenceRef(
                    node_id=section.provenance.get("nodeId", "") or section_name,
                    status=EvidenceStatus.ABSENT,
                    source=str(section.provenance.get("sourceObject", "")),
                    detail=detail,
                ),
            ),
            details={
                "constraintClass": section.constraint_class,
                "provenance": dict(section.provenance),
                **({"conflict": dict(section.conflict)} if section.conflict else {}),
            },
            reason_code=reason,
            blocked_section=section_name,
            blocked_by=section.blocked_by,
        )

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
        reason_code: ReasonCode = ReasonCode.EVIDENCE_INCOMPLETE,
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
            reason_code=reason_code,
        )
