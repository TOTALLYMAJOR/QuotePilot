"""Strict evidence-bundle loading.

The loader is deliberately unforgiving. A field that is present but malformed
rejects the whole record rather than being coerced to a default, because a
default is indistinguishable from real evidence once it reaches a rule -- and
a reconciler that quietly invents a zero will quietly report a clean record.

Rejected records are carried into the report so they count against the
reconciliation rate instead of disappearing.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from .contracts import Availability
from .model import (
    PAYMENT_KINDS,
    AcceptedSnapshot,
    ActualConsumption,
    AuthorizedQuote,
    CatalogAuthority,
    CommercialRecord,
    CostBasis,
    CustomerRequest,
    EvidenceSection,
    OperationalPlan,
    OverrunThresholds,
    PaymentEntry,
    ProcessorFeeSchedule,
    ProcessorPayout,
)
from .money import MoneyError, cents

EVIDENCE_BUNDLE_VERSION = "truthloop-evidence-bundle-v2"

#: Versions this loader once accepted and deliberately no longer does. A known
#: superseded version gets a named drift error instead of a generic one, so an
#: operator sees "this bundle is old" rather than "this bundle is wrong".
SUPERSEDED_BUNDLE_VERSIONS = frozenset({"truthloop-evidence-bundle-v1"})

#: Evidence sections the reconciler understands. A bundle carrying a section
#: outside this set is drift, not extra credit.
KNOWN_SECTIONS = frozenset(
    {
        "customerRequest",
        "authorizedQuote",
        "acceptedSnapshot",
        "payments",
        "payouts",
        "processorFeeSchedule",
        "operationalPlan",
        "costBasis",
        "actualConsumption",
    }
)

ISO_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$"
)
PAYMENT_STATES = frozenset(
    {"prepared", "sent", "processing", "paid", "failed", "expired"}
)


class BundleError(ValueError):
    """Raised when evidence cannot be trusted enough to reconcile."""


def _mapping(value: object, label: str) -> Mapping[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise BundleError(f"{label} must be an object.")
    return value


def _text(value: object, label: str, *, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise BundleError(f"{label} must be a string.")
    normalized = value.strip()
    if required and not normalized:
        raise BundleError(f"{label} is required.")
    return normalized


def _iso(value: object, label: str, *, required: bool = False) -> str:
    """Validate a timestamp and canonicalize it to UTC.

    Rules compare instants, and the bundle format admits both ``Z`` and
    numeric offsets. Two timestamps for the same instant written differently
    do not compare correctly as text, and an offset form compares outright
    wrongly, so normalization happens once here rather than in each rule.
    """
    normalized = _text(value, label, required=required)
    if not normalized:
        return ""
    if not ISO_PATTERN.match(normalized):
        raise BundleError(f"{label} must be an ISO-8601 timestamp.")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise BundleError(f"{label} must be an ISO-8601 timestamp.") from error
    if parsed.tzinfo is None:
        raise BundleError(f"{label} must carry a UTC offset.")
    return (
        parsed.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    )


def _integer(value: object, label: str, *, minimum: int | None = 0) -> int:
    if value is None:
        value = 0
    if isinstance(value, bool) or not isinstance(value, int):
        raise BundleError(f"{label} must be an integer.")
    if minimum is not None and value < minimum:
        raise BundleError(f"{label} must be at least {minimum}.")
    return value


def _cents(value: object, label: str) -> int:
    if value is None:
        value = 0
    try:
        return cents(value, label)
    except MoneyError as error:
        raise BundleError(str(error)) from error


def _sentinel_integer(
    data: Mapping[str, Any], key: str, label: str, default: int
) -> int:
    """Read an integer whose "absent" value is a sentinel rather than zero.

    ``catalogRevision`` uses ``-1`` for absent, so an explicit ``null`` must
    fall back to that sentinel. Coercing it to ``0`` would make an unknown
    revision look like a real revision zero.
    """
    value = data.get(key)
    if value is None:
        return default
    return _integer(value, label, minimum=default)


def _bool(value: object, label: str) -> bool:
    if value is None:
        return False
    if not isinstance(value, bool):
        raise BundleError(f"{label} must be a boolean.")
    return value


def _string_tuple(value: object, label: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise BundleError(f"{label} must be an array of strings.")
    result = []
    for index, item in enumerate(value):
        result.append(_text(item, f"{label}[{index}]"))
    return tuple(result)


def _cents_mapping(value: object, label: str) -> dict[str, int]:
    mapping = _mapping(value, label)
    return {
        _text(key, f"{label} key", required=True): _cents(item, f"{label}.{key}")
        for key, item in mapping.items()
    }


def _customer_request(value: object) -> CustomerRequest:
    data = _mapping(value, "customerRequest")
    if not data:
        return CustomerRequest()
    proposals_value = data.get("proposals")
    proposals: list[Mapping[str, Any]] = []
    if proposals_value is not None:
        if not isinstance(proposals_value, Sequence) or isinstance(
            proposals_value, (str, bytes)
        ):
            raise BundleError("customerRequest.proposals must be an array.")
        for index, proposal in enumerate(proposals_value):
            proposals.append(
                dict(_mapping(proposal, f"customerRequest.proposals[{index}]"))
            )
    return CustomerRequest(
        request_id=_text(data.get("requestId"), "customerRequest.requestId"),
        decision=_text(data.get("decision"), "customerRequest.decision"),
        submitted_at_iso=_iso(
            data.get("submittedAtISO"), "customerRequest.submittedAtISO"
        ),
        message_sha256=_text(
            data.get("messageSha256"), "customerRequest.messageSha256"
        ),
        proposals=tuple(proposals),
        recorded_proposal_ids=_string_tuple(
            data.get("recordedProposalIds"), "customerRequest.recordedProposalIds"
        ),
    )


def _authorized_quote(value: object) -> AuthorizedQuote:
    data = _mapping(value, "authorizedQuote")
    authority = _mapping(data.get("catalogAuthority"), "authorizedQuote.catalogAuthority")
    return AuthorizedQuote(
        revision_id=_text(data.get("revisionId"), "authorizedQuote.revisionId"),
        active_version_id=_text(
            data.get("activeVersionId"), "authorizedQuote.activeVersionId"
        ),
        latest_version_number=_integer(
            data.get("latestVersionNumber"), "authorizedQuote.latestVersionNumber"
        ),
        authorized_at_iso=_iso(
            data.get("authorizedAtISO"), "authorizedQuote.authorizedAtISO"
        ),
        catalog_authority=CatalogAuthority(
            catalog_revision=_sentinel_integer(
                authority, "catalogRevision", "catalogAuthority.catalogRevision", -1
            ),
            confirmed_catalog_revision=_sentinel_integer(
                authority,
                "confirmedCatalogRevision",
                "catalogAuthority.confirmedCatalogRevision",
                -1,
            ),
            settings_fingerprint_sha256=_text(
                authority.get("settingsFingerprintSha256"),
                "catalogAuthority.settingsFingerprintSha256",
            ),
            catalog_source=_text(
                authority.get("catalogSource"), "catalogAuthority.catalogSource"
            ),
        ),
    )


def _accepted_snapshot(value: object) -> AcceptedSnapshot:
    data = _mapping(value, "acceptedSnapshot")
    if not data:
        return AcceptedSnapshot()
    selection = _mapping(data.get("selection"), "acceptedSnapshot.selection")
    staffing = _mapping(data.get("staffing"), "acceptedSnapshot.staffing")
    return AcceptedSnapshot(
        revision_id=_text(data.get("revisionId"), "acceptedSnapshot.revisionId"),
        accepted_at_iso=_iso(
            data.get("acceptedAtISO"), "acceptedSnapshot.acceptedAtISO"
        ),
        totals_minor=_cents_mapping(
            data.get("totalsMinor"), "acceptedSnapshot.totalsMinor"
        ),
        guests=_integer(data.get("guests"), "acceptedSnapshot.guests"),
        hours=_integer(data.get("hours"), "acceptedSnapshot.hours"),
        style=_text(data.get("style"), "acceptedSnapshot.style"),
        menu_items=_string_tuple(
            selection.get("menuItems"), "acceptedSnapshot.selection.menuItems"
        ),
        addons=_string_tuple(
            selection.get("addons"), "acceptedSnapshot.selection.addons"
        ),
        rentals=_string_tuple(
            selection.get("rentals"), "acceptedSnapshot.selection.rentals"
        ),
        servers=_integer(staffing.get("servers"), "acceptedSnapshot.staffing.servers"),
        chefs=_integer(staffing.get("chefs"), "acceptedSnapshot.staffing.chefs"),
        bartenders=_integer(
            staffing.get("bartenders"), "acceptedSnapshot.staffing.bartenders"
        ),
    )


def _payments(value: object) -> tuple[PaymentEntry, ...]:
    if value is None:
        return ()
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise BundleError("payments must be an array.")
    entries = []
    for index, item in enumerate(value):
        data = _mapping(item, f"payments[{index}]")
        kind = _text(data.get("paymentKind"), f"payments[{index}].paymentKind", required=True)
        if kind not in PAYMENT_KINDS:
            raise BundleError(
                f"payments[{index}].paymentKind must be one of {', '.join(PAYMENT_KINDS)}."
            )
        state = _text(data.get("state"), f"payments[{index}].state", required=True).lower()
        if state not in PAYMENT_STATES:
            raise BundleError(f"payments[{index}].state is not a known payment state.")
        entries.append(
            PaymentEntry(
                operation_id=_text(
                    data.get("operationId"), f"payments[{index}].operationId", required=True
                ),
                payment_kind=kind,
                amount_cents=_cents(
                    data.get("amountCents"), f"payments[{index}].amountCents"
                ),
                state=state,
                provider_reference=_text(
                    data.get("providerReference"), f"payments[{index}].providerReference"
                ),
                provider_settled_at_iso=_iso(
                    data.get("providerSettledAtISO"),
                    f"payments[{index}].providerSettledAtISO",
                ),
            )
        )
    return tuple(entries)


def _payouts(value: object) -> tuple[ProcessorPayout, ...]:
    if value is None:
        return ()
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise BundleError("payouts must be an array.")
    payouts = []
    for index, item in enumerate(value):
        data = _mapping(item, f"payouts[{index}]")
        gross = _cents(data.get("grossCents"), f"payouts[{index}].grossCents")
        net = _cents(data.get("netCents"), f"payouts[{index}].netCents")
        if net > gross:
            raise BundleError(
                f"payouts[{index}] reports a net larger than its gross."
            )
        payouts.append(
            ProcessorPayout(
                provider_reference=_text(
                    data.get("providerReference"),
                    f"payouts[{index}].providerReference",
                    required=True,
                ),
                gross_cents=gross,
                net_cents=net,
                settled_at_iso=_iso(
                    data.get("settledAtISO"), f"payouts[{index}].settledAtISO"
                ),
                payout_reference=_text(
                    data.get("payoutReference"), f"payouts[{index}].payoutReference"
                ),
            )
        )
    return tuple(payouts)


def _fee_schedule(value: object) -> ProcessorFeeSchedule:
    data = _mapping(value, "processorFeeSchedule")
    if not data:
        return ProcessorFeeSchedule()
    return ProcessorFeeSchedule(
        percent_basis_points=_integer(
            data.get("percentBasisPoints"), "processorFeeSchedule.percentBasisPoints"
        ),
        fixed_cents=_cents(data.get("fixedCents"), "processorFeeSchedule.fixedCents"),
        tolerance_cents=_cents(
            data.get("toleranceCents"), "processorFeeSchedule.toleranceCents"
        ),
        declared_by=_text(data.get("declaredBy"), "processorFeeSchedule.declaredBy"),
        declared_at_iso=_iso(
            data.get("declaredAtISO"), "processorFeeSchedule.declaredAtISO"
        ),
        label=_text(data.get("label"), "processorFeeSchedule.label"),
    )


def _operational_plan(value: object) -> OperationalPlan:
    data = _mapping(value, "operationalPlan")
    if not data:
        return OperationalPlan()
    selections = _mapping(data.get("selections"), "operationalPlan.selections")
    staffing = _mapping(data.get("staffing"), "operationalPlan.staffing")
    return OperationalPlan(
        present=True,
        source_revision_id=_text(
            data.get("sourceRevisionId"), "operationalPlan.sourceRevisionId"
        ),
        guests=_integer(data.get("guests"), "operationalPlan.guests"),
        menu_items=_string_tuple(
            selections.get("menuItemNames"), "operationalPlan.selections.menuItemNames"
        ),
        addons=_string_tuple(
            selections.get("addons"), "operationalPlan.selections.addons"
        ),
        rentals=_string_tuple(
            selections.get("rentals"), "operationalPlan.selections.rentals"
        ),
        servers=_integer(staffing.get("servers"), "operationalPlan.staffing.servers"),
        chefs=_integer(staffing.get("chefs"), "operationalPlan.staffing.chefs"),
        bartenders=_integer(
            staffing.get("bartenders"), "operationalPlan.staffing.bartenders"
        ),
    )


def _cost_basis(value: object) -> CostBasis:
    data = _mapping(value, "costBasis")
    if not data:
        return CostBasis()
    return CostBasis(
        present=True,
        planned_cost_cents=_cents_mapping(
            data.get("plannedCostCents"), "costBasis.plannedCostCents"
        ),
        missing_cost_categories=_string_tuple(
            data.get("missingCostCategories"), "costBasis.missingCostCategories"
        ),
        provisional_cost_categories=_string_tuple(
            data.get("provisionalCostCategories"), "costBasis.provisionalCostCategories"
        ),
        target_margin_basis_points=_sentinel_integer(
            data, "targetMarginBasisPoints", "costBasis.targetMarginBasisPoints", -1
        ),
    )


def _actual_consumption(value: object) -> ActualConsumption:
    data = _mapping(value, "actualConsumption")
    if not data:
        return ActualConsumption()
    return ActualConsumption(
        present=True,
        labor_cost_cents=_cents(
            data.get("laborCostCents"), "actualConsumption.laborCostCents"
        ),
        purchasing_cost_cents=_cents(
            data.get("purchasingCostCents"), "actualConsumption.purchasingCostCents"
        ),
        other_cost_cents=_cents(
            data.get("otherCostCents"), "actualConsumption.otherCostCents"
        ),
        recorded_at_iso=_iso(
            data.get("recordedAtISO"), "actualConsumption.recordedAtISO"
        ),
    )


def _overrun_thresholds(value: object) -> OverrunThresholds:
    data = _mapping(value, "overrunThresholds")
    if not data:
        return OverrunThresholds()
    defaults = OverrunThresholds()
    return OverrunThresholds(
        labor_basis_points=_sentinel_integer(
            data,
            "laborBasisPoints",
            "overrunThresholds.laborBasisPoints",
            defaults.labor_basis_points,
        ),
        purchasing_basis_points=_sentinel_integer(
            data,
            "purchasingBasisPoints",
            "overrunThresholds.purchasingBasisPoints",
            defaults.purchasing_basis_points,
        ),
        minimum_cents=_sentinel_integer(
            data,
            "minimumCents",
            "overrunThresholds.minimumCents",
            defaults.minimum_cents,
        ),
    )


def _envelope(section: str, value: object) -> tuple[EvidenceSection, object]:
    """Split one evidence envelope into its availability and its value.

    An envelope with no availability is rejected rather than assumed available.
    A bundle that forgot to classify a section is drift, and guessing on its
    behalf is exactly the collapse this contract exists to prevent.
    """
    data = _mapping(value, f"evidence.{section}")
    if not data:
        raise BundleError(f"evidence.{section} is required.")

    raw_availability = _text(
        data.get("availability"), f"evidence.{section}.availability", required=True
    )
    try:
        availability = Availability(raw_availability)
    except ValueError as error:
        raise BundleError(
            f"evidence.{section}.availability is not a known state: {raw_availability}."
        ) from error

    payload = data.get("value")
    if availability is Availability.AVAILABLE and payload is None:
        raise BundleError(f"evidence.{section} is available but carries no value.")
    if availability is not Availability.AVAILABLE and payload is not None:
        raise BundleError(
            f"evidence.{section} is {availability.value} but carries a value."
        )
    if availability is Availability.BLOCKED_BY_INTEGRATION and not _text(
        data.get("blockedBy"), f"evidence.{section}.blockedBy"
    ):
        raise BundleError(
            f"evidence.{section} is blocked by integration but does not name what blocks it."
        )

    envelope = EvidenceSection(
        section=section,
        availability=availability,
        constraint_class=_text(
            data.get("constraintClass"), f"evidence.{section}.constraintClass"
        )
        or "none",
        detail=_text(data.get("detail"), f"evidence.{section}.detail"),
        blocked_by=_text(data.get("blockedBy"), f"evidence.{section}.blockedBy"),
        provenance=dict(_mapping(data.get("provenance"), f"evidence.{section}.provenance")),
        conflict=dict(_mapping(data.get("conflict"), f"evidence.{section}.conflict")),
    )
    return envelope, payload


def _evidence(value: object) -> tuple[dict[str, EvidenceSection], dict[str, object]]:
    data = _mapping(value, "evidence")
    if not data:
        raise BundleError("A record must carry an evidence block.")
    unknown = sorted(set(data) - KNOWN_SECTIONS)
    if unknown:
        raise BundleError(
            "evidence carries sections this reconciler does not know: "
            f"{', '.join(unknown)}."
        )
    missing_sections = sorted(KNOWN_SECTIONS - set(data))
    if missing_sections:
        raise BundleError(
            f"evidence is missing required sections: {', '.join(missing_sections)}."
        )

    envelopes: dict[str, EvidenceSection] = {}
    values: dict[str, object] = {}
    for section in sorted(KNOWN_SECTIONS):
        envelope, payload = _envelope(section, data.get(section))
        envelopes[section] = envelope
        values[section] = payload
    return envelopes, values


def load_record(value: object) -> CommercialRecord:
    """Build one ``CommercialRecord``, or raise ``BundleError``."""
    data = _mapping(value, "record")
    envelopes, values = _evidence(data.get("evidence"))
    return CommercialRecord(
        organization_id=_text(data.get("organizationId"), "organizationId", required=True),
        quote_id=_text(data.get("quoteId"), "quoteId", required=True),
        quote_number=_text(data.get("quoteNumber"), "quoteNumber"),
        event_date=_text(data.get("eventDate"), "eventDate"),
        customer_request=_customer_request(values["customerRequest"]),
        authorized_quote=_authorized_quote(values["authorizedQuote"]),
        accepted_snapshot=_accepted_snapshot(values["acceptedSnapshot"]),
        payments=_payments(values["payments"]),
        payouts=_payouts(values["payouts"]),
        fee_schedule=_fee_schedule(values["processorFeeSchedule"]),
        operational_plan=_operational_plan(values["operationalPlan"]),
        cost_basis=_cost_basis(values["costBasis"]),
        actual_consumption=_actual_consumption(values["actualConsumption"]),
        overrun_thresholds=_overrun_thresholds(data.get("overrunThresholds")),
        current_catalog_revision=_sentinel_integer(
            data, "currentCatalogRevision", "currentCatalogRevision", -1
        ),
        event_completed=_bool(data.get("eventCompleted"), "eventCompleted"),
        evidence=envelopes,
    )


def load_bundle(
    payload: object,
) -> tuple[str, list[CommercialRecord], list[dict[str, Any]]]:
    """Load a whole evidence bundle.

    Returns the evaluation instant, the records that parsed, and a rejection
    entry for each record that did not. Rejections are data, not exceptions:
    one bad record must not hide the other nine hundred.
    """
    data = _mapping(payload, "bundle")
    version = _text(data.get("bundleVersion"), "bundleVersion", required=True)
    if version in SUPERSEDED_BUNDLE_VERSIONS:
        # Named explicitly so the failure reads as drift rather than corruption.
        # The old shape is never coerced into the current one: a v1 bundle
        # cannot distinguish "absent" from "blocked", and reading it as if it
        # could would manufacture reconciliation.
        raise BundleError(
            f"bundleVersion {version} is superseded by {EVIDENCE_BUNDLE_VERSION} and "
            "is not read: it cannot express evidence availability. Re-export."
        )
    if version != EVIDENCE_BUNDLE_VERSION:
        raise BundleError(
            f"bundleVersion must be {EVIDENCE_BUNDLE_VERSION}; received {version}."
        )
    evaluated_at_iso = _iso(
        data.get("evaluatedAtISO"), "evaluatedAtISO", required=True
    )

    raw_records = data.get("records")
    if not isinstance(raw_records, Sequence) or isinstance(raw_records, (str, bytes)):
        raise BundleError("records must be an array.")

    records: list[CommercialRecord] = []
    rejected: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_records):
        try:
            records.append(load_record(raw))
        except BundleError as error:
            identity = raw if isinstance(raw, Mapping) else {}
            rejected.append(
                {
                    "index": index,
                    "quoteId": str(identity.get("quoteId", "")),
                    "organizationId": str(identity.get("organizationId", "")),
                    "reason": str(error),
                }
            )
    return evaluated_at_iso, records, rejected


def load_bundle_json(text: str) -> tuple[str, list[CommercialRecord], list[dict[str, Any]]]:
    """Parse and load a JSON evidence bundle."""
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        raise BundleError(f"Evidence bundle is not valid JSON: {error}") from error
    return load_bundle(payload)


def iter_records(payload: object) -> Iterable[CommercialRecord]:
    """Convenience iterator for callers that do not need rejections."""
    _, records, _ = load_bundle(payload)
    return records
