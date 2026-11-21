"""Build and validate the MailLedger Thunderbird .xpi package."""

from __future__ import annotations

import json
from pathlib import Path
import posixpath
import re
import sys
import zipfile


ROOT_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT_DIR / "dist"
OUTPUT_XPI = DIST_DIR / "MailLedger.xpi"

RUNTIME_FILES = [
    "manifest.json",
    "_locales/en/messages.json",
    "_locales/tr/messages.json",
    "icons/icon.svg",
    "src/i18n.js",
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

HTML_ASSET_PATTERN = re.compile(r"""(?:src|href)\s*=\s*"([^"#?]+)" """, re.VERBOSE)
DATA_I18N_PATTERN = re.compile(r"""data-i18n(?:-[a-z-]+)?\s*=\s*"([A-Za-z0-9_@]+)" """)
MSG_TOKEN_PATTERN = re.compile(r"""__MSG_([A-Za-z0-9_@]+)__""")
VALID_KEY_PATTERN = re.compile(r"""^[A-Za-z0-9_@]+$""")


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


def verify_html_references(zf: zipfile.ZipFile, entries: set[str]) -> set[str]:
    """Verify every local asset in HTML files exists and return referenced i18n keys."""
    i18n_keys: set[str] = set()
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
        for key in DATA_I18N_PATTERN.findall(html_text):
            i18n_keys.add(key)
    return i18n_keys


def verify_locales(zf: zipfile.ZipFile, manifest_text: str, manifest: dict, html_i18n_keys: set[str]) -> None:
    """Verify default_locale, locale parity between EN and TR, and all referenced keys."""
    default_locale = manifest.get("default_locale")
    if not default_locale:
        raise ValueError("manifest.json must declare default_locale when _locales/ is packaged")

    default_path = f"_locales/{default_locale}/messages.json"
    if default_path not in zf.namelist():
        raise ValueError(f"Default locale file missing: {default_path}")

    en_catalog = json.loads(zf.read("_locales/en/messages.json").decode("utf-8"))
    tr_catalog = json.loads(zf.read("_locales/tr/messages.json").decode("utf-8"))

    en_keys = set(en_catalog.keys())
    tr_keys = set(tr_catalog.keys())

    for key in sorted(en_keys | tr_keys):
        if not VALID_KEY_PATTERN.match(key):
            raise ValueError(f"Invalid WebExtension i18n key name: {key}")

    missing_in_tr = sorted(en_keys - tr_keys)
    missing_in_en = sorted(tr_keys - en_keys)
    if missing_in_tr:
        raise ValueError(f"Keys missing in _locales/tr/messages.json: {missing_in_tr}")
    if missing_in_en:
        raise ValueError(f"Keys missing in _locales/en/messages.json: {missing_in_en}")

    manifest_msg_keys = set(MSG_TOKEN_PATTERN.findall(manifest_text))
    required_keys = manifest_msg_keys | html_i18n_keys
    missing_required = sorted(required_keys - en_keys)
    if missing_required:
        raise ValueError(f"Missing i18n keys referenced by manifest/HTML: {missing_required}")


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

        manifest_text = zf.read("manifest.json").decode("utf-8")
        manifest = json.loads(manifest_text)
        manifest_refs = collect_manifest_references(manifest)
        missing_refs = sorted(manifest_refs - entry_set)
        if missing_refs:
            raise ValueError(f"Files referenced in manifest.json missing from .xpi: {missing_refs}")

        html_i18n_keys = verify_html_references(zf, entry_set)
        verify_locales(zf, manifest_text, manifest, html_i18n_keys)

        print(f"Built: {OUTPUT_XPI}")
        print(f"Version: {manifest.get('version')} (default_locale={manifest.get('default_locale')})")
        print("Archive entries:")
        for entry in entries:
            print(f"  - {entry}")
        print("Manifest, HTML asset, and i18n verification: OK")

    return OUTPUT_XPI


if __name__ == "__main__":
    try:
        build_xpi()
    except Exception as exc:  # pragma: no cover - CLI failure path
        print(f"Build failed: {exc}", file=sys.stderr)
        sys.exit(1)
