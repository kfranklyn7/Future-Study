import { createFileRoute, Link } from '@tanstack/react-router'
import { api } from '#/api'
import { CourseLink, CourseList, Resources } from '#/components'
import { Status, useData } from '#/hooks'

export const Route = createFileRoute('/programs/$id')({ component: ProgramDetail })

function ProgramDetail() {
  const { id } = Route.useParams()
  const { data: p, error } = useData(() => api.program(id), [id])
  if (!p) return <Status error={error} />
  return (
    <article>
      <p className="text-sm text-stone-500"><Link to="/programs" className="link">Programs</Link> / {p.title}</p>
      <h1 className="page-title">{p.title}</h1>
      <p className="text-stone-500">
        {p.degree_levels}{p.credits && ` · ${p.credits} credits`} · <a className="link" href={p.url} target="_blank" rel="noreferrer">brooklyn.edu</a>
      </p>
      <p className="my-2">{p.overview}</p>
      <p className="my-4"><Link to="/graph" search={{ program: p.program_id }} className="btn">View prerequisite graph →</Link></p>
      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="section-title">Career paths</h2>
          {p.careers?.map(k => (
            <div key={k.title} className="mb-3 rounded-xl border border-stone-200 bg-white px-4 py-3">
              <h3 className="font-semibold">{k.title}</h3>
              <p className="my-1.5">{k.why}</p>
              <div className="flex flex-wrap gap-2">{k.typical_courses.map(c => <CourseLink key={c} code={c} className="chip" />)}</div>
            </div>
          ))}
        </section>
        <section>
          <h2 className="section-title">Free resources for this field</h2>
          <Resources items={p.resources} />
          <h2 className="section-title">Courses</h2>
          <CourseList items={p.courses} empty="No CISC courses listed." />
        </section>
      </div>
    </article>
  )
}
