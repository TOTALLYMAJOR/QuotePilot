"""Bundle loading: envelopes, drift, and fail-closed parsing."""

import copy
import unittest

from quotepilot_truthloop.contracts import Availability
from quotepilot_truthloop.loader import (
    EVIDENCE_BUNDLE_VERSION,
    KNOWN_SECTIONS,
    BundleError,
    load_bundle,
    load_record,
)
from support import clean_record_dict, current_state_bundle, example_bundle


def section(raw, name):
    return raw["evidence"][name]


class BundleEnvelopeTest(unittest.TestCase):
    def test_loads_the_exporter_produced_bundle(self):
        evaluated, records, rejected = load_bundle(example_bundle())
        self.assertEqual(evaluated, "2026-08-21T14:00:00.000Z")
        self.assertEqual(len(records), 1)
        self.assertEqual(rejected, [])

    def test_loads_the_current_state_bundle(self):
        _, records, rejected = load_bundle(current_state_bundle())
        self.assertEqual(rejected, [])
        self.assertIs(
            records[0].section("payouts").availability,
            Availability.BLOCKED_BY_INTEGRATION,
        )

    def test_bundle_version_constant_is_v2(self):
        self.assertEqual(EVIDENCE_BUNDLE_VERSION, "truthloop-evidence-bundle-v2")

    def test_a_superseded_bundle_version_is_named_as_drift(self):
        # v1 cannot express availability, so reading it would manufacture
        # reconciliation. It must fail with a drift message, not be coerced.
        payload = example_bundle()
        payload["bundleVersion"] = "truthloop-evidence-bundle-v1"
        with self.assertRaises(BundleError) as caught:
            load_bundle(payload)
        self.assertIn("superseded", str(caught.exception))
        self.assertIn("Re-export", str(caught.exception))

    def test_an_unknown_bundle_version_is_rejected(self):
        payload = example_bundle()
        payload["bundleVersion"] = "truthloop-evidence-bundle-v9"
        with self.assertRaises(BundleError):
            load_bundle(payload)

    def test_requires_an_evaluation_instant(self):
        payload = example_bundle()
        del payload["evaluatedAtISO"]
        with self.assertRaises(BundleError):
            load_bundle(payload)

    def test_a_bad_record_is_rejected_without_hiding_the_good_ones(self):
        payload = example_bundle()
        broken = clean_record_dict()
        broken["quoteId"] = "quote_broken"
        section(broken, "payments")["value"] = [
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


class EnvelopeValidationTest(unittest.TestCase):
    """The envelope is the contract; a malformed one is never assumed available."""

    def test_every_known_section_must_be_present(self):
        raw = clean_record_dict()
        del raw["evidence"]["payouts"]
        with self.assertRaises(BundleError) as caught:
            load_record(raw)
        self.assertIn("payouts", str(caught.exception))

    def test_an_unknown_section_is_drift_not_extra_credit(self):
        raw = clean_record_dict()
        raw["evidence"]["speculativeMargin"] = {"availability": "available", "value": {}}
        with self.assertRaises(BundleError) as caught:
            load_record(raw)
        self.assertIn("speculativeMargin", str(caught.exception))

    def test_a_section_without_availability_is_rejected(self):
        raw = clean_record_dict()
        del section(raw, "costBasis")["availability"]
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_an_unknown_availability_state_is_rejected(self):
        raw = clean_record_dict()
        section(raw, "costBasis")["availability"] = "probably_fine"
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_available_without_a_value_is_rejected(self):
        raw = clean_record_dict()
        section(raw, "costBasis").pop("value")
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_unavailable_with_a_value_is_rejected(self):
        # An envelope that claims blocked while carrying data is exactly the
        # ambiguity the contract exists to forbid.
        raw = clean_record_dict()
        section(raw, "costBasis")["availability"] = "missing"
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_blocked_by_integration_must_name_its_blocker(self):
        raw = clean_record_dict()
        payouts = section(raw, "payouts")
        payouts.pop("value", None)
        payouts["availability"] = "blocked_by_integration"
        payouts.pop("blockedBy", None)
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_all_known_sections_are_covered(self):
        self.assertEqual(len(KNOWN_SECTIONS), 9)
        self.assertEqual(set(clean_record_dict()["evidence"]), set(KNOWN_SECTIONS))


class RecordValidationTest(unittest.TestCase):
    def test_requires_identity(self):
        for field in ("organizationId", "quoteId"):
            raw = clean_record_dict()
            raw[field] = ""
            with self.assertRaises(BundleError, msg=field):
                load_record(raw)

    def test_rejects_float_money(self):
        raw = clean_record_dict()
        section(raw, "acceptedSnapshot")["value"]["totalsMinor"]["total"] = 22592.00
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_rejects_a_payout_net_above_its_gross(self):
        raw = clean_record_dict()
        section(raw, "payouts")["value"][0]["netCents"] = 490000
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_rejects_an_unknown_payment_state(self):
        raw = clean_record_dict()
        section(raw, "payments")["value"][0]["state"] = "refunded"
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_rejects_a_string_where_an_integer_belongs(self):
        raw = clean_record_dict()
        section(raw, "acceptedSnapshot")["value"]["guests"] = "145"
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_rejects_a_scalar_where_a_list_belongs(self):
        raw = clean_record_dict()
        section(raw, "acceptedSnapshot")["value"]["selection"]["rentals"] = "Farm Tables"
        with self.assertRaises(BundleError):
            load_record(raw)


class TimestampNormalizationTest(unittest.TestCase):
    """Timestamps must compare as instants, not as text."""

    def _submitted(self, value: str):
        raw = clean_record_dict()
        section(raw, "customerRequest")["value"]["submittedAtISO"] = value
        return load_record(raw)

    def test_offsets_are_canonicalized_to_utc(self):
        record = self._submitted("2026-08-19T12:00:00+05:00")
        self.assertEqual(
            record.customer_request.submitted_at_iso, "2026-08-19T07:00:00.000Z"
        )

    def test_precision_is_canonicalized(self):
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
        section(raw, "acceptedSnapshot")["value"]["acceptedAtISO"] = (
            "2026-08-19T09:00:00.000Z"
        )
        request = section(raw, "customerRequest")["value"]
        request["submittedAtISO"] = "2026-08-19T12:00:00+05:00"
        request["proposals"] = []
        request["recordedProposalIds"] = []
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
        section(raw, "authorizedQuote")["value"]["catalogAuthority"][
            "catalogRevision"
        ] = None
        record = load_record(raw)
        self.assertEqual(record.authorized_quote.catalog_authority.catalog_revision, -1)
        self.assertFalse(record.authorized_quote.catalog_authority.present)

    def test_null_current_catalog_revision_stays_absent(self):
        raw = clean_record_dict()
        raw["currentCatalogRevision"] = None
        self.assertEqual(load_record(raw).current_catalog_revision, -1)

    def test_null_overrun_threshold_cannot_create_a_declared_default(self):
        raw = clean_record_dict()
        raw["overrunThresholds"] = {"laborBasisPoints": None}
        with self.assertRaises(BundleError):
            load_record(raw)


class DeepCopyIndependenceTest(unittest.TestCase):
    def test_loading_does_not_mutate_the_source_payload(self):
        payload = example_bundle()
        before = copy.deepcopy(payload)
        load_bundle(payload)
        self.assertEqual(payload, before)


class DeclaredOperationalCostsTest(unittest.TestCase):
    def test_missing_actual_cost_category_is_never_defaulted_to_zero(self):
        for omitted in ("laborCostCents", "purchasingCostCents", "otherCostCents", "recordedAtISO"):
            raw = clean_record_dict()
            costs = {"laborCostCents": 0, "purchasingCostCents": 0, "otherCostCents": 0,
                     "recordedAtISO": "2026-08-20T00:00:00.000Z"}
            del costs[omitted]
            raw["evidence"]["actualConsumption"].update(availability="available", value=costs)
            with self.subTest(omitted=omitted), self.assertRaises(BundleError):
                load_record(raw)

    def test_tolerance_requires_complete_declaration_evidence(self):
        policy = {"laborBasisPoints": 0, "purchasingBasisPoints": 0, "minimumCents": 0,
                  "declaredBy": "synthetic-operator", "declaredAtISO": "2026-08-20T00:00:00.000Z"}
        for omitted in policy:
            raw = clean_record_dict()
            raw["overrunThresholds"] = {key: value for key, value in policy.items() if key != omitted}
            with self.subTest(omitted=omitted), self.assertRaises(BundleError):
                load_record(raw)
        raw = clean_record_dict()
        raw["overrunThresholds"] = policy
        raw.pop("overrunPolicyEvidence", None)  # Explicit legacy declaration remains supported.
        loaded = load_record(raw).overrun_thresholds
        self.assertTrue(loaded.declared)
        self.assertEqual(loaded.minimum_cents, 0)
        self.assertEqual(loaded.labor_basis_points, 0)
        self.assertEqual(loaded.declared_by, "synthetic-operator")


class WorkflowPolicyEnvelopeTest(unittest.TestCase):
    POLICY = {"laborBasisPoints": 0, "purchasingBasisPoints": 0, "minimumCents": 0,
              "declaredBy": "synthetic-admin", "declaredAtISO": "2026-08-20T00:00:00.000Z"}

    def test_available_policy_matches_the_exact_declared_values(self):
        raw = clean_record_dict()
        raw["overrunThresholds"] = self.POLICY.copy()
        raw["overrunPolicyEvidence"] = {"availability": "available", "value": self.POLICY.copy()}
        record = load_record(raw)
        self.assertTrue(record.overrun_thresholds.declared)
        self.assertIs(record.overrun_policy_evidence.availability, Availability.AVAILABLE)
        raw["overrunPolicyEvidence"]["value"]["minimumCents"] = 1
        with self.assertRaises(BundleError):
            load_record(raw)

    def test_unavailable_policy_cannot_smuggle_a_tolerance(self):
        for availability in ("missing", "not_applicable", "not_yet_available", "contradictory", "schema_drift"):
            raw = clean_record_dict()
            raw["overrunThresholds"] = self.POLICY.copy()
            raw["overrunPolicyEvidence"] = {"availability": availability, "value": None}
            with self.subTest(availability=availability), self.assertRaises(BundleError):
                load_record(raw)

    def test_available_policy_requires_values_in_both_locations(self):
        raw = clean_record_dict()
        raw.pop("overrunThresholds", None)
        raw["overrunPolicyEvidence"] = {"availability": "available", "value": self.POLICY.copy()}
        with self.assertRaises(BundleError):
            load_record(raw)


if __name__ == "__main__":
    unittest.main()
