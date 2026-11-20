import { createFileRoute, Link } from '@tanstack/react-router'
import { api } from '#/api'
import { CourseList, Resources } from '#/components'
import { Status, useData } from '#/hooks'

export const Route = createFileRoute('/courses/$code')({ component: CourseDetail })

function CourseDetail() {
  const { code } = Route.useParams()
  const { data: c, error } = useData(() => api.course(code), [code])
  if (!c) return <Status error={error} />
  return (
    <article>
      <p className="crumbs"><Link to="/courses">Courses</Link> / {c.course_code}</p>
      <h1>{c.course_code}: {c.title}</h1>
      <p className="muted">{c.division} · {c.hours || `${c.credits} credits`} {c.recent ? '' : '· not offered recently'}</p>
      <p>{c.description}</p>
      {c.prerequisites && <p className="small"><b>Prerequisites (official text):</b> {c.prerequisites}</p>}
      <div className="links">
        {c.syllabus_urls?.map(u => <a key={u} href={u} target="_blank" rel="noreferrer">Syllabus PDF</a>)}
        {c.inventory_url && <a href={c.inventory_url} target="_blank" rel="noreferrer">Course inventory</a>}
      </div>

      <div className="cols">
        <section>
          <h2>Career paths</h2>
          {c.careers.map(k => (
            <div key={k.title} className="career">
              <h3>{k.title} <span className={`tag ${k.relevance}`}>{k.relevance}</span></h3>
              <p>{k.why}</p>
              {k.next_steps?.length > 0 && <ul className="small">{k.next_steps.map(s => <li key={s}>{s}</li>)}</ul>}
              <Link className="small" to="/careers" search={{ q: k.career }}>Other courses for {k.career} →</Link>
            </div>
          ))}
        </section>
        <section>
          <h2>Free resources</h2>
          <Resources items={c.resources} />
          <h2>Topics & skills</h2>
          <div className="chips">{c.topics?.map(t => <span key={t} className="chip static">{t}</span>)}</div>
          <ul className="small">{c.skills?.map(s => <li key={s}>{s}</li>)}</ul>
        </section>
      </div>

      <div className="cols">
        <section>
          <h2>Requires</h2>
          <CourseList items={c.prerequisites_of} empty="No prerequisites listed." />
        </section>
        <section>
          <h2>Unlocks</h2>
          <CourseList items={c.unlocks} empty="Not a listed prerequisite for other courses." />
        </section>
      </div>
      {c.programs.length > 0 && <>
        <h2>Part of</h2>
        <ul className="inline-list">
          {c.programs.map(p => <li key={p.program_id}><Link to="/programs/$id" params={{ id: p.program_id }}>{p.title}</Link></li>)}
        </ul>
      </>}
    </article>
  )
}
