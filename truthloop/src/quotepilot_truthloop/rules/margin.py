"""Contribution and margin-completeness rules."""

from __future__ import annotations

from ..contracts import ChainLink, EvidenceRef, EvidenceStatus, Finding, Severity
from ..model import MARGIN_REVENUE_CATEGORIES, REVENUE_CATEGORIES, CommercialRecord
from ..money import format_usd
from .base import Rule

COST_BASIS_NODE = "fact.pricing.cost_basis"
ACCEPTED_SNAPSHOT_NODE = "fact.quote.accepted_revision"
CONSUMPTION_NODE = "fact.operations.actual_consumption"

#: Categories the margin presentation deliberately leaves out, with the reason.
#: ``tax`` is not the operator's revenue; ``travel`` is real revenue that the
#: current model excludes, which is exactly the gap worth surfacing.
EXCLUSION_REASONS = {
    "tax": "tax is collected on behalf of the taxing authority, not revenue",
    "travel": "delivery and travel revenue is outside the current margin model",
}


class MarginCategoryOmissionRule(Rule):
    """Detects margin calculations missing categories."""

    rule_id = "margin_category_omission"
    chain_link = ChainLink.ACTUAL_CONTRIBUTION
    detects = (
        "Accepted revenue categories that carry money but sit outside the "
        "margin model, so reported contribution is incomplete."
    )

    def evaluate(self, record: CommercialRecord) -> Finding:
        snapshot = record.accepted_snapshot
        if not snapshot.present:
            return self.unverifiable(
                "No accepted quote snapshot to measure contribution against.",
                ACCEPTED_SNAPSHOT_NODE,
            )

        totals = snapshot.totals_minor
        included = sum(
            int(totals.get(key, 0)) for key in MARGIN_REVENUE_CATEGORIES
        )
        omitted = {
            key: int(totals.get(key, 0))
            for key in REVENUE_CATEGORIES
            if key not in MARGIN_REVENUE_CATEGORIES and int(totals.get(key, 0)) > 0
        }
        # Tax is a pass-through, so its exclusion is correct and is not a gap.
        reportable = {k: v for k, v in omitted.items() if k != "tax"}

        evidence = (
            EvidenceRef(
                node_id=ACCEPTED_SNAPSHOT_NODE,
                status=EvidenceStatus.VERIFIED,
                source="accepted quote snapshot",
                detail=f"margin basis {format_usd(included)}",
            ),
            EvidenceRef(
                node_id=COST_BASIS_NODE,
                status=(
                    EvidenceStatus.RECORDED
                    if record.cost_basis.present
                    else EvidenceStatus.ABSENT
                ),
                source="commercial snapshot cost evidence",
            ),
        )

        if not reportable:
            return self.explained(
                "The margin basis covers every revenue category on this record.",
                (
                    f"{format_usd(included)} of accepted revenue is inside the margin "
                    "model; only pass-through tax sits outside it."
                ),
                evidence=evidence,
                amounts_cents={"marginBasisCents": included},
            )

        omitted_total = sum(reportable.values())
        described = ", ".join(
            f"{key} ({format_usd(amount)}; {EXCLUSION_REASONS.get(key, 'excluded')})"
            for key, amount in sorted(reportable.items())
        )
        return self.discrepancy(
            "The current margin excludes revenue categories that carry money.",
            (
                f"The margin basis is {format_usd(included)}, but "
                f"{format_usd(omitted_total)} of accepted revenue sits outside it: "
                f"{described}. Contribution on this record is understated until "
                "those categories are costed and included."
            ),
            severity=Severity.ATTENTION,
            evidence=evidence,
            amounts_cents={
                "marginBasisCents": included,
                "omittedRevenueCents": omitted_total,
            },
            details={"omittedCategories": sorted(reportable)},
        )


class RealizedContributionRule(Rule):
    """Detects the gap between estimated and realized contribution."""

    rule_id = "estimated_versus_realized_contribution"
    chain_link = ChainLink.ACTUAL_CONTRIBUTION
    detects = (
        "A delivered event whose realized contribution differs from the "
        "contribution the accepted quote projected."
    )

    def evaluate(self, record: CommercialRecord) -> Finding:
        snapshot = record.accepted_snapshot
        if not snapshot.present:
            return self.unverifiable(
                "No accepted quote snapshot to project contribution from.",
                ACCEPTED_SNAPSHOT_NODE,
            )
        if not record.event_completed:
            return self.explained(
                "Realized contribution is not yet measurable.",
                "The event has not been delivered, so only the projected "
                "contribution exists.",
                evidence=(
                    EvidenceRef(
                        node_id=ACCEPTED_SNAPSHOT_NODE,
                        status=EvidenceStatus.VERIFIED,
                        source="accepted quote snapshot",
                    ),
                ),
            )
        if not record.actual_consumption.present:
            return self.unverifiable(
                "The event is delivered but no actual consumption was recorded.",
                CONSUMPTION_NODE,
            )
        if record.cost_basis.missing_cost_categories:
            return self.unverifiable(
                "Planned cost evidence is incomplete, so projected contribution "
                "cannot be compared to realized contribution.",
                COST_BASIS_NODE,
                details={
                    "missingCategories": sorted(
                        record.cost_basis.missing_cost_categories
                    )
                },
            )

        revenue = sum(
            int(snapshot.totals_minor.get(key, 0))
            for key in MARGIN_REVENUE_CATEGORIES
        )
        planned_cost = sum(record.cost_basis.planned_cost_cents.values())
        actual_cost = record.actual_consumption.total_cents
        projected = revenue - planned_cost
        realized = revenue - actual_cost
        variance = realized - projected

        evidence = (
            EvidenceRef(
                node_id=ACCEPTED_SNAPSHOT_NODE,
                status=EvidenceStatus.VERIFIED,
                source="accepted quote snapshot",
                detail=f"margin basis {format_usd(revenue)}",
            ),
            EvidenceRef(
                node_id=COST_BASIS_NODE,
                status=EvidenceStatus.RECORDED,
                source="commercial snapshot cost evidence",
                detail=f"planned cost {format_usd(planned_cost)}",
            ),
            EvidenceRef(
                node_id=CONSUMPTION_NODE,
                status=EvidenceStatus.RECORDED,
                source="operational consumption record",
                detail=f"actual cost {format_usd(actual_cost)}",
            ),
        )

        amounts = {
            "revenueCents": revenue,
            "projectedContributionCents": projected,
            "realizedContributionCents": realized,
            "contributionVarianceCents": variance,
        }

        if variance == 0:
            return self.explained(
                "Realized contribution matches the projection exactly.",
                f"Projected and realized contribution are both "
                f"{format_usd(projected)}.",
                evidence=evidence,
                amounts_cents=amounts,
            )

        direction = "above" if variance > 0 else "below"
        return self.explained(
            f"Realized contribution came in {direction} the projection.",
            (
                f"Projected contribution was {format_usd(projected)} and realized "
                f"contribution was {format_usd(realized)}, "
                f"{format_usd(abs(variance))} {direction} plan."
            ),
            evidence=evidence,
            amounts_cents=amounts,
        )
