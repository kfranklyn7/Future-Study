export type CourseSummary = {
  course_code: string
  title: string
  division: string
  credits: string
  recent: boolean
  topics: string[] | null
}

export type Career = { title: string; career: string; why: string; relevance: string; next_steps: string[] }
export type Resource = { title: string; url: string; provider: string; type: string }
export type CourseRef = { course_code: string; title: string | null; relationship?: string }

export type Course = CourseSummary & {
  hours: string
  description: string
  prerequisites: string
  scheduled_terms: string
  inventory_url: string
  skills: string[] | null
  syllabus_urls: string[] | null
  careers: Career[]
  resources: Resource[]
  prerequisites_of: CourseRef[]
  unlocks: CourseRef[]
  programs: { program_id: string; title: string }[]
}

export type ProgramSummary = { program_id: string; title: string; degree_levels: string; credits: string; course_count: number }
export type Program = ProgramSummary & {
  url: string
  overview: string
  careers: { title: string; why: string; typical_courses: string[]; next_steps: string[] }[] | null
  courses: { course_code: string; title: string | null; division: string | null }[]
  resources: Resource[]
  sections: { section_title: string; section_text: string }[]
}

export type GraphData = {
  nodes: { id: string; title: string | null; division: string | null; in_scope: boolean; in_catalog: boolean }[]
  edges: { source: string; target: string; relationship: string }[]
}

export type CareerGroup = {
  title: string
  course_count: number
  courses: { course_code: string; title: string; role: string; relevance: string; why: string }[]
}

export type SearchHit = { course_code: string; title: string; division: string }
export type Recommendation = { course_code: string; title: string; reason: string }

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText)
  return r.json()
}

const enc = encodeURIComponent

export const api = {
  courses: (division = '', recent = false) => get<CourseSummary[]>(`/api/courses?division=${enc(division)}&recent=${recent}`),
  course: (code: string) => get<Course>(`/api/courses/${enc(code)}`),
  programs: () => get<ProgramSummary[]>('/api/programs'),
  program: (id: string) => get<Program>(`/api/programs/${enc(id)}`),
  graph: (program = '') => get<GraphData>(`/api/graph?program=${enc(program)}`),
  careers: (title = '') => get<CareerGroup[]>(`/api/careers?title=${enc(title)}`),
  search: (q: string, division = '') => get<SearchHit[]>(`/api/search?q=${enc(q)}&division=${enc(division)}`),
  recommend: async (interests: string, division = '') => {
    const r = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interests, division }),
    })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText)
    return (await r.json()) as { recommendations: Recommendation[]; candidates: SearchHit[] }
  },
}

