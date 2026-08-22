"""Integer-cent money arithmetic.

Every monetary value in the Commercial Truth Loop is a non-negative integer
number of cents. Floating point never touches money here: a reconciler that
reports a one-cent discrepancy must be arithmetically incapable of inventing
one.

USD/minor-unit only, matching the accepted-proposal snapshot contract in
``functions/proposalAcceptance.js`` (``totalsMinor``) and the payment ledger in
``functions/paymentLedger.js`` (``amountCents``).
"""

from __future__ import annotations

BASIS_POINTS_DIVISOR = 10_000


class MoneyError(ValueError):
    """Raised when a value cannot be represented as evidence-grade money."""


def cents(value: object, label: str, *, allow_negative: bool = False) -> int:
    """Coerce ``value`` into an exact integer cent amount.

    Accepts only ``int`` (and ``bool`` is rejected explicitly, because Python
    treats it as an ``int`` and a boolean in a money field is always a bug).
    Floats are rejected rather than rounded: an upstream float means the
    exporter lost precision before this process ever saw the number, and
    silently rounding it here would manufacture false confidence.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        raise MoneyError(f"{label} must be an integer number of cents.")
    if not allow_negative and value < 0:
        raise MoneyError(f"{label} must not be negative.")
    return value


def add(*amounts: int) -> int:
    """Sum cent amounts."""
    return sum(amounts)


def apply_basis_points(amount_cents: int, basis_points: int) -> int:
    """Return ``amount_cents * basis_points / 10000``, rounded half up.

    Pure integer arithmetic, so the result is exactly reproducible on every
    platform and in every Python build. Half-up matches how card processors
    publish percentage fees.
    """
    if amount_cents < 0:
        raise MoneyError("Basis points cannot be applied to a negative amount.")
    if basis_points < 0:
        raise MoneyError("Basis points must not be negative.")
    scaled = amount_cents * basis_points
    return (scaled + BASIS_POINTS_DIVISOR // 2) // BASIS_POINTS_DIVISOR


def format_usd(amount_cents: int) -> str:
    """Render cents as an operator-readable USD string.

    Used only for narrative text. No downstream comparison reads this value.
    """
    sign = "-" if amount_cents < 0 else ""
    magnitude = abs(amount_cents)
    return f"{sign}${magnitude // 100:,}.{magnitude % 100:02d}"
