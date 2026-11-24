"""Command line: python -m pob_bridge stats <build code | link | file.xml>"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .pob import DEFAULT_POB_HOME, PathOfBuilding, PoBError, encode_build_code


def _fmt(v, pct=False):
    if v is None:
        return "-"
    return f"{v:.0f}%" if pct else f"{v:,.1f}"


def print_summary(result: dict) -> None:
    b, s = result["build"], result["stats"]
    print(f"Path of Building {result['pobVersion']}  |  {b.get('className')} / {b.get('ascendancy')}  |  Level {b.get('level')}")
    print(f"Main skill: {b.get('mainSkill') or '-'}")
    print()
    print(f"  DPS (Combined)   {_fmt(s.get('CombinedDPS'))}")
    print(f"  Hit DPS          {_fmt(s.get('TotalDPS'))}")
    print(f"  Life             {_fmt(s.get('Life'))}")
    print(f"  Energy Shield    {_fmt(s.get('EnergyShield'))}")
    for el in ("Fire", "Cold", "Lightning", "Chaos"):
        cur, total = s.get(f"{el}Resist"), s.get(f"{el}ResistTotal")
        extra = f"  (uncapped {_fmt(total, True)})" if total is not None and total != cur else ""
        print(f"  {el + ' Res':<16} {_fmt(cur, True)}{extra}")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="pob_bridge", description="Headless Path of Building (PoE2)")
    p.add_argument("--pob-home", default=str(DEFAULT_POB_HOME), help="installation from tools/setup_pob.sh")
    sub = p.add_subparsers(dest="cmd", required=True)

    st = sub.add_parser("stats", help="calculate a build")
    st.add_argument("build", help="build code, pobb.in/poe.ninja/maxroll link, or path to code/XML file; '-' reads stdin")
    st.add_argument("--json", action="store_true", help="print raw JSON")

    sm = sub.add_parser("sample", help="create a minimal test build with one skill")
    sm.add_argument("skill", help="e.g. 'Fireball 20/0  1'")
    sm.add_argument("--out", default="sample_build.xml")
    sm.add_argument("--code", action="store_true", help="also print the build code")

    args = p.parse_args(argv)
    try:
        pob = PathOfBuilding(home=Path(args.pob_home))
        if args.cmd == "stats":
            build = sys.stdin.read() if args.build == "-" else args.build
            result = pob.evaluate(build)
            print(json.dumps(result, indent=2) if args.json else "", end="")
            if not args.json:
                print_summary(result)
        else:
            result = pob.sample(args.skill, Path(args.out))
            print(f"wrote {args.out}")
            if args.code:
                print(encode_build_code(Path(args.out).read_text(encoding="utf-8")))
    except PoBError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
