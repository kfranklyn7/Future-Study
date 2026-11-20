"""Build frontend/src/data/courses.json for the /map route from data/csv.

Run from the repo root:  python frontend/scripts/build_map_data.py
"""
import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
CSV = ROOT / "data" / "csv"
OUT = ROOT / "frontend" / "src" / "data" / "courses.json"

# Courses drawn on the BS in Computer Science prerequisite flowchart.
MAP_COURSES = [
    "CISC 1115", "CISC 2210", "CISC 2820W", "CISC 3115", "CISC 3130",
    "CISC 3140", "CISC 3142", "CISC 3220", "CISC 3230", "CISC 3310",
    "CISC 3320", "CISC 4900", "CISC 5001",
]
# Required courses (or old-numbering equivalents) that don't count as electives.
NOT_ELECTIVE = set(MAP_COURSES) | {"CISC 3110", "CISC 3305", "CISC 3315"}


def clean(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    return str(v).strip() or None


def main():
    courses = pd.read_csv(CSV / "courses.csv")
    syllabi = pd.read_csv(CSV / "syllabi.csv")
    syllabus_url = (
        syllabi.dropna(subset=["source_url"])
        .drop_duplicates("course_code")
        .set_index("course_code")["source_url"]
        .to_dict()
    )

    def record(r):
        return {
            "code": r.course_code,
            "title": clean(r.title),
            "credits": None if pd.isna(r.credits) else float(r.credits),
            "description": clean(r.description),
            "prerequisites": clean(r.prerequisites),
            "offeredRecently": bool(r.offered_in_window),
            "lastSeen": clean(r.last_seen_year),
            "syllabusUrl": syllabus_url.get(r.course_code),
            "catalogUrl": clean(r.inventory_url),
        }

    by_code = courses.set_index("course_code", drop=False)
    core = {c: record(by_code.loc[c]) for c in MAP_COURSES if c in by_code.index}

    ug = courses[(courses.division == "Undergraduate") & (courses.offered_in_window == True)]
    num = ug.course_number.astype(str).str.extract(r"^(\d+)")[0].astype(int)
    electives = ug[num.between(3000, 4899) & ~ug.course_code.isin(NOT_ELECTIVE)]
    electives = sorted((record(r) for r in electives.itertuples()), key=lambda d: d["code"])

    OUT.write_text(json.dumps({"core": core, "electives": electives}, indent=2), encoding="utf-8")
    print(f"wrote {OUT} ({len(core)} core, {len(electives)} electives)")


if __name__ == "__main__":
    main()
