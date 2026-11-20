"""Pull Brooklyn College professor ratings from Rate My Professors (RMP).

Keeps only professors whose RMP course tags match a CISC course in
data/csv/course_offerings.csv, and writes data/csv/rmp_professors.csv.

RMP has no public API; this uses the GraphQL endpoint its own site calls.
Raw responses are cached in data/cache/rmp so reruns don't hit the site.
"""

import argparse
import csv
import json
import re
import time
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
GRAPHQL_URL = "https://www.ratemyprofessors.com/graphql"
HEADERS = {
    # RMP's own web client sends this fixed public header ("test:test").
    "Authorization": "Basic dGVzdDp0ZXN0",
    "User-Agent": "Mozilla/5.0 (Future-Study hackathon project)",
}
BROOKLYN_SCHOOL_ID = "U2Nob29sLTIyMw=="  # base64 of "School-223"

TEACHER_QUERY = """
query($q: TeacherSearchQuery!, $n: Int!, $c: String) {
  newSearch {
    teachers(query: $q, first: $n, after: $c) {
      resultCount
      pageInfo { hasNextPage endCursor }
      edges { node {
        legacyId firstName lastName department avgRating numRatings
        courseCodes { courseName courseCount }
        ratingsDistribution { r1 r2 r3 r4 r5 total }
      } }
    }
  }
}
"""

CS_PREFIXES = {"CISC", "CIS", "CSC", "CS", "CPSC", "COMPSCI"}


def fetch_all_teachers(cache_dir: Path, page_size: int, pause: float, max_pages: int | None):
    cache_dir.mkdir(parents=True, exist_ok=True)
    cursor, page, teachers = "", 0, []
    while True:
        cache_file = cache_dir / f"teachers_page_{page:03d}.json"
        if cache_file.exists():
            data = json.loads(cache_file.read_text(encoding="utf-8"))
        else:
            variables = {
                "q": {"text": "", "schoolID": BROOKLYN_SCHOOL_ID, "fallback": False},
                "n": page_size,
                "c": cursor,
            }
            resp = requests.post(GRAPHQL_URL, json={"query": TEACHER_QUERY, "variables": variables},
                                 headers=HEADERS, timeout=60)
            resp.raise_for_status()
            data = resp.json()
            if "errors" in data:
                raise RuntimeError(f"GraphQL error on page {page}: {data['errors']}")
            cache_file.write_text(json.dumps(data), encoding="utf-8")
            time.sleep(pause)

        block = data["data"]["newSearch"]["teachers"]
        teachers.extend(edge["node"] for edge in block["edges"])
        page += 1
        if not block["pageInfo"]["hasNextPage"] or (max_pages and page >= max_pages):
            return teachers, block["resultCount"]
        cursor = block["pageInfo"]["endCursor"]


def load_offered_codes(csv_dir: Path):
    """Return {number: [course codes]} for courses in course_offerings.csv, keyed by
    full number ("2820W") and base number ("2820")."""
    codes = sorted(pd.read_csv(csv_dir / "course_offerings.csv")["course_code"].dropna().unique())
    by_number: dict[str, set[str]] = {}
    for code in codes:
        number = code.split()[1]
        by_number.setdefault(number, set()).add(code)
        by_number.setdefault(re.sub(r"[A-Z]+$", "", number), set()).add(code)
    return codes, by_number


def load_old_numbers(csv_dir: Path):
    """Map old CIS numbers ("1.5") to new codes ("CISC 1110") from text like
    'CISC 1110 [CIS 1.5]' found anywhere in the scraped CSVs."""
    pattern = re.compile(r"(CISC \d{4}[A-Z]?) \[CIS (\d+(?:\.\d+)?[A-Z]?)\]")
    mapping = {}
    for path in csv_dir.glob("*.csv"):
        if path.name.startswith("rmp_"):
            continue
        for new, old in pattern.findall(path.read_text(encoding="utf-8", errors="ignore")):
            mapping[old] = new
    return mapping


def match_tag(tag: str, is_cs_dept: bool, by_number, old_numbers):
    """Return the CISC course codes an RMP course tag refers to (may be empty)."""
    clean = re.sub(r"[^A-Z0-9.]", "", tag.upper())
    m = re.fullmatch(r"([A-Z]*?)(\d+(?:\.\d+)?[A-Z]?)", clean)
    if not m:
        return set()
    prefix, number = m.groups()
    if prefix and prefix not in CS_PREFIXES:
        return set()
    if not prefix and not is_cs_dept:
        return set()  # a bare "3130" from a math professor is not CISC 3130
    if number in by_number:
        return by_number[number]
    if number in old_numbers and old_numbers[number].split()[1] in by_number:
        return by_number[old_numbers[number].split()[1]]
    return set()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output", default=str(ROOT / "data" / "csv"))
    ap.add_argument("--cache", default=str(ROOT / "data" / "cache" / "rmp"))
    ap.add_argument("--page-size", type=int, default=100)
    ap.add_argument("--pause", type=float, default=1.5, help="seconds between requests")
    ap.add_argument("--max-pages", type=int, default=None, help="stop early (for testing)")
    args = ap.parse_args()

    csv_dir = Path(args.output)
    offered_codes, by_number = load_offered_codes(csv_dir)
    old_numbers = load_old_numbers(csv_dir)
    teachers, result_count = fetch_all_teachers(Path(args.cache), args.page_size, args.pause, args.max_pages)

    rows, unmatched_cs_tags = [], {}
    for t in teachers:
        is_cs_dept = "comput" in (t.get("department") or "").lower()
        matched: dict[str, int] = {}
        for cc in t.get("courseCodes") or []:
            codes = match_tag(cc["courseName"], is_cs_dept, by_number, old_numbers)
            for code in codes:
                matched[code] = matched.get(code, 0) + cc["courseCount"]
            if not codes and is_cs_dept:
                unmatched_cs_tags[cc["courseName"]] = unmatched_cs_tags.get(cc["courseName"], 0) + cc["courseCount"]
        if not matched:
            continue
        dist = t.get("ratingsDistribution") or {}
        rows.append({
            "professor": f"{t['firstName'].strip()} {t['lastName'].strip()}",
            "rmp_id": t["legacyId"],
            "department": t.get("department"),
            "courses_taught": "; ".join(sorted(matched)),
            "current_rating": t.get("avgRating"),
            "num_ratings": t.get("numRatings"),
            "stars_1": dist.get("r1", 0),
            "stars_2": dist.get("r2", 0),
            "stars_3": dist.get("r3", 0),
            "stars_4": dist.get("r4", 0),
            "stars_5": dist.get("r5", 0),
            "rmp_url": f"https://www.ratemyprofessors.com/professor/{t['legacyId']}",
        })

    rows.sort(key=lambda r: (-r["num_ratings"], r["professor"]))
    out = csv_dir / "rmp_professors.csv"
    pd.DataFrame(rows).to_csv(out, index=False, quoting=csv.QUOTE_MINIMAL)

    covered = {c for r in rows for c in r["courses_taught"].split("; ")}
    print(f"RMP professors fetched: {len(teachers)} of {result_count}")
    print(f"Matched to course_offerings: {len(rows)} professors, "
          f"{len(covered)} of {len(offered_codes)} offered courses covered")
    print(f"Wrote {out}")
    top_unmatched = sorted(unmatched_cs_tags.items(), key=lambda kv: -kv[1])[:15]
    print("Top unmatched tags from CS-department professors:",
          ", ".join(f"{k}({v})" for k, v in top_unmatched) or "none")


if __name__ == "__main__":
    main()
