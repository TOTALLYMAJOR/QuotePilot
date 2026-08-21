"""Command line entry point.

    python -m quotepilot_truthloop reconcile <bundle.json>
    python -m quotepilot_truthloop rules

Reads a bundle from a path or stdin and writes the reconciliation report to
stdout. Reading and writing files is the only I/O this package performs; it
never opens a network connection or touches a credential.

Exit codes:
    0  every record fully reconciled
    1  the loop ran and found discrepancies or unverifiable evidence
    2  the bundle could not be loaded at all
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence

from .engine import reconcile
from .loader import BundleError, load_bundle_json
from .money import format_usd
from .rules import rule_catalog

EXIT_RECONCILED = 0
EXIT_FINDINGS = 1
EXIT_BUNDLE_ERROR = 2


def _read_source(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _render_text(report) -> str:
    metrics = report.metrics
    lines = [
        f"Commercial Truth Loop — evaluated {report.evaluated_at_iso}",
        (
            f"{metrics['recordsFullyReconciled']}/{metrics['recordsEvaluated']} records "
            f"fully reconciled "
            f"({metrics['fullyReconciledBasisPoints'] / 100:.2f}%)"
        ),
        (
            f"{metrics['openDiscrepancies']} discrepancy(ies), "
            f"{metrics['unverifiableFindings']} unverifiable, "
            f"{format_usd(metrics['unexplainedAmountCents'])} unexplained"
        ),
        "",
    ]
    for record in report.records:
        state = "reconciled" if record.fully_reconciled else "OPEN"
        lines.append(
            f"[{state}] {record.quote_number or record.quote_id} "
            f"({record.organization_id})"
        )
        for finding in record.findings:
            if finding.status.value == "explained":
                continue
            lines.append(
                f"  - {finding.status.value}/{finding.severity.value} "
                f"{finding.rule_id}: {finding.narrative}"
            )
        lines.append("")
    for rejection in report.rejected:
        lines.append(
            f"[rejected] record {rejection.get('index')} "
            f"{rejection.get('quoteId', '')}: {rejection.get('reason', '')}"
        )
    return "\n".join(lines).rstrip() + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="quotepilot_truthloop",
        description="Reconcile the QuotePilot commercial chain from exported evidence.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    reconcile_parser = subparsers.add_parser(
        "reconcile", help="Reconcile an evidence bundle."
    )
    reconcile_parser.add_argument(
        "bundle", help="Path to a JSON evidence bundle, or - for stdin."
    )
    reconcile_parser.add_argument(
        "--format",
        choices=("json", "text"),
        default="text",
        help="Output format (default: text).",
    )
    reconcile_parser.add_argument(
        "--out", default="", help="Write the report to this path instead of stdout."
    )

    subparsers.add_parser("rules", help="Print the rule catalog as JSON.")

    args = parser.parse_args(argv)

    if args.command == "rules":
        sys.stdout.write(json.dumps(rule_catalog(), indent=2, sort_keys=True) + "\n")
        return EXIT_RECONCILED

    try:
        evaluated_at_iso, records, rejected = load_bundle_json(_read_source(args.bundle))
    except (BundleError, OSError) as error:
        sys.stderr.write(f"Evidence bundle could not be loaded: {error}\n")
        return EXIT_BUNDLE_ERROR

    report = reconcile(records, evaluated_at_iso, rejected=rejected)
    rendered = report.to_json() + "\n" if args.format == "json" else _render_text(report)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(rendered)
    else:
        sys.stdout.write(rendered)

    metrics = report.metrics
    clean = (
        metrics["openDiscrepancies"] == 0
        and metrics["unverifiableFindings"] == 0
        and metrics["recordsRejected"] == 0
    )
    return EXIT_RECONCILED if clean else EXIT_FINDINGS


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
