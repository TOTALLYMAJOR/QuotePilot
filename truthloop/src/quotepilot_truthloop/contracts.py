"""Versioned output contracts for the Commercial Truth Loop.

The engine emits exactly one artifact shape, ``truthloop-reconciliation-v1``.
Freeform prose is a bounded field inside that contract, never the protocol
itself -- the same rule the Steward decision packet follows
(``docs/STEWARD_ADR.md``, binding decision 4).
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

RECONCILIATION_CONTRACT_VERSION = "truthloop-reconciliation-v1"
FINDING_CONTRACT_VERSION = "truthloop-finding-v1"

#: Stamped on every finding. The reconciler reads evidence and reports; it is
#: never an authority. It cannot price, charge, accept, book, settle, or write.
#: See ``docs/COMMERCIAL_TRUTH_LOOP_ADR.md``.
AUTHORITY = "observation_only"

BOUNDARY = (
    "Commercial Truth Loop findings are read-only staff observations derived "
    "from exported evidence. They are never customer output, accounting truth, "
    "authoritative repricing, or permission to charge, accept, book, or settle."
)


class ChainLink(StrEnum):
    """The commercial chain, in the order value moves through it."""

    CUSTOMER_REQUEST = "customer_request"
    AUTHORIZED_QUOTE = "authorized_quote"
    ACCEPTED_SNAPSHOT = "accepted_snapshot"
    DEPOSIT_OBLIGATION = "deposit_obligation"
    PAYMENT_RECEIPT = "payment_receipt"
    PROCESSOR_PAYOUT = "processor_payout"
    OPERATIONAL_CONSUMPTION = "operational_consumption"
    ACTUAL_CONTRIBUTION = "actual_contribution"


class Status(StrEnum):
    """What the reconciler was able to establish about one rule.

    ``UNVERIFIABLE`` is deliberately distinct from ``EXPLAINED``. A record
    missing its payout evidence is not reconciled; counting it as reconciled
    would corrupt the one metric this system exists to produce.
    """

    EXPLAINED = "explained"
    DISCREPANCY = "discrepancy"
    UNVERIFIABLE = "unverifiable"


class Severity(StrEnum):
    INFO = "info"
    ATTENTION = "attention"
    CRITICAL = "critical"


class Availability(StrEnum):
    """How the exporter classified one evidence section.

    "We do not have it" is never one thing. A payout blocked by an unshipped
    integration, a fee schedule nobody has declared, and consumption that will
    exist after the event are three different operator instructions, and
    collapsing them into a null destroys the only signal that says whether the
    next move is engineering, integration, or a business decision.
    """

    AVAILABLE = "available"
    MISSING = "missing"
    NOT_APPLICABLE = "not_applicable"
    NOT_YET_AVAILABLE = "not_yet_available"
    BLOCKED_BY_INTEGRATION = "blocked_by_integration"
    CONTRADICTORY = "contradictory"
    SCHEMA_DRIFT = "schema_drift"


class ReasonCode(StrEnum):
    """Machine-readable cause for an unverifiable verdict.

    Stable identifiers so a future operator surface can group, route, and
    explain blocked records without parsing prose.
    """

    NONE = ""
    EVIDENCE_MISSING = "evidence_missing"
    EVIDENCE_NOT_YET_AVAILABLE = "evidence_not_yet_available"
    EVIDENCE_BLOCKED_BY_INTEGRATION = "evidence_blocked_by_integration"
    EVIDENCE_CONTRADICTORY = "evidence_contradictory"
    EVIDENCE_SCHEMA_DRIFT = "evidence_schema_drift"
    EVIDENCE_INCOMPLETE = "evidence_incomplete"


#: Availability states that let a rule reach a verdict. ``NOT_APPLICABLE``
#: qualifies because there is genuinely nothing to check, which is a pass, not
#: a blocked record.
RESOLVING_AVAILABILITY = frozenset(
    {Availability.AVAILABLE, Availability.NOT_APPLICABLE}
)

#: Availability state -> the reason an operator is shown when it blocks a rule.
AVAILABILITY_REASON_CODES = {
    Availability.MISSING: ReasonCode.EVIDENCE_MISSING,
    Availability.NOT_YET_AVAILABLE: ReasonCode.EVIDENCE_NOT_YET_AVAILABLE,
    Availability.BLOCKED_BY_INTEGRATION: ReasonCode.EVIDENCE_BLOCKED_BY_INTEGRATION,
    Availability.CONTRADICTORY: ReasonCode.EVIDENCE_CONTRADICTORY,
    Availability.SCHEMA_DRIFT: ReasonCode.EVIDENCE_SCHEMA_DRIFT,
}


class EvidenceStatus(StrEnum):
    """How strongly a single input is attested.

    Mirrors the evidence vocabulary the product already uses for customer
    facts: a value a customer stated is not the same kind of thing as a value
    an operator interpreted, and neither is a verified provider record.
    """

    VERIFIED = "verified"
    RECORDED = "recorded"
    DECLARED = "declared"
    INTERPRETED = "interpreted"
    ABSENT = "absent"


@dataclass(frozen=True)
class EvidenceRef:
    """A pointer to the exact input a finding was derived from.

    ``node_id`` reuses the canonical dependency-graph vocabulary in
    ``functions/commercialDependencyGraphCore.cjs`` (``fact.*`` / ``output.*``)
    so a finding can be traced back to a node the rest of the system already
    names, rather than to a private label invented here.
    """

    node_id: str
    status: EvidenceStatus
    source: str = ""
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "nodeId": self.node_id,
            "evidenceStatus": self.status.value,
            "source": self.source,
            "detail": self.detail,
        }


@dataclass(frozen=True)
class Finding:
    """One rule's verdict on one commercial record."""

    rule_id: str
    chain_link: ChainLink
    status: Status
    severity: Severity
    summary: str
    narrative: str
    evidence: Sequence[EvidenceRef] = field(default_factory=tuple)
    amounts_cents: Mapping[str, int] = field(default_factory=dict)
    details: Mapping[str, Any] = field(default_factory=dict)
    #: Populated for unverifiable findings so a surface can route them without
    #: parsing prose. Empty for explained and discrepancy findings.
    reason_code: ReasonCode = ReasonCode.NONE
    #: The evidence section that blocked the verdict, when one did.
    blocked_section: str = ""
    #: What blocks it, for integration-blocked evidence.
    blocked_by: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "contractVersion": FINDING_CONTRACT_VERSION,
            "authority": AUTHORITY,
            "ruleId": self.rule_id,
            "chainLink": self.chain_link.value,
            "status": self.status.value,
            "severity": self.severity.value,
            "summary": self.summary,
            "narrative": self.narrative,
            "evidence": [ref.to_dict() for ref in self.evidence],
            "amountsCents": dict(self.amounts_cents),
            "details": dict(self.details),
            "reasonCode": self.reason_code.value,
            "blockedSection": self.blocked_section,
            "blockedBy": self.blocked_by,
        }


@dataclass(frozen=True)
class RecordReconciliation:
    """Every rule's verdict for one commercial record, plus its roll-up."""

    organization_id: str
    quote_id: str
    quote_number: str
    evaluated_at_iso: str
    findings: Sequence[Finding]
    #: False when the record has no accepted promise, so there is no commercial
    #: chain to reconcile. Such a record can reconcile trivially, which is true
    #: but would otherwise flatter the rate, so the run metrics segment it.
    has_commercial_chain: bool = True

    @property
    def discrepancies(self) -> list[Finding]:
        return [f for f in self.findings if f.status is Status.DISCREPANCY]

    @property
    def unverifiable(self) -> list[Finding]:
        return [f for f in self.findings if f.status is Status.UNVERIFIABLE]

    @property
    def fully_reconciled(self) -> bool:
        """True only when every rule reached an explained verdict.

        Fail-closed by construction: a rule that could not run leaves the
        record unreconciled.
        """
        return bool(self.findings) and not self.discrepancies and not self.unverifiable

    @property
    def chain_started(self) -> bool:
        """Whether this record has an accepted promise to reconcile at all."""
        return self.has_commercial_chain

    @property
    def blocked_reason_codes(self) -> dict[str, int]:
        """Machine-readable causes of every unverifiable verdict on this record."""
        tally: dict[str, int] = {}
        for finding in self.unverifiable:
            key = finding.reason_code.value or ReasonCode.EVIDENCE_INCOMPLETE.value
            tally[key] = tally.get(key, 0) + 1
        return dict(sorted(tally.items()))

    @property
    def unexplained_amount_cents(self) -> int:
        """Total money this run could not account for on this record."""
        return sum(
            int(f.amounts_cents.get("unexplainedCents", 0))
            for f in self.discrepancies
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "organizationId": self.organization_id,
            "quoteId": self.quote_id,
            "quoteNumber": self.quote_number,
            "evaluatedAtISO": self.evaluated_at_iso,
            "fullyReconciled": self.fully_reconciled,
            "discrepancyCount": len(self.discrepancies),
            "unverifiableCount": len(self.unverifiable),
            "unexplainedAmountCents": self.unexplained_amount_cents,
            "chainStarted": self.chain_started,
            "blockedReasonCodes": self.blocked_reason_codes,
            "findings": [f.to_dict() for f in self.findings],
        }


@dataclass(frozen=True)
class ReconciliationReport:
    """The engine's whole-run artifact."""

    evaluated_at_iso: str
    records: Sequence[RecordReconciliation]
    rejected: Sequence[Mapping[str, Any]] = field(default_factory=tuple)

    @property
    def metrics(self) -> dict[str, Any]:
        """The success metrics this capability is measured by.

        Rejected bundles count against the denominator. A record the loader
        refused to parse is an unreconciled record, not an absent one.
        """
        total = len(self.records) + len(self.rejected)
        reconciled = sum(1 for r in self.records if r.fully_reconciled)
        return {
            "recordsEvaluated": total,
            "recordsFullyReconciled": reconciled,
            "recordsRejected": len(self.rejected),
            "fullyReconciledBasisPoints": (
                (reconciled * 10_000) // total if total else 0
            ),
            "openDiscrepancies": sum(len(r.discrepancies) for r in self.records),
            "unverifiableFindings": sum(len(r.unverifiable) for r in self.records),
            "unexplainedAmountCents": sum(
                r.unexplained_amount_cents for r in self.records
            ),
            # A draft quote with no accepted promise reconciles trivially.
            # That is true, and reporting it without this segment would make
            # the headline rate look better than the business is.
            "recordsWithoutCommercialChain": sum(
                1 for r in self.records if not r.chain_started
            ),
            "recordsFullyReconciledWithChain": sum(
                1 for r in self.records if r.fully_reconciled and r.chain_started
            ),
            "blockedReasonCodes": self._reason_code_tally(),
        }

    def _reason_code_tally(self) -> dict[str, int]:
        """Every unverifiable cause across the run, for operator routing."""
        tally: dict[str, int] = {}
        for record in self.records:
            for code, count in record.blocked_reason_codes.items():
                tally[code] = tally.get(code, 0) + count
        return dict(sorted(tally.items()))

    def to_dict(self) -> dict[str, Any]:
        return {
            "contractVersion": RECONCILIATION_CONTRACT_VERSION,
            "authority": AUTHORITY,
            "boundary": BOUNDARY,
            "evaluatedAtISO": self.evaluated_at_iso,
            "metrics": self.metrics,
            "records": [r.to_dict() for r in self.records],
            "rejected": [dict(item) for item in self.rejected],
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, sort_keys=True)
