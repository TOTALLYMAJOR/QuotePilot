"""Customer-request rules: has the accepted record caught up with the customer?"""

from __future__ import annotations

from ..contracts import ChainLink, EvidenceRef, EvidenceStatus, Finding, Severity
from ..model import CommercialRecord
from .base import Rule

REQUEST_NODE = "fact.customer.change_request"
ACCEPTED_SNAPSHOT_NODE = "fact.quote.accepted_revision"
ACTIVE_REVISION_NODE = "fact.quote.active_revision"

#: How a parsed proposal maps onto the accepted snapshot, so the rule can say
#: which accepted value the customer's request contradicts. Item-level kinds
#: are handled separately because they name a list rather than a scalar.
SCALAR_PROPOSAL_FIELDS = {
    "set_guests": ("guests", "guest count"),
    "set_hours": ("hours", "service hours"),
    "set_style": ("style", "service style"),
}

ITEM_LIST_FOR_TYPE = {
    "menuItems": "menu_items",
    "addons": "addons",
    "rentals": "rentals",
}


class AcceptedRecordFreshnessRule(Rule):
    """Detects customer changes not reflected in the accepted record."""

    rule_id = "accepted_record_stale_vs_request"
    chain_link = ChainLink.CUSTOMER_REQUEST
    detects = (
        "A customer change request that postdates, or contradicts, the "
        "accepted quote snapshot."
    )

    def evaluate(self, record: CommercialRecord) -> Finding:
        request = record.customer_request
        snapshot = record.accepted_snapshot

        if not request.present:
            return self.explained(
                "No open customer change request.",
                "The customer has not submitted a change request against this "
                "record.",
                evidence=(
                    EvidenceRef(
                        node_id=REQUEST_NODE,
                        status=EvidenceStatus.ABSENT,
                        source="portal decision record",
                        detail="No change request recorded.",
                    ),
                ),
            )

        evidence = (
            EvidenceRef(
                node_id=REQUEST_NODE,
                # The customer stated this; nobody has verified it against the
                # commercial record yet. That is precisely the point.
                status=EvidenceStatus.DECLARED,
                source="customer portal request",
                detail=(
                    f"request {request.request_id} submitted "
                    f"{request.submitted_at_iso}"
                ),
            ),
            EvidenceRef(
                node_id=ACCEPTED_SNAPSHOT_NODE,
                status=(
                    EvidenceStatus.VERIFIED if snapshot.present else EvidenceStatus.ABSENT
                ),
                source="accepted quote snapshot",
                detail=(
                    f"accepted {snapshot.accepted_at_iso}"
                    if snapshot.present
                    else "Not accepted."
                ),
            ),
            EvidenceRef(
                node_id=ACTIVE_REVISION_NODE,
                status=EvidenceStatus.RECORDED,
                source="quote workflow",
                detail=record.authorized_quote.active_version_id,
            ),
        )

        if not snapshot.present:
            return self.explained(
                "A change request is open on a record that is not yet accepted.",
                (
                    f"Request {request.request_id} is open and there is no accepted "
                    "snapshot to contradict; it will be resolved when the quote is "
                    "accepted."
                ),
                evidence=evidence,
                details={"requestId": request.request_id},
            )

        # Safe as text: the loader canonicalizes every timestamp to UTC with
        # millisecond precision, so lexicographic order is instant order.
        request_is_newer = request.submitted_at_iso > snapshot.accepted_at_iso
        contradictions = self._contradictions(request, snapshot)
        unrecorded = [
            str(proposal.get("id", ""))
            for proposal in request.proposals
            if str(proposal.get("id", "")) not in set(request.recorded_proposal_ids)
        ]

        if not request_is_newer and not contradictions:
            return self.explained(
                "The accepted record already reflects the customer's request.",
                (
                    f"Request {request.request_id} predates the accepted snapshot "
                    "and none of its proposals contradict the accepted values."
                ),
                evidence=evidence,
                details={"requestId": request.request_id},
            )

        parts = []
        if request_is_newer:
            parts.append(
                f"request {request.request_id} was submitted "
                f"{request.submitted_at_iso}, after the snapshot accepted "
                f"{snapshot.accepted_at_iso}"
            )
        if contradictions:
            parts.append("; ".join(contradictions))
        if unrecorded:
            parts.append(
                f"{len(unrecorded)} parsed proposal(s) were never staged into a "
                f"change record ({', '.join(sorted(unrecorded))})"
            )

        return self.discrepancy(
            "A customer change is not reflected in the accepted record.",
            ". ".join(parts) + ".",
            severity=Severity.CRITICAL,
            evidence=evidence,
            details={
                "requestId": request.request_id,
                "decision": request.decision,
                "contradictions": contradictions,
                "unrecordedProposalIds": sorted(unrecorded),
            },
        )

    def _contradictions(self, request, snapshot) -> list[str]:
        """Name each proposal whose value differs from the accepted snapshot."""
        found: list[str] = []
        for proposal in request.proposals:
            kind = str(proposal.get("kind", ""))

            if kind in SCALAR_PROPOSAL_FIELDS:
                attribute, label = SCALAR_PROPOSAL_FIELDS[kind]
                accepted = getattr(snapshot, attribute)
                requested = proposal.get("value")
                if requested is not None and requested != accepted:
                    found.append(
                        f"customer asked for {label} {requested} against an "
                        f"accepted {accepted}"
                    )
                continue

            if kind == "add_staff":
                role = str(proposal.get("field", ""))
                requested_count = proposal.get("count")
                accepted_count = getattr(snapshot, role, None)
                if (
                    accepted_count is not None
                    and isinstance(requested_count, int)
                    and accepted_count < requested_count
                ):
                    found.append(
                        f"customer asked for {requested_count} {role} against an "
                        f"accepted {accepted_count}"
                    )
                continue

            if kind in ("add_item", "remove_item"):
                found.extend(self._item_contradiction(kind, proposal, snapshot))
                continue

            if kind == "swap_item":
                found.extend(
                    self._item_contradiction(
                        "remove_item", proposal.get("remove", {}), snapshot
                    )
                )
                found.extend(
                    self._item_contradiction(
                        "add_item", proposal.get("add", {}), snapshot
                    )
                )
        return found

    def _item_contradiction(self, kind: str, ref, snapshot) -> list[str]:
        item_type = str((ref or {}).get("itemType", ""))
        item_name = str((ref or {}).get("itemName", ""))
        attribute = ITEM_LIST_FOR_TYPE.get(item_type)
        if not attribute or not item_name:
            return []
        accepted_names = {
            str(name).strip().casefold() for name in getattr(snapshot, attribute, ())
        }
        present = item_name.strip().casefold() in accepted_names
        if kind == "add_item" and not present:
            return [f"customer asked to add {item_name}, which the accepted record omits"]
        if kind == "remove_item" and present:
            return [
                f"customer asked to remove {item_name}, which the accepted record "
                "still carries"
            ]
        return []
