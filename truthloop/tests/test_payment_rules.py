import unittest

from quotepilot_truthloop.contracts import Status
from support import finding_for, record_from


class PaymentAmountMismatchTest(unittest.TestCase):
    RULE = "payment_amount_mismatch"

    def test_matching_deposit_is_explained(self):
        self.assertIs(finding_for(record_from(), self.RULE).status, Status.EXPLAINED)

    def test_mismatched_deposit_is_a_discrepancy(self):
        record = record_from(
            {
                "payments": [
                    {
                        "operationId": "op_deposit_1",
                        "paymentKind": "deposit",
                        "amountCents": 460000,
                        "state": "paid",
                        "providerReference": "cs_test_deposit_1042",
                        "providerSettledAtISO": "2026-08-05T18:25:40.000Z",
                    }
                ]
            }
        )
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertEqual(finding.amounts_cents["unexplainedCents"], 20000)
        self.assertIn("$4,800.00", finding.narrative)
        self.assertIn("$4,600.00", finding.narrative)

    def test_without_acceptance_it_is_unverifiable_not_clean(self):
        record = record_from({"acceptedSnapshot": {}})
        self.assertIs(finding_for(record, self.RULE).status, Status.UNVERIFIABLE)


class ChargeIntegrityTest(unittest.TestCase):
    RULE = "missing_or_duplicate_charge"

    def test_single_settled_deposit_is_explained(self):
        self.assertIs(finding_for(record_from(), self.RULE).status, Status.EXPLAINED)

    def test_duplicate_settled_charge_is_a_discrepancy(self):
        record = record_from(
            {
                "payments": [
                    {
                        "operationId": "op_deposit_1",
                        "paymentKind": "deposit",
                        "amountCents": 480000,
                        "state": "paid",
                        "providerReference": "cs_a",
                        "providerSettledAtISO": "2026-08-05T18:25:40.000Z",
                    },
                    {
                        "operationId": "op_deposit_2",
                        "paymentKind": "deposit",
                        "amountCents": 480000,
                        "state": "paid",
                        "providerReference": "cs_b",
                        "providerSettledAtISO": "2026-08-06T18:25:40.000Z",
                    },
                ]
            }
        )
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertEqual(finding.amounts_cents["unexplainedCents"], 480000)
        self.assertIn("2 settled charges", finding.narrative)

    def test_reused_provider_reference_is_a_discrepancy(self):
        record = record_from(
            {
                "payments": [
                    {
                        "operationId": "op_deposit_1",
                        "paymentKind": "deposit",
                        "amountCents": 480000,
                        "state": "paid",
                        "providerReference": "cs_same",
                        "providerSettledAtISO": "2026-08-05T18:25:40.000Z",
                    },
                    {
                        "operationId": "op_final_1",
                        "paymentKind": "final_balance",
                        "amountCents": 1734200,
                        "state": "sent",
                        "providerReference": "cs_same",
                    },
                ]
            }
        )
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertIn("reused", finding.narrative)

    def test_missing_charge_only_counts_once_the_event_is_delivered(self):
        pending = record_from({"payments": []})
        self.assertIs(finding_for(pending, self.RULE).status, Status.EXPLAINED)

        delivered = record_from({"payments": [], "eventCompleted": True})
        finding = finding_for(delivered, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertIn("no settled charge", finding.narrative)


class ProcessorFeeTest(unittest.TestCase):
    RULE = "processor_fee_discrepancy"

    def test_declared_schedule_explains_the_payout_difference(self):
        finding = finding_for(record_from(), self.RULE)
        self.assertIs(finding.status, Status.EXPLAINED)
        self.assertEqual(finding.amounts_cents["explainedFeeCents"], 15720)
        self.assertIn("$157.20 difference matches the expected processing fee", finding.narrative)

    def test_without_a_declared_schedule_the_difference_stays_unexplained(self):
        record = record_from({"processorFeeSchedule": {}})
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertEqual(finding.amounts_cents["unexplainedCents"], 15720)
        self.assertIn("no declared fee schedule", finding.narrative)

    def test_a_fee_beyond_the_schedule_is_a_discrepancy(self):
        record = record_from({"payouts": [
            {
                "providerReference": "cs_test_deposit_1042",
                "grossCents": 480000,
                "netCents": 460000,
                "settledAtISO": "2026-08-07T09:00:00.000Z",
                "payoutReference": "po_1042",
            }
        ]})
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        # $200.00 withheld against a declared $157.20 leaves $42.80.
        self.assertEqual(finding.amounts_cents["unexplainedCents"], 4280)

    def test_tolerance_absorbs_a_one_cent_rounding_difference(self):
        record = record_from(
            {
                "payouts": [
                    {
                        "providerReference": "cs_test_deposit_1042",
                        "grossCents": 480000,
                        "netCents": 464279,
                        "settledAtISO": "2026-08-07T09:00:00.000Z",
                        "payoutReference": "po_1042",
                    }
                ],
                "processorFeeSchedule": {"toleranceCents": 1},
            }
        )
        self.assertIs(finding_for(record, self.RULE).status, Status.EXPLAINED)

    def test_missing_payout_evidence_is_unverifiable(self):
        record = record_from({"payouts": []})
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.UNVERIFIABLE)
        self.assertEqual(finding.evidence[0].node_id, "fact.payment.processor_payout")

    def test_gross_mismatch_outranks_fee_analysis(self):
        record = record_from({"payouts": [
            {
                "providerReference": "cs_test_deposit_1042",
                "grossCents": 470000,
                "netCents": 464280,
                "payoutReference": "po_1042",
            }
        ]})
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertIn("different gross amount", finding.summary)


class ExpectedRevenueTest(unittest.TestCase):
    RULE = "expected_revenue_not_received"

    def test_undelivered_event_with_outstanding_balance_is_on_schedule(self):
        finding = finding_for(record_from(), self.RULE)
        self.assertIs(finding.status, Status.EXPLAINED)
        self.assertIn("not yet due", finding.narrative)

    def test_delivered_event_with_outstanding_balance_is_a_discrepancy(self):
        record = record_from({"eventCompleted": True})
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertEqual(
            finding.amounts_cents["unexplainedCents"],
            finding.amounts_cents["expectedCents"] - 480000,
        )

    def test_fully_paid_delivered_event_is_explained(self):
        record = record_from(
            {
                "eventCompleted": True,
                "payments": [
                    {
                        "operationId": "op_deposit_1",
                        "paymentKind": "deposit",
                        "amountCents": 480000,
                        "state": "paid",
                        "providerReference": "cs_test_deposit_1042",
                        "providerSettledAtISO": "2026-08-05T18:25:40.000Z",
                    },
                    {
                        "operationId": "op_final_1",
                        "paymentKind": "final_balance",
                        "amountCents": 1734200,
                        "state": "paid",
                        "providerReference": "cs_test_final_1042",
                        "providerSettledAtISO": "2026-10-18T18:25:40.000Z",
                    },
                ],
            }
        )
        self.assertIs(finding_for(record, self.RULE).status, Status.EXPLAINED)


if __name__ == "__main__":
    unittest.main()
