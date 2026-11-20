-- Names for courses that appear in prerequisite rules but have no course page: core
-- curriculum (CORC) courses, which the course inventory doesn't list, and graduate codes the
-- rules still cite. The API shows these names on the prerequisite graph and course pages
-- without linking them. Codes no bulletin names (CORC 1312, CISC 6004X) are left out.
--   python snowflake/run_sql.py snowflake/course_names.sql

USE SCHEMA CISC.CORE;

CREATE OR REPLACE TABLE COURSE_NAMES (COURSE_CODE STRING, TITLE STRING, NOTE STRING, SOURCE STRING) AS
SELECT column1, column2, column3, column4 FROM VALUES
  ('CORC 1130', 'Music: Its Language, History, and Culture', 'Same as MUSC 1300', '2026-2027 Undergraduate Bulletin, core curriculum'),
  ('CORC 1311', 'Thinking Mathematically', 'Same as MATH 1311', '2026-2027 Undergraduate Bulletin, core curriculum'),
  ('CORC 3303', 'Exploring Robotics', 'Same as CISC 1003', '2026-2027 Undergraduate Bulletin, core curriculum'),
  ('CISC 7992', 'Thesis Research', 'Listed as CISC 7992G', '2022-2023 Graduate Bulletin'),
  ('CISC 7000', 'Any 7000-level CISC course', 'A course level, not a single course', '2022-2023 Graduate Bulletin');

GRANT SELECT ON TABLE COURSE_NAMES TO ROLE SYSADMIN;
