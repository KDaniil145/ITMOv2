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


if __name__ == "__main__":
    unittest.main()
