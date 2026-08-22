"""The shared contract binds the two tiers.

The exporter classifies availability and computes coverage from
``docs/truthloop-evidence-contract.json``; the reconciler's rule registry must
agree with it. If the two drift, coverage reports a rule the reconciler does
not run, or the reconciler runs a rule coverage never accounts for. Either way
the report has a hole in it, so drift is a test failure rather than a surprise.
"""

import unittest

from quotepilot_truthloop.contracts import (
    AVAILABILITY_REASON_CODES,
    RESOLVING_AVAILABILITY,
    Availability,
    ChainLink,
)
from quotepilot_truthloop.evidence_contract import (
    availability_states,
    contract_bundle_version,
    contract_rules,
    evidence_contract,
)
from quotepilot_truthloop.loader import EVIDENCE_BUNDLE_VERSION, KNOWN_SECTIONS
from quotepilot_truthloop.rules import RULES


class ContractBindingTest(unittest.TestCase):
    def test_bundle_version_matches_the_loader(self):
        self.assertEqual(contract_bundle_version(), EVIDENCE_BUNDLE_VERSION)

    def test_every_rule_in_the_registry_is_in_the_contract(self):
        self.assertEqual(
            {rule.rule_id for rule in RULES},
            set(contract_rules()),
        )

    def test_every_rule_declares_the_evidence_the_contract_says_it_needs(self):
        contract = contract_rules()
        for rule in RULES:
            self.assertEqual(
                sorted(rule.requires),
                sorted(contract[rule.rule_id]["requires"]),
                rule.rule_id,
            )

    def test_every_rule_agrees_with_the_contract_on_its_chain_link(self):
        contract = contract_rules()
        for rule in RULES:
            self.assertEqual(
                rule.chain_link.value,
                contract[rule.rule_id]["chainLink"],
                rule.rule_id,
            )

    def test_required_sections_all_exist(self):
        sections = set(evidence_contract()["evidenceSections"])
        self.assertEqual(sections, set(KNOWN_SECTIONS))
        for rule in RULES:
            for section in rule.requires:
                self.assertIn(section, sections, f"{rule.rule_id} -> {section}")

    def test_chain_links_are_all_known(self):
        known = {link.value for link in ChainLink}
        for rule_id, rule in contract_rules().items():
            self.assertIn(rule["chainLink"], known, rule_id)


class AvailabilityVocabularyTest(unittest.TestCase):
    def test_states_match_the_contract(self):
        self.assertEqual(
            {state.value for state in Availability},
            set(availability_states()),
        )

    def test_reason_codes_match_the_contract(self):
        for state, definition in availability_states().items():
            availability = Availability(state)
            if availability in RESOLVING_AVAILABILITY:
                self.assertNotIn(availability, AVAILABILITY_REASON_CODES, state)
                continue
            self.assertEqual(
                AVAILABILITY_REASON_CODES[availability].value,
                definition["reasonCode"],
                state,
            )

    def test_resolving_states_match_the_contract(self):
        resolving = {
            state
            for state, definition in availability_states().items()
            if definition["reconcilerEffect"] in ("run_rule", "explained")
        }
        self.assertEqual({state.value for state in RESOLVING_AVAILABILITY}, resolving)

    def test_not_applicable_resolves_and_missing_does_not(self):
        # The load-bearing distinction: nothing to check is a pass; evidence we
        # could not get is not.
        self.assertIn(Availability.NOT_APPLICABLE, RESOLVING_AVAILABILITY)
        self.assertNotIn(Availability.MISSING, RESOLVING_AVAILABILITY)
        self.assertNotIn(Availability.NOT_YET_AVAILABLE, RESOLVING_AVAILABILITY)
        self.assertNotIn(Availability.BLOCKED_BY_INTEGRATION, RESOLVING_AVAILABILITY)
        self.assertNotIn(Availability.CONTRADICTORY, RESOLVING_AVAILABILITY)
        self.assertNotIn(Availability.SCHEMA_DRIFT, RESOLVING_AVAILABILITY)


if __name__ == "__main__":
    unittest.main()
