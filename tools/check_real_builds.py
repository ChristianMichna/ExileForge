"""Runs real public builds through headless PoB and compares the results with
the values PoB's GUI stored in each build when it was exported (<PlayerStat>).

Usage: python tools/check_real_builds.py [tests/real_builds.txt]
Writes a Markdown table to stdout and, in GitHub Actions, to the job summary.
Exit code 1 only if a build could not be loaded or calculated at all; differing
numbers are reported, not failed, because builds may come from older PoB versions.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from xml.etree import ElementTree

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pob_bridge.pob import PathOfBuilding, PoBError, resolve_build_input  # noqa: E402

COMPARE = ["CombinedDPS", "Life", "EnergyShield", "FireResist", "ColdResist", "LightningResist", "ChaosResist"]
TOLERANCE = 0.005  # 0.5 %


def stored_stats(xml: str) -> dict:
    build = ElementTree.fromstring(xml.encode("utf-8")).find("Build")
    out = {}
    for el in build.iter("PlayerStat"):
        try:
            out[el.get("stat")] = float(el.get("value"))
        except (TypeError, ValueError):
            pass
    return out


def same(a, b) -> bool:
    if a is None or b is None:
        return a == b
    return abs(a - b) <= max(1.0, abs(b) * TOLERANCE)


def fmt(v) -> str:
    return "–" if v is None else f"{v:,.0f}"


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):  # Windows consoles default to cp1252
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    src = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "tests" / "real_builds.txt")
    entries = [l.strip() for l in src.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]
    pob = PathOfBuilding()

    rows, failures, matches, pob_version = [], 0, 0, ""
    diag_lines = []
    for entry in entries:
        name = entry.rsplit("/", 1)[-1][:16]
        try:
            xml = resolve_build_input(entry)
            if name in os.environ.get("DUMP_CODES", "").split(","):  # debugging aid for CI-only downloads
                from pob_bridge.pob import encode_build_code
                print(f"BUILDCODE {name} {encode_build_code(xml)}", file=sys.stderr)
            stored = stored_stats(xml)
            t0 = time.time()
            result = pob.evaluate_xml(xml)
            secs = time.time() - t0
        except (PoBError, OSError) as exc:
            failures += 1
            rows.append(f"| {name} | ❌ | {str(exc)[:120]} | | | | |")
            continue
        b, s = result["build"], result["stats"]
        pob_version = result["pobVersion"]
        root = ElementTree.fromstring(xml.encode("utf-8"))
        bx = root.find("Build")
        items_xml = len(root.findall("./Items/Item"))
        specs = root.findall("./Tree/Spec")
        diag_lines.append(f"{name}: xml items={items_xml} specs={len(specs)} treeVersions={[sp.get('treeVersion') for sp in specs]} "
                          f"activeSpec={root.find('Tree').get('activeSpec') if root.find('Tree') is not None else None} "
                          f"mainSocketGroup={bx.get('mainSocketGroup')} | loaded={result.get('loaded')}")
        diffs = [k for k in COMPARE if k in stored and not same(s.get(k), stored[k])]
        if not diffs:
            matches += 1
        res = "/".join(fmt(s.get(f"{e}Resist")) for e in ("Fire", "Cold", "Lightning", "Chaos"))
        verdict = "✅ wie PoB-GUI" if not diffs else "⚠️ abweichend: " + ", ".join(
            f"{k} {fmt(s.get(k))} statt {fmt(stored[k])}" for k in diffs)
        rows.append(
            f"| {name} | {b.get('className')} / {b.get('ascendancy')} L{b.get('level')} | {b.get('mainSkill') or '–'} "
            f"| {fmt(s.get('CombinedDPS'))} | {fmt(s.get('Life'))} / {fmt(s.get('EnergyShield'))} | {res} | {verdict} ({secs:.1f}s) |")

    report = "\n".join([
        f"## Echte Builds durch Path of Building {pob_version}",
        "",
        f"{len(entries)} Builds, {matches} identisch mit den in der Datei gespeicherten PoB-Werten, {failures} Fehler.",
        "",
        "| Build | Klasse | Hauptskill | DPS | Leben / ES | Res F/C/L/Ch | Vergleich mit PoB-GUI |",
        "|---|---|---|---|---|---|---|",
        *rows,
    ])
    print(report)
    print("\n".join(["", "Diagnose:"] + diag_lines))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(report + "\n")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
