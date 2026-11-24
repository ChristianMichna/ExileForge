"""Golden builds: a fixed corpus of PoE2 builds with expected values that
headless Path of Building calculated once. Every change is checked against
them, and a new PoB release shows up as a deliberate re-record.

    python tools/golden_builds.py fetch    # download missing builds (sources in manifest)
    python tools/golden_builds.py record   # run PoB, write expected/<id>.json
    python tools/golden_builds.py check    # run PoB, compare with expected/<id>.json

Options: --only ID (repeatable), --missing (record only unrecorded builds),
--pob-home DIR.
Needs the PoB bridge (pob_bridge/, tools/setup_pob.sh) for fetch/record/check.

Expected values are never written by hand: `record` stores exactly what PoB
returned, plus the PoB version and pinned commit it came from. The values the
PoB GUI saved in the build file (<PlayerStat>) are kept next to them:
`record` refuses a build whose headless result differs from them (builds
from older patches or PoB versions), unless the manifest entry sets
"acceptGuiDiff" with a reason. Broad GUI comparisons stay with
tools/check_real_builds.py (PR #2).

Exit codes: 0 all good (unrecorded builds are listed, not failed),
1 regression, PoB error or changed PoB version, 2 usage error.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = ROOT / "evals" / "golden"
SETUP_SCRIPT = ROOT / "tools" / "setup_pob.sh"


# --- pure helpers (unit-tested in tools/test_golden_builds.py) ---------------


@dataclass(frozen=True)
class Tolerance:
    relative: float
    absolute: float

    def same(self, actual: float | None, expected: float | None) -> bool:
        # A missing value only matches a missing value: no silent fallback to 0.
        if actual is None or expected is None:
            return actual is None and expected is None
        if math.isnan(actual) or math.isnan(expected):
            return False
        return abs(actual - expected) <= max(self.absolute, abs(expected) * self.relative)


@dataclass
class Diff:
    stat: str
    expected: float | None
    actual: float | None


@dataclass
class Outcome:
    id: str
    status: str  # "ok" | "regression" | "missing" | "error" | "pob-changed"
    detail: str = ""
    diffs: list[Diff] = field(default_factory=list)


def compare_stats(actual: dict, expected: dict, keys: list[str], tol: Tolerance) -> list[Diff]:
    return [Diff(k, expected.get(k), actual.get(k)) for k in keys if not tol.same(actual.get(k), expected.get(k))]


def gui_stats(xml: str) -> dict[str, float]:
    """Values the PoB GUI stored in the build file when it was exported."""
    build = ElementTree.fromstring(xml.encode("utf-8")).find("Build")
    out: dict[str, float] = {}
    if build is None:
        return out
    for el in build.iter("PlayerStat"):
        try:
            out[el.get("stat", "")] = float(el.get("value", ""))
        except ValueError:
            continue  # non-numeric GUI stats are not compared
    return out


def pinned_pob_ref(setup_script: Path = SETUP_SCRIPT) -> str | None:
    """The PoB commit tools/setup_pob.sh pins (env POB_REF overrides, like the script)."""
    if os.environ.get("POB_REF"):
        return os.environ["POB_REF"]
    if not setup_script.exists():
        return None
    m = re.search(r'^POB_REF="\$\{POB_REF:-([0-9a-f]+)\}"', setup_script.read_text(encoding="utf-8"), re.M)
    return m.group(1) if m else None


def fmt(v: float | None) -> str:
    return "–" if v is None else f"{v:,.2f}".rstrip("0").rstrip(".")


def report(outcomes: list[Outcome], pob_version: str, pob_ref: str | None) -> str:
    ok = sum(o.status == "ok" for o in outcomes)
    lines = [
        f"## Golden Builds gegen Path of Building {pob_version or '?'}",
        "",
        f"PoB-Commit `{pob_ref or '?'}`. {len(outcomes)} Builds, {ok} unverändert, {len(outcomes) - ok} mit Befund.",
        "",
        "| Build | Ergebnis | Details |",
        "|---|---|---|",
    ]
    icons = {"ok": "✅", "regression": "❌ Abweichung", "missing": "⚠️ nicht aufgezeichnet",
             "error": "❌ Fehler", "pob-changed": "🔁 PoB-Version gewechselt"}
    for o in outcomes:
        detail = o.detail or ", ".join(f"{d.stat} {fmt(d.actual)} statt {fmt(d.expected)}" for d in o.diffs)
        lines.append(f"| {o.id} | {icons.get(o.status, o.status)} | {detail} |")
    return "\n".join(lines)


# --- corpus files ------------------------------------------------------------


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"error: cannot read {path.relative_to(ROOT)}: {exc}") from exc


def entries(only: list[str] | None) -> list[dict]:
    builds = load_json(GOLDEN / "manifest.json")["builds"]
    ids = [b["id"] for b in builds]
    if len(ids) != len(set(ids)):
        raise SystemExit("error: duplicate ids in evals/golden/manifest.json")
    if only:
        unknown = set(only) - set(ids)
        if unknown:
            raise SystemExit(f"error: unknown build id(s): {', '.join(sorted(unknown))}")
        builds = [b for b in builds if b["id"] in only]
    return builds


def build_path(build_id: str) -> Path:
    return GOLDEN / "builds" / f"{build_id}.xml"


def expected_path(build_id: str) -> Path:
    return GOLDEN / "expected" / f"{build_id}.json"


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


# --- commands ----------------------------------------------------------------


def bridge():
    sys.path.insert(0, str(ROOT))
    try:
        from pob_bridge import pob  # noqa: PLC0415
    except ImportError as exc:
        raise SystemExit("error: pob_bridge not found. The PoB bridge (PR #2) must be in the checkout.") from exc
    return pob


def cmd_fetch(args) -> int:
    pob = bridge()
    failed = 0
    for b in entries(args.only):
        dest = build_path(b["id"])
        if dest.exists():
            continue
        src = b["source"]
        local = ROOT / src
        try:
            xml = local.read_text(encoding="utf-8") if local.is_file() else pob.resolve_build_input(src)
            pob.check_build_xml(xml)
        except (pob.PoBError, OSError) as exc:
            failed += 1
            print(f"FAIL {b['id']}: {exc}", file=sys.stderr)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(xml, encoding="utf-8")
        print(f"fetched {b['id']}")
    return 1 if failed else 0


def evaluate(pob, engine, build_id: str) -> tuple[str, dict]:
    xml = build_path(build_id).read_text(encoding="utf-8")
    return xml, engine.evaluate_xml(xml)


def cmd_record(args) -> int:
    pob = bridge()
    engine = pob.PathOfBuilding(**({"home": Path(args.pob_home)} if args.pob_home else {}))
    cfg = load_json(GOLDEN / "config.json")
    gui_tol = Tolerance(**cfg["guiTolerance"])
    ref = pinned_pob_ref()
    failed = 0
    for b in entries(args.only):
        if args.missing and expected_path(b["id"]).exists():
            continue
        if not build_path(b["id"]).exists():
            failed += 1
            print(f"MISSING {b['id']}: run `fetch` first", file=sys.stderr)
            continue
        try:
            xml, result = evaluate(pob, engine, b["id"])
        except pob.PoBError as exc:
            failed += 1
            print(f"FAIL {b['id']}: {exc}", file=sys.stderr)
            continue
        gui = {k: v for k, v in gui_stats(xml).items() if k in cfg["compareStats"]}
        gui_diffs = compare_stats(result["stats"], gui, sorted(gui), gui_tol)
        if gui_diffs and not b.get("acceptGuiDiff"):
            # A golden build must calculate headless exactly as in the PoB GUI that
            # saved it; otherwise its numbers are not trustworthy expected values
            # (e.g. saved with another PoB version or game patch).
            failed += 1
            print(f"REJECTED {b['id']}: differs from the values the PoB GUI saved: "
                  + ", ".join(f"{d.stat} {fmt(d.actual)} vs GUI {fmt(d.expected)}" for d in gui_diffs)
                  + ". Remove it from the manifest or set acceptGuiDiff with a reason.", file=sys.stderr)
            continue
        write_json(expected_path(b["id"]), {
            "id": b["id"],
            "recordedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "pobVersion": result.get("pobVersion"),
            "pobRef": ref,
            "build": result.get("build", {}),
            "stats": result["stats"],
            "gui": {
                "stats": gui,
                "differs": [d.stat for d in gui_diffs],
            },
        })
        print(f"recorded {b['id']} (PoB {result.get('pobVersion')})")
    return 1 if failed else 0


def cmd_check(args) -> int:
    pob = bridge()
    engine = pob.PathOfBuilding(**({"home": Path(args.pob_home)} if args.pob_home else {}))
    cfg = load_json(GOLDEN / "config.json")
    tol = Tolerance(**cfg["tolerance"])
    ref = pinned_pob_ref()
    outcomes: list[Outcome] = []
    pob_version = ""
    for b in entries(args.only):
        bid = b["id"]
        if not build_path(bid).exists() or not expected_path(bid).exists():
            outcomes.append(Outcome(bid, "missing", "`fetch` und `record` ausführen"))
            continue
        expected = load_json(expected_path(bid))
        if expected.get("pobRef") != ref:
            outcomes.append(Outcome(bid, "pob-changed",
                                    f"aufgezeichnet mit `{expected.get('pobRef')}`, gepinnt ist `{ref}`: neu aufzeichnen und Diff prüfen"))
            continue
        try:
            _, result = evaluate(pob, engine, bid)
        except pob.PoBError as exc:
            outcomes.append(Outcome(bid, "error", str(exc).splitlines()[0][:200]))
            continue
        pob_version = result.get("pobVersion") or pob_version
        diffs = compare_stats(result["stats"], expected["stats"], cfg["compareStats"], tol)
        outcomes.append(Outcome(bid, "regression" if diffs else "ok", diffs=diffs))

    text = report(outcomes, pob_version, ref)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(text + "\n")
    # Unrecorded builds are reported but do not fail: adding a build to the
    # manifest must not turn every open PR red until its values are committed.
    return 0 if all(o.status in ("ok", "missing") for o in outcomes) else 1


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):  # Windows consoles default to cp1252
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=["fetch", "record", "check"])
    p.add_argument("--only", action="append", metavar="ID", help="limit to this build id (repeatable)")
    p.add_argument("--missing", action="store_true", help="record: only builds without expected values")
    p.add_argument("--pob-home", help="PoB install dir (default: .pob, or EXILEFORGE_POB_HOME)")
    args = p.parse_args(argv)
    return {"fetch": cmd_fetch, "record": cmd_record, "check": cmd_check}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
