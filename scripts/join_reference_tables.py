#!/usr/bin/env python3
"""Join AviList + SOI flights + AVONET for target orders.

Rules:
- AviList is the reference table.
- Keep AviList rows where:
  - Taxon_rank == 'species'
  - Order is one of target orders
- Join SOI flights on scientific name:
  AviList.Scientific_name == SOI flights.Species_latin
  Retrieve Number_loggers_approx as:
  - soi_number_loggers_approx_raw
- Join AVONET on scientific name:
  AviList.Scientific_name == AVONET2_eBird.Species2
  Retrieve body_mass_g from AVONET2_eBird.Mass
  If no scientific-name match is found, fallback to:
  AviList.AvibaseID == AVONET2_eBird.Avibase.ID2

Output:
- CSV file in data/ by default.
"""

from __future__ import annotations

import argparse
import csv
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from pathlib import Path
from statistics import mean
from typing import Dict, Iterable, List

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
FRONTEND_DATA_CSV = ROOT / "src" / "data" / "avilist_soi_avonet_joined.csv"
MISSING_MASS_CSV = DATA_DIR / "missing_mass_species.csv"

TARGET_ORDERS = {
    "Passeriformes",
    "Apodiformes",
    "Caprimulgiformes",
    "Coraciiformes",
    "Piciformes",
    "Strigiformes",
    "Bucerotiformes",
}

AREAL_ORDERS = {
    "Apodiformes",
}

AREAL_FAMILIES = {
    "Hirundinidae",
    "Meropidae",
}

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"


def _shared_strings(zf: zipfile.ZipFile) -> List[str]:
    try:
        data = zf.read("xl/sharedStrings.xml")
    except KeyError:
        return []

    root = ET.fromstring(data)
    out: List[str] = []
    for si in root.findall("m:si", NS):
        out.append("".join((t.text or "") for t in si.findall(".//m:t", NS)))
    return out


def _sheet_xml_path(zf: zipfile.ZipFile, sheet_name: str) -> str:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    relmap = {r.attrib["Id"]: r.attrib["Target"] for r in rels.findall(f".//{PKG_REL}")}

    for sheet in workbook.findall(".//m:sheets/m:sheet", NS):
        if sheet.attrib.get("name") == sheet_name:
            rid = sheet.attrib.get(REL_ID, "")
            target = relmap.get(rid)
            if not target:
                raise RuntimeError(f"Missing target for sheet '{sheet_name}'")
            return f"xl/{target}"

    raise RuntimeError(f"Sheet '{sheet_name}' not found")


def _excel_col_to_index(cell_ref: str) -> int:
    letters = ""
    for char in cell_ref:
        if char.isalpha():
            letters += char
        else:
            break

    idx = 0
    for char in letters.upper():
        idx = idx * 26 + (ord(char) - ord("A") + 1)
    return max(idx - 1, 0)


def _iter_rows(zf: zipfile.ZipFile, sheet_name: str) -> Iterable[List[str]]:
    shared = _shared_strings(zf)
    sheet_path = _sheet_xml_path(zf, sheet_name)
    root = ET.fromstring(zf.read(sheet_path))
    sheet_data = root.find(".//m:sheetData", NS)
    if sheet_data is None:
        return

    for row in sheet_data.findall("m:row", NS):
        values: List[str] = []
        for cell in row.findall("m:c", NS):
            ref = cell.attrib.get("r", "")
            col_idx = _excel_col_to_index(ref) if ref else len(values)
            while len(values) <= col_idx:
                values.append("")

            typ = cell.attrib.get("t")
            value_node = cell.find("m:v", NS)
            value = ""

            if typ == "inlineStr":
                t_node = cell.find("m:is/m:t", NS)
                value = (t_node.text if t_node is not None else "") or ""
                values[col_idx] = value
                continue

            if value_node is None:
                values[col_idx] = value
                continue

            raw = value_node.text or ""
            if typ == "s":
                try:
                    value = shared[int(raw)]
                except Exception:
                    value = raw
            else:
                value = raw

            values[col_idx] = value

        yield values


def _to_map(headers: List[str], row: List[str]) -> Dict[str, str]:
    return {headers[i]: (row[i] if i < len(row) else "") for i in range(len(headers))}


def _to_float(value: str) -> float | None:
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def load_avilist_reference(path: Path) -> List[dict]:
    with zipfile.ZipFile(path) as zf:
        rows = list(_iter_rows(zf, "AviList v2025 extended"))

    headers = rows[0]
    selected: List[dict] = []

    for row in rows[1:]:
        item = _to_map(headers, row)

        if item.get("Taxon_rank") != "species":
            continue

        order_name = (item.get("Order") or "").strip()
        if order_name not in TARGET_ORDERS:
            continue
        family_name = (item.get("Family") or "").strip()

        scientific_name = (item.get("Scientific_name") or "").strip()
        avibase_id = (item.get("AvibaseID") or "").strip().upper()
        common_name = (
            (item.get("English_name_AviList") or "").strip()
            or (item.get("English_name_Clements_v2024") or "").strip()
            or (item.get("English_name_BirdLife_v9") or "").strip()
        )

        if not scientific_name:
            continue

        selected.append(
            {
                "order_name": order_name,
                "family_name": family_name,
                "avibase_id": avibase_id,
                "ebird_species_code": (item.get("Species_code_Cornell_Lab") or "").strip(),
                "birds_of_the_world_url": (item.get("Birds_of_the_World_URL") or "").strip(),
                "common_name": common_name,
                "scientific_name": scientific_name,
            }
        )

    return selected


def load_soi_loggers(path: Path) -> Dict[str, dict]:
    with zipfile.ZipFile(path) as zf:
        rows = list(_iter_rows(zf, "Feuille 2"))

    headers = rows[0]
    per_species: Dict[str, str] = {}

    for row in rows[1:]:
        item = _to_map(headers, row)
        sci = (item.get("Species_latin") or "").strip()
        if not sci:
            continue

        raw = (item.get("Number_loggers_approx") or "").strip()
        if raw and sci not in per_species:
            per_species[sci] = raw

    return {sci: {"soi_number_loggers_approx_raw": raw} for sci, raw in per_species.items()}


def load_avonet_mass(path: Path) -> tuple[Dict[str, float], Dict[str, float]]:
    with zipfile.ZipFile(path) as zf:
        rows = list(_iter_rows(zf, "AVONET2_eBird"))

    headers = rows[0]
    masses_by_sci: Dict[str, List[float]] = defaultdict(list)
    masses_by_avibase: Dict[str, List[float]] = defaultdict(list)

    for row in rows[1:]:
        item = _to_map(headers, row)
        sci = (item.get("Species2") or "").strip()
        avibase_id = (item.get("Avibase.ID2") or "").strip().upper()
        mass = _to_float((item.get("Mass") or "").strip())
        if mass is None:
            continue
        if sci:
            masses_by_sci[sci].append(mass)
        if avibase_id:
            masses_by_avibase[avibase_id].append(mass)

    by_sci = {sci: round(mean(values), 3) for sci, values in masses_by_sci.items() if values}
    by_avibase = {
        avibase_id: round(mean(values), 3) for avibase_id, values in masses_by_avibase.items() if values
    }
    return by_sci, by_avibase


def join_tables(
    reference_rows: List[dict],
    soi_map: Dict[str, dict],
    avonet_by_sci: Dict[str, float],
    avonet_by_avibase: Dict[str, float],
) -> List[dict]:
    out: List[dict] = []

    for row in reference_rows:
        sci = row["scientific_name"]
        soi = soi_map.get(sci, {})
        mass = avonet_by_sci.get(sci)
        if mass is None:
            mass = avonet_by_avibase.get(row["avibase_id"])
        is_areal = row["order_name"] in AREAL_ORDERS or row["family_name"] in AREAL_FAMILIES

        soi_raw = soi.get("soi_number_loggers_approx_raw", "")
        tagged_previously = "multi-sensor" if soi_raw else ""

        out.append(
            {
                "order_name": row["order_name"],
                "family_name": row["family_name"],
                "is_areal": is_areal,
                "avibase_id": row["avibase_id"],
                "ebird_species_code": row.get("ebird_species_code", ""),
                "birds_of_the_world_url": row.get("birds_of_the_world_url", ""),
                "common_name": row["common_name"],
                "scientific_name": sci,
                "soi_number_loggers_approx_raw": soi_raw,
                "body_mass_g": mass,
                "tagged_previously": tagged_previously,
            }
        )

    out.sort(key=lambda x: (x["order_name"], x["common_name"], x["scientific_name"]))
    return out


def write_csv(rows: List[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "order_name",
        "family_name",
        "is_areal",
        "avibase_id",
        "ebird_species_code",
        "birds_of_the_world_url",
        "common_name",
        "scientific_name",
        "soi_number_loggers_approx_raw",
        "body_mass_g",
        "tagged_previously",
    ]

    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_missing_mass_csv(rows: List[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "order_name",
        "family_name",
        "avibase_id",
        "ebird_species_code",
        "common_name",
        "scientific_name",
        "birds_of_the_world_url",
        "current_body_mass_g",
        "body_mass_g",
        "note",
    ]

    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "order_name": row["order_name"],
                    "family_name": row["family_name"],
                    "avibase_id": row["avibase_id"],
                    "ebird_species_code": row.get("ebird_species_code", ""),
                    "common_name": row["common_name"],
                    "scientific_name": row["scientific_name"],
                    "birds_of_the_world_url": row.get("birds_of_the_world_url", ""),
                    "current_body_mass_g": "",
                    "body_mass_g": "",
                    "note": "",
                }
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Join AviList, SOI flights, and AVONET for target orders.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DATA_DIR / "avilist_soi_avonet_joined.csv",
        help="Path to output CSV file.",
    )
    parser.add_argument(
        "--frontend-output",
        type=Path,
        default=FRONTEND_DATA_CSV,
        help="Path to frontend CSV copy used by the Vue app.",
    )
    parser.add_argument(
        "--missing-mass-output",
        type=Path,
        default=MISSING_MASS_CSV,
        help="Output CSV listing species missing body mass, for manual completion.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    avilist_file = DATA_DIR / "AviList-v2025-11Jun-extended.xlsx"
    avonet_file = DATA_DIR / "AVONET Supplementary dataset 1.xlsx"
    soi_file = DATA_DIR / "SOI flights.xlsx"

    for required in (avilist_file, avonet_file, soi_file):
        if not required.exists():
            raise SystemExit(f"Missing input file: {required}")

    ref = load_avilist_reference(avilist_file)
    soi_map = load_soi_loggers(soi_file)
    avonet_by_sci, avonet_by_avibase = load_avonet_mass(avonet_file)
    joined = join_tables(ref, soi_map, avonet_by_sci, avonet_by_avibase)

    write_csv(joined, args.output)
    if args.frontend_output != args.output:
        write_csv(joined, args.frontend_output)

    soi_hits = sum(1 for row in joined if row["soi_number_loggers_approx_raw"])
    avonet_hits = sum(1 for row in joined if row["body_mass_g"] is not None)
    avonet_fallback_hits = sum(
        1
        for row in ref
        if avonet_by_sci.get(row["scientific_name"]) is None
        and avonet_by_avibase.get(row["avibase_id"]) is not None
    )
    missing_mass_rows = [row for row in joined if row["body_mass_g"] is None]

    write_missing_mass_csv(missing_mass_rows, args.missing_mass_output)

    print(f"Wrote {len(joined)} rows to {args.output}")
    if args.frontend_output != args.output:
        print(f"Wrote frontend CSV copy to {args.frontend_output}")
    print(f"Wrote missing-mass template to {args.missing_mass_output}")
    print(f"SOI matches: {soi_hits}")
    print(f"AVONET matches: {avonet_hits}")
    print(f"AVONET fallback matches by AvibaseID: {avonet_fallback_hits}")
    print(f"Species without mass: {len(missing_mass_rows)}")
    for row in missing_mass_rows:
        print(
            f"- {row['common_name']} ({row['scientific_name']}) "
            f"[{row.get('ebird_species_code', '') or row['avibase_id']}]"
        )


if __name__ == "__main__":
    main()
