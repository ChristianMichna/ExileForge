"""Unit tests for the pure parts of tools/golden_builds.py (no PoB needed).

    python -m unittest discover -s tools -p "test_*.py"
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import golden_builds as gb  # noqa: E402

TOL = gb.Tolerance(relative=0.0001, absolute=0.01)


class ToleranceTest(unittest.TestCase):
    def test_equal_values_match(self):
        self.assertTrue(TOL.same(1234.5, 1234.5))

    def test_relative_tolerance_scales_with_value(self):
        self.assertTrue(TOL.same(1_000_050.0, 1_000_000.0))
        self.assertFalse(TOL.same(1_000_200.0, 1_000_000.0))

    def test_absolute_tolerance_for_small_values(self):
        self.assertTrue(TOL.same(0.005, 0.0))
        self.assertFalse(TOL.same(0.5, 0.0))

    def test_missing_value_never_matches_a_number(self):
        self.assertFalse(TOL.same(None, 0.0))
        self.assertFalse(TOL.same(0.0, None))
        self.assertTrue(TOL.same(None, None))

    def test_nan_never_matches(self):
        self.assertFalse(TOL.same(float("nan"), float("nan")))


class CompareTest(unittest.TestCase):
    def test_reports_only_differing_keys(self):
        diffs = gb.compare_stats({"A": 1.0, "B": 2.0}, {"A": 1.0, "B": 3.0}, ["A", "B"], TOL)
        self.assertEqual([d.stat for d in diffs], ["B"])

    def test_stat_missing_in_result_is_a_diff(self):
        diffs = gb.compare_stats({}, {"A": 1.0}, ["A"], TOL)
        self.assertEqual(len(diffs), 1)
        self.assertIsNone(diffs[0].actual)


class GuiStatsTest(unittest.TestCase):
    def test_reads_numeric_player_stats(self):
        xml = ('<PathOfBuilding2><Build><PlayerStat stat="A" value="12.5"/>'
               '<PlayerStat stat="B" value="n/a"/></Build></PathOfBuilding2>')
        self.assertEqual(gb.gui_stats(xml), {"A": 12.5})

    def test_no_build_element(self):
        self.assertEqual(gb.gui_stats("<PathOfBuilding2/>"), {})


class PinnedRefTest(unittest.TestCase):
    def test_reads_ref_from_setup_script(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "setup_pob.sh"
            p.write_text('POB_REF="${POB_REF:-abc123}"   # comment\n', encoding="utf-8")
            self.assertEqual(gb.pinned_pob_ref(p), "abc123")

    def test_missing_script(self):
        self.assertIsNone(gb.pinned_pob_ref(Path("/nonexistent/setup_pob.sh")))


class ReportTest(unittest.TestCase):
    def test_lists_every_outcome(self):
        text = gb.report([gb.Outcome("x", "ok"), gb.Outcome("y", "regression", diffs=[gb.Diff("Life", 10.0, 9.0)])],
                         "0.0", "ref")
        self.assertIn("| x | ✅ |", text)
        self.assertIn("Life 9 statt 10", text)


if __name__ == "__main__":
    unittest.main()
