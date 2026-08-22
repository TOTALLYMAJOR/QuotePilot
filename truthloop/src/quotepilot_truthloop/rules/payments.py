"""Payment, charge, and processor-payout reconciliation."""

from __future__ import annotations

from ..contracts import ChainLink, EvidenceRef, EvidenceStatus, Finding, Severity
from ..model import PAYMENT_KINDS, CommercialRecord
from ..money import apply_basis_points, format_usd
from .base import Rule

ACCEPTED_SNAPSHOT_NODE = "fact.quote.accepted_revision"
DEPOSIT_NODE = "output.payment.deposit_requirement"
FINAL_BALANCE_NODE = "output.payment.final_balance"
PAYMENT_LEDGER_NODE = "fact.payment.verified_deposit_state"
PAYOUT_NODE = "fact.payment.processor_payout"
FEE_SCHEDULE_NODE = "fact.payment.processor_fee_schedule"


def _obligation_cents(record: CommercialRecord, kind: str) -> int:
    snapshot = record.accepted_snapshot
    return (
        snapshot.deposit_cents if kind == "deposit" else snapshot.final_balance_cents
    )


class PaymentAmountMismatchRule(Rule):
    """Detects payment amount mismatches."""

    rule_id = "payment_amount_mismatch"
    chain_link = ChainLink.PAYMENT_RECEIPT
    detects = "A recorded payment whose amount is not the accepted obligation."
    requires = ("acceptedSnapshot", "payments",)

    def assess(self, record: CommercialRecord) -> Finding:
        if not record.accepted_snapshot.present:
            return self.unverifiable(
                "No accepted quote snapshot to price payments against.",
                ACCEPTED_SNAPSHOT_NODE,
            )

        mismatches = []
        for kind in PAYMENT_KINDS:
            expected = _obligation_cents(record, kind)
            for payment in record.payments_of_kind(kind):
                if payment.amount_cents != expected:
                    mismatches.append((kind, payment, expected))

        if not mismatches:
            return self.explained(
                "Every recorded payment matches its accepted obligation.",
                "Deposit and final-balance amounts equal the accepted quote snapshot.",
                evidence=self._evidence(record),
                amounts_cents={
                    "depositObligationCents": record.accepted_snapshot.deposit_cents,
                    "finalBalanceObligationCents": (
                        record.accepted_snapshot.final_balance_cents
                    ),
                },
            )

        kind, payment, expected = mismatches[0]
        delta = payment.amount_cents - expected
        label = kind.replace("_", " ")
        return self.discrepancy(
            f"A {label} payment does not match the accepted obligation.",
            (
                f"The accepted quote requires a {format_usd(expected)} {label}. "
                f"QuotePilot recorded {format_usd(payment.amount_cents)} on "
                f"operation {payment.operation_id}, a difference of "
                f"{format_usd(abs(delta))}."
            ),
            severity=Severity.CRITICAL,
            evidence=self._evidence(record),
            amounts_cents={
                "expectedCents": expected,
                "recordedCents": payment.amount_cents,
                "unexplainedCents": abs(delta),
            },
            details={
                "paymentKind": kind,
                "operationId": payment.operation_id,
                "additionalMismatches": len(mismatches) - 1,
            },
        )

    def _evidence(self, record: CommercialRecord) -> tuple[EvidenceRef, ...]:
        return (
            EvidenceRef(
                node_id=ACCEPTED_SNAPSHOT_NODE,
                status=EvidenceStatus.VERIFIED,
                source="proposal acceptance snapshot",
                detail=f"revision {record.accepted_snapshot.revision_id}",
            ),
            EvidenceRef(
                node_id=PAYMENT_LEDGER_NODE,
                status=EvidenceStatus.RECORDED,
                source="payment ledger",
                detail=f"{len(record.payments)} operation(s)",
            ),
        )


class ChargeIntegrityRule(Rule):
    """Detects missing or duplicate charges."""

    rule_id = "missing_or_duplicate_charge"
    chain_link = ChainLink.PAYMENT_RECEIPT
    detects = (
        "An obligation with no settled charge, more than one settled charge, "
        "or a provider reference reused across operations."
    )
    requires = ("acceptedSnapshot", "payments",)

    def assess(self, record: CommercialRecord) -> Finding:
        if not record.accepted_snapshot.present:
            return self.unverifiable(
                "No accepted quote snapshot to require charges against.",
                ACCEPTED_SNAPSHOT_NODE,
            )

        duplicates: list[str] = []
        missing: list[str] = []
        seen_references: dict[str, str] = {}

        for kind in PAYMENT_KINDS:
            expected = _obligation_cents(record, kind)
            entries = record.payments_of_kind(kind)
            settled = [p for p in entries if p.settled]
            if len(settled) > 1:
                duplicates.append(
                    f"{kind}: {len(settled)} settled charges "
                    f"({', '.join(p.operation_id for p in settled)})"
                )
            # A zero obligation needs no charge; the event must also be past
            # the point where the charge was due before absence is a finding.
            if expected > 0 and not settled and record.event_completed:
                missing.append(f"{kind}: no settled charge for {format_usd(expected)}")

        for payment in record.payments:
            reference = payment.provider_reference
            if not reference:
                continue
            if reference in seen_references:
                duplicates.append(
                    f"provider reference {reference} reused by "
                    f"{seen_references[reference]} and {payment.operation_id}"
                )
            seen_references[reference] = payment.operation_id

        evidence = (
            EvidenceRef(
                node_id=PAYMENT_LEDGER_NODE,
                status=EvidenceStatus.RECORDED,
                source="payment ledger",
                detail=f"{len(record.payments)} operation(s)",
            ),
            EvidenceRef(
                node_id=DEPOSIT_NODE,
                status=EvidenceStatus.VERIFIED,
                source="accepted quote snapshot",
            ),
            EvidenceRef(
                node_id=FINAL_BALANCE_NODE,
                status=EvidenceStatus.VERIFIED,
                source="accepted quote snapshot",
            ),
        )

        problems = duplicates + missing
        if not problems:
            return self.explained(
                "Charge coverage is exactly one settled charge per obligation.",
                "No duplicate settled charge, reused provider reference, or "
                "overdue uncharged obligation was found.",
                evidence=evidence,
            )

        unexplained = 0
        for kind in PAYMENT_KINDS:
            settled = [p for p in record.payments_of_kind(kind) if p.settled]
            if len(settled) > 1:
                unexplained += sum(p.amount_cents for p in settled[1:])
            elif not settled and record.event_completed:
                unexplained += _obligation_cents(record, kind)

        return self.discrepancy(
            "Charge coverage does not match the accepted obligations.",
            "; ".join(problems) + ".",
            severity=Severity.CRITICAL,
            evidence=evidence,
            amounts_cents={"unexplainedCents": unexplained},
            details={"duplicates": duplicates, "missing": missing},
        )


class ProcessorFeeRule(Rule):
    """Detects processor-fee discrepancies."""

    rule_id = "processor_fee_discrepancy"
    chain_link = ChainLink.PROCESSOR_PAYOUT
    detects = (
        "A gap between a settled charge and the processor payout that the "
        "declared fee schedule does not account for."
    )
    requires = ("payments", "payouts", "processorFeeSchedule",)

    def assess(self, record: CommercialRecord) -> Finding:
        settled = [p for p in record.payments if p.settled and p.provider_reference]
        if not settled:
            return self.explained(
                "No settled charge requires payout reconciliation yet.",
                "The payment ledger holds no settled charge with a provider "
                "reference, so there is no payout to reconcile.",
                evidence=(
                    EvidenceRef(
                        node_id=PAYMENT_LEDGER_NODE,
                        status=EvidenceStatus.RECORDED,
                        source="payment ledger",
                    ),
                ),
            )

        unmatched = [p for p in settled if record.payout_for(p.provider_reference) is None]
        if unmatched:
            return self.unverifiable(
                (
                    f"{len(unmatched)} settled charge(s) have no processor payout "
                    "evidence."
                ),
                PAYOUT_NODE,
                details={
                    "providerReferences": [p.provider_reference for p in unmatched]
                },
            )

        schedule = record.fee_schedule
        explained_total = 0
        unexplained_total = 0
        lines: list[str] = []

        for payment in settled:
            payout = record.payout_for(payment.provider_reference)
            if payout is None:  # unreachable: the unmatched check above returned
                continue

            if payout.gross_cents != payment.amount_cents:
                return self.discrepancy(
                    "A processor payout reports a different gross amount than "
                    "the recorded charge.",
                    (
                        f"QuotePilot recorded {format_usd(payment.amount_cents)} for "
                        f"{payment.provider_reference}, but the processor reports a "
                        f"gross of {format_usd(payout.gross_cents)}."
                    ),
                    severity=Severity.CRITICAL,
                    evidence=self._evidence(record, payout),
                    amounts_cents={
                        "recordedCents": payment.amount_cents,
                        "providerGrossCents": payout.gross_cents,
                        "unexplainedCents": abs(
                            payout.gross_cents - payment.amount_cents
                        ),
                    },
                    details={"providerReference": payment.provider_reference},
                )

            observed_fee = payout.reported_fee_cents
            if observed_fee == 0:
                continue

            if not schedule.present:
                unexplained_total += observed_fee
                lines.append(
                    f"{payment.provider_reference}: "
                    f"{format_usd(observed_fee)} withheld with no declared fee "
                    "schedule to explain it"
                )
                continue

            expected_fee = apply_basis_points(
                payout.gross_cents, schedule.percent_basis_points
            ) + schedule.fixed_cents
            residual = observed_fee - expected_fee
            if abs(residual) <= schedule.tolerance_cents:
                explained_total += observed_fee
                lines.append(
                    f"{payment.provider_reference}: {format_usd(observed_fee)} "
                    "matches the declared processing fee"
                )
            else:
                unexplained_total += abs(residual)
                lines.append(
                    f"{payment.provider_reference}: {format_usd(observed_fee)} "
                    f"withheld against a declared {format_usd(expected_fee)}, "
                    f"leaving {format_usd(abs(residual))} unexplained"
                )

        if unexplained_total == 0:
            narrative = self._reconciled_narrative(record, settled, explained_total)
            return self.explained(
                "Every payout difference is accounted for by the declared fee "
                "schedule.",
                narrative,
                evidence=self._evidence(record, None),
                amounts_cents={"explainedFeeCents": explained_total},
            )

        return self.discrepancy(
            "A processor payout difference is not explained by the declared fee "
            "schedule.",
            "; ".join(lines) + ".",
            severity=Severity.CRITICAL,
            evidence=self._evidence(record, None),
            amounts_cents={
                "explainedFeeCents": explained_total,
                "unexplainedCents": unexplained_total,
            },
            details={"lines": lines},
        )

    def _reconciled_narrative(self, record, settled, explained_total: int) -> str:
        """Reproduce the operator-facing explanation for the common case."""
        if len(settled) == 1 and explained_total > 0:
            payment = settled[0]
            payout = record.payout_for(payment.provider_reference)
            kind = payment.payment_kind.replace("_", " ")
            obligation = _obligation_cents(record, payment.payment_kind)
            return (
                f"The accepted quote requires a {format_usd(obligation)} {kind}. "
                f"QuotePilot recorded a {format_usd(payment.amount_cents)} payment, "
                f"but the processor payout was {format_usd(payout.net_cents)}. "
                f"The {format_usd(explained_total)} difference matches the expected "
                "processing fee."
            )
        return (
            f"{format_usd(explained_total)} withheld across "
            f"{len(settled)} settled charge(s) matches the declared processing fee."
        )

    def _evidence(self, record: CommercialRecord, payout) -> tuple[EvidenceRef, ...]:
        refs = [
            EvidenceRef(
                node_id=PAYMENT_LEDGER_NODE,
                status=EvidenceStatus.RECORDED,
                source="payment ledger",
            ),
            EvidenceRef(
                node_id=PAYOUT_NODE,
                status=EvidenceStatus.VERIFIED,
                source="processor settlement record",
                detail=(
                    payout.payout_reference
                    if payout is not None
                    else f"{len(record.payouts)} payout record(s)"
                ),
            ),
        ]
        schedule = record.fee_schedule
        refs.append(
            EvidenceRef(
                node_id=FEE_SCHEDULE_NODE,
                # Declared, never verified: the operator asserts this schedule.
                # The reconciler does not confirm it against the processor.
                status=(
                    EvidenceStatus.DECLARED if schedule.present else EvidenceStatus.ABSENT
                ),
                source=schedule.declared_by or "organization settings",
                detail=(
                    f"{schedule.percent_basis_points} bps + "
                    f"{format_usd(schedule.fixed_cents)}"
                    if schedule.present
                    else "No fee schedule declared."
                ),
            )
        )
        return tuple(refs)


class ExpectedRevenueRule(Rule):
    """Detects expected revenue that has not been received."""

    rule_id = "expected_revenue_not_received"
    chain_link = ChainLink.PROCESSOR_PAYOUT
    detects = "Accepted revenue with no corresponding settled receipt."
    requires = ("acceptedSnapshot", "payments",)

    def assess(self, record: CommercialRecord) -> Finding:
        snapshot = record.accepted_snapshot
        if not snapshot.present:
            return self.unverifiable(
                "No accepted quote snapshot to expect revenue from.",
                ACCEPTED_SNAPSHOT_NODE,
            )

        expected = snapshot.total_cents
        received = sum(p.amount_cents for p in record.payments if p.settled)
        outstanding = expected - received

        evidence = (
            EvidenceRef(
                node_id=ACCEPTED_SNAPSHOT_NODE,
                status=EvidenceStatus.VERIFIED,
                source="accepted quote snapshot",
                detail=f"total {format_usd(expected)}",
            ),
            EvidenceRef(
                node_id=PAYMENT_LEDGER_NODE,
                status=EvidenceStatus.RECORDED,
                source="payment ledger",
                detail=f"settled {format_usd(received)}",
            ),
        )

        if outstanding <= 0:
            return self.explained(
                "All accepted revenue has been received.",
                f"{format_usd(received)} settled against an accepted total of "
                f"{format_usd(expected)}.",
                evidence=evidence,
                amounts_cents={"expectedCents": expected, "receivedCents": received},
            )

        if not record.event_completed:
            return self.explained(
                "Revenue is still on schedule.",
                f"{format_usd(outstanding)} of {format_usd(expected)} is not yet due; "
                "the event has not been delivered.",
                evidence=evidence,
                amounts_cents={
                    "expectedCents": expected,
                    "receivedCents": received,
                    "scheduledCents": outstanding,
                },
            )

        return self.discrepancy(
            "Accepted revenue has not been received.",
            (
                f"The event is delivered and {format_usd(outstanding)} of the "
                f"{format_usd(expected)} accepted total has no settled receipt."
            ),
            severity=Severity.CRITICAL,
            evidence=evidence,
            amounts_cents={
                "expectedCents": expected,
                "receivedCents": received,
                "unexplainedCents": outstanding,
            },
        )
