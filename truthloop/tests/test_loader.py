import unittest

from quotepilot_truthloop.loader import (
    EVIDENCE_BUNDLE_VERSION,
    BundleError,
    load_bundle,
    load_record,
)
from support import clean_record_dict, example_bundle


class BundleEnvelopeTest(unittest.TestCase):
    def test_loads_the_example_bundle(self):
        evaluated, records, rejected = load_bundle(example_bundle())
        self.assertEqual(evaluated, "2026-08-21T14:00:00.000Z")
        self.assertEqual(len(records), 1)
        self.assertEqual(rejected, [])

    def test_rejects_an_unknown_bundle_version(self):
        payload = example_bundle()
        payload["bundleVersion"] = "truthloop-evidence-bundle-v2"
        with self.assertRaises(BundleError):
            load_bundle(payload)

    def test_requires_an_evaluation_instant(self):
        payload = example_bundle()
        del payload["evaluatedAtISO"]
        with self.assertRaises(BundleError):
            load_bundle(payload)

    def test_rejects_a_non_iso_evaluation_instant(self):
        payload = example_bundle()
        payload["evaluatedAtISO"] = "August 21, 2026"
        with self.assertRaises(BundleError):
            load_bundle(payload)

    def test_a_bad_record_is_rejected_without_hiding_the_good_ones(self):
        payload = example_bundle()
        broken = clean_record_dict()
        broken["quoteId"] = "quote_broken"
        broken["payments"] = [
            {
                "operationId": "op_x",
                "paymentKind": "gift_card",
                "amountCents": 100,
                "state": "paid",
            }
        ]
        payload["records"] = [broken, clean_record_dict()]
        _, records, rejected = load_bundle(payload)
        self.assertEqual(len(records), 1)
        self.assertEqual(len(rejected), 1)
        self.assertEqual(rejected[0]["quoteId"], "quote_broken")
        self.assertIn("paymentKind", rejected[0]["reason"])


class RecordValidationTest(unittest.TestCase):
    def _record(self, **overrides):
        raw = clean_record_dict()
        raw.update(overrides)
        return raw

    def test_requires_identity(self):
        for field in ("organizationId", "quoteId"):
            raw = clean_record_dict()
            raw[field] = ""
            with self.assertRaises(BundleError, msg=field):
                load_record(raw)

    def test_rejects_float_money(self):
        raw = clean_record_dict()
        raw["acceptedSnapshot"]["totalsMinor"]["total"] = 22592.00
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_rejects_a_payout_net_above_its_gross(self):
        raw = clean_record_dict()
        raw["payouts"][0]["netCents"] = 490000
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_rejects_an_unknown_payment_state(self):
        raw = clean_record_dict()
        raw["payments"][0]["state"] = "refunded"
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_rejects_a_string_where_an_integer_belongs(self):
        raw = clean_record_dict()
        raw["acceptedSnapshot"]["guests"] = "145"
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_rejects_a_scalar_where_a_list_belongs(self):
        raw = clean_record_dict()
        raw["acceptedSnapshot"]["selection"]["rentals"] = "Farm Tables"
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_absent_sections_stay_absent_rather_than_defaulting(self):
        raw = clean_record_dict()
        for key in ("operationalPlan", "costBasis", "actualConsumption"):
            raw.pop(key, None)
        record = load_record(raw)
        self.assertFalse(record.operational_plan.present)
        self.assertFalse(record.cost_basis.present)
        self.assertFalse(record.actual_consumption.present)

    def test_bundle_version_constant_is_stable(self):
        self.assertEqual(EVIDENCE_BUNDLE_VERSION, "truthloop-evidence-bundle-v1")


if __name__ == "__main__":
    unittest.main()


class TimestampNormalizationTest(unittest.TestCase):
    """Timestamps must compare as instants, not as text."""

    def _submitted(self, value: str):
        raw = clean_record_dict()
        raw["customerRequest"] = {
            "requestId": "req_1",
            "decision": "changes_requested",
            "submittedAtISO": value,
            "proposals": [],
            "recordedProposalIds": [],
        }
        return load_record(raw)

    def test_offsets_are_canonicalized_to_utc(self):
        record = self._submitted("2026-08-19T12:00:00+05:00")
        self.assertEqual(
            record.customer_request.submitted_at_iso, "2026-08-19T07:00:00.000Z"
        )

    def test_precision_is_canonicalized(self):
        # Same instant, three spellings, one normalized form.
        for spelling in (
            "2026-08-19T07:00:00Z",
            "2026-08-19T07:00:00.000Z",
            "2026-08-19T07:00:00.000000Z",
        ):
            self.assertEqual(
                self._submitted(spelling).customer_request.submitted_at_iso,
                "2026-08-19T07:00:00.000Z",
                spelling,
            )

    def test_an_offset_request_before_acceptance_is_not_read_as_after(self):
        # Regression: "2026-08-19T12:00:00+05:00" sorts above the accepted
        # snapshot's "...Z" form as raw text, but is two hours earlier.
        from quotepilot_truthloop.engine import reconcile_record

        raw = clean_record_dict()
        raw["acceptedSnapshot"]["acceptedAtISO"] = "2026-08-19T09:00:00.000Z"
        raw["customerRequest"] = {
            "requestId": "req_1",
            "decision": "changes_requested",
            "submittedAtISO": "2026-08-19T12:00:00+05:00",
            "proposals": [],
            "recordedProposalIds": [],
        }
        result = reconcile_record(load_record(raw), "2026-08-21T14:00:00.000Z")
        finding = next(
            f for f in result.findings if f.rule_id == "accepted_record_stale_vs_request"
        )
        self.assertEqual(finding.status.value, "explained")

    def test_a_timestamp_without_an_offset_is_rejected(self):
        with self.assertRaises(BundleError):
            self._submitted("2026-08-19T07:00:00")


class SentinelIntegerTest(unittest.TestCase):
    """An explicit null must mean absent, not zero."""

    def test_null_catalog_revision_stays_absent(self):
        raw = clean_record_dict()
        raw["authorizedQuote"]["catalogAuthority"]["catalogRevision"] = None
        record = load_record(raw)
        self.assertEqual(record.authorized_quote.catalog_authority.catalog_revision, -1)
        self.assertFalse(record.authorized_quote.catalog_authority.present)

    def test_null_current_catalog_revision_stays_absent(self):
        raw = clean_record_dict()
        raw["currentCatalogRevision"] = None
        self.assertEqual(load_record(raw).current_catalog_revision, -1)

    def test_null_overrun_threshold_keeps_the_declared_default(self):
        raw = clean_record_dict()
        raw["overrunThresholds"] = {"laborBasisPoints": None}
        self.assertEqual(load_record(raw).overrun_thresholds.labor_basis_points, 1_000)
