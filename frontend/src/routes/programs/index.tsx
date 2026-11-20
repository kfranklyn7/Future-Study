import { createFileRoute, Link } from '@tanstack/react-router'
import { api } from '#/api'
import { Status, useData } from '#/hooks'

export const Route = createFileRoute('/programs/')({ component: Programs })

function Programs() {
  const { data, error } = useData(api.programs, [])
  if (!data) return <Status error={error} />
  return (
    <>
      <h1 className="page-title">Programs</h1>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {data.map(p => (
          <Link key={p.program_id} to="/programs/$id" params={{ id: p.program_id }} className="card">
            <h3 className="font-semibold">{p.title}</h3>
            <p className="mt-1 text-sm text-stone-500">{p.degree_levels}</p>
            <p className="mt-3 text-sm font-medium text-accent">{p.course_count} CISC courses</p>
          </Link>
        ))}
      </div>
    </>
  )
}
