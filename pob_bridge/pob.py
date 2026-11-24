"""Thin Python bridge to a headless Path of Building (PoE2).

Every number returned here is computed by Path of Building itself. This module
only decodes build codes, starts PoB's Lua code in a subprocess and parses the
JSON it prints.
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import tempfile
import urllib.request
import zlib
from xml.etree import ElementTree
from dataclasses import dataclass
from pathlib import Path

RESULT_MARKER = "@@EXILEFORGE_RESULT@@"
LUA_DIR = Path(__file__).resolve().parent / "lua"
DEFAULT_POB_HOME = Path(__file__).resolve().parent.parent / ".pob"

# Build sites PoB itself knows (src/Modules/BuildSiteTools.lua): link -> raw code URL.
_BUILD_SITES = [
    (re.compile(r"pobb\.in/(?:pob/)?([\w-]+)"), "https://pobb.in/pob/{}"),
    (re.compile(r"poe2?\.ninja/(?:poe2/)?pob/(?:raw/)?([\w-]+)"), "https://poe.ninja/poe2/pob/raw/{}"),
    (re.compile(r"maxroll\.gg/poe2/pob/([\w-]+)"), "https://maxroll.gg/poe2/api/pob/{}"),
    (re.compile(r"poe2db\.tw/pob/([\w-]+)"), "https://poe2db.tw/pob/{}/raw"),
    (re.compile(r"pastebin\.com/(?:raw/)?(\w+)"), "https://pastebin.com/raw/{}"),
]


class PoBError(RuntimeError):
    """Path of Building could not load or calculate the build."""


# --------------------------------------------------------------------------- codes

def decode_build_code(code: str) -> str:
    """PoB build code (url-safe base64 of zlib-compressed XML) -> XML text."""
    code = re.sub(r"\s+", "", code)
    code += "=" * (-len(code) % 4)
    try:
        raw = base64.urlsafe_b64decode(code)
        return zlib.decompress(raw).decode("utf-8")
    except (ValueError, zlib.error) as exc:
        raise PoBError(f"Not a valid Path of Building code: {exc}") from exc


def encode_build_code(xml: str) -> str:
    """XML text -> PoB build code (same format PoB's 'Generate' button produces)."""
    return base64.urlsafe_b64encode(zlib.compress(xml.encode("utf-8"), 9)).decode("ascii")


def resolve_build_input(value: str, timeout: float = 20.0) -> str:
    """Accept a build code, a link to a known build site, an XML string or a file path.

    Returns the build XML.
    """
    value = value.strip()
    if value.startswith("<"):
        return value
    try:
        is_file = Path(value).is_file()
    except OSError:  # e.g. a long build code is "too long" as a file name
        is_file = False
    if is_file:
        return resolve_build_input(Path(value).read_text(encoding="utf-8"), timeout)
    if value.startswith(("http://", "https://")):
        for pattern, raw_url in _BUILD_SITES:
            m = pattern.search(value)
            if m:
                req = urllib.request.Request(raw_url.format(m.group(1)), headers={"User-Agent": "ExileForge"})
                try:
                    with urllib.request.urlopen(req, timeout=timeout) as resp:
                        return decode_build_code(resp.read().decode("utf-8"))
                except OSError as exc:  # URLError, timeouts, proxy refusals
                    raise PoBError(f"Could not download build from {value}: {exc}") from exc
        raise PoBError(f"Unknown build site: {value}")
    return decode_build_code(value)


def check_build_xml(xml: str) -> None:
    """PoB silently falls back to an empty build on bad input, so we check first."""
    try:
        root = ElementTree.fromstring(xml.encode("utf-8"))
    except ElementTree.ParseError as exc:
        raise PoBError(f"Build XML is not valid XML: {exc}") from exc
    if root.tag == "PathOfBuilding":
        raise PoBError("This is a Path of Exile 1 build. Only PoE2 builds are supported.")
    if root.tag != "PathOfBuilding2" or root.find("Build") is None:
        raise PoBError(f"Not a Path of Building (PoE2) build (root element <{root.tag}>).")


# --------------------------------------------------------------------------- runner

@dataclass
class PathOfBuilding:
    """Handle to a local headless PoB installation (created by tools/setup_pob.sh)."""

    home: Path = DEFAULT_POB_HOME
    timeout: float = 120.0

    def __post_init__(self) -> None:
        self.home = Path(os.environ.get("EXILEFORGE_POB_HOME", self.home)).resolve()
        self.src = self.home / "PathOfBuilding-PoE2" / "src"
        if os.environ.get("EXILEFORGE_LUAJIT"):
            self.luajit = Path(os.environ["EXILEFORGE_LUAJIT"])
        elif os.name == "nt":
            # Windows: luajit.exe sits next to PoB's own lua51.dll / lua-utf8.dll
            self.luajit = self.home / "PathOfBuilding-PoE2" / "runtime" / "luajit.exe"
        else:
            self.luajit = self.home / "luajit"
        if not self.luajit.exists() or not (self.src / "HeadlessWrapper.lua").exists():
            raise PoBError(f"Path of Building not installed in {self.home}. Run tools/setup_pob.sh first.")

    def _run(self, *args: str) -> dict:
        env = dict(os.environ)
        if os.name != "nt":  # on Windows the default cpath already finds DLLs next to luajit.exe
            env["LUA_CPATH"] = f"{self.home / 'lib' / '?.so'};" + env.get("LUA_CPATH", ";;")
        proc = subprocess.run(
            [str(self.luajit), str(LUA_DIR / "runner.lua"), str(LUA_DIR), *args],
            cwd=self.src,
            env=env,
            stdin=subprocess.DEVNULL,  # PoB waits for Enter on startup errors
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=self.timeout,
        )
        for line in proc.stdout.splitlines():
            if line.startswith(RESULT_MARKER):
                result = json.loads(line[len(RESULT_MARKER):])
                if "error" in result:
                    raise PoBError(result["error"])
                return result
        tail = "\n".join((proc.stdout + proc.stderr).strip().splitlines()[-15:])
        raise PoBError(f"Path of Building produced no result (exit {proc.returncode}):\n{tail}")

    def evaluate_xml(self, xml: str) -> dict:
        check_build_xml(xml)
        with tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False, encoding="utf-8") as f:
            f.write(xml)
            path = f.name
        try:
            return self._run(path)
        finally:
            os.unlink(path)

    def evaluate(self, build: str) -> dict:
        """Build code, build-site link, XML or file path -> stats dict."""
        return self.evaluate_xml(resolve_build_input(build))

    def sample(self, skill_line: str, out_xml: Path) -> dict:
        """Create a minimal level 1 build with one skill (e.g. 'Fireball 20/0  1')."""
        return self._run("--sample", skill_line, str(Path(out_xml).resolve()))
