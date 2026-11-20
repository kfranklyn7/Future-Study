import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '#/api'
import { CourseLink, relevanceRank } from '#/components'
import { Status, useData } from '#/hooks'

export const Route = createFileRoute('/careers')({
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
  }),
  component: Careers,
})

function Careers() {
  const { q = '' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data, error } = useData(() => api.careers(), [])
  if (!data) return <Status error={error} />
  const f = q.toLowerCase()
  const rows = data.filter(c => !f || c.title.toLowerCase().includes(f))
  return (
    <>
      <h1 className="page-title">Career paths</h1>
      <p className="text-stone-600">Generated from each course's description and syllabus.</p>
      <input type="search" aria-label="Search careers" className="field my-5 w-full max-w-sm" placeholder="Search careers" value={q}
        onChange={e => navigate({ search: { q: e.target.value || undefined }, replace: true })} />
      {rows.map(c => (
        <details key={c.title} className="mb-3 rounded-xl border border-stone-200 bg-white px-5 py-3 open:pb-4" open={rows.length <= 3}>
          <summary className="cursor-pointer py-1 marker:text-stone-400"><span className="font-semibold">{c.title}</span> <span className="text-sm text-stone-500">{c.course_count} courses</span></summary>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            {[...c.courses].sort((a, b) => relevanceRank(a.relevance) - relevanceRank(b.relevance)).map(x => (
              <li key={x.course_code}>
                <CourseLink code={x.course_code}>{x.course_code} {x.title}</CourseLink>{' '}
                <span className={`tag tag-${x.relevance}`}>{x.relevance}</span>
                <div className="text-sm text-stone-500">{x.why}</div>
              </li>
            ))}
          </ul>
        </details>
      ))}
      {rows.length === 0 && <p className="text-stone-500">No careers match "{q}".</p>}
    </>
  )
}
