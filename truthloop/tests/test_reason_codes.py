"""Every unverifiable verdict must carry a machine-readable cause.

A future operator surface has to group and route blocked records without
parsing prose, and an operator has to be able to tell "we are waiting on
Stripe" from "nobody has set a fee schedule" from "that data is gone".
"""

import unittest

from quotepilot_truthloop.contracts import ReasonCode, Status
from quotepilot_truthloop.engine import reconcile, reconcile_record
from quotepilot_truthloop.loader import KNOWN_SECTIONS, load_bundle
from support import current_state_bundle, finding_for, record_from

INSTANT = "2026-08-21T14:00:00.000Z"


class ReasonCodeTest(unittest.TestCase):
    RULE = "processor_fee_discrepancy"

    def _blocked(self, availability: str):
        return finding_for(record_from(unavailable={"payouts": availability}), self.RULE)

    def test_missing_evidence(self):
        finding = self._blocked("missing")
        self.assertIs(finding.status, Status.UNVERIFIABLE)
        self.assertIs(finding.reason_code, ReasonCode.EVIDENCE_MISSING)
        self.assertEqual(finding.blocked_section, "payouts")

    def test_not_yet_available_evidence(self):
        finding = self._blocked("not_yet_available")
        self.assertIs(finding.reason_code, ReasonCode.EVIDENCE_NOT_YET_AVAILABLE)

    def test_integration_blocked_evidence_names_its_blocker(self):
        finding = self._blocked("blocked_by_integration")
        self.assertIs(finding.reason_code, ReasonCode.EVIDENCE_BLOCKED_BY_INTEGRATION)
        self.assertEqual(finding.blocked_by, "test_integration_gate")

    def test_contradictory_evidence_carries_the_conflict(self):
        finding = self._blocked("contradictory")
        self.assertIs(finding.reason_code, ReasonCode.EVIDENCE_CONTRADICTORY)
        self.assertIn("conflict", finding.details)

    def test_schema_drift_evidence(self):
        finding = self._blocked("schema_drift")
        self.assertIs(finding.reason_code, ReasonCode.EVIDENCE_SCHEMA_DRIFT)

    def test_not_applicable_evidence_is_not_a_block(self):
        # Nothing to check is a pass, not a blocked record.
        finding = self._blocked("not_applicable")
        self.assertIsNot(finding.status, Status.UNVERIFIABLE)
        self.assertIs(finding.reason_code, ReasonCode.NONE)

    def test_explained_findings_carry_no_reason_code(self):
        result = reconcile_record(record_from(), INSTANT)
        for finding in result.findings:
            if finding.status is not Status.UNVERIFIABLE:
                self.assertIs(finding.reason_code, ReasonCode.NONE, finding.rule_id)

    def test_the_first_declared_requirement_is_the_reported_blocker(self):
        # Stable across runs: the blocker is the rule's first unmet requirement
        # in declaration order, not whichever the dict happened to yield first.
        finding = finding_for(
            record_from(unavailable={"payments": "missing", "payouts": "missing"}),
            self.RULE,
        )
        self.assertEqual(finding.blocked_section, "payments")


class ReasonCodeMetricsTest(unittest.TestCase):
    def test_run_metrics_tally_every_cause(self):
        record = record_from(
            unavailable={"payouts": "blocked_by_integration", "costBasis": "missing"}
        )
        metrics = reconcile([record], INSTANT).metrics
        tally = metrics["blockedReasonCodes"]
        self.assertEqual(tally["evidence_blocked_by_integration"], 1)
        # costBasis blocks provisional_cost_basis, operational_overrun, and
        # estimated_versus_realized_contribution.
        self.assertEqual(tally["evidence_missing"], 3)

    def test_current_state_preserves_connect_and_incomplete_actual_cost_blockers(self):
        _, records, rejected = load_bundle(current_state_bundle())
        self.assertEqual(rejected, [])
        metrics = reconcile(records, INSTANT).metrics
        self.assertEqual(
            metrics["blockedReasonCodes"],
            {"evidence_blocked_by_integration": 1, "evidence_not_yet_available": 2},
        )

    def test_records_without_a_commercial_chain_are_segmented(self):
        # A draft quote reconciles trivially. That is true, and reporting it
        # without the segment would flatter the rate.
        record = record_from(
            unavailable={
                section: "not_applicable"
                for section in KNOWN_SECTIONS
            }
        )
        metrics = reconcile([record], INSTANT).metrics
        self.assertEqual(metrics["recordsWithoutCommercialChain"], 1)
        self.assertEqual(metrics["recordsFullyReconciled"], 1)
        self.assertEqual(metrics["recordsFullyReconciledWithChain"], 0)


if __name__ == "__main__":
    unittest.main()
