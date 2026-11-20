// The BS in Computer Science prerequisite map, laid out like the department's
// "Prerequisite Flowchart for the BS in Computer Science". Course text (titles,
// descriptions, raw prerequisite rules) comes from courses.json, which
// scripts/build_map_data.py generates from data/csv.

import courseData from './courses.json'

export type Track = 'math' | 'core' | 'programming' | 'english' | 'elective'

export type Resource = { title: string; url: string; kind: 'course' | 'book' | 'tool' | 'guide' }

export type CourseInfo = {
  code: string
  title: string | null
  credits: number | null
  description: string | null
  prerequisites: string | null
  offeredRecently: boolean
  lastSeen: string | null
  syllabusUrl: string | null
  catalogUrl: string | null
}

export type MapNodeDef = {
  id: string
  label: string
  /** Course codes this box stands for. More than one means "take one of these". */
  codes: string[]
  track: Track
  x: number
  y: number
  /** Map nodes that must be done first (all of them). */
  requires: string[]
  /** Edges drawn dashed in the flowchart. */
  softRequires?: string[]
  careers: string[]
  resources: Resource[]
  note?: string
}

export const core = courseData.core as Record<string, CourseInfo>
export const electives = courseData.electives as CourseInfo[]
export const ELECTIVES_NEEDED = 3

const COL = 290
const col = (n: number) => n * COL

export const mapNodes: MapNodeDef[] = [
  // Column 0
  {
    id: 'precalc',
    label: 'Pre-Calc',
    codes: ['MATH 1011'],
    track: 'math',
    x: col(0),
    y: 300,
    requires: [],
    note: 'Or placement into MATH 1201 by the Department of Mathematics.',
    careers: ['Data Science', 'Software Engineering'],
    resources: [
      { title: 'Khan Academy: Precalculus', url: 'https://www.khanacademy.org/math/precalculus', kind: 'course' },
      { title: 'OpenStax: Precalculus 2e', url: 'https://openstax.org/details/books/precalculus-2e', kind: 'book' },
    ],
  },
  {
    id: 'java',
    label: 'Intro Java',
    codes: ['CISC 1115'],
    track: 'programming',
    x: col(0),
    y: 540,
    requires: [],
    careers: ['Software Engineering', 'Web Development', 'Mobile Development'],
    resources: [
      { title: 'University of Helsinki: Java Programming MOOC', url: 'https://java-programming.mooc.fi/', kind: 'course' },
      { title: 'dev.java: Learn Java', url: 'https://dev.java/learn/', kind: 'guide' },
      { title: 'CodingBat Java practice problems', url: 'https://codingbat.com/java', kind: 'tool' },
    ],
  },
  {
    id: 'english',
    label: 'English 2',
    codes: ['ENGL 1012'],
    track: 'english',
    x: col(0),
    y: 760,
    requires: [],
    careers: ['Technical Writing', 'Product Management'],
    resources: [
      { title: 'Purdue OWL: Writing Lab', url: 'https://owl.purdue.edu/', kind: 'guide' },
    ],
  },

  // Column 1
  {
    id: 'calc1',
    label: 'Calc 1',
    codes: ['MATH 1201'],
    track: 'math',
    x: col(1),
    y: 240,
    requires: ['precalc'],
    careers: ['Data Science', 'Machine Learning', 'Graphics'],
    resources: [
      { title: 'Khan Academy: Calculus 1', url: 'https://www.khanacademy.org/math/calculus-1', kind: 'course' },
      { title: 'OpenStax: Calculus Volume 1', url: 'https://openstax.org/details/books/calculus-volume-1', kind: 'book' },
      { title: '3Blue1Brown: Essence of Calculus', url: 'https://www.3blue1brown.com/topics/calculus', kind: 'course' },
    ],
  },
  {
    id: 'discrete',
    label: 'Discrete Structures',
    codes: ['CISC 2210'],
    track: 'core',
    x: col(1),
    y: 380,
    requires: ['precalc', 'java'],
    careers: ['Software Engineering', 'Security', 'Research'],
    resources: [
      { title: 'MIT 6.042J: Mathematics for Computer Science', url: 'https://ocw.mit.edu/courses/6-042j-mathematics-for-computer-science-fall-2010/', kind: 'course' },
      { title: 'Levin: Discrete Mathematics, An Open Introduction', url: 'https://discrete.openmathbooks.org/', kind: 'book' },
    ],
  },
  {
    id: 'modern',
    label: 'Modern Techniques',
    codes: ['CISC 3115'],
    track: 'programming',
    x: col(1),
    y: 540,
    requires: ['java'],
    careers: ['Software Engineering', 'Backend Development'],
    resources: [
      { title: 'Refactoring.Guru: Design Patterns', url: 'https://refactoring.guru/design-patterns', kind: 'guide' },
      { title: 'Missing Semester of Your CS Education (MIT)', url: 'https://missing.csail.mit.edu/', kind: 'course' },
      { title: 'Pro Git (free book)', url: 'https://git-scm.com/book/en/v2', kind: 'book' },
    ],
  },
  {
    id: 'ethics',
    label: 'Ethics',
    codes: ['CISC 2820W'],
    track: 'core',
    x: col(1),
    y: 760,
    requires: ['java', 'english'],
    careers: ['Product Management', 'Policy', 'Security'],
    resources: [
      { title: 'Stanford Encyclopedia of Philosophy: Computer and Information Ethics', url: 'https://plato.stanford.edu/entries/ethics-computer/', kind: 'guide' },
      { title: 'ACM Code of Ethics', url: 'https://www.acm.org/code-of-ethics', kind: 'guide' },
    ],
  },

  // Column 2
  {
    id: 'calc2',
    label: 'Calc 2',
    codes: ['MATH 1206'],
    track: 'math',
    x: col(2),
    y: 200,
    requires: ['calc1'],
    careers: ['Data Science', 'Machine Learning'],
    resources: [
      { title: 'Khan Academy: Calculus 2', url: 'https://www.khanacademy.org/math/calculus-2', kind: 'course' },
      { title: 'OpenStax: Calculus Volume 2', url: 'https://openstax.org/details/books/calculus-volume-2', kind: 'book' },
    ],
  },
  {
    id: 'arch',
    label: 'Architecture',
    codes: ['CISC 3310'],
    track: 'core',
    x: col(2),
    y: 420,
    requires: ['discrete'],
    careers: ['Systems Programming', 'Embedded Systems', 'Hardware'],
    resources: [
      { title: 'Nand2Tetris: Build a Computer from First Principles', url: 'https://www.nand2tetris.org/', kind: 'course' },
      { title: 'Computer Systems: A Programmer’s Perspective (CMU course site)', url: 'https://csapp.cs.cmu.edu/', kind: 'book' },
    ],
  },
  {
    id: 'ds',
    label: 'Data Structures',
    codes: ['CISC 3130'],
    track: 'programming',
    x: col(2),
    y: 540,
    requires: ['modern'],
    careers: ['Software Engineering', 'Interview Prep', 'Backend Development'],
    resources: [
      { title: 'VisuAlgo: animated data structures', url: 'https://visualgo.net/', kind: 'tool' },
      { title: 'Open Data Structures (free book)', url: 'https://opendatastructures.org/', kind: 'book' },
      { title: 'NeetCode roadmap (practice problems)', url: 'https://neetcode.io/roadmap', kind: 'tool' },
    ],
  },
  {
    id: 'project',
    label: 'Project',
    codes: ['CISC 4900', 'CISC 5001'],
    track: 'core',
    x: col(2),
    y: 880,
    requires: ['ds'],
    note: 'Also needs chair permission. CISC 4900 needs a CISC course above 3130; CISC 5001 needs a 3.0 GPA.',
    careers: ['Software Engineering', 'Research', 'Portfolio'],
    resources: [
      { title: 'Project-based learning (GitHub list)', url: 'https://github.com/practical-tutorials/project-based-learning', kind: 'guide' },
      { title: 'Build Your Own X', url: 'https://github.com/codecrafters-io/build-your-own-x', kind: 'guide' },
    ],
  },

  // Column 3
  {
    id: 'stats',
    label: 'Stats',
    codes: ['MATH 2501', 'MATH 3501'],
    track: 'math',
    x: col(3),
    y: 200,
    requires: ['calc2'],
    careers: ['Data Science', 'Machine Learning', 'Analytics'],
    resources: [
      { title: 'Khan Academy: Statistics and Probability', url: 'https://www.khanacademy.org/math/statistics-probability', kind: 'course' },
      { title: 'OpenIntro Statistics (free book)', url: 'https://www.openintro.org/book/os/', kind: 'book' },
      { title: 'Seeing Theory (visual probability)', url: 'https://seeing-theory.brown.edu/', kind: 'tool' },
    ],
  },
  {
    id: 'algo',
    label: 'Algorithms or Theory',
    codes: ['CISC 3220', 'CISC 3230'],
    track: 'core',
    x: col(3),
    y: 330,
    requires: ['calc1', 'discrete', 'ds'],
    careers: ['Software Engineering', 'Research', 'Interview Prep'],
    resources: [
      { title: 'MIT 6.006: Introduction to Algorithms', url: 'https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/', kind: 'course' },
      { title: 'Jeff Erickson: Algorithms (free book)', url: 'https://jeffe.cs.illinois.edu/teaching/algorithms/', kind: 'book' },
      { title: 'MIT 18.404J: Theory of Computation', url: 'https://ocw.mit.edu/courses/18-404j-theory-of-computation-fall-2020/', kind: 'course' },
    ],
  },
  {
    id: 'os',
    label: 'Operating Systems',
    codes: ['CISC 3320'],
    track: 'core',
    x: col(3),
    y: 460,
    requires: ['arch', 'ds'],
    careers: ['Systems Programming', 'DevOps', 'Cloud'],
    resources: [
      { title: 'Operating Systems: Three Easy Pieces (free book)', url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/', kind: 'book' },
      { title: 'MIT 6.1810 Operating System Engineering (xv6)', url: 'https://pdos.csail.mit.edu/6.1810/', kind: 'course' },
    ],
  },
  {
    id: 'cpp',
    label: 'Programming Paradigms in C++',
    codes: ['CISC 3142'],
    track: 'programming',
    x: col(3),
    y: 590,
    requires: ['arch', 'ds'],
    careers: ['Game Development', 'Systems Programming', 'Embedded Systems'],
    resources: [
      { title: 'LearnCpp.com', url: 'https://www.learncpp.com/', kind: 'guide' },
      { title: 'cppreference.com', url: 'https://en.cppreference.com/', kind: 'tool' },
    ],
  },
  {
    id: 'web',
    label: 'Web Apps',
    codes: ['CISC 3140'],
    track: 'core',
    x: col(3),
    y: 720,
    requires: ['ds'],
    careers: ['Web Development', 'Frontend', 'Full Stack'],
    resources: [
      { title: 'roadmap.sh: Frontend Developer', url: 'https://roadmap.sh/frontend', kind: 'guide' },
      { title: 'MDN: Learn web development', url: 'https://developer.mozilla.org/en-US/docs/Learn', kind: 'course' },
      { title: 'Full Stack Open (University of Helsinki)', url: 'https://fullstackopen.com/en/', kind: 'course' },
    ],
  },
  {
    id: 'electives',
    label: 'Three Advanced CIS Electives',
    codes: [],
    track: 'elective',
    x: col(3),
    y: 860,
    requires: [],
    softRequires: ['modern', 'ds'],
    note: 'Pick three courses numbered CISC 3000 to 4899. The list below is courses offered in the last five academic years; check the bulletin for which ones count.',
    careers: ['AI / ML', 'Security', 'Games', 'Data', 'Networking'],
    resources: [
      { title: 'roadmap.sh: all role and skill roadmaps', url: 'https://roadmap.sh/', kind: 'guide' },
      { title: 'OSSU: Open Source Society University CS curriculum', url: 'https://github.com/ossu/computer-science', kind: 'guide' },
    ],
  },
]

export const mapNodeById = Object.fromEntries(mapNodes.map((n) => [n.id, n])) as Record<string, MapNodeDef>

export const mapEdges = mapNodes.flatMap((n) => [
  ...n.requires.map((src) => ({ source: src, target: n.id, dashed: false })),
  ...(n.softRequires ?? []).map((src) => ({ source: src, target: n.id, dashed: true })),
])

// Colors are CSS variables from styles.css, so they switch with dark mode.
export const trackStyle: Record<Track, { label: string; bg: string; border: string }> = {
  math: { label: 'Math', bg: 'var(--color-track-math)', border: 'var(--color-track-math-line)' },
  core: { label: 'CIS core', bg: 'var(--color-track-core)', border: 'var(--color-track-core-line)' },
  programming: { label: 'Programming sequence', bg: 'var(--color-track-programming)', border: 'var(--color-track-programming-line)' },
  english: { label: 'English', bg: 'var(--color-track-english)', border: 'var(--color-track-english-line)' },
  elective: { label: 'Electives', bg: 'var(--color-track-core)', border: 'var(--color-track-core-line)' },
}
