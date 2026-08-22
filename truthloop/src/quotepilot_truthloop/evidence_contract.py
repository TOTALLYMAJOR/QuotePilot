"""The shared evidence contract, loaded from ``docs/``.

Both tiers read this file. The exporter uses it to classify availability and
compute coverage; the reconciler uses it to prove its rule registry has not
drifted from it. A rule added on one side without the other fails a test rather
than silently producing a report with a hole in it.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

CONTRACT_PATH = (
    Path(__file__).resolve().parents[3] / "docs" / "truthloop-evidence-contract.json"
)


class EvidenceContractError(RuntimeError):
    """Raised when the shared contract is unreadable or self-inconsistent."""


@lru_cache(maxsize=1)
def evidence_contract() -> dict[str, Any]:
    try:
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EvidenceContractError(
            f"Shared evidence contract is unreadable at {CONTRACT_PATH}: {error}"
        ) from error
    for key in ("contractVersion", "bundleVersion", "availabilityStates", "rules"):
        if key not in contract:
            raise EvidenceContractError(f"Shared evidence contract is missing {key}.")
    return contract


def contract_bundle_version() -> str:
    return str(evidence_contract()["bundleVersion"])


def contract_rules() -> dict[str, Any]:
    return dict(evidence_contract()["rules"])


def availability_states() -> dict[str, Any]:
    return dict(evidence_contract()["availabilityStates"])
