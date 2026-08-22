import unittest

from quotepilot_truthloop.money import (
    MoneyError,
    apply_basis_points,
    cents,
    format_usd,
)


class CentsTest(unittest.TestCase):
    def test_accepts_non_negative_integers(self):
        self.assertEqual(cents(0, "amount"), 0)
        self.assertEqual(cents(480000, "amount"), 480000)

    def test_rejects_floats_rather_than_rounding(self):
        with self.assertRaises(MoneyError):
            cents(4800.00, "amount")

    def test_rejects_booleans(self):
        with self.assertRaises(MoneyError):
            cents(True, "amount")

    def test_rejects_strings(self):
        with self.assertRaises(MoneyError):
            cents("480000", "amount")

    def test_rejects_negative_unless_allowed(self):
        with self.assertRaises(MoneyError):
            cents(-1, "amount")
        self.assertEqual(cents(-1, "amount", allow_negative=True), -1)


class BasisPointsTest(unittest.TestCase):
    def test_reproduces_the_declared_processing_fee(self):
        # 3.25% of $4,800.00 plus a $1.20 fixed component is $157.20.
        self.assertEqual(apply_basis_points(480000, 325) + 120, 15720)

    def test_rounds_half_up(self):
        # 1 cent at 50% is exactly half a cent and must round up.
        self.assertEqual(apply_basis_points(1, 5000), 1)
        self.assertEqual(apply_basis_points(1, 4999), 0)

    def test_is_exact_for_large_amounts(self):
        self.assertEqual(apply_basis_points(10_000_000_000, 290), 290_000_000)

    def test_rejects_negative_inputs(self):
        with self.assertRaises(MoneyError):
            apply_basis_points(-1, 290)
        with self.assertRaises(MoneyError):
            apply_basis_points(100, -1)


class FormatTest(unittest.TestCase):
    def test_formats_usd_with_separators(self):
        self.assertEqual(format_usd(464280), "$4,642.80")
        self.assertEqual(format_usd(5), "$0.05")
        self.assertEqual(format_usd(0), "$0.00")
        self.assertEqual(format_usd(-15720), "-$157.20")


if __name__ == "__main__":
    unittest.main()
