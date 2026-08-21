"""Engine, report, and boundary guarantees."""

import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

from quotepilot_truthloop import cli
from quotepilot_truthloop.contracts import AUTHORITY, Status
from quotepilot_truthloop.engine import reconcile, reconcile_record
from quotepilot_truthloop.loader import load_bundle
from quotepilot_truthloop.rules import RULES, rule_catalog
from support import EXAMPLE_BUNDLE_PATH, clean_record_dict, example_bundle, record_from

INSTANT = "2026-08-21T14:00:00.000Z"


class RuleSetTest(unittest.TestCase):
    def test_every_rule_has_a_unique_id_and_a_stated_detection(self):
        ids = [rule.rule_id for rule in RULES]
        self.assertEqual(len(ids), len(set(ids)))
        for rule in RULES:
            self.assertTrue(rule.rule_id, "a rule is missing its id")
            self.assertTrue(rule.detects, f"{rule.rule_id} does not state what it detects")

    def test_the_catalog_covers_every_named_detection(self):
        # The capabilities the Commercial Truth Loop was asked to provide.
        required = {
            "payment_amount_mismatch",
            "missing_or_duplicate_charge",
            "stale_catalog_revision",
            "provisional_cost_basis",
            "processor_fee_discrepancy",
            "margin_category_omission",
            "promise_absent_from_plan",
            "operational_overrun",
            "expected_revenue_not_received",
            "accepted_record_stale_vs_request",
            "estimated_versus_realized_contribution",
        }
        self.assertEqual({entry["ruleId"] for entry in rule_catalog()}, required)

    def test_every_rule_runs_against_a_bare_record(self):
        # A record with almost no evidence must still produce one finding per
        # rule, never an exception and never a silent omission.
        bare = {"organizationId": "org", "quoteId": "q"}
        from quotepilot_truthloop.loader import load_record

        result = reconcile_record(load_record(bare), INSTANT)
        self.assertEqual(len(result.findings), len(RULES))
        self.assertFalse(result.fully_reconciled)


class ReconciliationStatusTest(unittest.TestCase):
    def test_a_complete_record_is_fully_reconciled(self):
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
                "payouts": [
                    {
                        "providerReference": "cs_test_deposit_1042",
                        "grossCents": 480000,
                        "netCents": 464280,
                        "payoutReference": "po_1",
                    },
                    {
                        "providerReference": "cs_test_final_1042",
                        "grossCents": 1734200,
                        "netCents": 1677718,
                        "payoutReference": "po_2",
                    },
                ],
                "actualConsumption": {
                    "laborCostCents": 208000,
                    "purchasingCostCents": 0,
                    "otherCostCents": 708000,
                    "recordedAtISO": "2026-10-18T04:00:00.000Z",
                },
            }
        )
        result = reconcile_record(record, INSTANT)
        open_findings = [f for f in result.findings if f.status is not Status.EXPLAINED]
        self.assertEqual(open_findings, [], [f.rule_id for f in open_findings])
        self.assertTrue(result.fully_reconciled)

    def test_unverifiable_evidence_blocks_full_reconciliation(self):
        # The central guarantee: absent evidence never reads as a clean record.
        record = record_from({"payouts": []})
        result = reconcile_record(record, INSTANT)
        self.assertTrue(result.unverifiable)
        self.assertFalse(result.fully_reconciled)

    def test_findings_carry_the_observation_only_authority_stamp(self):
        result = reconcile_record(record_from(), INSTANT)
        for finding in result.findings:
            self.assertEqual(finding.to_dict()["authority"], AUTHORITY)


class MetricsTest(unittest.TestCase):
    def test_rejected_records_count_against_the_reconciliation_rate(self):
        report = reconcile(
            [], INSTANT, rejected=[{"index": 0, "quoteId": "q", "reason": "bad"}]
        )
        metrics = report.metrics
        self.assertEqual(metrics["recordsEvaluated"], 1)
        self.assertEqual(metrics["recordsFullyReconciled"], 0)
        self.assertEqual(metrics["fullyReconciledBasisPoints"], 0)

    def test_an_empty_run_does_not_divide_by_zero(self):
        self.assertEqual(reconcile([], INSTANT).metrics["fullyReconciledBasisPoints"], 0)

    def test_unexplained_amounts_are_summed_across_records(self):
        record = record_from({"processorFeeSchedule": {}})
        report = reconcile([record, record], INSTANT)
        self.assertEqual(report.metrics["unexplainedAmountCents"], 15720 * 2)


class DeterminismTest(unittest.TestCase):
    def test_two_runs_over_the_same_bundle_are_byte_identical(self):
        _, records, rejected = load_bundle(example_bundle())
        first = reconcile(records, INSTANT, rejected=rejected).to_json()
        _, records_again, rejected_again = load_bundle(example_bundle())
        second = reconcile(records_again, INSTANT, rejected=rejected_again).to_json()
        self.assertEqual(first, second)

    def test_the_report_is_json_serializable(self):
        _, records, rejected = load_bundle(example_bundle())
        payload = json.loads(reconcile(records, INSTANT, rejected=rejected).to_json())
        self.assertEqual(payload["contractVersion"], "truthloop-reconciliation-v1")
        self.assertEqual(payload["evaluatedAtISO"], INSTANT)

    def test_the_engine_does_not_mutate_its_input(self):
        before = clean_record_dict()
        record = record_from()
        reconcile_record(record, INSTANT)
        self.assertEqual(before, clean_record_dict())


class CliTest(unittest.TestCase):
    def _run(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = cli.main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_reconcile_reports_findings_with_exit_code_one(self):
        code, out, _ = self._run(["reconcile", EXAMPLE_BUNDLE_PATH])
        self.assertEqual(code, cli.EXIT_FINDINGS)
        self.assertIn("margin_category_omission", out)

    def test_the_example_reproduces_the_documented_explanation(self):
        code, out, _ = self._run(["reconcile", EXAMPLE_BUNDLE_PATH, "--format", "json"])
        self.assertEqual(code, cli.EXIT_FINDINGS)
        payload = json.loads(out)
        fee = next(
            f
            for f in payload["records"][0]["findings"]
            if f["ruleId"] == "processor_fee_discrepancy"
        )
        self.assertEqual(fee["status"], "explained")
        self.assertIn("$4,642.80", fee["narrative"])
        self.assertIn("$157.20", fee["narrative"])

    def test_an_unreadable_bundle_exits_two(self):
        code, _, err = self._run(["reconcile", os.path.join(tempfile.gettempdir(), "missing.json")])
        self.assertEqual(code, cli.EXIT_BUNDLE_ERROR)
        self.assertIn("could not be loaded", err)

    def test_malformed_json_exits_two(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            handle.write("{not json")
            path = handle.name
        try:
            code, _, err = self._run(["reconcile", path])
            self.assertEqual(code, cli.EXIT_BUNDLE_ERROR)
            self.assertIn("not valid JSON", err)
        finally:
            os.unlink(path)

    def test_rules_command_lists_the_catalog(self):
        code, out, _ = self._run(["rules"])
        self.assertEqual(code, cli.EXIT_RECONCILED)
        self.assertEqual(len(json.loads(out)), len(RULES))

    def test_out_writes_the_report_to_a_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = os.path.join(directory, "report.json")
            code, out, _ = self._run(
                ["reconcile", EXAMPLE_BUNDLE_PATH, "--format", "json", "--out", target]
            )
            self.assertEqual(code, cli.EXIT_FINDINGS)
            self.assertEqual(out, "")
            with open(target, encoding="utf-8") as handle:
                self.assertEqual(
                    json.load(handle)["contractVersion"],
                    "truthloop-reconciliation-v1",
                )


if __name__ == "__main__":
    unittest.main()
