# Future-Study
Mapping college courses to resources and career paths.

Brooklyn College CISC courses → interest-based recommendations, prerequisite/program graphs,
AI-generated career paths, and free learning resources. Data and AI run on Snowflake
(tables, Cortex `AI_COMPLETE`, Cortex Search); Go API; React frontend.

```
scrape_brooklyn_cis.py   → data/csv/*.csv
snowflake/load_csvs.py   → CISC.CORE.* tables
snowflake/ai_enrichment.sql → COURSE_AI, PROGRAM_AI, COURSE_CAREERS, CAREER_CANON, RESOURCES, COURSE_SEARCH (Cortex Search)
snowflake/check_urls.py  → marks broken resource links (RESOURCES.URL_OK)
backend/  (Go)           → /api/*, also serves frontend/dist
frontend/ (React + TanStack Router + Vite) → Discover, Courses, Programs, Course map, Careers
```

## Setup

Set Snowflake credentials in your shell (never commit them):

```bash
export SNOWFLAKE_ACCOUNT=... SNOWFLAKE_USER=... SNOWFLAKE_PASSWORD=... SNOWFLAKE_WAREHOUSE=COMPUTE_WH SNOWFLAKE_ROLE=SYSADMIN
```

Or copy `backend/.env.example` to `backend/.env` (gitignored), fill it in, and load it with
the one-liner at the top of that file.

1. Data (only needed when the CSVs change):
   ```bash
   pip install -r requirements.txt snowflake-connector-python[pandas]
   python snowflake/load_csvs.py
   python snowflake/run_sql.py snowflake/ai_enrichment.sql   # ~2 min of Cortex calls
   python snowflake/check_urls.py                            # needs normal internet access
   ```
2. App:
   ```bash
   cd frontend && npm install && npm run build && cd ..
   cd backend && go run .            # http://localhost:8000
   ```
   For frontend development, run the API on 8001 (`PORT=8001 go run .`) and `npm run dev` in `frontend/` (http://localhost:3000); Vite proxies `/api` to the API.

## API

| Endpoint | Returns |
|---|---|
| `GET /api/courses?division=&recent=true` | Course list with AI topics |
| `GET /api/courses/{code}` | Details, career paths, free resources, skills, prereqs, unlocks, programs |
| `GET /api/programs`, `/api/programs/{id}` | Programs with career paths and general resources |
| `GET /api/graph?program={id}` | Prerequisite graph nodes/edges (omit `program` for the whole catalog) |
| `GET /api/careers?title=` | Canonical career paths and the courses that lead to them |
| `GET /api/search?q=&division=` | Cortex Search over course text, syllabi, topics, careers |
| `POST /api/recommend {"interests", "division"}` | Search + `AI_COMPLETE` ranking with reasons |

Set `CORTEX_MODEL` to change the live recommendation model (default `claude-sonnet-4-5`).
