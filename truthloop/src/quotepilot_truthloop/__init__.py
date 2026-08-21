"""QuotePilot Commercial Truth Loop.

A read-only, deterministic reconciler for the commercial chain that runs from a
customer request through to realized contribution. It reads exported evidence
and emits findings. It has no write path, no network access, and no authority:
QuotePilot's existing TypeScript services remain the only place a commercial
fact can be created or changed.

See ``docs/COMMERCIAL_TRUTH_LOOP_ADR.md`` for the architecture decision and
``docs/COMMERCIAL_TRUTH_LOOP_DESIGN.md`` for the rule catalog and evidence
contract.
"""

from __future__ import annotations

from .contracts import (
    AUTHORITY,
    BOUNDARY,
    FINDING_CONTRACT_VERSION,
    RECONCILIATION_CONTRACT_VERSION,
    ChainLink,
    EvidenceRef,
    EvidenceStatus,
    Finding,
    ReconciliationReport,
    RecordReconciliation,
    Severity,
    Status,
)
from .engine import reconcile, reconcile_record
from .loader import (
    EVIDENCE_BUNDLE_VERSION,
    BundleError,
    load_bundle,
    load_bundle_json,
    load_record,
)
from .model import CommercialRecord
from .rules import RULES, rule_catalog

__version__ = "0.1.0"

__all__ = [
    "AUTHORITY",
    "BOUNDARY",
    "EVIDENCE_BUNDLE_VERSION",
    "FINDING_CONTRACT_VERSION",
    "RECONCILIATION_CONTRACT_VERSION",
    "RULES",
    "BundleError",
    "ChainLink",
    "CommercialRecord",
    "EvidenceRef",
    "EvidenceStatus",
    "Finding",
    "ReconciliationReport",
    "RecordReconciliation",
    "Severity",
    "Status",
    "__version__",
    "load_bundle",
    "load_bundle_json",
    "load_record",
    "reconcile",
    "reconcile_record",
    "rule_catalog",
]
