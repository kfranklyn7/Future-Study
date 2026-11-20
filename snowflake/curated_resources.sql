-- Hand-picked free resources, added on top of the AI-generated rows in RESOURCES.
-- ai_enrichment.sql rebuilds RESOURCES from scratch, so run this after it:
--   python snowflake/run_sql.py snowflake/curated_resources.sql
-- Safe to rerun: rows with the same course and URL are replaced, not duplicated.
-- URLs were checked on 2026-11-20 (GeeksforGeeks URLs are the post-redirect ones).

USE SCHEMA CISC.CORE;

CREATE OR REPLACE TEMPORARY TABLE CURATED_RESOURCES (SCOPE_ID STRING, TITLE STRING, URL STRING, PROVIDER STRING, TYPE STRING) AS
SELECT column1, column2, column3, column4, column5 FROM VALUES
  -- Algebra and precalculus
  ('MATH 1006', 'Algebra notes', 'https://tutorial.math.lamar.edu/Classes/Alg/Alg.aspx', 'Paul''s Online Math Notes', 'notes'),
  ('MATH 1011', 'Algebra notes', 'https://tutorial.math.lamar.edu/Classes/Alg/Alg.aspx', 'Paul''s Online Math Notes', 'notes'),
  ('MATH 1012', 'Algebra notes', 'https://tutorial.math.lamar.edu/Classes/Alg/Alg.aspx', 'Paul''s Online Math Notes', 'notes'),
  ('MATH 1021', 'Algebra notes', 'https://tutorial.math.lamar.edu/Classes/Alg/Alg.aspx', 'Paul''s Online Math Notes', 'notes'),
  ('MATH 1026', 'Algebra notes', 'https://tutorial.math.lamar.edu/Classes/Alg/Alg.aspx', 'Paul''s Online Math Notes', 'notes'),
  ('MATH 1006', 'Professor Leonard: college algebra and precalculus lectures', 'https://www.youtube.com/@ProfessorLeonard', 'Professor Leonard (YouTube)', 'video'),
  ('MATH 1011', 'Professor Leonard: college algebra and precalculus lectures', 'https://www.youtube.com/@ProfessorLeonard', 'Professor Leonard (YouTube)', 'video'),
  ('MATH 1012', 'Professor Leonard: college algebra and precalculus lectures', 'https://www.youtube.com/@ProfessorLeonard', 'Professor Leonard (YouTube)', 'video'),
  ('MATH 1006', 'The Organic Chemistry Tutor: algebra and precalculus videos', 'https://www.youtube.com/@TheOrganicChemistryTutor', 'The Organic Chemistry Tutor (YouTube)', 'video'),
  ('MATH 1011', 'The Organic Chemistry Tutor: algebra and precalculus videos', 'https://www.youtube.com/@TheOrganicChemistryTutor', 'The Organic Chemistry Tutor (YouTube)', 'video'),
  ('MATH 1012', 'The Organic Chemistry Tutor: algebra and precalculus videos', 'https://www.youtube.com/@TheOrganicChemistryTutor', 'The Organic Chemistry Tutor (YouTube)', 'video'),
  -- Calculus
  ('MATH 1201', 'Calculus I notes', 'https://tutorial.math.lamar.edu/Classes/CalcI/CalcI.aspx', 'Paul''s Online Math Notes', 'notes'),
  ('MATH 1206', 'Calculus II notes', 'https://tutorial.math.lamar.edu/Classes/CalcII/CalcII.aspx', 'Paul''s Online Math Notes', 'notes'),
  ('MATH 1211', 'Calculus II notes (series and sequences)', 'https://tutorial.math.lamar.edu/Classes/CalcII/CalcII.aspx', 'Paul''s Online Math Notes', 'notes'),
  ('MATH 2201', 'Calculus III notes', 'https://tutorial.math.lamar.edu/Classes/CalcIII/CalcIII.aspx', 'Paul''s Online Math Notes', 'notes'),
  ('MATH 1201', 'Professor Leonard: Calculus 1 lectures', 'https://www.youtube.com/@ProfessorLeonard', 'Professor Leonard (YouTube)', 'video'),
  ('MATH 1206', 'Professor Leonard: Calculus 2 lectures', 'https://www.youtube.com/@ProfessorLeonard', 'Professor Leonard (YouTube)', 'video'),
  ('MATH 1211', 'Professor Leonard: Calculus 2 lectures (series)', 'https://www.youtube.com/@ProfessorLeonard', 'Professor Leonard (YouTube)', 'video'),
  ('MATH 2201', 'Professor Leonard: Calculus 3 lectures', 'https://www.youtube.com/@ProfessorLeonard', 'Professor Leonard (YouTube)', 'video'),
  ('MATH 1201', 'The Organic Chemistry Tutor: calculus videos', 'https://www.youtube.com/@TheOrganicChemistryTutor', 'The Organic Chemistry Tutor (YouTube)', 'video'),
  ('MATH 1206', 'The Organic Chemistry Tutor: calculus videos', 'https://www.youtube.com/@TheOrganicChemistryTutor', 'The Organic Chemistry Tutor (YouTube)', 'video'),
  -- Statistics
  ('MATH 1501', 'Professor Leonard: statistics lectures', 'https://www.youtube.com/@ProfessorLeonard', 'Professor Leonard (YouTube)', 'video'),
  ('MATH 2501', 'Professor Leonard: statistics lectures', 'https://www.youtube.com/@ProfessorLeonard', 'Professor Leonard (YouTube)', 'video'),
  ('MATH 3501', 'Professor Leonard: statistics lectures', 'https://www.youtube.com/@ProfessorLeonard', 'Professor Leonard (YouTube)', 'video'),
  ('BUSN 3400', 'Professor Leonard: statistics lectures', 'https://www.youtube.com/@ProfessorLeonard', 'Professor Leonard (YouTube)', 'video'),
  ('ECON 3400', 'Professor Leonard: statistics lectures', 'https://www.youtube.com/@ProfessorLeonard', 'Professor Leonard (YouTube)', 'video'),
  ('PSYC 3400', 'Professor Leonard: statistics lectures', 'https://www.youtube.com/@ProfessorLeonard', 'Professor Leonard (YouTube)', 'video'),
  ('MATH 1501', 'The Organic Chemistry Tutor: statistics videos', 'https://www.youtube.com/@TheOrganicChemistryTutor', 'The Organic Chemistry Tutor (YouTube)', 'video'),
  ('MATH 2501', 'The Organic Chemistry Tutor: statistics videos', 'https://www.youtube.com/@TheOrganicChemistryTutor', 'The Organic Chemistry Tutor (YouTube)', 'video'),
  -- Programming languages
  ('CISC 1113', 'Java tutorial', 'https://www.w3schools.com/java/', 'W3Schools', 'tutorial'),
  ('CISC 1114', 'Java tutorial', 'https://www.w3schools.com/java/', 'W3Schools', 'tutorial'),
  ('CISC 1115', 'Java tutorial', 'https://www.w3schools.com/java/', 'W3Schools', 'tutorial'),
  ('CISC 1170', 'Java tutorial', 'https://www.w3schools.com/java/', 'W3Schools', 'tutorial'),
  ('CISC 3115', 'Java tutorial', 'https://www.w3schools.com/java/', 'W3Schools', 'tutorial'),
  ('CISC 3150', 'Java tutorial (classes and OOP)', 'https://www.w3schools.com/java/', 'W3Schools', 'tutorial'),
  ('CISC 1110', 'C++ tutorial', 'https://www.w3schools.com/cpp/', 'W3Schools', 'tutorial'),
  ('CISC 1111', 'C++ tutorial', 'https://www.w3schools.com/cpp/', 'W3Schools', 'tutorial'),
  ('CISC 1112', 'C++ tutorial', 'https://www.w3schools.com/cpp/', 'W3Schools', 'tutorial'),
  ('CISC 1180', 'C++ tutorial', 'https://www.w3schools.com/cpp/', 'W3Schools', 'tutorial'),
  ('CISC 3110', 'C++ tutorial', 'https://www.w3schools.com/cpp/', 'W3Schools', 'tutorial'),
  ('CISC 3142', 'C++ tutorial', 'https://www.w3schools.com/cpp/', 'W3Schools', 'tutorial'),
  ('CISC 1215', 'Python tutorial', 'https://www.w3schools.com/python/', 'W3Schools', 'tutorial'),
  ('CISC 3225', 'Python tutorial', 'https://www.w3schools.com/python/', 'W3Schools', 'tutorial'),
  -- Web
  ('CISC 1030', 'HTML tutorial', 'https://www.w3schools.com/html/', 'W3Schools', 'tutorial'),
  ('CISC 1035', 'HTML tutorial', 'https://www.w3schools.com/html/', 'W3Schools', 'tutorial'),
  ('CISC 1035', 'CSS tutorial', 'https://www.w3schools.com/css/', 'W3Schools', 'tutorial'),
  ('CISC 3140', 'JavaScript tutorial', 'https://www.w3schools.com/js/', 'W3Schools', 'tutorial'),
  ('CISC 3140', 'React tutorial', 'https://www.w3schools.com/react/', 'W3Schools', 'tutorial'),
  ('CISC 3144', 'JavaScript tutorial', 'https://www.w3schools.com/js/', 'W3Schools', 'tutorial'),
  ('CISC 3144', 'React tutorial', 'https://www.w3schools.com/react/', 'W3Schools', 'tutorial'),
  -- Databases
  ('CISC 3810', 'SQL tutorial', 'https://www.w3schools.com/sql/', 'W3Schools', 'tutorial'),
  ('CISC 4610', 'SQL tutorial', 'https://www.w3schools.com/sql/', 'W3Schools', 'tutorial'),
  ('CISC 3810', 'DBMS tutorial', 'https://www.geeksforgeeks.org/dbms/dbms/', 'GeeksforGeeks', 'tutorial'),
  ('CISC 4610', 'DBMS tutorial', 'https://www.geeksforgeeks.org/dbms/dbms/', 'GeeksforGeeks', 'tutorial'),
  -- Core CS
  ('CISC 2210', 'Discrete mathematics tutorial', 'https://www.geeksforgeeks.org/engineering-mathematics/discrete-mathematics-tutorial/', 'GeeksforGeeks', 'tutorial'),
  ('CISC 3130', 'Data structures and algorithms tutorial', 'https://www.geeksforgeeks.org/dsa/dsa-tutorial-learn-data-structures-and-algorithms/', 'GeeksforGeeks', 'tutorial'),
  ('CISC 3130', 'Data structures and algorithms tutorial', 'https://www.w3schools.com/dsa/', 'W3Schools', 'tutorial'),
  ('CISC 3220', 'Data structures and algorithms tutorial', 'https://www.geeksforgeeks.org/dsa/dsa-tutorial-learn-data-structures-and-algorithms/', 'GeeksforGeeks', 'tutorial'),
  ('CISC 3230', 'Theory of computation tutorial', 'https://www.geeksforgeeks.org/theory-of-computation/theory-of-computation-automata-tutorials/', 'GeeksforGeeks', 'tutorial'),
  ('CISC 3305', 'Computer organization and architecture tutorial', 'https://www.geeksforgeeks.org/computer-organization-architecture/computer-organization-and-architecture-tutorials/', 'GeeksforGeeks', 'tutorial'),
  ('CISC 3310', 'Computer organization and architecture tutorial', 'https://www.geeksforgeeks.org/computer-organization-architecture/computer-organization-and-architecture-tutorials/', 'GeeksforGeeks', 'tutorial'),
  ('CISC 3320', 'Operating systems tutorial', 'https://www.geeksforgeeks.org/operating-systems/operating-systems/', 'GeeksforGeeks', 'tutorial'),
  ('CISC 3340', 'Computer networks tutorial', 'https://www.geeksforgeeks.org/computer-networks/computer-network-tutorials/', 'GeeksforGeeks', 'tutorial'),
  ('CISC 3345', 'Computer networks tutorial', 'https://www.geeksforgeeks.org/computer-networks/computer-network-tutorials/', 'GeeksforGeeks', 'tutorial'),
  ('CISC 3240', 'Cryptography tutorial', 'https://www.geeksforgeeks.org/computer-networks/cryptography-tutorial/', 'GeeksforGeeks', 'tutorial'),
  ('CISC 3390', 'Compiler design tutorial', 'https://www.geeksforgeeks.org/compiler-design/compiler-design-tutorials/', 'GeeksforGeeks', 'tutorial'),
  ('CISC 3171', 'Software engineering tutorial', 'https://www.geeksforgeeks.org/software-engineering/software-engineering/', 'GeeksforGeeks', 'tutorial'),
  ('CISC 3440', 'Machine learning tutorial', 'https://www.geeksforgeeks.org/machine-learning/machine-learning-tutorial/', 'GeeksforGeeks', 'tutorial');

DELETE FROM RESOURCES r USING CURATED_RESOURCES c
WHERE r.SCOPE = 'course' AND r.SCOPE_ID = c.SCOPE_ID AND r.URL = c.URL;

INSERT INTO RESOURCES (SCOPE, SCOPE_ID, TITLE, URL, PROVIDER, TYPE, URL_OK)
SELECT 'course', SCOPE_ID, TITLE, URL, PROVIDER, TYPE, TRUE FROM CURATED_RESOURCES;
