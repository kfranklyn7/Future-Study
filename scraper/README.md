# Course catalog scraper

Scrapes every undergraduate **CISC** course from Brooklyn College's official course
inventory and writes two CSV files to [`../data/`](../data/).

- **Source list:** https://websql.brooklyn.cuny.edu/courses/acad/courses_list.jsp?div=U&disc=CISC.
- **One page per course:** `https://websql.brooklyn.cuny.edu/courses/ShowCourse.do?dsc=CISC.&crs_num=<number>&div=U`

## Run it

```bash
pip install -r scraper/requirements.txt
python scraper/scrape_courses.py            # reuses cached HTML in scraper/cache/
python scraper/scrape_courses.py --refresh  # re-downloads every page (~82 requests, ~2 min)
```

The scraper waits 1 second between requests and caches each page in `scraper/cache/`
(git-ignored), so you can change the parser and re-run it without hitting the site again.
It exits with code 1 if any course page fails to download or parse.

## Output

### `data/courses.csv` (one row per course)

| column | example | notes |
|---|---|---|
| `course_id` | `CISC3130` | primary key |
| `dept` | `CISC` | |
| `number` | `3130` | may carry a suffix, e.g. `2820W` (writing-intensive) |
| `title` | `Data Structures` | |
| `level` | `3000` | first digit of the number |
| `counts_toward_advanced` | `True` | `False` for courses starred `*` in the catalog (they don't count toward the major's 24 advanced credits) |
| `hours` | `4 hours; 4 credits` | the catalog's original wording |
| `credits` | `4` | numeric; `4.5` for "4 1/2 credits" |
| `description` | `Container classes: ...` | catalog description |
| `prerequisite_text` | `Computer and Information Science 3115; or 3110 and either 1115 or 1170` | original wording |
| `corequisite_text` | | |
| `pre_or_corequisite_text` | | |
| `restrictions` | `Not open to students who ...` | split out of the description |
| `notes` | | catalog notices, e.g. "This information is in effect as of academic year 2027" |
| `url` | | the official course page |

### `data/course_prereqs.csv` (one row per course referenced in a requirement)

| column | example | notes |
|---|---|---|
| `course_id` | `CISC3130` | the course that has the requirement |
| `requires_course_id` | `CISC3115` | the course it mentions |
| `requires_dept` / `requires_number` | `CISC` / `3115` | |
| `relationship` | `prerequisite` | or `corequisite` / `pre_or_corequisite` |
| `in_catalog` | `True` | `False` for non-CISC courses (MATH, CORC, ENGL...) and retired CISC numbers |

Use this table for the prerequisite graph. It records **every course mentioned**,
not the and/or logic: "3115; or 3110 and either 1115 or 1170" becomes four rows.
Show `prerequisite_text` from `courses.csv` when you need the exact rule.

## How prerequisites are parsed

- Bare numbers take the most recent department named before them:
  "Computer and Information Science 3130; and Mathematics 2501" gives `CISC3130` and `MATH2501`.
  With no department named, CISC is assumed.
- Old-style course numbers in brackets (`[22]`, `[1.5]`) and decimal numbers (`1.10`) are ignored.
- Text like "permission of the chairperson" or "sophomore status" stays in `prerequisite_text` only.

## Known gaps

- **CISC 2810W** (Macromolecular Structure and Bioinformatics): the course is in the official
  list, but its course page comes back empty. Its row has only the title from the list, with a note.
- **CISC 1410:** the catalog marks this page "in effect as of academic year 2027" (see `notes`).
- The catalog is the source of truth, so anything it gets wrong is in the CSVs too.
  Re-run with `--refresh` before a demo if the data may have changed.

## Loading into Snowflake

```sql
CREATE OR REPLACE TABLE COURSES (
  course_id STRING PRIMARY KEY, dept STRING, number STRING, title STRING, level INT,
  counts_toward_advanced BOOLEAN, hours STRING, credits FLOAT, description STRING,
  prerequisite_text STRING, corequisite_text STRING, pre_or_corequisite_text STRING,
  restrictions STRING, notes STRING, url STRING
);

CREATE OR REPLACE TABLE COURSE_PREREQS (
  course_id STRING, requires_course_id STRING, requires_dept STRING,
  requires_number STRING, relationship STRING, in_catalog BOOLEAN
);
```

Then load each CSV with Snowsight's **Load Data** wizard, or `PUT` the files to a stage and
`COPY INTO` with `FILE_FORMAT = (TYPE = CSV SKIP_HEADER = 1 FIELD_OPTIONALLY_ENCLOSED_BY = '"')`.
