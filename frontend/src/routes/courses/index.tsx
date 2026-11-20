import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '#/api'
import { CourseLink, DivisionSelect } from '#/components'
import { Status, useData } from '#/hooks'

type Search = { division?: string; recent?: boolean }

export const Route = createFileRoute('/courses/')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    division: typeof s.division === 'string' && s.division ? s.division : undefined,
    recent: s.recent === true || s.recent === 'true' ? true : undefined,
  }),
  component: Courses,
})

function Courses() {
  const { division = '', recent = false } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [filter, setFilter] = useState('')
  const { data, error } = useData(() => api.courses(division, recent), [division, recent])
  const set = (patch: Search) => navigate({ search: prev => ({ ...prev, ...patch }) })

  const f = filter.toLowerCase()
  const rows = data?.filter(c => !f || c.course_code.toLowerCase().includes(f) || c.title.toLowerCase().includes(f)
    || c.topics?.some(t => t.toLowerCase().includes(f)))
  return (
    <>
      <h1>Courses</h1>
      <div className="row toolbar">
        <input placeholder="Filter by code, title or topic" value={filter} onChange={e => setFilter(e.target.value)} />
        <DivisionSelect value={division} onChange={v => set({ division: v || undefined })} />
        <label><input type="checkbox" checked={recent} onChange={e => set({ recent: e.target.checked || undefined })} /> Offered recently</label>
      </div>
      {!rows ? <Status error={error} /> : (
        <table>
          <thead><tr><th>Code</th><th>Title</th><th>Level</th><th>Topics</th></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.course_code}>
                <td><CourseLink code={c.course_code} /></td>
                <td>{c.title}{!c.recent && <span className="tag dim">not recent</span>}</td>
                <td>{c.division}</td>
                <td className="small">{c.topics?.slice(0, 4).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
