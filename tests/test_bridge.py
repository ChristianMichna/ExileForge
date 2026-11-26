"""Run with: python3 -m unittest discover tests"""

import os
import unittest
from pathlib import Path

from pob_bridge.pob import PathOfBuilding, PoBError, decode_build_code, encode_build_code

FIXTURE = Path(__file__).parent / "fixtures" / "witch_spark_lvl60.xml"

try:
    POB = PathOfBuilding()
except PoBError:
    if os.environ.get("ASTROLABE_REQUIRE_POB"):  # CI: never skip silently
        raise
    POB = None


class BuildCodeTest(unittest.TestCase):
    def test_roundtrip(self):
        xml = FIXTURE.read_text(encoding="utf-8")
        self.assertEqual(decode_build_code(encode_build_code(xml)), xml)

    def test_invalid_code(self):
        with self.assertRaises(PoBError):
            decode_build_code("definitely-not-a-build")


@unittest.skipIf(POB is None, "Path of Building not installed (run tools/setup_pob.sh)")
class HeadlessPoBTest(unittest.TestCase):
    # Expected values were produced by PoB 0.23.1 itself. If a PoB update
    # changes them, that is exactly the "patch changed my build" signal.
    def test_fixture_stats(self):
        result = POB.evaluate(str(FIXTURE))
        self.assertEqual(result["build"]["className"], "Witch")
        self.assertEqual(result["build"]["level"], 60)
        self.assertEqual(result["build"]["mainSkill"], "Spark")
        s = result["stats"]
        self.assertEqual(s["Life"], 1124)
        self.assertEqual(s["EnergyShield"], 294)
        self.assertEqual((s["FireResist"], s["ColdResist"], s["LightningResist"], s["ChaosResist"]), (-20, -25, -15, 20))
        self.assertAlmostEqual(s["CombinedDPS"], 117.88, places=1)

    def test_requirement_stats_are_present(self):
        # PoB sets ReqStr/ReqDex/ReqInt only above zero; the bridge reads its "<name>String"
        # marker so that "no requirement" arrives as 0 and a failed calculation as missing.
        s = POB.evaluate(str(FIXTURE))["stats"]
        for key in ("Str", "Dex", "Int", "ReqStr", "ReqDex", "ReqInt"):
            self.assertIn(key, s)
            self.assertGreaterEqual(s[key], 0)

    def test_same_result_via_build_code(self):
        code = encode_build_code(FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(POB.evaluate(code)["stats"], POB.evaluate(str(FIXTURE))["stats"])

    def test_garbage_xml_reports_error(self):
        with self.assertRaises(PoBError):
            POB.evaluate_xml("<NotABuild/>")


if __name__ == "__main__":
    unittest.main()
