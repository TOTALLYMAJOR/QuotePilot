"""The rule set, in commercial-chain order.

Adding a rule here is the only way to extend the loop. The engine runs every
registered rule against every record, so coverage is a property of this list
rather than of per-record branching.
"""

from __future__ import annotations

from .base import Rule
from .catalog import ProvisionalCostBasisRule, StaleCatalogRevisionRule
from .margin import MarginCategoryOmissionRule, RealizedContributionRule
from .operations import OperationalOverrunRule, PromiseCoverageRule
from .payments import (
    ChargeIntegrityRule,
    ExpectedRevenueRule,
    PaymentAmountMismatchRule,
    ProcessorFeeRule,
)
from .requests import AcceptedRecordFreshnessRule

#: Ordered so a report reads the way value moves: request, quote, acceptance,
#: money in, money settled, delivery, contribution.
RULES: tuple[Rule, ...] = (
    AcceptedRecordFreshnessRule(),
    StaleCatalogRevisionRule(),
    PaymentAmountMismatchRule(),
    ChargeIntegrityRule(),
    ProcessorFeeRule(),
    ExpectedRevenueRule(),
    PromiseCoverageRule(),
    OperationalOverrunRule(),
    ProvisionalCostBasisRule(),
    MarginCategoryOmissionRule(),
    RealizedContributionRule(),
)


def rule_catalog() -> list[dict[str, str]]:
    """What the loop can detect, for docs and operator-facing surfaces."""
    return [
        {
            "ruleId": rule.rule_id,
            "chainLink": rule.chain_link.value,
            "detects": rule.detects,
            "requires": list(rule.requires),
        }
        for rule in RULES
    ]


__all__ = ["RULES", "Rule", "rule_catalog"]
