import unittest
from service import choose_belt


class ChooseBeltTest(unittest.TestCase):
    def test_weight_5_standard(self):
        self.assertEqual(choose_belt(5), "standard")

    def test_weight_10_standard(self):
        self.assertEqual(choose_belt(10), "standard")

    def test_weight_15_heavy(self):
        self.assertEqual(choose_belt(15), "heavy")

    def test_weight_zero_raises(self):
        with self.assertRaises(ValueError):
            choose_belt(0)

    def test_weight_negative_raises(self):
        with self.assertRaises(ValueError):
            choose_belt(-5)

    # Feature B: priority sorting
    def test_priority_true_standard_weight_returns_express(self):
        self.assertEqual(choose_belt(5, priority=True), "express")

    def test_priority_true_boundary_10_returns_express(self):
        self.assertEqual(choose_belt(10, priority=True), "express")

    def test_priority_true_heavy_still_heavy(self):
        self.assertEqual(choose_belt(15, priority=True), "heavy")

    def test_priority_true_zero_raises(self):
        with self.assertRaises(ValueError):
            choose_belt(0, priority=True)

    def test_priority_true_negative_raises(self):
        with self.assertRaises(ValueError):
            choose_belt(-1, priority=True)

    def test_priority_false_behaves_as_standard(self):
        self.assertEqual(choose_belt(5, priority=False), "standard")


if __name__ == "__main__":
    unittest.main()
