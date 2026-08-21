"""Record builders for the rule tests.

Each test starts from a fully reconciled record and breaks exactly one thing,
so a failure names the rule that regressed rather than a tangle of inputs.
"""

from __future__ import annotations

import copy
import json
import os
from typing import Any

from quotepilot_truthloop.loader import load_record
from quotepilot_truthloop.model import CommercialRecord

FIXTURE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fixtures")
EXAMPLE_BUNDLE_PATH = os.path.join(FIXTURE_DIR, "example-bundle.json")


def example_bundle() -> dict[str, Any]:
    with open(EXAMPLE_BUNDLE_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def clean_record_dict() -> dict[str, Any]:
    """The example record with its one known gap (travel) removed."""
    raw = copy.deepcopy(example_bundle()["records"][0])
    totals = raw["acceptedSnapshot"]["totalsMinor"]
    totals["total"] -= totals["travel"]
    totals["travel"] = 0
    return raw


def record_from(overrides: dict[str, Any] | None = None) -> CommercialRecord:
    raw = clean_record_dict()
    if overrides:
        _deep_update(raw, overrides)
    return load_record(raw)


def _deep_update(target: dict[str, Any], patch: dict[str, Any]) -> None:
    """Merge ``patch`` into ``target``.

    An empty dict replaces rather than merges, so a test can clear a whole
    evidence section (``{"acceptedSnapshot": {}}``) as easily as it can tweak
    one field inside it.
    """
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict) and value:
            _deep_update(target[key], value)
        else:
            target[key] = value


def finding_for(record: CommercialRecord, rule_id: str):
    from quotepilot_truthloop.engine import reconcile_record

    result = reconcile_record(record, "2026-08-21T14:00:00.000Z")
    for finding in result.findings:
        if finding.rule_id == rule_id:
            return finding
    raise AssertionError(f"No finding produced for rule {rule_id}.")
