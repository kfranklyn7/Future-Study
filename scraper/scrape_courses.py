"""Scrape Brooklyn College's official undergraduate CISC course catalog.

Source: the college's course inventory (websql.brooklyn.cuny.edu), which lists
every undergraduate course in a discipline and links to one page per course.

Outputs (in ../data/):
    courses.csv         one row per course
    course_prereqs.csv  one row per prerequisite/corequisite reference

Raw HTML is cached in ./cache/ so the parser can be re-run without
re-downloading. Pass --refresh to ignore the cache and fetch everything again.

Usage:
    python scraper/scrape_courses.py            # use cache where available
    python scraper/scrape_courses.py --refresh  # re-download every page
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://websql.brooklyn.cuny.edu"
DISCIPLINE = "CISC."
LIST_URL = f"{BASE_URL}/courses/acad/courses_list.jsp?div=U&disc={DISCIPLINE}"

HERE = Path(__file__).resolve().parent
CACHE_DIR = HERE / "cache"
DATA_DIR = HERE.parent / "data"

HEADERS = {"User-Agent": "Future-Study course-catalog scraper (student hackathon project)"}
REQUEST_DELAY_SECONDS = 1.0
TIMEOUT_SECONDS = 30
RETRIES = 3

# Department names as they appear in prerequisite text -> catalog code.
# Longest names first so "Computer and Information Science" wins over shorter matches.
# Matched case-insensitively ("Computer and Information science" appears too).
DEPARTMENTS = {
    "computer and information sciences": "CISC",
    "computer and information science": "CISC",
    "core curriculum": "CORC",
    "core studies": "CORE",     # older core program; its numbers (5, 5.1) aren't 4 digits
    "core": "CORC",
    "mathematics": "MATH",
    "english": "ENGL",
    "linguistics": "LING",
    "business": "BUSN",
    "economics": "ECON",
    "psychology": "PSYC",
    "philosophy": "PHIL",
    "physics": "PHYS",
    "music": "MUSC",
    "cisc": "CISC",
    "cis": "CISC",
    "math": "MATH",
    "corc": "CORC",
}
_dept_names = sorted(DEPARTMENTS, key=len, reverse=True)
DEPT_OR_NUMBER_RE = re.compile(
    r"\b(" + "|".join(re.escape(n) for n in _dept_names) + r")\b"
    # A 4-digit course number, optionally starred ("*1201"). Not part of a longer
    # number or a decimal like "3.0", but a sentence-ending period is fine ("3140.").
    r"|(?<![\d.])\*?(\d{4})(?!\d)(?!\.\d)",
    re.I,
)
# "Prerequisite or corequisite:" sometimes appears mid-paragraph inside the prerequisite text.
EMBEDDED_REQ_RE = re.compile(r"[.;,]?\s*\b(prerequisites? or corequisites?|pre- ?or corequisites?|corequisites?)\s*:\s*", re.I)

HOURS_RE = re.compile(r"\bhours?\b.*\bcredits?\b", re.I | re.S)
CREDITS_RE = re.compile(r"(\d+(?:\.\d+)?)(?:\s+(\d)/(\d))?\s*credits?", re.I)  # "3", "4 1/2"
REQ_PREFIX_RE = re.compile(
    r"^(Prerequisites?(?: or corequisites?)?|Pre- ?or corequisites?|Corequisites?)\s*:\s*",
    re.I,
)


def fetch(url: str, cache_name: str, refresh: bool) -> str:
    """Return the page HTML, from cache unless refresh is set."""
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / cache_name
    if cache_file.exists() and not refresh:
        return cache_file.read_text(encoding="utf-8")

    last_error: Exception | None = None
    for attempt in range(1, RETRIES + 1):
        try:
            time.sleep(REQUEST_DELAY_SECONDS)
            resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT_SECONDS)
            resp.raise_for_status()
            resp.encoding = resp.encoding or "utf-8"
            html = resp.text
            cache_file.write_text(html, encoding="utf-8")
            return html
        except requests.RequestException as exc:
            last_error = exc
            print(f"  attempt {attempt} failed for {url}: {exc}", file=sys.stderr)
            time.sleep(2 * attempt)
    raise RuntimeError(f"Could not fetch {url}") from last_error


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def parse_course_list(html: str) -> list[dict]:
    """Parse the inventory page into [{number, title, not_advanced, url}]."""
    soup = BeautifulSoup(html, "html.parser")
    courses = []
    seen = set()
    for a in soup.select("ul.category li a[href*='ShowCourse.do']"):
        span = a.find("span", class_="courseid")
        if span is None:
            continue
        course_id_text = clean(span.get_text())          # e.g. "CISC. *1115"
        m = re.search(r"(\*?)\s*(\d{4}[A-Z]?)", course_id_text)
        if not m:
            continue
        number = m.group(2)
        if number in seen:
            continue
        seen.add(number)
        span.extract()
        title = clean(a.get_text()).lstrip("-– ").strip()
        courses.append({
            "number": number,
            "title": title,
            "not_advanced": bool(m.group(1)),
            "url": urljoin(BASE_URL, a["href"]),
        })
    return courses


def _kind(label: str) -> str:
    label = label.lower()
    if "pre" in label and "co" in label:
        return "pre_or_corequisite"
    if label.startswith("co"):
        return "corequisite"
    return "prerequisite"


def classify_requirements(text: str) -> list[tuple[str, str]]:
    """Split 'Prerequisite: A. Prerequisite or corequisite: B' into [(kind, body), ...]."""
    m = REQ_PREFIX_RE.match(text)
    kind, rest = _kind(m.group(1)), text[m.end():]
    segments = []
    pos = 0
    for em in EMBEDDED_REQ_RE.finditer(rest):
        body = rest[pos:em.start()].strip(" ;,.")
        if body:
            segments.append((kind, body))
        kind, pos = _kind(em.group(1)), em.end()
    body = rest[pos:].strip(" ;,")
    if body:
        segments.append((kind, body))
    return segments


def extract_course_refs(text: str) -> list[tuple[str, str]]:
    """Find (dept, number) references in requirement text.

    Bare numbers inherit the most recent department named before them, so
    "Computer and Information Science 3115; or 3110 and Mathematics 1201"
    -> [(CISC, 3115), (CISC, 3110), (MATH, 1201)]. Text with no department
    at all is assumed to mean CISC.
    """
    refs: list[tuple[str, str]] = []
    dept = "CISC"
    for m in DEPT_OR_NUMBER_RE.finditer(text):
        if m.group(1):
            dept = DEPARTMENTS[m.group(1).lower()]
        else:
            ref = (dept, m.group(2))
            if ref not in refs:
                refs.append(ref)
    return refs


def parse_course_page(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    header = soup.find(class_="course-header")
    desc_div = soup.find(id="courseDescription")
    if header is None or desc_div is None:
        raise ValueError("course header or description block not found")

    header_text = clean(header.get_text())                # "CISC 3130 Data Structures"
    hm = re.match(r"CISC\.?\s*\*?\s*(\d{4}[A-Z]?)\s*(.*)", header_text)
    if not hm:
        raise ValueError(f"unexpected header: {header_text!r}")

    hours = ""
    description_parts: list[str] = []
    requirements: list[tuple[str, str]] = []
    other_notes: list[str] = []

    for p in desc_div.find_all("p"):
        text = clean(p.get_text(" "))
        if not text:
            continue
        if not hours and HOURS_RE.search(text) and len(text) < 200:
            hours = text
        elif REQ_PREFIX_RE.match(text):
            requirements.extend(classify_requirements(text))
        elif re.match(r"^(Not open to|Students who|This course is|Satisfies|Fulfills)", text):
            other_notes.append(text)
        else:
            description_parts.append(text)

    # Highlighted notices the page sometimes shows (course updates, special topics, comments).
    for msg_id in ("msgCourseUpdate", "msgSpecialTopics", "msgComment"):
        el = soup.find(id=msg_id)
        if el:
            text = clean(el.get_text(" "))
            if text:
                other_notes.append(text)

    # Enrollment restrictions are written inside the description as a trailing
    # "(Not open to students who ...)" sentence; move them to their own field.
    description = " ".join(description_parts)
    restrictions = ""
    start = description.find("(Not open to")
    if start == -1:
        start = description.find("Not open to")
    if start != -1:
        restrictions = description[start:].strip()
        description = description[:start].strip()
        if restrictions.startswith("(") and restrictions.endswith(")"):
            restrictions = restrictions[1:-1].strip()

    credits = ""
    credits_m = CREDITS_RE.search(hours)
    if credits_m:
        value = float(credits_m.group(1))
        if credits_m.group(2):
            value += int(credits_m.group(2)) / int(credits_m.group(3))
        credits = f"{value:g}"                            # 3.0 -> "3", 4.5 -> "4.5"
    return {
        "number": hm.group(1),
        "title": hm.group(2).strip(),
        "hours": hours,
        "credits": credits,
        "description": description,
        "restrictions": restrictions,
        "requirements": requirements,
        "notes": " ".join(other_notes),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--refresh", action="store_true", help="ignore the HTML cache")
    args = parser.parse_args()

    print(f"Fetching course list: {LIST_URL}")
    listing = parse_course_list(fetch(LIST_URL, "courses_list.html", args.refresh))
    if not listing:
        print("No courses found on the list page; the page layout may have changed.", file=sys.stderr)
        return 1
    print(f"Found {len(listing)} courses")

    course_rows: list[dict] = []
    prereq_rows: list[dict] = []
    failures: list[str] = []
    empty_pages: list[str] = []

    for i, item in enumerate(listing, 1):
        number = item["number"]
        print(f"[{i}/{len(listing)}] CISC {number} {item['title']}")
        try:
            html = fetch(item["url"], f"CISC{number}.html", args.refresh)
        except Exception as exc:  # keep going; report at the end
            print(f"  FAILED to download: {exc}", file=sys.stderr)
            failures.append(number)
            continue

        if not BeautifulSoup(html, "html.parser").get_text(strip=True):
            # The catalog lists some courses whose page is blank (e.g. CISC 2810W).
            # Keep the course with what the list page gives us, and say so.
            print("  warning: official course page is empty; using list-page data only", file=sys.stderr)
            empty_pages.append(number)
            page = {"number": number, "title": item["title"], "hours": "", "credits": "",
                    "description": "", "restrictions": "", "requirements": [],
                    "notes": "Official catalog page for this course is empty."}
        else:
            try:
                page = parse_course_page(html)
            except Exception as exc:
                print(f"  FAILED to parse: {exc}", file=sys.stderr)
                failures.append(number)
                continue

        if page["number"] != number:
            print(f"  warning: page number {page['number']} != list number {number}", file=sys.stderr)

        course_id = f"CISC{number}"
        req_texts = {"prerequisite": [], "corequisite": [], "pre_or_corequisite": []}
        for kind, body in page["requirements"]:
            req_texts[kind].append(body)
            for dept, ref_num in extract_course_refs(body):
                ref_id = f"{dept}{ref_num}"
                if ref_id == course_id:
                    continue
                prereq_rows.append({
                    "course_id": course_id,
                    "requires_course_id": ref_id,
                    "requires_dept": dept,
                    "requires_number": ref_num,
                    "relationship": kind,
                })

        course_rows.append({
            "course_id": course_id,
            "dept": "CISC",
            "number": number,
            "title": page["title"] or item["title"],
            "level": f"{number[0]}000",
            "counts_toward_advanced": not item["not_advanced"],
            "hours": page["hours"],
            "credits": page["credits"],
            "description": page["description"],
            "prerequisite_text": " ".join(req_texts["prerequisite"]),
            "corequisite_text": " ".join(req_texts["corequisite"]),
            "pre_or_corequisite_text": " ".join(req_texts["pre_or_corequisite"]),
            "restrictions": page["restrictions"],
            "notes": page["notes"],
            "url": item["url"],
        })

    # Mark which referenced courses exist in this catalog (non-CISC or retired ones won't).
    known = {row["course_id"] for row in course_rows}
    for row in prereq_rows:
        row["in_catalog"] = row["requires_course_id"] in known

    DATA_DIR.mkdir(exist_ok=True)
    write_csv(DATA_DIR / "courses.csv", course_rows)
    write_csv(DATA_DIR / "course_prereqs.csv", prereq_rows)

    print(f"\nWrote {len(course_rows)} courses and {len(prereq_rows)} requirement links to {DATA_DIR}")
    if empty_pages:
        print(f"Courses with an empty official page ({len(empty_pages)}): {', '.join(empty_pages)}")
    if failures:
        print(f"Failed courses ({len(failures)}): {', '.join(failures)}", file=sys.stderr)
        return 1
    return 0


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    sys.exit(main())
