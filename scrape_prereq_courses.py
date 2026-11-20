"""Pull the non-CISC courses that CISC courses and programs list as prerequisites.

course_requisites.csv (written by scrape_brooklyn_cis.py) names courses in MATH, BUSN,
ECON, CORC and other departments, but courses.csv only covers CISC. This script looks up
each of those courses on the Brooklyn College course inventory, then follows their own
prerequisites (MATH 1206 needs MATH 1201, and so on) up to --depth levels.

Writes, to the same folder as course_requisites.csv:
  prereq_courses.csv             one row per non-CISC course (title, credits, description)
  prereq_course_requisites.csv   prerequisite edges between those courses

Run scrape_brooklyn_cis.py first. Pages are cached in data/cache/prereq_courses, so
a rerun makes no requests; delete that folder to pull fresh data.

  python scrape_prereq_courses.py
  python scrape_prereq_courses.py --output data/csv --depth 3
"""
import argparse
import hashlib
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

from scrape_brooklyn_cis import (
    COURSE_SHOW_URL,
    REQUEST_PAUSE_SECONDS,
    extract_credits,
    grouped_requisite_refs,
    make_session,
    split_prerequisites,
    squash,
    write_table,
)

LOG = logging.getLogger("prereq_courses")

# Graduate courses carry an X suffix in this data (MATH 6652X, MATH 7280X).
GRAD_NUMBER = re.compile(r"^[5-9]\d{3}")

# CISC courses are already in courses.csv, so they are never looked up here.
SKIP_DEPTS = {"CISC"}


class CourseFetcher:
    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.session = make_session()
        self.requests = 0

    def page(self, url: str) -> str:
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:20]
        cached = self.cache_dir / f"{digest}.html"
        if cached.exists():
            return cached.read_text(encoding="utf-8")
        time.sleep(REQUEST_PAUSE_SECONDS)
        response = self.session.get(url, timeout=60)
        response.raise_for_status()
        response.encoding = response.encoding or "utf-8"
        self.requests += 1
        cached.write_text(response.text, encoding="utf-8")
        return response.text


def detail_urls(dept: str, number: str) -> list[tuple[str, str]]:
    """Candidate (division, url) pairs; graduate numbers are tried as G first."""
    base = number.rstrip("X") if number.endswith("X") else number
    divisions = ["G", "U"] if GRAD_NUMBER.match(base) else ["U", "G"]
    return [
        (div, f"{COURSE_SHOW_URL}?dsc={dept}.&crs_num={base}&div={div}")
        for div in divisions
    ]


def parse_detail(html: str, dept: str) -> dict | None:
    page = BeautifulSoup(html, "html.parser")
    header = page.select_one("h2.course-header")
    description = page.select_one("#courseDescription")
    if not header or not description:
        return None
    header_text = squash(header.get_text(" ", strip=True))
    match = re.search(rf"{dept}\.?\s+\*?\d{{4}}[A-Z]?\s+(.*)$", header_text, re.IGNORECASE)
    title = squash(match.group(1)) if match else header_text
    paragraphs = [squash(p.get_text(" ", strip=True)) for p in description.find_all("p")]
    paragraphs = [p for p in paragraphs if p]
    hours = ""
    if paragraphs and "credit" in paragraphs[0].lower():
        hours = paragraphs.pop(0)
    narrative, prerequisites = split_prerequisites(" ".join(paragraphs))
    return {
        "title": title,
        "hours": hours,
        "credits": extract_credits(hours) if hours else "",
        "description": narrative,
        "prerequisites": prerequisites,
    }


def lookup(fetcher: CourseFetcher, code: str) -> dict:
    dept, number = code.split(" ", 1)
    row = {
        "course_code": code,
        "dept": dept,
        "number": number,
        "division": "",
        "title": "",
        "hours": "",
        "credits": "",
        "description": "",
        "prerequisites": "",
        "found": False,
        "source_url": "",
    }
    for division, url in detail_urls(dept, number):
        try:
            detail = parse_detail(fetcher.page(url), dept)
        except requests.RequestException as exc:
            LOG.warning("Lookup failed for %s (%s): %s", code, url, exc)
            continue
        if detail:
            row.update(detail)
            row.update(
                division="Graduate" if division == "G" else "Undergraduate",
                found=True,
                source_url=url,
            )
            return row
    LOG.warning("No inventory page for %s", code)
    return row


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=Path("data/csv"), help="Folder holding course_requisites.csv.")
    parser.add_argument("--cache", type=Path, default=Path("data/cache/prereq_courses"), help="HTML cache folder.")
    parser.add_argument("--depth", type=int, default=3, help="Prerequisite levels to follow. Default: 3.")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    requisites_path = args.output / "course_requisites.csv"
    requisites = pd.read_csv(requisites_path, dtype=str, keep_default_na=False)
    pending = sorted(
        set(requisites.loc[~requisites["requires_dept"].isin(SKIP_DEPTS), "requires_code"]) - {""}
    )
    LOG.info("%s non-CISC courses referenced in %s", len(pending), requisites_path.name)

    fetcher = CourseFetcher(args.cache)
    scraped_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    courses: dict[str, dict] = {}
    edges: list[dict] = []
    for level in range(args.depth + 1):
        next_round: set[str] = set()
        for code in pending:
            if code in courses:
                continue
            row = lookup(fetcher, code)
            row["depth"] = level
            courses[code] = row
            for relationship, dept, number, group, operator in grouped_requisite_refs(
                row["prerequisites"], default_dept=row["dept"]
            ):
                requires = f"{dept} {number}"
                if requires == code:
                    continue
                edges.append(
                    {
                        "course_code": code,
                        "requires_code": requires,
                        "requires_dept": dept,
                        "requires_number": number,
                        "relationship": relationship,
                        "group_id": f"{code}-g{group}",
                        "group_operator": operator,
                        "source": "inventory",
                    }
                )
                if dept not in SKIP_DEPTS:
                    next_round.add(requires)
        pending = sorted(next_round - set(courses))
        if not pending:
            break
        if level == args.depth:
            LOG.info("Stopped at depth %s with %s courses not followed", args.depth, len(pending))

    known = set(courses)
    course_frame = pd.DataFrame(courses.values()).sort_values("course_code")
    edge_frame = pd.DataFrame(
        edges,
        columns=["course_code", "requires_code", "requires_dept", "requires_number", "relationship",
                 "group_id", "group_operator", "source"],
    ).drop_duplicates()
    edge_frame["in_prereq_courses"] = edge_frame["requires_code"].isin(known)
    edge_frame["in_cisc_catalog"] = edge_frame["requires_dept"].eq("CISC")

    write_table(
        course_frame,
        args.output / "prereq_courses.csv",
        "Non-CISC courses that CISC courses or programs require, from the course inventory.",
        scraped_at,
    )
    write_table(
        edge_frame,
        args.output / "prereq_course_requisites.csv",
        "Prerequisite edges between non-CISC prerequisite courses.",
        scraped_at,
    )
    found = int(course_frame["found"].sum())
    LOG.info(
        "%s courses (%s found, %s missing), %s edges, %s new requests",
        len(course_frame), found, len(course_frame) - found, len(edge_frame), fetcher.requests,
    )


if __name__ == "__main__":
    main()
