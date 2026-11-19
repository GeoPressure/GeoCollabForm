#!/usr/bin/env python3
"""Build the bird sticker exceptions table for the species panel.

Stickers come from https://github.com/alchaincyf/huashu-bird-sticker (CC BY 4.0).
The app derives the sticker path from the species CSV as
  stickers/<order_name>/<family_name>/<Genus_species>.webp
This script writes only the species where that rule fails, to
src/data/bird_sticker_overrides.json: {scientific_name: file or null}.
A species missing from the sticker index is matched by English name; if that fails too,
it gets null and the panel shows no sticker.

Usage: python3 scripts/build_sticker_overrides.py [path/to/stickers.json]
Without an argument the index is downloaded from jsDelivr.
"""

from __future__ import annotations

import csv
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPECIES_CSV = ROOT / "src" / "data" / "avilist_soi_avonet_joined.csv"
OUT_JSON = ROOT / "src" / "data" / "bird_sticker_overrides.json"
INDEX_URL = "https://cdn.jsdelivr.net/gh/alchaincyf/huashu-bird-sticker@main/data/stickers.json"


def load_index(arg: str | None) -> dict:
    if arg:
        return json.loads(Path(arg).read_text(encoding="utf-8"))
    with urllib.request.urlopen(INDEX_URL) as resp:
        return json.load(resp)


def main() -> None:
    index = load_index(sys.argv[1] if len(sys.argv) > 1 else None)
    stickers = index["stickers"]
    by_sci = {s["scientificName"]: s["file"] for s in stickers}
    by_en = {s["en"].casefold(): s["file"] for s in stickers if s.get("en")}

    overrides: dict[str, str | None] = {}
    with SPECIES_CSV.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            sci = row["scientific_name"].strip()
            default = f"stickers/{row['order_name']}/{row['family_name']}/{sci.replace(' ', '_')}.webp"
            file = by_sci.get(sci) or by_en.get(row["common_name"].strip().casefold())
            if file != default:
                overrides[sci] = file

    OUT_JSON.write_text(json.dumps(dict(sorted(overrides.items())), indent=1) + "\n", encoding="utf-8")
    missing = sum(v is None for v in overrides.values())
    print(f"index v{index.get('version')}: {len(overrides)} overrides, {missing} without sticker -> {OUT_JSON}")


if __name__ == "__main__":
    main()
