"""Catalog, operational, margin, and customer-request rules."""

import unittest

from quotepilot_truthloop.contracts import Status
from support import finding_for, record_from


class StaleCatalogTest(unittest.TestCase):
    RULE = "stale_catalog_revision"

    def test_current_revision_is_explained(self):
        self.assertIs(finding_for(record_from(), self.RULE).status, Status.EXPLAINED)

    def test_superseded_revision_is_reported(self):
        record = record_from({"currentCatalogRevision": 15})
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertEqual(finding.details["revisionDrift"], 3)
        # Accepted records keep their promise; the finding must say so rather
        # than implying the accepted price should move.
        self.assertIn("remains the binding promise", finding.narrative)

    def test_unconfirmed_revision_is_critical(self):
        record = record_from(
            {"authorizedQuote": {"catalogAuthority": {"confirmedCatalogRevision": 11}}}
        )
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertEqual(finding.severity.value, "critical")

    def test_missing_authority_is_unverifiable(self):
        record = record_from({"authorizedQuote": {"catalogAuthority": {}}})
        self.assertIs(finding_for(record, self.RULE).status, Status.UNVERIFIABLE)


class ProvisionalCostTest(unittest.TestCase):
    RULE = "provisional_cost_basis"

    def test_recorded_costs_are_explained(self):
        self.assertIs(finding_for(record_from(), self.RULE).status, Status.EXPLAINED)

    def test_provisional_costs_are_reported(self):
        record = record_from({"costBasis": {"provisionalCostCategories": ["labor"]}})
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertIn("provisional cost basis on labor", finding.narrative)

    def test_missing_costs_are_reported(self):
        record = record_from({"costBasis": {"missingCostCategories": ["rentals"]}})
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertIn("no recorded cost for rentals", finding.narrative)

    def test_absent_cost_basis_is_unverifiable(self):
        record = record_from({"costBasis": {}})
        self.assertIs(finding_for(record, self.RULE).status, Status.UNVERIFIABLE)


class MarginOmissionTest(unittest.TestCase):
    RULE = "margin_category_omission"

    def test_record_without_travel_revenue_is_explained(self):
        self.assertIs(finding_for(record_from(), self.RULE).status, Status.EXPLAINED)

    def test_travel_revenue_outside_the_margin_model_is_reported(self):
        record = record_from(
            {"acceptedSnapshot": {"totalsMinor": {"travel": 45000, "total": 2259200}}}
        )
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertEqual(finding.amounts_cents["omittedRevenueCents"], 45000)
        self.assertEqual(finding.details["omittedCategories"], ["travel"])

    def test_tax_alone_is_not_an_omission(self):
        # Tax is collected for the taxing authority; excluding it is correct.
        record = record_from(
            {"acceptedSnapshot": {"totalsMinor": {"travel": 0, "tax": 178200}}}
        )
        self.assertIs(finding_for(record, self.RULE).status, Status.EXPLAINED)


class PromiseCoverageTest(unittest.TestCase):
    RULE = "promise_absent_from_plan"

    def test_matching_plan_is_explained(self):
        self.assertIs(finding_for(record_from(), self.RULE).status, Status.EXPLAINED)

    def test_missing_rental_is_reported(self):
        record = record_from(
            {"operationalPlan": {"selections": {"rentals": ["Farm Tables"]}}}
        )
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertIn("Gold Flatware", finding.narrative)

    def test_name_matching_ignores_case_and_padding(self):
        record = record_from(
            {
                "operationalPlan": {
                    "selections": {"rentals": ["  farm tables ", "GOLD FLATWARE"]}
                }
            }
        )
        self.assertIs(finding_for(record, self.RULE).status, Status.EXPLAINED)

    def test_guest_count_drift_is_reported(self):
        record = record_from({"operationalPlan": {"guests": 120}})
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertIn("120 guests", finding.narrative)

    def test_understaffed_plan_is_reported(self):
        record = record_from({"operationalPlan": {"staffing": {"servers": 4}}})
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertIn("plan staffs 4 servers", finding.narrative)

    def test_overstaffed_plan_is_not_a_missing_promise(self):
        record = record_from({"operationalPlan": {"staffing": {"servers": 8}}})
        self.assertIs(finding_for(record, self.RULE).status, Status.EXPLAINED)

    def test_plan_built_from_a_different_revision_is_reported(self):
        record = record_from({"operationalPlan": {"sourceRevisionId": "rev_6"}})
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertIn("rev_6", finding.narrative)

    def test_absent_plan_is_unverifiable(self):
        record = record_from({"operationalPlan": {}})
        self.assertIs(finding_for(record, self.RULE).status, Status.UNVERIFIABLE)


class OverrunTest(unittest.TestCase):
    RULE = "operational_overrun"

    def _delivered(self, labor: int, purchasing: int = 0):
        return record_from(
            {
                "eventCompleted": True,
                "costBasis": {"plannedCostCents": {"labor": 208000, "purchasing": 100000}},
                "actualConsumption": {
                    "laborCostCents": labor,
                    "purchasingCostCents": purchasing,
                    "otherCostCents": 0,
                    "recordedAtISO": "2026-10-18T04:00:00.000Z",
                },
            }
        )

    def test_within_tolerance_is_explained(self):
        # 10% of $2,080.00 is $208.00 of allowance.
        self.assertIs(finding_for(self._delivered(228000, 100000), self.RULE).status, Status.EXPLAINED)

    def test_labor_beyond_tolerance_is_reported(self):
        finding = finding_for(self._delivered(260000, 100000), self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertEqual(finding.amounts_cents["unexplainedCents"], 52000)
        self.assertIn("Labor consumed $2,600.00", finding.narrative)

    def test_purchasing_beyond_tolerance_is_reported(self):
        finding = finding_for(self._delivered(208000, 140000), self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertIn("Purchasing consumed", finding.narrative)

    def test_undelivered_event_needs_no_consumption(self):
        self.assertIs(finding_for(record_from(), self.RULE).status, Status.EXPLAINED)

    def test_delivered_event_without_consumption_is_unverifiable(self):
        # The exporter marks consumption `missing` once the event is delivered:
        # it should exist and does not. That is a blocked record, not a pass.
        record = record_from(
            {"eventCompleted": True}, unavailable={"actualConsumption": "missing"}
        )
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.UNVERIFIABLE)
        self.assertEqual(finding.reason_code.value, "evidence_missing")
        self.assertEqual(finding.blocked_section, "actualConsumption")


class RealizedContributionTest(unittest.TestCase):
    RULE = "estimated_versus_realized_contribution"

    def test_undelivered_event_reports_no_realized_figure(self):
        # Consumption is not applicable before delivery, so the rule passes
        # with nothing to check rather than reporting a blocked record.
        finding = finding_for(record_from(), self.RULE)
        self.assertIs(finding.status, Status.EXPLAINED)
        self.assertEqual(finding.details["notApplicableSection"], "actualConsumption")

    def test_variance_is_measured_not_flagged(self):
        record = record_from(
            {
                "eventCompleted": True,
                "actualConsumption": {
                    "laborCostCents": 208000,
                    "purchasingCostCents": 0,
                    "otherCostCents": 708000,
                    "recordedAtISO": "2026-10-18T04:00:00.000Z",
                },
            }
        )
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.EXPLAINED)
        planned = 540000 + 72000 + 96000 + 208000
        actual = 208000 + 708000
        self.assertEqual(
            finding.amounts_cents["contributionVarianceCents"], planned - actual
        )

    def test_incomplete_cost_evidence_blocks_the_comparison(self):
        record = record_from(
            {
                "eventCompleted": True,
                "costBasis": {"missingCostCategories": ["rentals"]},
                "actualConsumption": {
                    "laborCostCents": 208000,
                    "recordedAtISO": "2026-10-18T04:00:00.000Z",
                },
            }
        )
        self.assertIs(finding_for(record, self.RULE).status, Status.UNVERIFIABLE)


class AcceptedRecordFreshnessTest(unittest.TestCase):
    RULE = "accepted_record_stale_vs_request"

    def test_no_request_is_explained(self):
        self.assertIs(finding_for(record_from(), self.RULE).status, Status.EXPLAINED)

    def test_request_after_acceptance_is_reported(self):
        record = record_from(
            {
                "customerRequest": {
                    "requestId": "req_9",
                    "decision": "changes_requested",
                    "submittedAtISO": "2026-08-19T10:00:00.000Z",
                    "proposals": [],
                    "recordedProposalIds": [],
                }
            }
        )
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertIn("after the snapshot accepted", finding.narrative)

    def test_guest_count_contradiction_is_named(self):
        record = record_from(
            {
                "customerRequest": {
                    "requestId": "req_9",
                    "decision": "changes_requested",
                    "submittedAtISO": "2026-08-19T10:00:00.000Z",
                    "proposals": [
                        {"id": "p1", "kind": "set_guests", "value": 160}
                    ],
                    "recordedProposalIds": ["p1"],
                }
            }
        )
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertIn("guest count 160 against an accepted 145", finding.narrative)

    def test_unstaged_proposal_is_named(self):
        record = record_from(
            {
                "customerRequest": {
                    "requestId": "req_9",
                    "decision": "changes_requested",
                    "submittedAtISO": "2026-08-19T10:00:00.000Z",
                    "proposals": [{"id": "p2", "kind": "set_hours", "value": 5}],
                    "recordedProposalIds": [],
                }
            }
        )
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertEqual(finding.details["unrecordedProposalIds"], ["p2"])

    def test_item_addition_contradiction_is_named(self):
        record = record_from(
            {
                "customerRequest": {
                    "requestId": "req_9",
                    "decision": "changes_requested",
                    "submittedAtISO": "2026-08-01T10:00:00.000Z",
                    "proposals": [
                        {
                            "id": "p3",
                            "kind": "add_item",
                            "itemType": "rentals",
                            "itemId": "r9",
                            "itemName": "Patio Heaters",
                        }
                    ],
                    "recordedProposalIds": ["p3"],
                }
            }
        )
        finding = finding_for(record, self.RULE)
        self.assertIs(finding.status, Status.DISCREPANCY)
        self.assertIn("Patio Heaters", finding.narrative)

    def test_satisfied_request_before_acceptance_is_explained(self):
        record = record_from(
            {
                "customerRequest": {
                    "requestId": "req_9",
                    "decision": "changes_requested",
                    "submittedAtISO": "2026-08-01T10:00:00.000Z",
                    "proposals": [
                        {"id": "p1", "kind": "set_guests", "value": 145}
                    ],
                    "recordedProposalIds": ["p1"],
                }
            }
        )
        self.assertIs(finding_for(record, self.RULE).status, Status.EXPLAINED)


if __name__ == "__main__":
    unittest.main()
