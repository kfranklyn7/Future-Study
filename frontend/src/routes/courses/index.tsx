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
      <h1 className="page-title">Courses</h1>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="field" placeholder="Filter by code, title or topic" value={filter} onChange={e => setFilter(e.target.value)} />
        <DivisionSelect value={division} onChange={v => set({ division: v || undefined })} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-accent" checked={recent} onChange={e => set({ recent: e.target.checked || undefined })} /> Offered recently
        </label>
      </div>
      {!rows ? <Status error={error} /> : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-stone-200 text-xs text-stone-500 uppercase">
                <th className="px-3 py-2">Code</th><th className="px-3 py-2">Title</th><th className="px-3 py-2">Level</th><th className="px-3 py-2">Topics</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.course_code} className="border-b border-stone-100 align-top last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap"><CourseLink code={c.course_code} /></td>
                  <td className="px-3 py-2">{c.title}{!c.recent && <span className="tag tag-dim">not recent</span>}</td>
                  <td className="px-3 py-2">{c.division}</td>
                  <td className="px-3 py-2 text-sm">{c.topics?.slice(0, 4).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
