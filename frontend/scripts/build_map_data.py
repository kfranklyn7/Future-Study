"""Build the course map data in frontend/src/data/ from Snowflake (CISC.CORE).

  courses.json      course text for the hand-drawn BS in Computer Science map
  programMaps.json  maps for the other majors, generated from their official degree maps
                    (DEGREE_MAP_COURSES): one column per semester, prerequisite arrows from the
                    catalog, "A or B" rows as alternative boxes, long option lists as pick boxes

Uses the same environment variables as snowflake/load_csvs.py. Run from the repo root:
  python frontend/scripts/build_map_data.py
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "snowflake"))
from load_csvs import connect  # noqa: E402

OUT = ROOT / "frontend" / "src" / "data" / "courses.json"
PROGRAM_OUT = ROOT / "frontend" / "src" / "data" / "programMaps.json"

# The BS in Computer Science has a hand-drawn map (src/data/csMap.ts), so it isn't generated.
HAND_DRAWN = {"Computer Science, B.S."}
YEARS = ["First Year", "Second Year", "Third Year", "Fourth Year"]
TERMS = ["Fall", "Spring"]
# Rows listing more options than this become a "pick N" box instead of side-by-side boxes.
MAX_ALTERNATIVES = 3
CODE = re.compile(r"\b([A-Z]{3,4})\s+(\d{4}[A-Z]?)\b|\b(\d{4}[A-Z]?)\b")
# RESOURCES.TYPE values mapped to the course map's resource kinds.
RESOURCE_KIND = {"course": "course", "video": "course", "textbook": "book", "book": "book", "tool": "tool"}

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


def query(cur, sql):
    cur.execute(sql)
    frame = cur.fetch_pandas_all()
    frame.columns = [c.lower() for c in frame.columns]
    return frame


def main():
    conn = connect()
    cur = conn.cursor()
    courses = query(cur, "SELECT * FROM CISC.CORE.COURSES")
    syllabi = query(cur, "SELECT COURSE_CODE, SOURCE_URL FROM CISC.CORE.SYLLABI WHERE SOURCE_URL <> ''")
    degree_maps = query(cur, "SELECT * FROM CISC.CORE.DEGREE_MAP_COURSES")
    other = query(cur, "SELECT * FROM CISC.CORE.PREREQ_COURSES WHERE FOUND = 'TRUE'")
    edges = query(cur, """
        SELECT COURSE_CODE, REQUIRES_CODE FROM CISC.CORE.COURSE_REQUISITES WHERE PROGRAM_ID = ''
        UNION SELECT COURSE_CODE, REQUIRES_CODE FROM CISC.CORE.PREREQ_COURSE_REQUISITES""")
    # Free resources per course (AI-picked plus curated_resources.sql), skipping known-broken links.
    resources = query(cur, """
        SELECT SCOPE_ID AS COURSE_CODE, TITLE, URL, PROVIDER, TYPE FROM CISC.CORE.RESOURCES
        WHERE SCOPE = 'course' AND COALESCE(URL_OK, TRUE) ORDER BY SCOPE_ID, TYPE, TITLE""")
    conn.close()
    degree_maps["academic_year_start"] = pd.to_numeric(degree_maps.academic_year_start)
    # load_csvs.py stores every column as text.
    courses["offered_in_window"] = courses.offered_in_window.str.upper().eq("TRUE")
    courses["credits"] = pd.to_numeric(courses.credits, errors="coerce")
    syllabus_url = (
        syllabi.drop_duplicates("course_code")
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
    num = pd.to_numeric(ug.course_number.astype(str).str.extract(r"^(\d+)")[0])
    electives = ug[num.between(3000, 4899) & ~ug.course_code.isin(NOT_ELECTIVE)]
    electives = sorted((record(r) for r in electives.itertuples()), key=lambda d: d["code"])

    OUT.write_text(json.dumps({"core": core, "electives": electives}, indent=2), encoding="utf-8")
    print(f"wrote {OUT} ({len(core)} core, {len(electives)} electives)")

    def other_record(r):
        hours = clean(r.credits)
        return {
            "code": r.course_code,
            "title": clean(r.title),
            "credits": float(hours) if hours and hours.replace(".", "", 1).isdigit() else None,
            "description": clean(r.description),
            "prerequisites": clean(r.prerequisites),
            "offeredRecently": False,
            "lastSeen": None,
            "syllabusUrl": None,
            "catalogUrl": clean(r.source_url),
        }

    info = {r.course_code: other_record(r) for r in other.itertuples()}
    info.update({r.course_code: record(r) for r in courses.itertuples()})
    requires = defaultdict(set)
    for r in edges.itertuples():
        requires[r.course_code].add(r.requires_code)
    maps, used = build_program_maps(degree_maps, info, requires)
    links = defaultdict(list)
    for r in resources.itertuples():
        if (r.course_code in used or r.course_code in info) and r.url not in {l["url"] for l in links[r.course_code]}:
            title = clean(r.title) or r.url
            links[r.course_code].append({
                "title": f"{title} ({r.provider})" if clean(r.provider) and r.provider not in title else title,
                "url": r.url,
                "kind": RESOURCE_KIND.get((r.type or "").lower(), "guide"),
            })
    PROGRAM_OUT.write_text(
        json.dumps({
            "maps": maps,
            "courses": {c: info[c] for c in sorted(used) if c in info},
            "resources": {c: links[c] for c in sorted(links)},
        }, indent=2),
        encoding="utf-8",
    )
    print(f"wrote {PROGRAM_OUT} ({len(maps)} maps: {', '.join(m['title'] for m in maps)}; "
          f"resources for {len(links)} courses)")


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def codes_in(text):
    """Course codes named in a degree-map row, e.g. 'CISC 3140 or 3142 or 3410' -> three codes."""
    found, dept = [], None
    for m in CODE.finditer(text or ""):
        if m.group(1):
            dept, number = m.group(1), m.group(2)
        elif dept:
            number = m.group(3)
        else:
            continue
        code = f"{dept} {number}"
        if code not in found:
            found.append(code)
    return found


def track_of(code):
    dept = code.split(" ")[0]
    return {"MATH": "math", "ENGL": "english", "CISC": "core"}.get(dept, "other")


def build_program_maps(degree_maps, info, requires):
    """One map per degree-map program, from its latest bulletin year."""
    latest = degree_maps.sort_values("academic_year_start").groupby("program_name").tail(1)
    maps, used = [], set()
    for program, year, map_id in latest[["program_name", "bulletin_year", "degree_map_id"]].itertuples(index=False):
        if program in HAND_DRAWN:
            continue
        rows = degree_maps[degree_maps.degree_map_id == map_id]
        # A row's text repeats once per course code it was split into, and once per slot.
        slots = []
        for (yr, term, text), g in rows.groupby(["year_in_program", "term", "course_text"], sort=False):
            if yr not in YEARS or term not in TERMS:
                continue
            listed = [c for c in g.course_code if c]
            options = [c for c in codes_in(text) if c in info] or [c for c in dict.fromkeys(listed) if c in info]
            if not options:
                continue  # Gen ed and general elective rows name no course.
            count = max(1, len(g) // max(1, len(set(listed))))
            slots.append({"col": YEARS.index(yr) * 2 + TERMS.index(term), "text": text, "options": options, "count": count})

        # Long option lists ("CISC 3140 or 3142 or ... or 4610") become one pick box per
        # program, counting every semester that lists them; shorter ones are alternatives.
        picks = {}
        boxes = []
        for s in sorted(slots, key=lambda s: s["col"]):
            if len(s["options"]) > MAX_ALTERNATIVES:
                key = tuple(s["options"])
                if key in picks:
                    picks[key]["pick"]["count"] += s["count"]
                    continue
                picks[key] = {"col": s["col"], "kind": "pick", "pick": {"count": s["count"], "options": s["options"]}}
                boxes.append(picks[key])
            else:
                for _ in range(s["count"]):
                    boxes.append({"col": s["col"], "kind": "course", "options": s["options"]})

        nodes, rows_in_col, code_box = [], defaultdict(int), {}
        seen_ids = defaultdict(int)
        for b in boxes:
            col = b["col"]
            if b["kind"] == "pick":
                n = b["pick"]["count"]
                nodes.append({
                    "id": f"pick-{len(nodes)}",
                    "label": f"{'One' if n == 1 else n} course{'' if n == 1 else 's'} from {len(b['pick']['options'])} options",
                    "codes": [], "track": "elective", "col": col, "row": rows_in_col[col],
                    "requires": [], "pick": b["pick"],
                })
                used.update(b["pick"]["options"])
                rows_in_col[col] += 1
                continue
            group = slug("-".join(b["options"])) if len(b["options"]) > 1 else None
            for code in b["options"]:
                base = slug(code)
                seen_ids[base] += 1
                node_id = base if seen_ids[base] == 1 else f"{base}-{seen_ids[base]}"
                node = {
                    "id": node_id, "label": info[code]["title"] or code, "codes": [code],
                    "track": track_of(code), "col": col, "row": rows_in_col[col], "requires": [],
                }
                if group:
                    node["group"] = {"id": f"{group}-{col}", "label": " or ".join(b["options"])}
                nodes.append(node)
                code_box.setdefault(code, []).append(node)
                used.add(code)
                rows_in_col[col] += 1

        # Arrows only point forward in time; a prerequisite listed in a later semester of the
        # degree map is left out rather than drawn backwards.
        for node in nodes:
            for code in node["codes"]:
                for req in sorted(requires.get(code, ())):
                    for src in code_box.get(req, []):
                        if src["col"] < node["col"] and src["id"] not in node["requires"]:
                            node["requires"].append(src["id"])
        # Drop arrows a longer chain already implies (MATH 1011 -> MATH 1201 -> CISC 2210 makes
        # MATH 1011 -> CISC 2210 redundant), so the map shows the path rather than a fan of lines.
        by_id = {n["id"]: n for n in nodes}

        def ancestors(node_id, acc):
            for parent in by_id[node_id]["requires"]:
                if parent not in acc:
                    acc.add(parent)
                    ancestors(parent, acc)
            return acc

        for node in nodes:
            implied = set()
            for parent in node["requires"]:
                implied |= ancestors(parent, set())
            node["requires"] = [p for p in node["requires"] if p not in implied]
        maps.append({"id": slug(program), "title": program, "bulletinYear": year, "nodes": nodes})
    return maps, used


if __name__ == "__main__":
    main()
