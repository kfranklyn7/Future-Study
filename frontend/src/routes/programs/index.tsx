import { createFileRoute, Link } from '@tanstack/react-router'
import { api } from '#/api'
import { Status, useData } from '#/hooks'

export const Route = createFileRoute('/programs/')({ component: Programs })

function Programs() {
  const { data, error } = useData(api.programs, [])
  if (!data) return <Status error={error} />
  return (
    <>
      <h1>Programs</h1>
      <div className="grid">
        {data.map(p => (
          <Link key={p.program_id} to="/programs/$id" params={{ id: p.program_id }} className="card">
            <h3>{p.title}</h3>
            <p className="muted small">{p.degree_levels}</p>
            <p className="small">{p.course_count} CISC courses</p>
          </Link>
        ))}
      </div>
    </>
  )
}
