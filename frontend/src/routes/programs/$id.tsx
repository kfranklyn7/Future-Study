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
      <p className="crumbs"><Link to="/programs">Programs</Link> / {p.title}</p>
      <h1>{p.title}</h1>
      <p className="muted">
        {p.degree_levels}{p.credits && ` · ${p.credits} credits`} · <a href={p.url} target="_blank" rel="noreferrer">brooklyn.edu</a>
      </p>
      <p>{p.overview}</p>
      <p><Link to="/graph" search={{ program: p.program_id }} className="button">View course map →</Link></p>
      <div className="cols">
        <section>
          <h2>Career paths</h2>
          {p.careers?.map(k => (
            <div key={k.title} className="career">
              <h3>{k.title}</h3>
              <p>{k.why}</p>
              <div className="chips">{k.typical_courses.map(c => <CourseLink key={c} code={c} className="chip" />)}</div>
            </div>
          ))}
        </section>
        <section>
          <h2>Free resources for this field</h2>
          <Resources items={p.resources} />
          <h2>Courses</h2>
          <CourseList items={p.courses} empty="No CISC courses listed." />
        </section>
      </div>
    </article>
  )
}
