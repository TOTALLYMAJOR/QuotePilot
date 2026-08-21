"""Catalog-revision and cost-basis provenance rules."""

from __future__ import annotations

from ..contracts import ChainLink, EvidenceRef, EvidenceStatus, Finding, Severity
from ..model import CommercialRecord
from .base import Rule

CATALOG_NODE = "fact.pricing.catalog_snapshot"
SETTINGS_NODE = "fact.pricing.settings_snapshot"
COST_BASIS_NODE = "fact.pricing.cost_basis"


class StaleCatalogRevisionRule(Rule):
    """Detects old catalog revisions."""

    rule_id = "stale_catalog_revision"
    chain_link = ChainLink.AUTHORIZED_QUOTE
    detects = (
        "A quote priced against a catalog revision older than the "
        "organization's current confirmed revision."
    )
    requires = ("authorizedQuote",)

    def assess(self, record: CommercialRecord) -> Finding:
        authority = record.authorized_quote.catalog_authority
        if not authority.present:
            return self.unverifiable(
                "The quote carries no pricing catalog authority.",
                CATALOG_NODE,
            )
        if record.current_catalog_revision < 0:
            return self.unverifiable(
                "The organization's current catalog revision is unknown.",
                SETTINGS_NODE,
            )

        evidence = (
            EvidenceRef(
                node_id=CATALOG_NODE,
                status=EvidenceStatus.VERIFIED,
                source="pricing catalog authority",
                detail=f"quote priced at revision {authority.catalog_revision}",
            ),
            EvidenceRef(
                node_id=SETTINGS_NODE,
                status=EvidenceStatus.VERIFIED,
                source="organization pricing settings",
                detail=f"current revision {record.current_catalog_revision}",
            ),
        )

        # The quote's own confirmation must match the revision it priced
        # against. A quote priced on an unconfirmed catalog is a stronger
        # problem than a merely superseded one.
        if authority.confirmed_catalog_revision != authority.catalog_revision:
            return self.discrepancy(
                "This quote was priced against an unconfirmed catalog revision.",
                (
                    f"Pricing used catalog revision {authority.catalog_revision}, but "
                    f"the confirmed revision at that time was "
                    f"{authority.confirmed_catalog_revision}."
                ),
                severity=Severity.CRITICAL,
                evidence=evidence,
                details={
                    "quoteCatalogRevision": authority.catalog_revision,
                    "confirmedCatalogRevision": authority.confirmed_catalog_revision,
                },
            )

        drift = record.current_catalog_revision - authority.catalog_revision
        if drift <= 0:
            return self.explained(
                "The quote is priced on the current catalog revision.",
                f"Catalog revision {authority.catalog_revision} is current.",
                evidence=evidence,
            )

        # A superseded catalog on an already-accepted quote is expected: the
        # accepted snapshot is the promise, and the catalog moved on after it.
        # It is reported so margin work reads the right prices, not as a defect
        # in the accepted record.
        accepted = record.accepted_snapshot.present
        return self.discrepancy(
            "This quote was priced on a superseded catalog revision.",
            (
                f"Pricing used catalog revision {authority.catalog_revision}; the "
                f"organization is now on revision {record.current_catalog_revision} "
                f"({drift} revision(s) newer). "
                + (
                    "The accepted snapshot remains the binding promise; recheck the "
                    "cost basis before judging margin."
                    if accepted
                    else "Reprice before sending this quote."
                )
            ),
            severity=Severity.ATTENTION if accepted else Severity.CRITICAL,
            evidence=evidence,
            details={
                "quoteCatalogRevision": authority.catalog_revision,
                "currentCatalogRevision": record.current_catalog_revision,
                "revisionDrift": drift,
                "accepted": accepted,
            },
        )


class ProvisionalCostBasisRule(Rule):
    """Detects quotes using provisional costs."""

    rule_id = "provisional_cost_basis"
    chain_link = ChainLink.ACTUAL_CONTRIBUTION
    detects = (
        "A quote whose contribution rests on provisional or missing cost "
        "evidence rather than recorded costs."
    )
    requires = ("costBasis",)

    def assess(self, record: CommercialRecord) -> Finding:
        basis = record.cost_basis
        if not basis.present:
            return self.unverifiable(
                "No recorded cost evidence accompanies this quote.",
                COST_BASIS_NODE,
            )

        provisional = list(basis.provisional_cost_categories)
        missing = list(basis.missing_cost_categories)

        evidence = (
            EvidenceRef(
                node_id=COST_BASIS_NODE,
                status=(
                    EvidenceStatus.RECORDED
                    if not provisional
                    else EvidenceStatus.INTERPRETED
                ),
                source="commercial snapshot cost evidence",
                detail=(
                    f"{len(basis.planned_cost_cents)} costed categor(ies), "
                    f"{len(provisional)} provisional, {len(missing)} missing"
                ),
            ),
        )

        if not provisional and not missing:
            return self.explained(
                "Every costed category rests on recorded cost evidence.",
                "No provisional or missing cost basis was found.",
                evidence=evidence,
            )

        parts = []
        if provisional:
            parts.append(f"provisional cost basis on {', '.join(sorted(provisional))}")
        if missing:
            parts.append(f"no recorded cost for {', '.join(sorted(missing))}")

        return self.discrepancy(
            "This quote's contribution rests on incomplete cost evidence.",
            (
                "Contribution figures for this record carry "
                + " and ".join(parts)
                + ". Treat the resulting margin as provisional until costs are "
                "recorded."
            ),
            severity=Severity.ATTENTION,
            evidence=evidence,
            details={
                "provisionalCategories": sorted(provisional),
                "missingCategories": sorted(missing),
            },
        )
