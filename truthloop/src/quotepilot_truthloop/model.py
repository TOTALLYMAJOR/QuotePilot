"""The commercial chain, as read-only evidence.

Field names track the shapes QuotePilot already writes so an exporter is a
projection, not a translation:

* ``AcceptedSnapshot``  -> ``buildSignedProposalSnapshot`` (functions/proposalAcceptance.js)
* ``PaymentEntry``      -> ``normalizePaymentLedgerEntry`` (functions/paymentLedger.js)
* ``CatalogAuthority``  -> ``buildPricingCatalogAuthority`` (functions/pricingEngine.js)
* ``OperationalPlan``   -> ``buildBeoPayload`` (src/lib/beoPayload.js)
* ``CostBasis``         -> ``buildMarginPresentationFromCommercialSnapshot``
                          (src/lib/commercialSnapshot.js)
* ``CustomerRequest``   -> ``quote.portalDecision`` (functions/changeRequestRecord.js)

Everything here is frozen. The reconciler must not be able to edit the record
it is judging.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from .contracts import RESOLVING_AVAILABILITY, Availability

#: Revenue categories carried by an accepted proposal snapshot, in the exact
#: order and naming of ``totalsMinor``.
REVENUE_CATEGORIES = (
    "base",
    "addons",
    "rentals",
    "menu",
    "labor",
    "travel",
    "serviceFee",
    "tax",
)

#: The categories the margin presentation currently divides into. ``travel``
#: and ``tax`` are excluded there by design; that exclusion is what the
#: margin-omission rule reports when a record actually carries those amounts.
MARGIN_REVENUE_CATEGORIES = (
    "base",
    "addons",
    "rentals",
    "menu",
    "labor",
    "serviceFee",
)

PAYMENT_KINDS = ("deposit", "final_balance")
SETTLED_PAYMENT_STATE = "paid"
ACTIVE_PAYMENT_STATES = ("prepared", "sent", "processing")


@dataclass(frozen=True)
class CustomerRequest:
    """The latest customer-stated position, from the portal decision record."""

    request_id: str = ""
    decision: str = ""
    submitted_at_iso: str = ""
    message_sha256: str = ""
    #: Structured proposals parsed from the request, using the kinds in
    #: ``functions/changeRequestRecord.js``.
    proposals: Sequence[Mapping[str, object]] = field(default_factory=tuple)
    recorded_proposal_ids: Sequence[str] = field(default_factory=tuple)

    @property
    def present(self) -> bool:
        return bool(self.request_id and self.submitted_at_iso)


@dataclass(frozen=True)
class CatalogAuthority:
    """The pricing catalog identity stamped onto a quote when it was priced."""

    catalog_revision: int = -1
    confirmed_catalog_revision: int = -1
    settings_fingerprint_sha256: str = ""
    catalog_source: str = ""

    @property
    def present(self) -> bool:
        return self.catalog_revision >= 0 and bool(self.settings_fingerprint_sha256)


@dataclass(frozen=True)
class AuthorizedQuote:
    """The quote as authorized, with the catalog identity that priced it."""

    revision_id: str = ""
    active_version_id: str = ""
    latest_version_number: int = 0
    authorized_at_iso: str = ""
    catalog_authority: CatalogAuthority = field(default_factory=CatalogAuthority)


@dataclass(frozen=True)
class AcceptedSnapshot:
    """The signed proposal snapshot -- the promise the customer accepted."""

    revision_id: str = ""
    accepted_at_iso: str = ""
    totals_minor: Mapping[str, int] = field(default_factory=dict)
    guests: int = 0
    hours: int = 0
    style: str = ""
    menu_items: Sequence[str] = field(default_factory=tuple)
    addons: Sequence[str] = field(default_factory=tuple)
    rentals: Sequence[str] = field(default_factory=tuple)
    servers: int = 0
    chefs: int = 0
    bartenders: int = 0

    @property
    def present(self) -> bool:
        return bool(self.revision_id and self.accepted_at_iso)

    @property
    def total_cents(self) -> int:
        return int(self.totals_minor.get("total", 0))

    @property
    def deposit_cents(self) -> int:
        return int(self.totals_minor.get("deposit", 0))

    @property
    def final_balance_cents(self) -> int:
        return self.total_cents - self.deposit_cents


@dataclass(frozen=True)
class PaymentEntry:
    """One payment ledger operation."""

    operation_id: str
    payment_kind: str
    amount_cents: int
    state: str
    provider_reference: str = ""
    provider_settled_at_iso: str = ""

    @property
    def settled(self) -> bool:
        return self.state == SETTLED_PAYMENT_STATE

    @property
    def active(self) -> bool:
        return self.state in ACTIVE_PAYMENT_STATES


@dataclass(frozen=True)
class ProcessorFeeSchedule:
    """An organization-declared processor fee schedule.

    This is *declared evidence supplied by the operator*, never a rate
    QuotePilot asserts on a processor's behalf. Without it, a payout
    difference stays unexplained -- the reconciler will not back-solve a rate
    from history and then treat that rate as policy.
    """

    percent_basis_points: int = 0
    fixed_cents: int = 0
    tolerance_cents: int = 0
    declared_by: str = ""
    declared_at_iso: str = ""
    label: str = ""

    @property
    def present(self) -> bool:
        return bool(self.declared_at_iso) and (
            self.percent_basis_points > 0 or self.fixed_cents > 0
        )


@dataclass(frozen=True)
class ProcessorPayout:
    """A settlement observed on the processor side."""

    provider_reference: str
    gross_cents: int
    net_cents: int
    settled_at_iso: str = ""
    payout_reference: str = ""

    @property
    def reported_fee_cents(self) -> int:
        return self.gross_cents - self.net_cents


@dataclass(frozen=True)
class OperationalPlan:
    """What operations actually planned to deliver (the BEO projection)."""

    present: bool = False
    source_revision_id: str = ""
    guests: int = 0
    menu_items: Sequence[str] = field(default_factory=tuple)
    addons: Sequence[str] = field(default_factory=tuple)
    rentals: Sequence[str] = field(default_factory=tuple)
    servers: int = 0
    chefs: int = 0
    bartenders: int = 0


@dataclass(frozen=True)
class CostBasis:
    """Recorded cost evidence behind the margin presentation."""

    present: bool = False
    #: Planned cost per revenue category, in cents.
    planned_cost_cents: Mapping[str, int] = field(default_factory=dict)
    #: Categories whose cost evidence is missing, using the
    #: ``missingReason`` vocabulary from ``src/lib/commercialSnapshot.js``.
    missing_cost_categories: Sequence[str] = field(default_factory=tuple)
    #: Cost lines still carrying a provisional (unconfirmed) basis.
    provisional_cost_categories: Sequence[str] = field(default_factory=tuple)
    target_margin_basis_points: int = -1


@dataclass(frozen=True)
class ActualConsumption:
    """What the event actually consumed, once it is known."""

    present: bool = False
    labor_cost_cents: int = 0
    purchasing_cost_cents: int = 0
    other_cost_cents: int = 0
    recorded_at_iso: str = ""

    @property
    def total_cents(self) -> int:
        return self.labor_cost_cents + self.purchasing_cost_cents + self.other_cost_cents


@dataclass(frozen=True)
class OverrunThresholds:
    """Operator-declared tolerance before an overrun is worth an operator's time."""

    labor_basis_points: int = 0
    purchasing_basis_points: int = 0
    minimum_cents: int = 0
    declared_by: str = ""
    declared_at_iso: str = ""

    @property
    def declared(self) -> bool:
        return bool(self.declared_by and self.declared_at_iso)


@dataclass(frozen=True)
class EvidenceSection:
    """One exported evidence section, with its availability and provenance.

    The reconciler keeps the envelope rather than only the parsed value, so a
    blocked rule can say exactly which section blocked it, why, and which
    source the exporter looked at and came up empty.
    """

    section: str
    availability: Availability
    constraint_class: str = "none"
    detail: str = ""
    blocked_by: str = ""
    provenance: Mapping[str, Any] = field(default_factory=dict)
    conflict: Mapping[str, Any] = field(default_factory=dict)

    @property
    def resolves(self) -> bool:
        """True when this section lets a rule reach a verdict."""
        return self.availability in RESOLVING_AVAILABILITY

    def to_dict(self) -> dict[str, Any]:
        return {
            "section": self.section,
            "availability": self.availability.value,
            "constraintClass": self.constraint_class,
            "detail": self.detail,
            "blockedBy": self.blocked_by,
            "provenance": dict(self.provenance),
            "conflict": dict(self.conflict),
        }


#: The section that decides whether a record has a commercial chain at all.
CHAIN_ANCHOR_SECTION = "acceptedSnapshot"


@dataclass(frozen=True)
class CommercialRecord:
    """One event's whole commercial chain."""

    organization_id: str
    quote_id: str
    quote_number: str = ""
    event_date: str = ""
    customer_request: CustomerRequest = field(default_factory=CustomerRequest)
    authorized_quote: AuthorizedQuote = field(default_factory=AuthorizedQuote)
    accepted_snapshot: AcceptedSnapshot = field(default_factory=AcceptedSnapshot)
    payments: Sequence[PaymentEntry] = field(default_factory=tuple)
    payouts: Sequence[ProcessorPayout] = field(default_factory=tuple)
    fee_schedule: ProcessorFeeSchedule = field(default_factory=ProcessorFeeSchedule)
    operational_plan: OperationalPlan = field(default_factory=OperationalPlan)
    cost_basis: CostBasis = field(default_factory=CostBasis)
    actual_consumption: ActualConsumption = field(default_factory=ActualConsumption)
    overrun_thresholds: OverrunThresholds = field(default_factory=OverrunThresholds)
    overrun_policy_evidence: EvidenceSection | None = None
    #: Current organization catalog revision, for staleness comparison.
    current_catalog_revision: int = -1
    #: Whether the event date has passed at evaluation time. Supplied by the
    #: caller so a run is reproducible from its inputs alone.
    event_completed: bool = False
    #: Availability envelope per evidence section, keyed by section name.
    evidence: Mapping[str, EvidenceSection] = field(default_factory=dict)

    def payments_of_kind(self, kind: str) -> list[PaymentEntry]:
        return [p for p in self.payments if p.payment_kind == kind]

    def payout_for(self, provider_reference: str) -> ProcessorPayout | None:
        for payout in self.payouts:
            if payout.provider_reference == provider_reference:
                return payout
        return None

    def section(self, name: str) -> EvidenceSection:
        """The evidence envelope for one section.

        An unexported section is treated as missing rather than as available
        and empty. Fail-closed: a bundle that forgot a section must not read as
        a clean record.
        """
        return self.evidence.get(
            name,
            EvidenceSection(section=name, availability=Availability.MISSING,
                            detail="The bundle did not carry this section."),
        )

    @property
    def chain_started(self) -> bool:
        """False when there is no accepted promise, so nothing to reconcile.

        Reported separately in the run metrics: a draft quote reconciling
        trivially is true but would otherwise flatter the reconciliation rate.
        """
        return self.section(CHAIN_ANCHOR_SECTION).availability is Availability.AVAILABLE
