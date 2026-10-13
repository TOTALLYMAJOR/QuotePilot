"""Operational consumption rules: promise coverage and overruns."""

from __future__ import annotations

from ..contracts import AVAILABILITY_REASON_CODES, Availability, ChainLink, EvidenceRef, EvidenceStatus, Finding, ReasonCode, Severity
from ..model import CommercialRecord
from ..money import apply_basis_points, format_usd
from .base import Rule

ACCEPTED_SNAPSHOT_NODE = "fact.quote.accepted_revision"
PRODUCTION_PLAN_NODE = "artifact.production_plan"
STAFFING_NODE = "output.plan.staffing_requirement"
CONSUMPTION_NODE = "fact.operations.actual_consumption"
COST_BASIS_NODE = "fact.pricing.cost_basis"


def _missing(promised, planned) -> list[str]:
    """Names promised to the customer that the plan does not carry.

    Comparison is case- and whitespace-insensitive because the plan projection
    and the snapshot normalize names differently; it is not fuzzy beyond that,
    so a genuinely renamed item is reported rather than silently matched.
    """
    planned_keys = {str(name).strip().casefold() for name in planned}
    return [
        str(name)
        for name in promised
        if str(name).strip().casefold() not in planned_keys
    ]


class PromiseCoverageRule(Rule):
    """Detects accepted promises absent from operational plans."""

    rule_id = "promise_absent_from_plan"
    chain_link = ChainLink.OPERATIONAL_CONSUMPTION
    detects = (
        "Menu items, add-ons, rentals, staffing, or guest counts the customer "
        "accepted that the operational plan does not carry."
    )
    requires = ("acceptedSnapshot", "operationalPlan",)

    def assess(self, record: CommercialRecord) -> Finding:
        snapshot = record.accepted_snapshot
        if not snapshot.present:
            return self.unverifiable(
                "No accepted quote snapshot to compare the plan against.",
                ACCEPTED_SNAPSHOT_NODE,
            )
        plan = record.operational_plan
        if not plan.present:
            return self.unverifiable(
                "No operational plan exists for this accepted quote.",
                PRODUCTION_PLAN_NODE,
            )

        gaps: list[str] = []
        details: dict[str, object] = {}

        for label, promised, planned in (
            ("menu item", snapshot.menu_items, plan.menu_items),
            ("add-on", snapshot.addons, plan.addons),
            ("rental", snapshot.rentals, plan.rentals),
        ):
            absent = _missing(promised, planned)
            if absent:
                gaps.append(f"{len(absent)} accepted {label}(s) missing: {', '.join(absent)}")
                details[f"missing_{label.replace(' ', '_').replace('-', '_')}s"] = absent

        if plan.guests != snapshot.guests:
            gaps.append(
                f"plan is built for {plan.guests} guests against an accepted "
                f"count of {snapshot.guests}"
            )
            details["acceptedGuests"] = snapshot.guests
            details["plannedGuests"] = plan.guests

        for role, promised_count, planned_count in (
            ("servers", snapshot.servers, plan.servers),
            ("chefs", snapshot.chefs, plan.chefs),
            ("bartenders", snapshot.bartenders, plan.bartenders),
        ):
            if planned_count < promised_count:
                gaps.append(
                    f"plan staffs {planned_count} {role} against an accepted "
                    f"{promised_count}"
                )
                details[f"planned_{role}"] = planned_count
                details[f"accepted_{role}"] = promised_count

        # The plan must also be built from the revision the customer accepted.
        stale_source = (
            plan.source_revision_id
            and snapshot.revision_id
            and plan.source_revision_id != snapshot.revision_id
        )
        if stale_source:
            gaps.append(
                f"plan is built from revision {plan.source_revision_id} but "
                f"revision {snapshot.revision_id} was accepted"
            )
            details["planSourceRevisionId"] = plan.source_revision_id
            details["acceptedRevisionId"] = snapshot.revision_id

        evidence = (
            EvidenceRef(
                node_id=ACCEPTED_SNAPSHOT_NODE,
                status=EvidenceStatus.VERIFIED,
                source="accepted quote snapshot",
                detail=f"revision {snapshot.revision_id}",
            ),
            EvidenceRef(
                node_id=PRODUCTION_PLAN_NODE,
                status=EvidenceStatus.RECORDED,
                source="operational plan projection",
                detail=f"revision {plan.source_revision_id or 'unstamped'}",
            ),
            EvidenceRef(
                node_id=STAFFING_NODE,
                status=EvidenceStatus.RECORDED,
                source="operational plan projection",
            ),
        )

        if not gaps:
            return self.explained(
                "The operational plan carries every accepted promise.",
                "Menu, add-ons, rentals, guest count, and staffing in the plan "
                "match the accepted snapshot.",
                evidence=evidence,
            )

        return self.discrepancy(
            "The operational plan is missing accepted promises.",
            "; ".join(gaps) + ".",
            severity=Severity.CRITICAL,
            evidence=evidence,
            details=details,
        )


class OperationalOverrunRule(Rule):
    """Detects labor or purchasing overruns."""

    rule_id = "operational_overrun"
    chain_link = ChainLink.OPERATIONAL_CONSUMPTION
    detects = (
        "Labor or purchasing consumption beyond the planned cost basis by more "
        "than the declared tolerance."
    )
    requires = ("costBasis", "actualConsumption",)

    def assess(self, record: CommercialRecord) -> Finding:
        actual = record.actual_consumption
        if not actual.present:
            if record.event_completed:
                return self.unverifiable(
                    "The event is delivered but no labor or purchasing "
                    "consumption was recorded.",
                    CONSUMPTION_NODE,
                )
            return self.explained(
                "No consumption to compare yet.",
                "The event has not been delivered, so there is no recorded "
                "labor or purchasing consumption.",
                evidence=(
                    EvidenceRef(
                        node_id=CONSUMPTION_NODE,
                        status=EvidenceStatus.ABSENT,
                        source="operational consumption record",
                        detail="Event not yet delivered.",
                    ),
                ),
            )
        if not record.cost_basis.present:
            return self.unverifiable(
                "Consumption was recorded but there is no planned cost basis to "
                "compare it against.",
                COST_BASIS_NODE,
            )

        policy_evidence = record.overrun_policy_evidence
        if policy_evidence is not None and policy_evidence.availability is not Availability.AVAILABLE:
            return self.unverifiable_section(
                "overrunThresholds", policy_evidence,
                AVAILABILITY_REASON_CODES.get(policy_evidence.availability, ReasonCode.EVIDENCE_INCOMPLETE),
            )
        thresholds = record.overrun_thresholds
        if not thresholds.declared:
            return self.unverifiable(
                "Recorded costs have no explicitly declared overrun tolerance with actor and time evidence.",
                "policy.operations.overrun_tolerance",
            )
        planned = record.cost_basis.planned_cost_cents
        overruns: list[str] = []
        details: dict[str, object] = {}
        total_overrun = 0

        for label, actual_cents, planned_key, threshold_bps in (
            ("Labor", actual.labor_cost_cents, "labor", thresholds.labor_basis_points),
            (
                "Purchasing",
                actual.purchasing_cost_cents,
                "purchasing",
                thresholds.purchasing_basis_points,
            ),
        ):
            planned_cents = int(planned.get(planned_key, 0))
            if planned_cents <= 0:
                # No plan for this category means no overrun can be measured;
                # the provisional-cost rule owns reporting the missing basis.
                continue
            overage = actual_cents - planned_cents
            allowance = max(
                apply_basis_points(planned_cents, threshold_bps),
                thresholds.minimum_cents,
            )
            details[f"{planned_key}PlannedCents"] = planned_cents
            details[f"{planned_key}ActualCents"] = actual_cents
            if overage > allowance:
                total_overrun += overage
                overruns.append(
                    f"{label} recorded costs of {format_usd(actual_cents)} against a planned "
                    f"{format_usd(planned_cents)}, {format_usd(overage)} over "
                    f"(tolerance {format_usd(allowance)})"
                )

        evidence = (
            EvidenceRef(
                node_id="policy.operations.overrun_tolerance",
                status=EvidenceStatus.RECORDED,
                source="operator-declared comparison policy",
                detail=f"declared by {thresholds.declared_by} at {thresholds.declared_at_iso}",
            ),
            EvidenceRef(
                node_id=COST_BASIS_NODE,
                status=EvidenceStatus.RECORDED,
                source="commercial snapshot cost evidence",
            ),
            EvidenceRef(
                node_id=CONSUMPTION_NODE,
                status=EvidenceStatus.RECORDED,
                source="operational consumption record",
                detail=f"recorded {actual.recorded_at_iso or 'without a timestamp'}",
            ),
        )

        if not overruns:
            return self.explained(
                "Labor and purchasing stayed within the declared tolerance.",
                f"Operator-declared costs of {format_usd(actual.total_cents)} are within "
                "tolerance of the planned cost basis.",
                evidence=evidence,
                details=details,
            )

        return self.discrepancy(
            "Labor or purchasing overran the planned cost basis.",
            "; ".join(overruns) + ".",
            severity=Severity.ATTENTION,
            evidence=evidence,
            amounts_cents={"unexplainedCents": total_overrun},
            details=details,
        )
