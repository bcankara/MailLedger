"""Build and validate the Mail Tarihçe Günlüğü Thunderbird .xpi package."""

from __future__ import annotations

import json
from pathlib import Path
import posixpath
import re
import sys
import zipfile


ROOT_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT_DIR / "dist"
OUTPUT_XPI = DIST_DIR / "mail-tarihce-gunlugu.xpi"

RUNTIME_FILES = [
    "manifest.json",
    "icons/icon.svg",
    "src/store.js",
    "src/mailActions.js",
    "src/background.js",
    "ui/popup.html",
    "ui/popup.css",
    "ui/popup.js",
    "ui/dashboard.html",
    "ui/dashboard.css",
    "ui/dashboard.js",
    "ui/options.html",
    "ui/options.css",
    "ui/options.js",
]

HTML_ASSET_PATTERN = re.compile(
    r"""(?:src|href)\s*=\s*"([^"#?]+)" """,
    re.VERBOSE,
)


def collect_manifest_references(manifest: dict) -> set[str]:
    """Collect relative file paths referenced by manifest.json."""
    refs: set[str] = set()

    for icon_path in (manifest.get("icons") or {}).values():
        if isinstance(icon_path, str):
            refs.add(icon_path)

    action = manifest.get("action") or {}
    default_icon = action.get("default_icon")
    if isinstance(default_icon, str):
        refs.add(default_icon)
    elif isinstance(default_icon, dict):
        for icon_path in default_icon.values():
            if isinstance(icon_path, str):
                refs.add(icon_path)

    default_popup = action.get("default_popup")
    if isinstance(default_popup, str):
        refs.add(default_popup)

    options_ui = manifest.get("options_ui") or {}
    options_page = options_ui.get("page")
    if isinstance(options_page, str):
        refs.add(options_page)

    background = manifest.get("background") or {}
    for script_path in background.get("scripts") or []:
        if isinstance(script_path, str):
            refs.add(script_path)

    return refs


def verify_html_references(zf: zipfile.ZipFile, entries: set[str]) -> None:
    """Verify every local script/style/image reference in packaged HTML files exists."""
    for entry in sorted(entries):
        if not entry.endswith(".html"):
            continue
        html_text = zf.read(entry).decode("utf-8")
        base_dir = posixpath.dirname(entry)
        for ref in HTML_ASSET_PATTERN.findall(html_text):
            if ref.startswith(("http://", "https://", "mailto:", "data:")):
                continue
            resolved = posixpath.normpath(posixpath.join(base_dir, ref))
            if resolved not in entries:
                raise ValueError(f"{entry} references missing asset: {ref} (resolved: {resolved})")


def build_xpi() -> Path:
    """Package runtime files into a POSIX-normalized .xpi archive and verify it."""
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(OUTPUT_XPI, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel_path in RUNTIME_FILES:
            src_path = ROOT_DIR / rel_path
            if not src_path.is_file():
                raise FileNotFoundError(f"Missing runtime file: {src_path}")
            arcname = Path(rel_path).as_posix()
            zf.write(src_path, arcname=arcname)

    with zipfile.ZipFile(OUTPUT_XPI, "r") as zf:
        entries = zf.namelist()
        entry_set = set(entries)
        if any("\\" in entry for entry in entries):
            raise ValueError(f"Backslash path detected in archive: {entries}")
        if "manifest.json" not in entry_set:
            raise ValueError("manifest.json is missing from archive root")

        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        manifest_refs = collect_manifest_references(manifest)
        missing_refs = sorted(manifest_refs - entry_set)
        if missing_refs:
            raise ValueError(f"Files referenced in manifest.json missing from .xpi: {missing_refs}")

        verify_html_references(zf, entry_set)

        print(f"Built: {OUTPUT_XPI}")
        print(f"Version: {manifest.get('version')}")
        print("Archive entries:")
        for entry in entries:
            print(f"  - {entry}")
        print("Manifest & HTML asset verification: OK")

    return OUTPUT_XPI


if __name__ == "__main__":
    try:
        build_xpi()
    except Exception as exc:  # pragma: no cover - CLI failure path
        print(f"Build failed: {exc}", file=sys.stderr)
        sys.exit(1)
