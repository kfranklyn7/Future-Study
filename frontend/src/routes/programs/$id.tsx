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
      <p className="breadcrumb"><Link to="/programs" className="link">Programs</Link> / {p.title}</p>
      <h1 className="page-title mt-2">{p.title}</h1>
      <div className="flex flex-wrap gap-2">
        <span className="meta">{p.degree_levels}</span>
        {p.credits && <span className="meta">{p.credits} credits</span>}
      </div>
      <p className="mt-4 max-w-3xl leading-relaxed text-stone-800">{p.overview}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link to="/graph" search={{ program: p.program_id }} className="btn">View prerequisite graph</Link>
        <a className="btn-secondary" href={p.url} target="_blank" rel="noreferrer">Program page on brooklyn.edu ↗</a>
      </div>
      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="section-title">Career paths</h2>
          {p.careers?.map(k => (
            <div key={k.title} className="mb-3 rounded-xl border border-stone-200 bg-surface px-5 py-4">
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
