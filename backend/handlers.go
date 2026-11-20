package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type api struct {
	db    *sql.DB
	model string
}

type row = map[string]any

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	log.Printf("error: %v", err)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

// query runs SQL and returns rows keyed by lowercase column name. VARIANT/ARRAY/OBJECT
// columns are decoded as JSON so they reach the client as structures, not strings.
func (a *api) query(ctx context.Context, q string, args ...any) ([]row, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	rs, err := a.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	types, _ := rs.ColumnTypes()
	out := []row{}
	for rs.Next() {
		vals := make([]sql.NullString, len(types))
		ptrs := make([]any, len(types))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rs.Scan(ptrs...); err != nil {
			return nil, err
		}
		r := row{}
		for i, t := range types {
			name := strings.ToLower(t.Name())
			if !vals[i].Valid {
				r[name] = nil
				continue
			}
			switch t.DatabaseTypeName() {
			case "VARIANT", "ARRAY", "OBJECT":
				r[name] = json.RawMessage(vals[i].String)
			case "BOOLEAN":
				r[name] = vals[i].String == "true" || vals[i].String == "1"
			case "FIXED", "REAL":
				if f, err := strconv.ParseFloat(vals[i].String, 64); err == nil {
					r[name] = f
				} else {
					r[name] = vals[i].String
				}
			default:
				r[name] = vals[i].String
			}
		}
		out = append(out, r)
	}
	return out, rs.Err()
}

func (a *api) respond(w http.ResponseWriter, r *http.Request, q string, args ...any) {
	rows, err := a.query(r.Context(), q, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, rows)
}

// GET /api/courses?division=Undergraduate&recent=true
func (a *api) listCourses(w http.ResponseWriter, r *http.Request) {
	a.respond(w, r, `
		SELECT c.COURSE_CODE, c.TITLE, c.DIVISION, c.CREDITS, c.OFFERED_IN_WINDOW = 'TRUE' AS RECENT,
		       ai.AI:topics AS TOPICS
		FROM COURSES c LEFT JOIN COURSE_AI ai ON ai.COURSE_CODE = c.COURSE_CODE
		WHERE (? = '' OR c.DIVISION = ?) AND (? <> 'true' OR c.OFFERED_IN_WINDOW = 'TRUE')
		ORDER BY c.COURSE_CODE`,
		r.URL.Query().Get("division"), r.URL.Query().Get("division"), r.URL.Query().Get("recent"))
}

// GET /api/courses/{code}: details, AI topics/skills, career paths, resources, prereqs, programs.
func (a *api) getCourse(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	ctx := r.Context()
	course, err := a.query(ctx, `
		SELECT c.COURSE_CODE, c.TITLE, c.DIVISION, c.CREDITS, c.HOURS, c.DESCRIPTION, c.PREREQUISITES,
		       c.OFFERED_IN_WINDOW = 'TRUE' AS RECENT, c.SCHEDULED_TERMS, c.INVENTORY_URL,
		       ai.AI:topics AS TOPICS, ai.AI:skills AS SKILLS,
		       (SELECT ARRAY_AGG(DISTINCT SOURCE_URL) FROM SYLLABI s WHERE s.COURSE_CODE = c.COURSE_CODE) AS SYLLABUS_URLS
		FROM COURSES c LEFT JOIN COURSE_AI ai ON ai.COURSE_CODE = c.COURSE_CODE
		WHERE c.COURSE_CODE = ?`, code)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	if len(course) == 0 {
		writeErr(w, http.StatusNotFound, fmt.Errorf("course %q not found", code))
		return
	}
	out := course[0]
	parts := map[string]string{
		"careers": `SELECT TITLE, CAREER, WHY, RELEVANCE, NEXT_STEPS FROM COURSE_CAREERS WHERE COURSE_CODE = ? ORDER BY RANK`,
		"resources": `SELECT TITLE, URL, PROVIDER, TYPE, URL_OK FROM RESOURCES
		              WHERE SCOPE = 'course' AND SCOPE_ID = ? AND COALESCE(URL_OK, TRUE) ORDER BY TYPE, TITLE`,
		"prerequisites_of": `SELECT DISTINCT q.REQUIRES_CODE AS COURSE_CODE, c.TITLE, q.RELATIONSHIP
		              FROM COURSE_REQUISITES q LEFT JOIN COURSES c ON c.COURSE_CODE = q.REQUIRES_CODE
		              WHERE q.COURSE_CODE = ? AND q.PROGRAM_ID = '' ORDER BY 1`,
		"unlocks": `SELECT DISTINCT q.COURSE_CODE, c.TITLE, q.RELATIONSHIP
		              FROM COURSE_REQUISITES q LEFT JOIN COURSES c ON c.COURSE_CODE = q.COURSE_CODE
		              WHERE q.REQUIRES_CODE = ? AND q.PROGRAM_ID = '' ORDER BY 1`,
		"programs": `SELECT DISTINCT p.PROGRAM_ID, p.TITLE FROM PROGRAM_COURSES pc
		              JOIN PROGRAMS p ON p.PROGRAM_ID = pc.PROGRAM_ID WHERE pc.COURSE_CODE = ? ORDER BY 2`,
	}
	for key, q := range parts {
		rows, err := a.query(ctx, q, code)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		out[key] = rows
	}
	writeJSON(w, out)
}

// GET /api/programs
func (a *api) listPrograms(w http.ResponseWriter, r *http.Request) {
	a.respond(w, r, `
		SELECT p.PROGRAM_ID, p.TITLE, p.DEGREE_LEVELS, p.CREDITS,
		       (SELECT COUNT(DISTINCT COURSE_CODE) FROM PROGRAM_COURSES pc WHERE pc.PROGRAM_ID = p.PROGRAM_ID) AS COURSE_COUNT
		FROM PROGRAMS p ORDER BY p.TITLE`)
}

// GET /api/programs/{id}: overview, courses, AI career paths and general resources.
func (a *api) getProgram(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ctx := r.Context()
	prog, err := a.query(ctx, `
		SELECT p.PROGRAM_ID, p.TITLE, p.URL, p.DEGREE_LEVELS, p.DEPARTMENTS, p.CREDITS, p.OVERVIEW,
		       ai.AI:career_paths AS CAREERS
		FROM PROGRAMS p LEFT JOIN PROGRAM_AI ai ON ai.PROGRAM_ID = p.PROGRAM_ID WHERE p.PROGRAM_ID = ?`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	if len(prog) == 0 {
		writeErr(w, http.StatusNotFound, fmt.Errorf("program %q not found", id))
		return
	}
	out := prog[0]
	parts := map[string]string{
		"courses": `SELECT DISTINCT pc.COURSE_CODE, c.TITLE, c.DIVISION FROM PROGRAM_COURSES pc
		            LEFT JOIN COURSES c ON c.COURSE_CODE = pc.COURSE_CODE WHERE pc.PROGRAM_ID = ? ORDER BY 1`,
		"resources": `SELECT TITLE, URL, PROVIDER, TYPE FROM RESOURCES
		            WHERE SCOPE = 'program' AND SCOPE_ID = ? AND COALESCE(URL_OK, TRUE) ORDER BY TYPE, TITLE`,
		"sections": `SELECT SECTION_TITLE, SECTION_TEXT FROM PROGRAM_SECTIONS WHERE PROGRAM_ID = ?
		            ORDER BY TRY_TO_NUMBER(SORT_ORDER)`,
	}
	for key, q := range parts {
		rows, err := a.query(ctx, q, id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		out[key] = rows
	}
	writeJSON(w, out)
}

// GET /api/graph?program=<id>: prerequisite graph. With a program, nodes are that program's
// courses plus their direct prerequisites; without one, the whole CISC catalog.
func (a *api) graph(w http.ResponseWriter, r *http.Request) {
	program := r.URL.Query().Get("program")
	ctx := r.Context()
	edges, err := a.query(ctx, `
		WITH scope AS (
		  SELECT COURSE_CODE FROM PROGRAM_COURSES WHERE PROGRAM_ID = ?
		  UNION SELECT COURSE_CODE FROM COURSES WHERE ? = ''
		)
		SELECT DISTINCT q.REQUIRES_CODE AS SOURCE, q.COURSE_CODE AS TARGET, q.RELATIONSHIP
		FROM COURSE_REQUISITES q
		WHERE q.PROGRAM_ID = '' AND q.COURSE_CODE IN (SELECT COURSE_CODE FROM scope)
		  AND q.REQUIRES_CODE <> q.COURSE_CODE`, program, program)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	nodes, err := a.query(ctx, `
		WITH scope AS (
		  SELECT COURSE_CODE FROM PROGRAM_COURSES WHERE PROGRAM_ID = ?
		  UNION SELECT COURSE_CODE FROM COURSES WHERE ? = ''
		),
		ids AS (
		  SELECT COURSE_CODE AS ID, TRUE AS IN_SCOPE FROM scope
		  UNION
		  SELECT REQUIRES_CODE, FALSE FROM COURSE_REQUISITES
		  WHERE PROGRAM_ID = '' AND COURSE_CODE IN (SELECT COURSE_CODE FROM scope)
		)
		SELECT i.ID, MAX(c.TITLE) AS TITLE, MAX(c.DIVISION) AS DIVISION, BOOLOR_AGG(i.IN_SCOPE) AS IN_SCOPE,
		       BOOLOR_AGG(c.COURSE_CODE IS NOT NULL) AS IN_CATALOG
		FROM ids i LEFT JOIN COURSES c ON c.COURSE_CODE = i.ID
		GROUP BY i.ID ORDER BY i.ID`, program, program)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"nodes": nodes, "edges": edges})
}

// GET /api/careers: every AI career path with the courses that lead to it.
// GET /api/careers?title=Data%20Engineer: courses for one career (case-insensitive match).
func (a *api) careers(w http.ResponseWriter, r *http.Request) {
	a.respond(w, r, `
		SELECT k.CAREER AS TITLE, COUNT(DISTINCT k.COURSE_CODE) AS COURSE_COUNT,
		       ARRAY_AGG(DISTINCT OBJECT_CONSTRUCT('course_code', k.COURSE_CODE, 'title', c.TITLE,
		                 'role', k.TITLE, 'relevance', k.RELEVANCE, 'why', k.WHY)) AS COURSES
		FROM COURSE_CAREERS k JOIN COURSES c ON c.COURSE_CODE = k.COURSE_CODE
		WHERE ? = '' OR LOWER(k.CAREER) = LOWER(?)
		GROUP BY 1 ORDER BY COURSE_COUNT DESC, TITLE`,
		r.URL.Query().Get("title"), r.URL.Query().Get("title"))
}

func (a *api) cortexSearch(ctx context.Context, q, division string, limit int) ([]row, error) {
	req := map[string]any{"query": q, "columns": []string{"COURSE_CODE", "TITLE", "DIVISION"}, "limit": limit}
	if division != "" {
		req["filter"] = map[string]any{"@eq": map[string]string{"DIVISION": division}}
	}
	body, _ := json.Marshal(req)
	rows, err := a.query(ctx, `SELECT PARSE_JSON(SNOWFLAKE.CORTEX.SEARCH_PREVIEW('CISC.CORE.COURSE_SEARCH', ?)):results AS R`, string(body))
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	var results []row
	raw, _ := rows[0]["r"].(json.RawMessage)
	if err := json.Unmarshal(raw, &results); err != nil {
		return nil, err
	}
	for _, res := range results { // normalize keys to lowercase like the rest of the API
		for k, v := range res {
			delete(res, k)
			res[strings.ToLower(k)] = v
		}
	}
	return results, nil
}

// GET /api/search?q=machine+learning&division=Undergraduate
func (a *api) search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("q is required"))
		return
	}
	res, err := a.cortexSearch(r.Context(), q, r.URL.Query().Get("division"), 12)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, res)
}

// POST /api/recommend {"interests": "...", "division": "Undergraduate"}
// Retrieves candidates with Cortex Search, then asks AI_COMPLETE to rank and explain them.
func (a *api) recommend(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Interests string `json:"interests"`
		Division  string `json:"division"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil || strings.TrimSpace(in.Interests) == "" {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("interests is required"))
		return
	}
	ctx := r.Context()
	cands, err := a.cortexSearch(ctx, in.Interests, in.Division, 10)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	if len(cands) == 0 {
		writeJSON(w, map[string]any{"recommendations": []any{}})
		return
	}
	var list strings.Builder
	for _, c := range cands {
		fmt.Fprintf(&list, "- %v: %v\n", c["course_code"], c["title"])
	}
	prompt := "A Brooklyn College student describes their interests as: \"" + in.Interests + "\".\n" +
		"Candidate courses:\n" + list.String() +
		"Pick the 3-6 best matches from the candidates only, best first. For each give course_code exactly as listed " +
		"(code only, e.g. CISC 3130) and a one-sentence reason tied to the student's interests."
	rows, err := a.query(ctx, `
		SELECT TRY_PARSE_JSON(AI_COMPLETE(model => ?, prompt => ?,
		  model_parameters => {'temperature': 0.2, 'max_tokens': 1500},
		  response_format => {'type': 'json', 'schema': {'type': 'object', 'properties': {
		    'recommendations': {'type': 'array', 'items': {'type': 'object', 'properties': {
		      'course_code': {'type': 'string'}, 'reason': {'type': 'string'}},
		      'required': ['course_code', 'reason']}}}, 'required': ['recommendations']}})::STRING) AS R`,
		a.model, prompt)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	var parsed struct {
		Recommendations []row `json:"recommendations"`
	}
	if raw, ok := rows[0]["r"].(json.RawMessage); ok {
		_ = json.Unmarshal(raw, &parsed)
	}
	titles := map[string]any{}
	for _, c := range cands {
		titles[fmt.Sprint(c["course_code"])] = c["title"]
	}
	recs := []row{}
	for _, rec := range parsed.Recommendations {
		// The model sometimes echoes "CODE: Title"; keep only the code, and drop invented codes.
		code := strings.TrimSpace(strings.SplitN(fmt.Sprint(rec["course_code"]), ":", 2)[0])
		if t, ok := titles[code]; ok {
			rec["course_code"], rec["title"] = code, t
			recs = append(recs, rec)
		}
	}
	writeJSON(w, map[string]any{"recommendations": recs, "candidates": cands})
}
