import unittest

from scoring.risk import classify_severity_by_type


class RiskSeverityByPerilTests(unittest.TestCase):
    def test_flood_thresholds(self) -> None:
        self.assertEqual(classify_severity_by_type(4.0, "flood"), "Critical")
        self.assertEqual(classify_severity_by_type(3.0, "flood"), "High")
        self.assertEqual(classify_severity_by_type(2.0, "flood"), "Moderate")
        self.assertEqual(classify_severity_by_type(1.0, "flood"), "Low")

    def test_volcano_thresholds(self) -> None:
        self.assertEqual(classify_severity_by_type(4.0, "volcano"), "Critical")
        self.assertEqual(classify_severity_by_type(3.0, "volcano"), "High")
        self.assertEqual(classify_severity_by_type(2.0, "volcano"), "Moderate")
        self.assertEqual(classify_severity_by_type(1.0, "volcano"), "Low")

    def test_unknown_type_falls_back_to_earthquake_logic(self) -> None:
        self.assertEqual(classify_severity_by_type(6.2, "other"), "Critical")
        self.assertEqual(classify_severity_by_type(4.2, "other"), "Moderate")
