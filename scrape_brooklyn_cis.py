"""Scrape Brooklyn College CIS programs, courses, bulletins, syllabi, and degree maps.

The program finder and several department pages are HTML. Course bulletins and
syllabi are PDFs linked from those pages. This script parses both, then writes
one CSV per table for upload into Snowflake.

A course counts as offered in the recent window when either:

* an undergraduate or graduate bulletin (or its addendum) lists it as an active
  catalog course in one of the last N academic years, or
* the department schedule lists it for a fall/spring term in that window, or
  under "Every Semester".

Bulletin text marks some courses inactive ("offered only if there is sufficient
demand"). Those listings do not count as offered. Schedule rows for a future
academic year are kept, but they do not satisfy the recent-offering filter.

Academic years run fall through spring. In November 2026 the current year is
2026-2027, so the default five-year window is 2022-2023 through 2026-2027.

Usage:
    python scrape_brooklyn_cis.py
    python scrape_brooklyn_cis.py --years 5 --output data/csv
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import re
import subprocess
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import pandas as pd
import requests
import urllib3
from bs4 import BeautifulSoup
from pypdf import PdfReader
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

LOG = logging.getLogger("brooklyn_cis")

BASE = "https://www.brooklyn.edu"
PROGRAM_FINDER = (
    "https://www.brooklyn.edu/academics/programs/"
    "?degree_level=Undergraduate&degree_level=Graduate&degree_level=Minor"
    "&department=Computer-and-Information-Science"
)
BULLETINS_URL = "https://www.brooklyn.edu/registrar/bulletins/"
UNDERGRAD_COURSES_URL = (
    "https://websql.brooklyn.cuny.edu/courses/acad/courses_list.jsp?div=U&disc=CISC."
)
GRAD_COURSES_URL = (
    "https://websql.brooklyn.cuny.edu/courses/acad/courses_list.jsp?div=G&disc=CISC."
)
UNDERGRAD_RESOURCES_URL = "https://www.brooklyn.edu/cis/undergraduate-computer-science/"
GRAD_RESOURCES_URL = "https://www.brooklyn.edu/cis/graduate-computer-science/"
DEGREE_MAPS_URL = "https://pub.brooklyn.edu/DegreeMaps/stdnt_degree_maps_list.jsp"
DEGREE_MAP_VIEW_URL = "https://pub.brooklyn.edu/DegreeMaps/stdn_view_degree_map.jsp"
COURSE_SHOW_URL = "https://websql.brooklyn.cuny.edu/courses/ShowCourse.do"

USER_AGENT = "FutureStudy/1.0 (Brooklyn College CIS academic catalog research)"
REQUEST_PAUSE_SECONDS = 0.2

CHROME_HEADINGS = {
    "info for",
    "quick links",
    "our schools",
    "follow us",
    "take the next step",
    "brooklyn. all in.",
}

COURSE_LINE = re.compile(r"^CISC\s+(\*?)(\d{4}[A-Z]?)\b\s*(.*)$", re.IGNORECASE)
RUNNING_HEADER = re.compile(
    r"^[A-Za-z][A-Za-z0-9/&,.'’ \-]{2,90}?\s+\d+\s*Programs and Courses of Instruction\s*$"
)
INACTIVE_SPLIT = re.compile(
    r"The following inactive course\(s\) will only be offered if there is sufficient demand:\s*",
    re.IGNORECASE,
)
YEAR_SPAN = re.compile(r"(20\d{2})\s*[\u2013\u2014\-]\s*(20\d{2}|\d{2})")
COURSE_CODE = re.compile(r"\bCISC\s+\*?\s*(\d{4}[A-Z]?)\b", re.IGNORECASE)
COURSE_MENTION = re.compile(
    r"(?:Computer and Information Science|CISC)\s+\*?\s*(\d{4}[A-Z]?)",
    re.IGNORECASE,
)
ANY_COURSE_CODE = re.compile(r"\b([A-Z]{2,5})\s+(\d{4}[A-Z]?)\b")
BULLETIN_FILE = re.compile(
    r"(20\d{2})[-_](20\d{2}).*?(Undergraduate|Graduate)",
    re.IGNORECASE,
)


def academic_start_year(day: date | None = None) -> int:
    day = day or date.today()
    return day.year if day.month >= 8 else day.year - 1


def year_label(start: int) -> str:
    return f"{start}-{start + 1}"


def parse_year_span(text: str) -> tuple[int, int] | None:
    match = YEAR_SPAN.search(text or "")
    if not match:
        return None
    start = int(match.group(1))
    end_raw = match.group(2)
    end = int(end_raw) if len(end_raw) == 4 else int(str(start)[:2] + end_raw)
    if end == start + 1 or end == start:
        return start, end
    if end < start:
        return None
    return start, end


def squash(value: str | None) -> str:
    if not value:
        return ""
    text = value.replace("\x00", " ").replace("\u00ad", "")
    return re.sub(r"\s+", " ", text).strip()


def course_code(number: str) -> str:
    return f"CISC {number.upper()}"


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    retry = Retry(
        total=3,
        backoff_factor=0.6,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET", "POST"),
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


class Scraper:
    def __init__(self, years: int, output_dir: Path, cache_dir: Path) -> None:
        self.years = years
        self.output_dir = output_dir
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.session = make_session()
        self.scraped_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        current = academic_start_year()
        self.window_starts = list(range(current - years + 1, current + 1))
        self.window_labels = {year_label(start) for start in self.window_starts}
        LOG.info(
            "Recent offering window: %s",
            ", ".join(year_label(start) for start in self.window_starts),
        )

    def in_window(self, start_year: int | None) -> bool:
        return start_year in self.window_starts

    def fetch(self, url: str, *, method: str = "GET", data: dict | None = None) -> requests.Response:
        time.sleep(REQUEST_PAUSE_SECONDS)
        request = self.session.get if method == "GET" else self.session.post
        host = urlparse(url).hostname or ""
        verify = not host.endswith("static.brooklyn.edu")
        if not verify:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        try:
            response = request(url, data=data, timeout=120, verify=verify)
            response.raise_for_status()
            return response
        except requests.exceptions.SSLError:
            LOG.warning("Certificate verification failed for %s; retrying once without verification", url)
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            response = request(url, data=data, timeout=120, verify=False)
            response.raise_for_status()
            return response

    def soup(self, url: str) -> BeautifulSoup:
        response = self.fetch(url)
        response.encoding = response.encoding or "utf-8"
        return BeautifulSoup(response.text, "html.parser")

    def pdf_path(self, url: str) -> Path:
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:20]
        cached = self.cache_dir / f"{digest}.pdf"
        if cached.exists() and cached.stat().st_size > 0:
            return cached
        response = self.fetch(url)
        content = response.content
        if not content.startswith(b"%PDF"):
            raise ValueError(f"Not a PDF: {url}")
        cached.write_bytes(content)
        return cached

    def pdf_pages(self, url: str) -> list[str]:
        """Extract page text in a child process.

        A few bulletin PDFs crash the PDF library with a native access violation.
        Keeping that work in a subprocess lets the scrape continue with the rest.
        """
        path = self.pdf_path(url)
        extracted = path.with_suffix(".pages.json")
        if extracted.exists() and extracted.stat().st_size > 2:
            pages = json.loads(extracted.read_text(encoding="utf-8"))
            if isinstance(pages, list):
                return pages
        completed = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "--extract-pdf", str(path), str(extracted)],
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
        )
        if completed.returncode != 0 or not extracted.exists():
            detail = (completed.stderr or completed.stdout or "").strip().splitlines()
            tail = detail[-1] if detail else f"exit {completed.returncode}"
            raise RuntimeError(tail)
        return json.loads(extracted.read_text(encoding="utf-8"))

    def discover_programs(self) -> list[dict]:
        page = self.soup(PROGRAM_FINDER)
        script = page.find("script", src=re.compile(r"algolia-programs\.js"))
        if script is None or not script.get("src"):
            raise RuntimeError("Program finder no longer publishes its Algolia search script.")
        script_url = urljoin(PROGRAM_FINDER, script["src"])
        javascript = self.fetch(script_url).text
        keys = re.search(r"algoliasearch\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)", javascript)
        index = re.search(r"indexName:\s*'([^']+)'", javascript)
        if not keys or not index:
            raise RuntimeError("Could not read the program finder's search index from its script.")
        app_id, api_key = keys.group(1), keys.group(2)
        endpoint = f"https://{app_id}-dsn.algolia.net/1/indexes/{index.group(1)}/query"
        filters = (
            'facetFilters=[["department:Computer and Information Science"],'
            '["degree_level:Undergraduate","degree_level:Graduate","degree_level:Minor"]]'
            "&hitsPerPage=100"
        )
        response = self.session.post(
            endpoint,
            json={"params": filters},
            headers={
                "X-Algolia-Application-Id": app_id,
                "X-Algolia-API-Key": api_key,
                "Content-Type": "application/json",
            },
            timeout=60,
        )
        response.raise_for_status()
        hits = response.json().get("hits", [])
        programs = []
        for hit in hits:
            relative = hit.get("url") or ""
            programs.append(
                {
                    "title": squash(hit.get("title")),
                    "url": urljoin(BASE, relative),
                    "degree_levels": hit.get("degree_level") or [],
                    "departments": hit.get("department") or [],
                    "colleges": hit.get("college") or [],
                }
            )
        LOG.info("Program finder returned %s CIS programs", len(programs))
        return programs

    def parse_program_page(self, program: dict) -> tuple[dict, list[dict], list[dict]]:
        page = self.soup(program["url"])
        main = page.select_one("main") or page
        title = squash(main.find("h1").get_text(" ", strip=True) if main.find("h1") else program["title"])
        slug = urlparse(program["url"]).path.strip("/").split("/")[-1]
        sections: list[dict] = []
        headings = [
            tag
            for tag in main.find_all(["h2", "h3"])
            if squash(tag.get_text(" ", strip=True)).lower() not in CHROME_HEADINGS
        ]
        for order, heading in enumerate(headings):
            name = squash(heading.get_text(" ", strip=True))
            chunks: list[str] = []
            for sibling in heading.find_all_next():
                if sibling.name in {"h2", "h3"}:
                    break
                if sibling.name in {"p", "li"}:
                    parent_heading = sibling.find_parent(["h2", "h3"])
                    if parent_heading is not None and parent_heading is not heading:
                        continue
                    # find_all_next walks into later sections; stop at the next heading's descendants
                    later_heading = sibling.find_previous(["h2", "h3"])
                    if later_heading is not heading:
                        break
                    text = squash(sibling.get_text(" ", strip=True))
                    if text and text not in chunks:
                        chunks.append(text)
            text = " ".join(chunks)
            if not text:
                continue
            sections.append(
                {
                    "program_id": slug,
                    "section_title": name,
                    "section_text": text,
                    "sort_order": order,
                }
            )

        full_text = " ".join(
            f"{section['section_title']} {section['section_text']}" for section in sections
        )
        overview = next(
            (section["section_text"] for section in sections if section["section_title"].lower() == "program overview"),
            "",
        )
        school = next(
            (section["section_title"] for section in sections if section["section_title"].lower().startswith("school of")),
            "",
        )
        hegis = re.search(r"HEGIS(?:\s+code)?[:\s]+(\d{4})", full_text, re.IGNORECASE)
        nysed = re.search(r"(?:NYSED|SED)\s+program\s+code[:\s]+(\d+)", full_text, re.IGNORECASE)
        credits = re.search(
            r"(?:Major|Minor|Program|Degree)\s+Requirements?\s*\(([^)]*credits?)\)",
            full_text,
            re.IGNORECASE,
        )
        record = {
            "program_id": slug,
            "title": title,
            "url": program["url"],
            "degree_levels": "; ".join(program["degree_levels"]),
            "departments": "; ".join(program["departments"]),
            "colleges": "; ".join(program["colleges"]),
            "school": school,
            "overview": overview,
            "credits": squash(credits.group(1)) if credits else "",
            "hegis_code": hegis.group(1) if hegis else "",
            "nysed_program_code": nysed.group(1) if nysed else "",
            "source_url": PROGRAM_FINDER,
        }
        mentions = []
        seen: set[str] = set()
        for match in COURSE_MENTION.finditer(full_text):
            code = course_code(match.group(1))
            if code in seen:
                continue
            seen.add(code)
            mentions.append(
                {
                    "program_id": slug,
                    "course_code": code,
                    "raw_mention": squash(match.group(0)),
                }
            )
        return record, sections, mentions

    def parse_course_inventory(self, url: str, division: str) -> list[dict]:
        page = self.soup(url)
        rows = []
        for link in page.select("ul.category li a"):
            span = link.select_one(".courseid")
            label = squash(span.get_text(" ", strip=True) if span else link.get_text(" ", strip=True))
            match = re.search(r"(\*?)(\d{4}[A-Z]?)", label)
            if not match:
                continue
            whole = squash(link.get_text(" ", strip=True))
            title = re.sub(r"^CISC\.?\s+\*?\d{4}[A-Z]?\s*-\s*", "", whole, flags=re.IGNORECASE)
            rows.append(
                {
                    "course_code": course_code(match.group(2)),
                    "division": division,
                    "title": title,
                    "not_counted_toward_advanced": bool(match.group(1)),
                    "inventory_url": urljoin(url, link.get("href")),
                    "source_url": url,
                }
            )
        LOG.info("%s inventory listed %s courses", division, len(rows))
        return rows

    def parse_course_detail(self, row: dict) -> dict:
        detail = dict(row)
        detail.update({"hours": "", "credits": "", "description": "", "prerequisites": ""})
        try:
            page = self.soup(row["inventory_url"])
        except requests.RequestException as exc:
            LOG.warning("Course detail failed for %s: %s", row["course_code"], exc)
            return detail
        header = page.select_one("h2.course-header")
        if header:
            header_text = squash(header.get_text(" ", strip=True))
            match = re.search(r"CISC\s+(\*?)(\d{4}[A-Z]?)\s+(.*)$", header_text, re.IGNORECASE)
            if match:
                detail["not_counted_toward_advanced"] = bool(match.group(1)) or detail["not_counted_toward_advanced"]
                if match.group(3):
                    detail["title"] = squash(match.group(3))
        description = page.select_one("#courseDescription")
        paragraphs = []
        if description:
            paragraphs = [squash(p.get_text(" ", strip=True)) for p in description.find_all("p")]
            paragraphs = [p for p in paragraphs if p]
        if paragraphs and "credit" in paragraphs[0].lower():
            detail["hours"] = paragraphs[0]
            detail["credits"] = extract_credits(paragraphs[0])
            body = " ".join(paragraphs[1:])
        else:
            body = " ".join(paragraphs)
        narrative, prerequisites = split_prerequisites(body)
        detail["description"] = narrative
        detail["prerequisites"] = prerequisites
        return detail

    def bulletin_documents(self) -> list[dict]:
        page = self.soup(BULLETINS_URL)
        documents = []
        seen: set[str] = set()
        for link in page.find_all("a", href=True):
            href = urljoin(BULLETINS_URL, link["href"])
            if ".pdf" not in href.lower():
                continue
            match = BULLETIN_FILE.search(urlparse(href).path)
            if not match:
                continue
            start = int(match.group(1))
            if not self.in_window(start):
                continue
            if href in seen:
                continue
            seen.add(href)
            link_text = squash(link.get_text(" ", strip=True))
            documents.append(
                {
                    "academic_year": year_label(start),
                    "academic_year_start": start,
                    "level": match.group(3).title(),
                    "document_type": "addendum" if "addendum" in href.lower() else "bulletin",
                    "link_text": link_text,
                    "source_url": href,
                }
            )
        documents.sort(key=lambda item: (item["academic_year_start"], item["level"], item["document_type"]))
        LOG.info("Bulletin PDFs in the window: %s", len(documents))
        return documents

    def parse_bulletin(self, document: dict) -> tuple[dict, list[dict]]:
        meta = {
            "academic_year": document["academic_year"],
            "level": document["level"],
            "document_type": document["document_type"],
            "source_url": document["source_url"],
            "page_count": 0,
            "cis_page_count": 0,
            "course_count": 0,
            "parse_status": "ok",
        }
        try:
            pages = self.pdf_pages(document["source_url"])
        except (requests.RequestException, ValueError, OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
            LOG.warning("Bulletin download failed %s: %s", document["source_url"], exc)
            meta["parse_status"] = f"download_failed: {exc}"
            return meta, []
        meta["page_count"] = len(pages)
        section, cis_pages = extract_cis_section(pages)
        meta["cis_page_count"] = cis_pages
        if not section and document["document_type"] == "addendum":
            section = "\n".join(clean_pdf_text(page) for page in pages)
            meta["parse_status"] = "addendum_full_text"
        if not section:
            meta["parse_status"] = "cis_section_not_found"
            return meta, []
        main_text, inactive_text = split_inactive(section)
        courses = parse_bulletin_course_blocks(main_text)
        inactive_entries = parse_inactive_entries(inactive_text)
        found = {row["course_code"] for row in courses}
        for row in courses:
            if row["course_code"] in inactive_entries:
                row["inactive"] = True
                if not row["title"]:
                    row["title"] = inactive_entries[row["course_code"]]
        for code, title in inactive_entries.items():
            if code in found:
                continue
            stub = empty_bulletin_course(code, inactive=True)
            stub["title"] = title
            courses.append(stub)
        for row in courses:
            row.update(
                {
                    "academic_year": document["academic_year"],
                    "academic_year_start": document["academic_year_start"],
                    "level": document["level"],
                    "document_type": document["document_type"],
                    "source_url": document["source_url"],
                }
            )
        meta["course_count"] = len(courses)
        LOG.info(
            "Parsed %s %s %s: %s courses (%s inactive marks)",
            document["level"],
            document["academic_year"],
            document["document_type"],
            len(courses),
            len(inactive_entries),
        )
        return meta, courses

    def parse_resource_page(self, url: str, level: str) -> tuple[list[dict], list[dict], list[dict]]:
        page = self.soup(url)
        offerings = parse_schedule(page, url, level, self.window_starts)
        syllabi: list[dict] = []
        documents: list[dict] = []
        group = ""
        for tag in page.find_all(["h3", "h4", "a"]):
            if tag.name in {"h3", "h4"}:
                group = squash(tag.get_text(" ", strip=True))
                continue
            href = tag.get("href") or ""
            if ".pdf" not in href.lower():
                continue
            absolute = urljoin(url, href)
            text = squash(tag.get_text(" ", strip=True))
            parent_text = squash(tag.parent.get_text(" ", strip=True)) if tag.parent else text
            codes = expand_syllabus_codes(text)
            if not codes:
                parent_codes = expand_syllabus_codes(parent_text)
                if len(parent_codes) == 1:
                    codes = parent_codes
            record = {
                "link_text": text or parent_text,
                "section": group,
                "level": level,
                "source_url": absolute,
                "source_page": url,
            }
            if codes:
                syllabi.append({**record, "course_codes": codes})
            else:
                documents.append(record)
        LOG.info("%s resources: %s syllabi, %s other PDFs, %s schedule rows", level, len(syllabi), len(documents), len(offerings))
        return offerings, syllabi, documents

    def read_pdf_document(self, record: dict) -> dict:
        enriched = dict(record)
        enriched.update({"page_count": 0, "text": "", "parse_status": "ok"})
        try:
            pages = self.pdf_pages(record["source_url"])
        except (requests.RequestException, ValueError, OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
            enriched["parse_status"] = f"download_failed: {exc}"
            return enriched
        enriched["page_count"] = len(pages)
        parts = [clean_pdf_text(page) for page in pages]
        enriched["text"] = squash("\n".join(parts))
        if not enriched["text"]:
            enriched["parse_status"] = "no_extractable_text"
        return enriched

    def degree_map_index(self, program_names: list[str]) -> list[dict]:
        page = self.soup(DEGREE_MAPS_URL)
        bases = []
        for name in program_names:
            base = re.sub(
                r",?\s*(b\.s\.|b\.a\.|m\.s\.|m\.a\.|minor|advanced certificate).*$",
                "",
                name,
                flags=re.IGNORECASE,
            ).strip()
            if len(base) >= 8:
                bases.append(base.lower())
        selected = []
        for link in page.find_all("a", href=re.compile(r"javascript:viewMap\(")):
            match = re.search(r"viewMap\((\d+)\)", link.get("href", ""))
            if not match:
                continue
            name = squash(link.get_text(" ", strip=True))
            if not any(base in name.lower() for base in bases):
                continue
            select = page.select_one(f"select#years_{match.group(1)}")
            if select is None:
                continue
            for option in select.find_all("option"):
                span = parse_year_span(option.get_text(" ", strip=True))
                if not span or not self.in_window(span[0]):
                    continue
                selected.append(
                    {
                        "program_name": name,
                        "bulletin_year": year_label(span[0]),
                        "academic_year_start": span[0],
                        "degree_map_id": option.get("value"),
                    }
                )
        LOG.info("Degree maps in the window: %s", len(selected))
        return selected

    def parse_degree_map(self, item: dict) -> list[dict]:
        try:
            response = self.fetch(
                DEGREE_MAP_VIEW_URL,
                method="POST",
                data={
                    "degree_map_id": item["degree_map_id"],
                    "select_criteria": "all",
                    "school_or_dept_param": "",
                    "hide_selection": "N",
                },
            )
        except requests.RequestException as exc:
            LOG.warning("Degree map %s failed: %s", item["degree_map_id"], exc)
            return []
        page = BeautifulSoup(response.text, "html.parser")
        rows = []
        tables = [
            table
            for table in page.find_all("table")
            if table.find("table") is None and "Fall Classes" in table.get_text(" ", strip=True)[:80]
        ]
        for table in tables:
            year_in_program = ""
            for previous in table.find_all_previous(string=True):
                text = squash(str(previous))
                if text and "Year" in text and len(text) < 40:
                    year_in_program = text
                    break
                if text and len(text) > 80:
                    break
            for tr in table.find_all("tr"):
                cells = tr.find_all("td", recursive=False) or tr.find_all("td")
                texts = [squash(cell.get_text(" ", strip=True)) for cell in cells]
                if len(texts) < 4 or texts[0].startswith("Fall Classes"):
                    continue
                for term, course_text, credits in (
                    ("Fall", texts[0], texts[1]),
                    ("Spring", texts[2], texts[3] if len(texts) > 3 else ""),
                ):
                    if not course_text or course_text == "Credits":
                        continue
                    codes = [f"{subject} {number}" for subject, number in ANY_COURSE_CODE.findall(course_text)]
                    requirement = ""
                    requirement_match = re.search(r"\s(Major|General Elective)$", course_text)
                    if requirement_match:
                        requirement = requirement_match.group(1)
                    targets = codes or [""]
                    for code in targets:
                        rows.append(
                            {
                                "program_name": item["program_name"],
                                "bulletin_year": item["bulletin_year"],
                                "academic_year_start": item["academic_year_start"],
                                "degree_map_id": item["degree_map_id"],
                                "year_in_program": year_in_program,
                                "term": term,
                                "course_text": course_text,
                                "course_code": code,
                                "credits": credits if re.fullmatch(r"\d+(?:\.\d+)?", credits) else "",
                                "requirement_type": requirement,
                                "source_url": DEGREE_MAP_VIEW_URL,
                            }
                        )
        return rows


def clean_pdf_text(text: str) -> str:
    text = text.replace("\x00", " ").replace("\u00ad", "").replace("\x0c", "\n").replace("\r", "\n")
    text = text.replace("\u2013", "-").replace("\u2014", "-").replace("\u2019", "'")
    text = re.sub(r"-\n([a-z])", r"\1", text)
    return text


def extract_cis_section(pages: list[str]) -> tuple[str, int]:
    chunks: list[str] = []
    started = False
    for page in pages:
        text = clean_pdf_text(page)
        nonempty = [line.strip() for line in text.splitlines() if line.strip()]
        if not nonempty:
            continue
        header = nonempty[0]
        is_cis = header.startswith("Computer and Information Science") and "Programs and Courses of Instruction" in header
        if not started:
            if is_cis and "Department office" in text:
                started = True
            else:
                continue
        elif not is_cis:
            break
        body = [line for line in nonempty[1:] if not RUNNING_HEADER.match(line)]
        chunks.append("\n".join(body))
    return "\n".join(chunks), len(chunks)


def split_inactive(section: str) -> tuple[str, str]:
    parts = INACTIVE_SPLIT.split(section, maxsplit=1)
    if len(parts) == 1:
        return section, ""
    return parts[0], parts[1]


def extract_credits(hours: str) -> str:
    match = re.search(r"(\d+(?:\.\d+)?)\s+credits?", hours or "", re.IGNORECASE)
    return match.group(1) if match else ""


def split_prerequisites(body: str) -> tuple[str, str]:
    match = re.search(r"\b((?:Pre|Co)requisites?:)\s*(.*)$", body or "", re.IGNORECASE)
    if not match:
        return squash(body), ""
    narrative = squash(body[: match.start()])
    prerequisites = squash(match.group(2))
    return narrative, prerequisites


def parse_inactive_entries(text: str) -> dict[str, str]:
    entries: dict[str, str] = {}
    for line in text.splitlines():
        match = COURSE_LINE.match(line.strip())
        if not match:
            continue
        entries[course_code(match.group(2))] = squash(match.group(3))
    return entries


def empty_bulletin_course(code: str, inactive: bool) -> dict:
    return {
        "course_code": code,
        "title": "",
        "hours": "",
        "credits": "",
        "description": "",
        "prerequisites": "",
        "not_counted_toward_advanced": False,
        "inactive": inactive,
    }


def parse_bulletin_course_blocks(text: str) -> list[dict]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    lines = [line for line in lines if not RUNNING_HEADER.match(line)]
    courses = []
    index = 0
    while index < len(lines):
        match = COURSE_LINE.match(lines[index])
        if not match:
            index += 1
            continue
        asterisk, number, title = match.group(1), match.group(2).upper(), match.group(3)
        index += 1
        title_parts = [title] if title else []
        while index < len(lines) and not COURSE_LINE.match(lines[index]):
            lowered = lines[index].lower()
            next_has_credits = index + 1 < len(lines) and "credit" in lines[index + 1].lower()
            if "credit" in lowered or lowered.startswith("prerequisite") or lowered.startswith("corequisite"):
                break
            if "hour" in lowered and next_has_credits:
                break
            if len(title_parts) >= 3:
                break
            title_parts.append(lines[index])
            index += 1
        hours = ""
        if index < len(lines) and "hour" in lines[index].lower() and "credit" not in lines[index].lower():
            if index + 1 < len(lines) and "credit" in lines[index + 1].lower():
                hours = f"{lines[index]} {lines[index + 1]}"
                index += 2
        elif index < len(lines) and "credit" in lines[index].lower():
            hours = lines[index]
            index += 1
        body: list[str] = []
        while index < len(lines) and not COURSE_LINE.match(lines[index]):
            body.append(lines[index])
            index += 1
        if not hours:
            continue
        title_text = squash(" ".join(title_parts))
        credits = extract_credits(hours)
        # Addenda mix requirement totals ("17.5 credits") into the same shape as a
        # catalog line. A real course title does not name another CISC course, and
        # CIS courses are not worth more than a handful of credits.
        if re.search(r"\bCISC\b", title_text, re.IGNORECASE):
            continue
        try:
            if credits and float(credits) > 9:
                continue
        except ValueError:
            pass
        narrative, prerequisites = split_prerequisites(" ".join(body))
        courses.append(
            {
                "course_code": course_code(number),
                "title": title_text,
                "hours": squash(hours),
                "credits": credits,
                "description": narrative,
                "prerequisites": prerequisites,
                "not_counted_toward_advanced": bool(asterisk),
                "inactive": False,
            }
        )
    return courses


def parse_schedule(page: BeautifulSoup, url: str, level: str, window_starts: list[int]) -> list[dict]:
    heading = None
    for tag in page.find_all(["h2", "h3"]):
        if "schedule" in tag.get_text(" ", strip=True).lower():
            heading = tag
            break
    if heading is None:
        return []
    rows = []
    current_year: tuple[int, int] | None = None
    pattern = ""
    partner = ""
    node = heading
    while node is not None:
        node = node.find_next()
        if node is None or not getattr(node, "name", None):
            break
        if node.name in {"h2", "h3"} and node is not heading:
            break
        if node.name in {"h4", "h5"}:
            label = squash(node.get_text(" ", strip=True))
            lowered = label.lower()
            if "every semester" in lowered:
                current_year = None
                pattern = "every_semester"
                partner = ""
            elif "as scheduled" in lowered:
                current_year = None
                pattern = "as_scheduled"
                partner = ""
            elif node.name == "h5":
                partner = label
            else:
                current_year = parse_year_span(label)
                pattern = "scheduled" if current_year else ""
                partner = ""
            continue
        if node.name == "table" and pattern == "scheduled" and current_year:
            header = [squash(cell.get_text(" ", strip=True)).lower() for cell in node.find_all("th")]
            if not header:
                first = node.find("tr")
                header = [squash(cell.get_text(" ", strip=True)).lower() for cell in first.find_all(["td", "th"])] if first else []
            for tr in node.find_all("tr"):
                cells = tr.find_all(["td", "th"])
                texts = [cell.get_text("\n", strip=True) for cell in cells]
                if not texts or "semester" in texts[0].lower():
                    continue
                for position, text in enumerate(texts):
                    term = "Fall" if position == 0 or (header and position < len(header) and "fall" in header[position]) else "Spring"
                    if header and position < len(header):
                        if "fall" in header[position]:
                            term = "Fall"
                        elif "spring" in header[position]:
                            term = "Spring"
                    rows.extend(
                        schedule_entries(
                            text,
                            academic_year=year_label(current_year[0]),
                            academic_year_start=current_year[0],
                            term=term,
                            pattern="scheduled",
                            partner="",
                            level=level,
                            url=url,
                            window_starts=window_starts,
                        )
                    )
        elif node.name == "li" and pattern in {"every_semester", "as_scheduled"}:
            rows.extend(
                schedule_entries(
                    node.get_text(" ", strip=True),
                    academic_year="",
                    academic_year_start=None,
                    term="Every Semester" if pattern == "every_semester" else "As Scheduled",
                    pattern=pattern,
                    partner=partner,
                    level=level,
                    url=url,
                    window_starts=window_starts,
                )
            )
    return rows


def schedule_entries(
    text: str,
    *,
    academic_year: str,
    academic_year_start: int | None,
    term: str,
    pattern: str,
    partner: str,
    level: str,
    url: str,
    window_starts: list[int],
) -> list[dict]:
    pieces = [squash(piece) for piece in re.split(r"(?=CISC\s+\d{4})", text) if squash(piece)]
    rows = []
    for piece in pieces:
        match = re.match(r"CISC\s+(\d{4}[A-Z]?)\s*(.*)$", piece, re.IGNORECASE)
        if not match:
            continue
        number, rest = match.group(1).upper(), match.group(2).strip()
        cross_listed: list[str] = []
        while True:
            cross_match = re.match(r"^/\s*([A-Z]{2,5})\s+(\d{4}[A-Z]?)\s*(.*)$", rest)
            if not cross_match:
                break
            cross_listed.append(f"{cross_match.group(1)} {cross_match.group(2)}")
            rest = cross_match.group(3).strip()
        times = ""
        time_match = re.search(r"\s*\(([DEW](?:\s*,\s*[DEW])*)\)\s*$", rest, re.IGNORECASE)
        if time_match:
            times = time_match.group(1).upper().replace(" ", "")
            rest = rest[: time_match.start()].strip()
        title = rest
        cross = "; ".join(cross_listed)
        in_window = pattern == "every_semester" or (
            pattern == "scheduled" and academic_year_start in window_starts
        )
        rows.append(
            {
                "course_code": course_code(number),
                "title": squash(title),
                "academic_year": academic_year,
                "academic_year_start": academic_year_start or "",
                "term": term,
                "time_codes": times,
                "cross_listed": cross,
                "partner_department": partner,
                "offering_pattern": pattern,
                "in_recent_window": in_window,
                "level": level,
                "source_url": url,
            }
        )
    return rows


def expand_syllabus_codes(text: str) -> list[str]:
    codes: list[str] = []
    range_match = re.search(r"CISC\s+(\d{4})\s*[-–]\s*(\d{2,4})", text, re.IGNORECASE)
    if range_match:
        start = int(range_match.group(1))
        end_raw = range_match.group(2)
        end = int(end_raw) if len(end_raw) == 4 else int(str(start)[: 4 - len(end_raw)] + end_raw)
        if 0 < end - start <= 8:
            codes.extend(course_code(str(number)) for number in range(start, end + 1))
    and_match = re.search(r"CISC\s+(\d{4})\s+and\s+(\d{4})", text, re.IGNORECASE)
    if and_match:
        codes.extend([course_code(and_match.group(1)), course_code(and_match.group(2))])
    if not codes:
        codes = [course_code(number) for number in COURSE_CODE.findall(text)]
    deduped = []
    for code in codes:
        if code not in deduped:
            deduped.append(code)
    return deduped


def first_nonempty(rows: list[dict], key: str) -> str:
    for row in rows:
        value = squash(str(row.get(key) or ""))
        if value:
            return value
    return ""


REQUISITE_DEPARTMENTS = {
    "computer and information sciences": "CISC",
    "computer and information science": "CISC",
    "core curriculum": "CORC",
    "core studies": "CORE",
    "television, radio & emerging media": "TVRA",
    "television, radio and emerging media": "TVRA",
    "mathematics": "MATH",
    "philosophy": "PHIL",
    "psychology": "PSYC",
    "linguistics": "LING",
    "accounting": "ACCT",
    "economics": "ECON",
    "business": "BUSN",
    "english": "ENGL",
    "finance": "FINC",
    "music": "MUSC",
    "film": "FILM",
    "math": "MATH",
    "cisc": "CISC",
    "cis": "CISC",
    "art": "ART",
}
_REQUISITE_DEPT_RE = re.compile(
    r"\b(" + "|".join(re.escape(name) for name in sorted(REQUISITE_DEPARTMENTS, key=len, reverse=True)) + r")\b"
    r"|(?<![\d.])\*?(\d{4}[A-Z]?)(?!\d)(?!\.\d)",
    re.IGNORECASE,
)
_REQUISITE_LABEL_RE = re.compile(
    r"(?:^|[.;,]\s*)(prerequisites?\s+or\s+corequisites?|pre-?\s*or\s+corequisites?|corequisites?|prerequisites?)\s*:\s*",
    re.IGNORECASE,
)
PLACEMENT_NOTE = (
    "Degree maps place MATH 1006 before MATH 1011 when placement requires it. "
    "Program requirements allow MATH 1006, 1011, and 1012 to be waived by a placement exam."
)

# Major requirements that name another department. Operators say whether every
# course in the group is required or any one of them satisfies the group.
PROGRAM_REQUISITE_GROUPS = [
    ("computer-science-bs", "cs-math-placement", "all", True, [("MATH", "1006")]),
    ("computer-science-bs", "cs-precalculus", "one_of", True, [("MATH", "1011"), ("MATH", "1012")]),
    ("computer-science-bs", "cs-calculus", "all", False, [("MATH", "1201"), ("MATH", "1206")]),
    ("computer-science-bs", "cs-calculus-transfer", "all", False, [("MATH", "1211")]),
    ("computer-science-bs", "cs-statistics", "one_of", False, [("MATH", "2501"), ("MATH", "3501")]),
    ("computer-science-bs", "cs-ethics", "one_of", False, [("CISC", "2820W"), ("PHIL", "3318W")]),
    ("multimedia-computing-bs", "mmc-math-placement", "all", True, [("MATH", "1006")]),
    ("multimedia-computing-bs", "mmc-precalculus", "one_of", True, [("MATH", "1011"), ("MATH", "1012")]),
    ("multimedia-computing-bs", "mmc-calculus-1", "all", False, [("MATH", "1201")]),
    ("multimedia-computing-bs", "mmc-second-math", "one_of", False, [("MATH", "1711"), ("MATH", "1206")]),
    ("multimedia-computing-bs", "mmc-third-math", "one_of", False, [("MATH", "1716"), ("MATH", "2501")]),
    ("information-systems-bs", "is-ethics", "one_of", False, [("CISC", "2820W"), ("PHIL", "3318W")]),
    ("information-systems-bs", "is-mis", "one_of", False, [("BUSN", "3420"), ("CISC", "1590")]),
    ("information-systems-bs", "is-operations", "one_of", False, [("BUSN", "3430"), ("CISC", "2531")]),
    ("information-systems-bs", "is-ecommerce", "one_of", False, [("BUSN", "3120"), ("CISC", "1530"), ("BUSN", "3432"), ("CISC", "2532")]),
    ("information-systems-bs", "is-seminar", "one_of", False, [("BUSN", "4202W"), ("CISC", "1580W")]),
    ("information-systems-bs", "is-micro", "one_of", False, [("ECON", "2100"), ("BUSN", "2100")]),
    ("information-systems-bs", "is-macro", "one_of", False, [("ECON", "2200"), ("BUSN", "2200")]),
    ("information-systems-bs", "is-management", "all", False, [("BUSN", "3200")]),
    ("information-systems-bs", "is-finance", "all", False, [("FINC", "3310")]),
    ("information-systems-bs", "is-accounting", "all", False, [("ACCT", "2001")]),
    (
        "information-systems-bs",
        "is-quantitative",
        "one_of",
        False,
        [("BUSN", "3400"), ("ECON", "3400"), ("MATH", "2501"), ("MATH", "3501"), ("PSYC", "3400")],
    ),
    (
        "information-systems-bs",
        "is-second-quantitative",
        "one_of",
        False,
        [("BUSN", "3410"), ("ECON", "3410"), ("MATH", "1201"), ("BUSN", "3421"), ("CISC", "2590")],
    ),
    ("information-systems-bs", "is-math-placement", "all", True, [("MATH", "1006")]),
    ("information-systems-bs", "is-precalculus-if-stats", "one_of", True, [("MATH", "1011"), ("MATH", "1012")]),
    (
        "computational-mathematics-bs",
        "comp-math-placement",
        "all",
        True,
        [("MATH", "1006")],
    ),
    ("computational-mathematics-bs", "comp-precalculus", "one_of", True, [("MATH", "1011"), ("MATH", "1012")]),
    ("computational-mathematics-bs", "comp-calculus", "all", False, [("MATH", "1201"), ("MATH", "1206")]),
]

# How the undergraduate math sequence fits together, including MATH 1006,
# which the CISC catalog never lists but the degree maps and majors do.
MATH_SEQUENCE = [
    ("MATH 1011", "MATH 1006", "placement_prerequisite", "precalc-placement", "all", True),
    ("MATH 1201", "MATH 1011", "prerequisite", "calculus-entry", "one_of", False),
    ("MATH 1201", "MATH 1012", "prerequisite", "calculus-entry", "one_of", False),
    ("MATH 1206", "MATH 1201", "prerequisite", "calculus-2", "all", False),
]


def _requisite_kind(label: str) -> str:
    lowered = label.lower()
    if "pre" in lowered and "co" in lowered:
        return "pre_or_corequisite"
    if lowered.startswith("co"):
        return "corequisite"
    return "prerequisite"


def extract_requisite_refs(text: str, default_dept: str = "CISC") -> list[tuple[str, str, str]]:
    """Return (relationship, dept, number) mentions in catalog requirement text.

    Bare course numbers belong to default_dept until another department is named.
    """
    if not text or not str(text).strip():
        return []
    raw = str(text).strip()
    if not _REQUISITE_LABEL_RE.match(raw):
        raw = "Prerequisite: " + raw
    segments: list[tuple[str, str]] = []
    kind = "prerequisite"
    position = 0
    for match in _REQUISITE_LABEL_RE.finditer(raw):
        body = raw[position:match.start()].strip(" ;,.")
        if body and position > 0:
            segments.append((kind, body))
        kind = _requisite_kind(match.group(1))
        position = match.end()
    tail = raw[position:].strip(" ;,.")
    if tail:
        segments.append((kind, tail))
    refs: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for relationship, body in segments:
        department = default_dept
        for match in _REQUISITE_DEPT_RE.finditer(body):
            if match.group(1):
                department = REQUISITE_DEPARTMENTS[match.group(1).lower()]
                continue
            number = match.group(2).upper()
            key = (relationship, department, number)
            if key not in seen:
                seen.add(key)
                refs.append(key)
    return refs


_DEPT_NAME_RE = re.compile(
    r"\b(" + "|".join(re.escape(name) for name in sorted(REQUISITE_DEPARTMENTS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)
_BOTH_OF_RE = re.compile(r"\bboth\s+(?:of\s+)?([^,;]*?)\s+and\s+", re.IGNORECASE)
# After department names become codes, a clause is codes and course numbers.
_CODE_OR_NUMBER_RE = re.compile(
    r"\b(" + "|".join(sorted(set(REQUISITE_DEPARTMENTS.values()))) + r")\b"
    r"|(?<![\d.])\*?(\d{4}[A-Z]?)(?!\d)(?!\.\d)",
)
# Required clauses are split by semicolons (unless the next clause starts with "or") and by "and".
_AND_SPLIT_RE = re.compile(r";(?!\s*or\b)\s*|,?\s+and\s+", re.IGNORECASE)
_OR_RE = re.compile(r"\b(?:or|either)\b", re.IGNORECASE)


def grouped_requisite_refs(text: str, default_dept: str = "CISC") -> list[tuple[str, str, str, int, str]]:
    """Like extract_requisite_refs, plus each course's group in the rule.

    Returns (relationship, dept, number, group_index, operator). Clauses separated by
    semicolons or "and" are all required; courses listed with "or" in one clause form a
    one_of group. "Both of 1113 and 1114" stays inside its clause, so a pair offered as one
    alternative is shown as two separate alternatives. Courses outside any "or" list get
    their own all group. Nested rules ("3110 and either 1115 or 1170") are approximated.
    """
    if not text or not str(text).strip():
        return []
    raw = str(text).strip()
    if not _REQUISITE_LABEL_RE.match(raw):
        raw = "Prerequisite: " + raw
    segments: list[tuple[str, str]] = []
    kind = "prerequisite"
    position = 0
    for match in _REQUISITE_LABEL_RE.finditer(raw):
        body = raw[position:match.start()].strip(" ;,.")
        if body and position > 0:
            segments.append((kind, body))
        kind = _requisite_kind(match.group(1))
        position = match.end()
    tail = raw[position:].strip(" ;,.")
    if tail:
        segments.append((kind, tail))

    refs: list[tuple[str, str, str, int, str]] = []
    seen: set[tuple[str, str, str, int]] = set()
    group = 0
    for relationship, body in segments:
        # Department names to codes first, so "Computer and Information Science" isn't split on "and".
        body = _DEPT_NAME_RE.sub(lambda m: REQUISITE_DEPARTMENTS[m.group(1).lower()], body)
        body = _BOTH_OF_RE.sub(lambda m: f"both of {m.group(1)} & ", body)
        department = default_dept
        for clause in _AND_SPLIT_RE.split(body):
            members: list[tuple[str, str]] = []
            for match in _CODE_OR_NUMBER_RE.finditer(clause):
                if match.group(1):
                    department = match.group(1)
                    continue
                members.append((department, match.group(2).upper()))
            if not members:
                continue
            if len(members) > 1 and _OR_RE.search(clause):
                group += 1
                for dept, number in members:
                    if (relationship, dept, number, group) not in seen:
                        seen.add((relationship, dept, number, group))
                        refs.append((relationship, dept, number, group, "one_of"))
            else:
                for dept, number in members:
                    group += 1
                    seen.add((relationship, dept, number, group))
                    refs.append((relationship, dept, number, group, "all"))
    return refs


def build_requisites(courses: pd.DataFrame, program_ids: set[str]) -> pd.DataFrame:
    """Catalog prerequisite edges plus other-department major requirements.

    MATH 1006 is included because the computer science, multimedia, and
    computational mathematics majors, and the degree maps, start the math
    sequence there even though CISC catalog pages begin at MATH 1011 or 1201.
    """
    known = set(courses["course_code"]) if not courses.empty else set()
    rows: list[dict] = []

    def add(
        course_code: str,
        program_id: str,
        department: str,
        number: str,
        relationship: str,
        source: str,
        group_id: str = "",
        group_operator: str = "",
        waivable: bool = False,
        note: str = "",
    ) -> None:
        requires = f"{department} {number}"
        rows.append(
            {
                "course_code": course_code,
                "program_id": program_id,
                "requires_code": requires,
                "requires_dept": department,
                "requires_number": number,
                "relationship": relationship,
                "source": source,
                "group_id": group_id,
                "group_operator": group_operator,
                "waivable": waivable,
                "in_cisc_catalog": requires in known,
                "note": note,
            }
        )

    if not courses.empty:
        for record in courses.itertuples(index=False):
            code = record.course_code
            mentioned_math: set[str] = set()
            for relationship, department, number, group, operator in grouped_requisite_refs(
                getattr(record, "prerequisites", "")
            ):
                if f"{department} {number}" == code:
                    continue
                add(code, "", department, number, relationship, "catalog", f"{code}-g{group}", operator)
                if department == "MATH":
                    mentioned_math.add(number)
            if mentioned_math & {"1011", "1012", "1201", "1206"}:
                add(
                    code,
                    "",
                    "MATH",
                    "1006",
                    "placement_prerequisite",
                    "placement_sequence",
                    group_id="math-1006",
                    group_operator="all",
                    waivable=True,
                    note=PLACEMENT_NOTE,
                )

    for program_id, group_id, operator, waivable, members in PROGRAM_REQUISITE_GROUPS:
        if program_id not in program_ids:
            continue
        note = PLACEMENT_NOTE if waivable else ""
        if group_id in {"is-precalculus-if-stats", "is-math-placement"}:
            note = "Applies when MATH 2501 or MATH 3501 is chosen. MATH 1006 may be required before MATH 1011 and can be waived by placement."
        if group_id == "cs-calculus-transfer":
            note = "Required for transfer students who already have credit for the older MATH 3.20 and 4.20 sequence, in place of MATH 1201 and 1206."
        for department, number in members:
            add("", program_id, department, number, "program_requirement", "program", group_id, operator, waivable, note)

    for course_code, requires_code, relationship, group_id, operator, waivable in MATH_SEQUENCE:
        department, number = requires_code.split()
        add(
            course_code,
            "",
            department,
            number,
            relationship,
            "placement_sequence",
            group_id,
            operator,
            waivable,
            PLACEMENT_NOTE if waivable else "Undergraduate math sequence used by the CIS majors and degree maps.",
        )

    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    frame = frame.drop_duplicates(
        subset=["course_code", "program_id", "requires_code", "relationship", "source", "group_id"]
    )
    return frame.sort_values(
        ["source", "program_id", "course_code", "group_id", "requires_code"]
    ).reset_index(drop=True)


def build_courses(
    inventory: list[dict],
    bulletin_courses: list[dict],
    offerings: list[dict],
    window_starts: list[int],
) -> pd.DataFrame:
    by_code: dict[str, dict] = {}

    def ensure(code: str) -> dict:
        if code not in by_code:
            by_code[code] = {
                "course_code": code,
                "subject": "CISC",
                "course_number": code.replace("CISC ", ""),
                "division": "",
                "title": "",
                "credits": "",
                "hours": "",
                "description": "",
                "prerequisites": "",
                "not_counted_toward_advanced": False,
                "inventory_url": "",
                "bulletin_years": "",
                "inactive_years": "",
                "scheduled_terms": "",
                "offering_basis": "",
                "offered_in_window": False,
                "first_seen_year": "",
                "last_seen_year": "",
            }
        return by_code[code]

    for row in inventory:
        item = ensure(row["course_code"])
        item["division"] = row["division"]
        item["title"] = row.get("title") or item["title"]
        item["hours"] = row.get("hours") or item["hours"]
        item["credits"] = row.get("credits") or item["credits"]
        item["description"] = row.get("description") or item["description"]
        item["prerequisites"] = row.get("prerequisites") or item["prerequisites"]
        item["not_counted_toward_advanced"] = bool(row.get("not_counted_toward_advanced"))
        item["inventory_url"] = row.get("inventory_url") or ""

    bulletin_by_code: dict[str, list[dict]] = {}
    for row in bulletin_courses:
        bulletin_by_code.setdefault(row["course_code"], []).append(row)
        ensure(row["course_code"])

    for code, rows in bulletin_by_code.items():
        item = ensure(code)
        ordered = sorted(rows, key=lambda row: (row["academic_year_start"], row["document_type"] != "bulletin"))
        active_years = []
        inactive_years = []
        seen_years = []
        for row in ordered:
            label = row["academic_year"]
            if label not in seen_years:
                seen_years.append(label)
            if row.get("inactive"):
                if label not in inactive_years:
                    inactive_years.append(label)
            elif label not in active_years:
                active_years.append(label)
        preferred = [
            row
            for row in reversed(ordered)
            if row["document_type"] == "bulletin" and not row.get("inactive") and row.get("description")
        ]
        preferred = preferred or [row for row in reversed(ordered) if row.get("description")]
        if preferred:
            if not item["title"]:
                item["title"] = preferred[0].get("title") or ""
            if not item["description"]:
                item["description"] = preferred[0].get("description") or ""
            if not item["prerequisites"]:
                item["prerequisites"] = preferred[0].get("prerequisites") or ""
            if not item["hours"]:
                item["hours"] = preferred[0].get("hours") or ""
            if not item["credits"]:
                item["credits"] = preferred[0].get("credits") or ""
            item["not_counted_toward_advanced"] = item["not_counted_toward_advanced"] or bool(
                preferred[0].get("not_counted_toward_advanced")
            )
        if not item["title"]:
            item["title"] = first_nonempty(list(reversed(ordered)), "title")
        divisions = {row["level"] for row in rows}
        if item["division"] and item["division"] not in divisions:
            divisions.add(item["division"])
        if divisions == {"Undergraduate", "Graduate"}:
            item["division"] = "Both"
        elif not item["division"] and divisions:
            item["division"] = next(iter(divisions))
        item["bulletin_years"] = "; ".join(active_years)
        item["inactive_years"] = "; ".join(inactive_years)
        if seen_years:
            item["first_seen_year"] = seen_years[0]
            item["last_seen_year"] = seen_years[-1]

    schedule_by_code: dict[str, list[dict]] = {}
    for row in offerings:
        schedule_by_code.setdefault(row["course_code"], []).append(row)
        item = ensure(row["course_code"])
        if not item["title"]:
            item["title"] = row.get("title") or ""
        if not item["division"]:
            item["division"] = row.get("level") or ""

    for code, rows in schedule_by_code.items():
        labels = []
        for row in rows:
            if row["offering_pattern"] == "scheduled":
                labels.append(f"{row['academic_year']} {row['term']}")
            elif row["offering_pattern"] == "every_semester":
                labels.append("Every Semester")
            else:
                labels.append(f"As Scheduled ({row['partner_department']})".strip())
        deduped = []
        for label in labels:
            if label not in deduped:
                deduped.append(label)
        ensure(code)["scheduled_terms"] = "; ".join(deduped)

    current = window_starts[-1]
    for item in by_code.values():
        bases = []
        active_years = [year for year in item["bulletin_years"].split("; ") if year]
        if any(parse_year_span(year) and parse_year_span(year)[0] in window_starts for year in active_years):
            bases.append("bulletin")
        scheduled = schedule_by_code.get(item["course_code"], [])
        if any(row["in_recent_window"] and row["offering_pattern"] in {"scheduled", "every_semester"} for row in scheduled):
            bases.append("department_schedule")
        item["offering_basis"] = "+".join(bases)
        item["offered_in_window"] = bool(bases)
        if item["offered_in_window"] and not item["last_seen_year"] and any(
            row["offering_pattern"] != "as_scheduled" for row in scheduled
        ):
            item["last_seen_year"] = year_label(current)

    frame = pd.DataFrame(by_code.values())
    if frame.empty:
        return frame
    return frame.sort_values(["division", "course_number"]).reset_index(drop=True)


_SNOWFLAKE_CHARS = {
    "\u00a0": " ",
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2013": "-",
    "\u2014": "-",
    "\u00bd": " 1/2",
    "\u00ad": "",
}


def snowflake_cell(value) -> str:
    """One CSV field, safe for Snowflake's delimited-file loader.

    Embedded newlines make the loader treat one record as many and then
    ignore the header, so every value is a single line. Booleans are TRUE
    or FALSE, which Snowflake accepts without a file-format override.
    """
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except (TypeError, ValueError):
        pass
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    text = str(value).replace("\x00", "")
    for source, replacement in _SNOWFLAKE_CHARS.items():
        text = text.replace(source, replacement)
    text = text.replace("\r\n", " ").replace("\r", " ").replace("\n", " ")
    text = re.sub(r"[ \t]+", " ", text).strip()
    if text in {"True", "False"}:
        return text.upper()
    if text.lower() in {"nan", "none", "<na>"}:
        return ""
    return text


def write_snowflake_csv(frame: pd.DataFrame, path: Path) -> None:
    """Write a header row and data rows, with no dataframe index column."""
    path.parent.mkdir(parents=True, exist_ok=True)
    columns = [snowflake_cell(column) for column in frame.columns]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(
            handle,
            lineterminator="\n",
            quoting=csv.QUOTE_MINIMAL,
            quotechar='"',
            doublequote=True,
        )
        writer.writerow(columns)
        for record in frame.itertuples(index=False, name=None):
            writer.writerow([snowflake_cell(value) for value in record])


def stamp(frame: pd.DataFrame, scraped_at: str) -> pd.DataFrame:
    if frame.empty:
        frame = frame.copy()
    frame = frame.copy()
    frame["scraped_at"] = scraped_at
    for column in frame.columns:
        if frame[column].dtype == object:
            frame[column] = frame[column].map(lambda value: "" if value is None or (isinstance(value, float) and pd.isna(value)) else value)
    return frame


def write_table(frame: pd.DataFrame, path: Path, description: str, scraped_at: str) -> dict:
    stamped = stamp(frame, scraped_at)
    write_snowflake_csv(stamped, path)
    LOG.info("Wrote %s (%s rows)", path.name, len(stamped))
    return {
        "file_name": path.name,
        "rows": len(stamped),
        "columns": len(stamped.columns),
        "description": description,
    }


def progress_file(cache_dir: Path, name: str) -> Path:
    folder = cache_dir.parent / "progress"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{name}.json"


def read_progress(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write_progress(path: Path, payload) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--years", type=int, default=5, help="Academic years to treat as recently offered. Default: 5.")
    parser.add_argument("--output", type=Path, default=Path("data/csv"), help="Directory for CSV files.")
    parser.add_argument("--cache", type=Path, default=Path("data/cache/pdfs"), help="Directory for downloaded PDFs.")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if args.years < 1:
        parser.error("--years must be at least 1")

    scraper = Scraper(args.years, args.output, args.cache)
    # Page fetches occasionally crash the Windows SSL stack. Progress is saved
    # after each page so a rerun continues instead of starting over.

    program_path = progress_file(args.cache, "programs")
    program_state = read_progress(program_path) or {"programs": [], "sections": [], "mentions": [], "done": []}
    done_programs = set(program_state["done"])
    for discovered in scraper.discover_programs():
        if discovered["url"] in done_programs:
            continue
        record, sections, mentions = scraper.parse_program_page(discovered)
        program_state["programs"].append(record)
        program_state["sections"].extend(sections)
        program_state["mentions"].extend(mentions)
        program_state["done"].append(discovered["url"])
        write_progress(program_path, program_state)
    program_rows = program_state["programs"]
    section_rows = program_state["sections"]
    program_course_rows = program_state["mentions"]

    inventory_path = progress_file(args.cache, "inventory")
    inventory_state = read_progress(inventory_path) or {"rows": []}
    inventory = inventory_state["rows"]
    done_courses = {row["inventory_url"] for row in inventory}
    for url, division in ((UNDERGRAD_COURSES_URL, "Undergraduate"), (GRAD_COURSES_URL, "Graduate")):
        for row in scraper.parse_course_inventory(url, division):
            if row["inventory_url"] in done_courses:
                continue
            inventory.append(scraper.parse_course_detail(row))
            done_courses.add(row["inventory_url"])
            if len(inventory) % 10 == 0:
                write_progress(inventory_path, {"rows": inventory})
                LOG.info("Fetched %s course details", len(inventory))
    write_progress(inventory_path, {"rows": inventory})

    bulletin_path = progress_file(args.cache, "bulletins")
    bulletin_state = read_progress(bulletin_path) or {"meta": [], "courses": [], "done": []}
    done_bulletins = set(bulletin_state["done"])
    for document in scraper.bulletin_documents():
        if document["source_url"] in done_bulletins:
            continue
        meta, courses = scraper.parse_bulletin(document)
        bulletin_state["meta"].append(meta)
        bulletin_state["courses"].extend(courses)
        bulletin_state["done"].append(document["source_url"])
        write_progress(bulletin_path, bulletin_state)
    bulletin_meta = bulletin_state["meta"]
    bulletin_courses = bulletin_state["courses"]

    deduped_bulletin_courses = []
    seen_bulletin_rows: set[tuple[str, str, str, str]] = set()
    for row in sorted(
        bulletin_courses,
        key=lambda item: len(item.get("description") or ""),
        reverse=True,
    ):
        key = (row["academic_year"], row["level"], row["document_type"], row["course_code"])
        if key in seen_bulletin_rows:
            continue
        seen_bulletin_rows.add(key)
        deduped_bulletin_courses.append(row)
    bulletin_courses = deduped_bulletin_courses

    resource_path = progress_file(args.cache, "resources")
    resource_state = read_progress(resource_path)
    if resource_state is None:
        offerings = []
        syllabi = []
        related = []
        for url, level in ((UNDERGRAD_RESOURCES_URL, "Undergraduate"), (GRAD_RESOURCES_URL, "Graduate")):
            page_offerings, page_syllabi, page_documents = scraper.parse_resource_page(url, level)
            offerings.extend(page_offerings)
            syllabi.extend(page_syllabi)
            related.extend(page_documents)
        write_progress(resource_path, {"offerings": offerings, "syllabi": syllabi, "related": related})
    else:
        LOG.info("Using saved department resource pages")
        offerings = resource_state["offerings"]
        syllabi = resource_state["syllabi"]
        related = resource_state["related"]

    syllabus_path = progress_file(args.cache, "syllabi")
    syllabus_state = read_progress(syllabus_path) or {"rows": [], "done": []}
    done_syllabi = set(syllabus_state["done"])
    for item in syllabi:
        if item["source_url"] in done_syllabi:
            continue
        parsed = scraper.read_pdf_document(item)
        for code in item["course_codes"]:
            syllabus_state["rows"].append(
                {
                    "course_code": code,
                    "link_text": item["link_text"],
                    "title": "",
                    "section": item["section"],
                    "level": item["level"],
                    "source_url": item["source_url"],
                    "source_page": item["source_page"],
                    "page_count": parsed["page_count"],
                    "syllabus_text": parsed["text"],
                    "parse_status": parsed["parse_status"],
                }
            )
        syllabus_state["done"].append(item["source_url"])
        write_progress(syllabus_path, syllabus_state)
    syllabus_rows = syllabus_state["rows"]

    document_path = progress_file(args.cache, "documents")
    document_state = read_progress(document_path) or {"rows": [], "done": []}
    done_documents = set(document_state["done"])
    for item in related:
        if item["source_url"] in done_documents:
            continue
        parsed = scraper.read_pdf_document(item)
        document_state["rows"].append(
            {
                "link_text": item["link_text"],
                "section": item["section"],
                "level": item["level"],
                "source_url": item["source_url"],
                "source_page": item["source_page"],
                "page_count": parsed["page_count"],
                "document_text": parsed["text"],
                "parse_status": parsed["parse_status"],
            }
        )
        document_state["done"].append(item["source_url"])
        write_progress(document_path, document_state)
    document_rows = document_state["rows"]

    degree_path = progress_file(args.cache, "degree_maps")
    degree_state = read_progress(degree_path) or {"rows": [], "done": []}
    done_maps = set(degree_state["done"])
    for item in scraper.degree_map_index([row["title"] for row in program_rows]):
        map_key = f"{item['degree_map_id']}"
        if map_key in done_maps:
            continue
        degree_state["rows"].extend(scraper.parse_degree_map(item))
        degree_state["done"].append(map_key)
        write_progress(degree_path, degree_state)
    degree_rows = degree_state["rows"]

    courses = build_courses(inventory, bulletin_courses, offerings, scraper.window_starts)
    offered = courses[courses["offered_in_window"]].copy() if not courses.empty else courses.copy()
    requisites = build_requisites(courses, {row["program_id"] for row in program_rows})

    output = args.output
    manifest = [
        write_table(
            pd.DataFrame(program_rows),
            output / "programs.csv",
            "CIS undergraduate, graduate, and minor programs from the program finder.",
            scraper.scraped_at,
        ),
        write_table(
            pd.DataFrame(section_rows),
            output / "program_sections.csv",
            "Requirement and overview sections parsed from each program page.",
            scraper.scraped_at,
        ),
        write_table(
            pd.DataFrame(program_course_rows),
            output / "program_courses.csv",
            "CISC course codes mentioned in each program's requirements.",
            scraper.scraped_at,
        ),
        write_table(
            courses,
            output / "courses.csv",
            "All CISC courses found in the inventory, bulletins, or department schedule.",
            scraper.scraped_at,
        ),
        write_table(
            requisites,
            output / "course_requisites.csv",
            "Catalog prerequisites plus other-department major requirements, including the MATH 1006 placement sequence.",
            scraper.scraped_at,
        ),
        write_table(
            offered,
            output / "courses_offered_recent.csv",
            "Courses offered in the recent academic-year window. Subset of courses.csv.",
            scraper.scraped_at,
        ),
        write_table(
            pd.DataFrame(bulletin_meta),
            output / "bulletins.csv",
            "Undergraduate and graduate bulletin PDFs parsed for the recent window.",
            scraper.scraped_at,
        ),
        write_table(
            pd.DataFrame(bulletin_courses),
            output / "bulletin_courses.csv",
            "Course entries extracted from each bulletin PDF, including inactive listings.",
            scraper.scraped_at,
        ),
        write_table(
            pd.DataFrame(offerings),
            output / "course_offerings.csv",
            "Department schedule rows from the undergraduate and graduate CIS pages.",
            scraper.scraped_at,
        ),
        write_table(
            pd.DataFrame(syllabus_rows),
            output / "syllabi.csv",
            "Syllabus PDFs linked from the CIS undergraduate and graduate resource pages.",
            scraper.scraped_at,
        ),
        write_table(
            pd.DataFrame(document_rows),
            output / "related_documents.csv",
            "Other PDFs linked from those pages, such as prerequisite diagrams and checklists.",
            scraper.scraped_at,
        ),
        write_table(
            pd.DataFrame(degree_rows),
            output / "degree_map_courses.csv",
            "Courses on four-year degree maps for the CIS programs, by bulletin year.",
            scraper.scraped_at,
        ),
    ]
    manifest_frame = pd.DataFrame(manifest)
    manifest_frame.to_csv(output / "manifest.csv", index=False, encoding="utf-8")
    LOG.info("Finished. CSVs are in %s", output.resolve())


def extract_pdf_to_json(pdf_path: str, json_path: str) -> None:
    reader = PdfReader(pdf_path)
    pages: list[str] = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            pages.append("")
    Path(json_path).write_text(json.dumps(pages), encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "--extract-pdf":
        extract_pdf_to_json(sys.argv[2], sys.argv[3])
    else:
        main()
