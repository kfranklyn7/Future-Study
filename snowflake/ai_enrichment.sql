-- Future-Study AI enrichment. Run after snowflake/load_csvs.py.
-- Precomputes per-course and per-program career paths + free resources with Cortex AI_COMPLETE,
-- and builds a Cortex Search service for interest-based course search.
-- Re-runnable: every statement is CREATE OR REPLACE.
USE SCHEMA CISC.CORE;

-- 1. One row per course with all the text we know about it (syllabi concatenated, truncated).
CREATE OR REPLACE VIEW COURSE_CONTEXT AS
SELECT c.COURSE_CODE, c.TITLE, c.DIVISION, c.CREDITS, c.DESCRIPTION, c.PREREQUISITES,
       c.OFFERED_IN_WINDOW,
       LEFT(COALESCE(s.SYLLABUS_TEXT, ''), 12000) AS SYLLABUS_TEXT,
       IFF(s.COURSE_CODE IS NULL, FALSE, TRUE) AS HAS_SYLLABUS
FROM COURSES c
LEFT JOIN (SELECT COURSE_CODE, LISTAGG(SYLLABUS_TEXT, '\n---\n') AS SYLLABUS_TEXT
           FROM SYLLABI WHERE SYLLABUS_TEXT <> '' GROUP BY COURSE_CODE) s
  ON s.COURSE_CODE = c.COURSE_CODE;

-- 2. Per-course enrichment: topics, skills, career paths, free resources.
CREATE OR REPLACE TABLE COURSE_AI AS
SELECT COURSE_CODE, TRY_PARSE_JSON(RAW) AS AI, CURRENT_TIMESTAMP() AS GENERATED_AT
FROM (
  SELECT COURSE_CODE,
    AI_COMPLETE(
      model => 'claude-sonnet-4-5',
      prompt => 'You are an academic and career advisor for Brooklyn College Computer and Information Science students. '
        || 'Using ONLY the course information below (and general knowledge of the field), return JSON describing the course.\n'
        || '- topics: 4-10 short topic keywords actually covered.\n'
        || '- skills: 4-10 concrete skills a student gains.\n'
        || '- career_paths: 3-5 careers this course prepares for. For each: title, why (1-2 sentences tied to specific syllabus/course content), '
        || 'relevance (high|medium|low), and next_steps (1-3 short suggestions).\n'
        || '- resources: 3-6 FREE online resources for this course''s material. Only use well-known free providers '
        || '(MIT OpenCourseWare, Khan Academy, freeCodeCamp, Harvard CS50, The Odin Project, official language/tool documentation, '
        || 'Open Textbook Library, OpenStax, YouTube channels of universities). Prefer stable top-level course or docs URLs; never invent deep links. '
        || 'For each: title, url, provider, type (course|textbook|video|docs|practice).\n\n'
        || 'Course: ' || COURSE_CODE || ' - ' || TITLE || ' (' || DIVISION || ', ' || CREDITS || ' credits)\n'
        || 'Description: ' || DESCRIPTION || '\n'
        || 'Prerequisites: ' || PREREQUISITES || '\n'
        || 'Syllabus: ' || IFF(HAS_SYLLABUS, SYLLABUS_TEXT, '(none available)'),
      model_parameters => {'temperature': 0.2, 'max_tokens': 4096},
      response_format => {'type': 'json', 'schema': {
        'type': 'object',
        'properties': {
          'topics': {'type': 'array', 'items': {'type': 'string'}},
          'skills': {'type': 'array', 'items': {'type': 'string'}},
          'career_paths': {'type': 'array', 'items': {'type': 'object', 'properties': {
              'title': {'type': 'string'}, 'why': {'type': 'string'},
              'relevance': {'type': 'string', 'enum': ['high', 'medium', 'low']},
              'next_steps': {'type': 'array', 'items': {'type': 'string'}}},
            'required': ['title', 'why', 'relevance', 'next_steps']}},
          'resources': {'type': 'array', 'items': {'type': 'object', 'properties': {
              'title': {'type': 'string'}, 'url': {'type': 'string'}, 'provider': {'type': 'string'},
              'type': {'type': 'string', 'enum': ['course', 'textbook', 'video', 'docs', 'practice']}},
            'required': ['title', 'url', 'provider', 'type']}}},
        'required': ['topics', 'skills', 'career_paths', 'resources']}}
    )::STRING AS RAW
  FROM COURSE_CONTEXT
);

-- 3. Per-program career paths and resources.
CREATE OR REPLACE TABLE PROGRAM_AI AS
SELECT PROGRAM_ID, TRY_PARSE_JSON(RAW) AS AI, CURRENT_TIMESTAMP() AS GENERATED_AT
FROM (
  SELECT p.PROGRAM_ID,
    AI_COMPLETE(
      model => 'claude-sonnet-4-5',
      prompt => 'You are a career advisor for Brooklyn College. Given this program and its courses, return JSON with '
        || 'career_paths (4-6; title, why tied to the program''s courses, typical_courses: course codes from the list, next_steps) '
        || 'and resources (4-8 FREE general resources for this field/career path from well-known free providers only, stable top-level URLs; '
        || 'title, url, provider, type course|textbook|video|docs|practice|career).\n\n'
        || 'Program: ' || p.TITLE || ' (' || p.DEGREE_LEVELS || ')\nOverview: ' || LEFT(p.OVERVIEW, 3000)
        || '\nCourses: ' || COALESCE(pc.COURSES, '(none listed)'),
      model_parameters => {'temperature': 0.2, 'max_tokens': 4096},
      response_format => {'type': 'json', 'schema': {
        'type': 'object',
        'properties': {
          'career_paths': {'type': 'array', 'items': {'type': 'object', 'properties': {
              'title': {'type': 'string'}, 'why': {'type': 'string'},
              'typical_courses': {'type': 'array', 'items': {'type': 'string'}},
              'next_steps': {'type': 'array', 'items': {'type': 'string'}}},
            'required': ['title', 'why', 'typical_courses', 'next_steps']}},
          'resources': {'type': 'array', 'items': {'type': 'object', 'properties': {
              'title': {'type': 'string'}, 'url': {'type': 'string'}, 'provider': {'type': 'string'},
              'type': {'type': 'string'}},
            'required': ['title', 'url', 'provider', 'type']}}},
        'required': ['career_paths', 'resources']}}
    )::STRING AS RAW
  FROM PROGRAMS p
  LEFT JOIN (SELECT pc.PROGRAM_ID, LISTAGG(DISTINCT pc.COURSE_CODE || ' ' || COALESCE(c.TITLE, ''), '; ') AS COURSES
             FROM PROGRAM_COURSES pc LEFT JOIN COURSES c ON c.COURSE_CODE = pc.COURSE_CODE
             GROUP BY pc.PROGRAM_ID) pc ON pc.PROGRAM_ID = p.PROGRAM_ID
);

-- 4. Flattened tables the API reads.
CREATE OR REPLACE TABLE COURSE_CAREERS AS
SELECT COURSE_CODE, f.INDEX AS RANK, f.VALUE:title::STRING AS TITLE, f.VALUE:why::STRING AS WHY,
       f.VALUE:relevance::STRING AS RELEVANCE, f.VALUE:next_steps AS NEXT_STEPS
FROM COURSE_AI, LATERAL FLATTEN(AI:career_paths) f;

CREATE OR REPLACE TABLE RESOURCES AS
SELECT 'course' AS SCOPE, COURSE_CODE AS SCOPE_ID, f.VALUE:title::STRING AS TITLE, f.VALUE:url::STRING AS URL,
       f.VALUE:provider::STRING AS PROVIDER, f.VALUE:type::STRING AS TYPE, NULL::BOOLEAN AS URL_OK
FROM COURSE_AI, LATERAL FLATTEN(AI:resources) f
UNION ALL
SELECT 'program', PROGRAM_ID, f.VALUE:title::STRING, f.VALUE:url::STRING, f.VALUE:provider::STRING,
       f.VALUE:type::STRING, NULL
FROM PROGRAM_AI, LATERAL FLATTEN(AI:resources) f;
-- URL_OK is filled by snowflake/check_urls.py; the API hides rows where URL_OK = FALSE.

-- 4b. Collapse near-duplicate career titles ("Software Developer", "Software Engineer") into
-- ~30-50 canonical career paths with one Cortex call, so careers group cleanly across courses.
CREATE OR REPLACE TABLE CAREER_CANON AS
WITH titles AS (SELECT LISTAGG(DISTINCT TITLE, '\n') AS T FROM COURSE_CAREERS),
res AS (
  SELECT TRY_PARSE_JSON(AI_COMPLETE(
    model => 'claude-sonnet-4-5',
    prompt => 'Group these job titles into 30-50 canonical career paths. Merge synonyms and seniority variants '
      || '(e.g. "Software Developer" and "Backend Software Engineer" -> "Software Engineer"). '
      || 'Return every input title exactly once in mappings, with its canonical name.\n\n' || T,
    model_parameters => {'temperature': 0, 'max_tokens': 32000},
    response_format => {'type': 'json', 'schema': {'type': 'object', 'properties': {
      'mappings': {'type': 'array', 'items': {'type': 'object', 'properties': {
        'title': {'type': 'string'}, 'canonical': {'type': 'string'}}, 'required': ['title', 'canonical']}}},
      'required': ['mappings']}})::STRING) AS J
  FROM titles
)
SELECT DISTINCT f.VALUE:title::STRING AS TITLE, f.VALUE:canonical::STRING AS CANONICAL
FROM res, LATERAL FLATTEN(J:mappings) f;

CREATE OR REPLACE TABLE COURSE_CAREERS AS
SELECT k.COURSE_CODE, k.RANK, k.TITLE, COALESCE(m.CANONICAL, k.TITLE) AS CAREER, k.WHY, k.RELEVANCE, k.NEXT_STEPS
FROM COURSE_CAREERS k
LEFT JOIN (SELECT TITLE, ANY_VALUE(CANONICAL) AS CANONICAL FROM CAREER_CANON GROUP BY TITLE) m
  ON LOWER(m.TITLE) = LOWER(k.TITLE);

-- 5. Interest-based search over course text + AI topics/skills/careers.
-- A table, not a view: Cortex Search change tracking rejects views with subqueries.
DROP VIEW IF EXISTS COURSE_SEARCH_DOCS;
CREATE OR REPLACE TABLE COURSE_SEARCH_DOCS CHANGE_TRACKING = TRUE AS
SELECT cc.COURSE_CODE, cc.TITLE, cc.DIVISION,
       cc.TITLE || '. ' || cc.DESCRIPTION
         || ' Topics: ' || COALESCE(ARRAY_TO_STRING(a.AI:topics, ', '), '')
         || '. Skills: ' || COALESCE(ARRAY_TO_STRING(a.AI:skills, ', '), '')
         || '. Careers: ' || COALESCE(k.CAREERS, '')
         || '. ' || LEFT(cc.SYLLABUS_TEXT, 4000) AS SEARCH_TEXT
FROM COURSE_CONTEXT cc
LEFT JOIN COURSE_AI a ON a.COURSE_CODE = cc.COURSE_CODE
LEFT JOIN (SELECT COURSE_CODE, LISTAGG(TITLE, ', ') AS CAREERS FROM COURSE_CAREERS GROUP BY COURSE_CODE) k
  ON k.COURSE_CODE = cc.COURSE_CODE;

CREATE OR REPLACE CORTEX SEARCH SERVICE COURSE_SEARCH
  ON SEARCH_TEXT
  ATTRIBUTES DIVISION
  WAREHOUSE = COMPUTE_WH
  TARGET_LAG = '1 day'
AS SELECT COURSE_CODE, TITLE, DIVISION, SEARCH_TEXT FROM COURSE_SEARCH_DOCS;

-- 6. Let teammates using SYSADMIN read everything (objects here are created as ACCOUNTADMIN).
GRANT USAGE ON DATABASE CISC TO ROLE SYSADMIN;
GRANT USAGE ON SCHEMA CISC.CORE TO ROLE SYSADMIN;
GRANT SELECT ON ALL TABLES IN SCHEMA CISC.CORE TO ROLE SYSADMIN;
GRANT SELECT ON ALL VIEWS IN SCHEMA CISC.CORE TO ROLE SYSADMIN;
GRANT USAGE ON CORTEX SEARCH SERVICE CISC.CORE.COURSE_SEARCH TO ROLE SYSADMIN;
