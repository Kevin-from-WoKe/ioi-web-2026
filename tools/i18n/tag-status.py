#!/usr/bin/env python3
"""
Apply macOS Finder color tags to i18n/cn/*.json files based on translation completeness.

  Red    = 0 / N translated  (not started)
  Yellow = partial          (in progress)
  Green  = N / N translated (complete)

Usage:  python3 tools/i18n/tag-status.py
"""

import json
import plistlib
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CN_DIR = REPO / "i18n" / "cn"

# Apple's built-in tag color indices (used inside the _kMDItemUserTags plist)
TAGS = {
    "red":    ("Red",    6),
    "yellow": ("Yellow", 5),
    "green":  ("Green",  2),
}


def set_tag(path: Path, color: str) -> None:
    name, idx = TAGS[color]
    tag_str = f"{name}\n{idx}"
    plist = plistlib.dumps([tag_str], fmt=plistlib.FMT_BINARY)
    subprocess.run(
        ["xattr", "-wx", "com.apple.metadata:_kMDItemUserTags",
         plist.hex(), str(path)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def status(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    strings = data.get("strings", [])
    total = len(strings)
    if total == 0:
        return "green", 0, 0
    done = sum(1 for s in strings if s.get("cn", "").strip())
    if done == 0:
        return "red", done, total
    if done == total:
        return "green", done, total
    return "yellow", done, total


def main() -> int:
    if not CN_DIR.exists():
        print(f"ERROR: {CN_DIR} not found", file=sys.stderr)
        return 1

    files = sorted(CN_DIR.rglob("*.json"))
    counts = {"red": 0, "yellow": 0, "green": 0}

    for f in files:
        color, done, total = status(f)
        set_tag(f, color)
        counts[color] += 1
        rel = f.relative_to(REPO)
        print(f"  {color.upper():6}  {done:>4}/{total:<4}  {rel}")

    print(f"\nTagged {len(files)} files: "
          f"{counts['red']} red, {counts['yellow']} yellow, {counts['green']} green.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
