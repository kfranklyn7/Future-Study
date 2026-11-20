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
      <p className="breadcrumb"><Link to="/courses" className="link">Courses</Link> / {c.course_code}</p>
      <h1 className="page-title mt-2">{c.course_code}: {c.title}</h1>
      <div className="flex flex-wrap gap-2">
        <span className="meta">{c.division}</span>
        <span className="meta">{c.hours || `${c.credits} credits`}</span>
        {!c.recent && <span className="meta text-stone-500">Not offered recently</span>}
      </div>
      <p className="mt-4 max-w-3xl leading-relaxed text-stone-800">{c.description}</p>
      {c.prerequisites && (
        <div className="mt-4 max-w-3xl rounded-lg border border-stone-200 bg-surface px-4 py-3 text-sm">
          <div className="font-semibold text-stone-900">Catalog prerequisite rule</div>
          <p className="mt-1 text-stone-700">{c.prerequisites}</p>
        </div>
      )}
      <div className="mt-4 flex gap-4">
        {c.syllabus_urls?.map(u => <a key={u} className="link" href={u} target="_blank" rel="noreferrer">Syllabus PDF</a>)}
        {c.inventory_url && <a className="link" href={c.inventory_url} target="_blank" rel="noreferrer">Course inventory</a>}
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="section-title">Career paths</h2>
          {c.careers.map(k => (
            <div key={k.title} className="mb-3 rounded-xl border border-stone-200 bg-surface px-5 py-4">
              <h3 className="font-semibold">{k.title} <span className={`tag tag-${k.relevance}`}>{k.relevance}</span></h3>
              <p className="my-1.5">{k.why}</p>
              {k.next_steps?.length > 0 && <ul className="list-disc pl-5 text-sm">{k.next_steps.map(s => <li key={s}>{s}</li>)}</ul>}
              <Link className="link text-sm" to="/careers" search={{ q: k.career }}>Other courses for {k.career} →</Link>
            </div>
          ))}
        </section>
        <section>
          <h2 className="section-title">Free resources</h2>
          <Resources items={c.resources} />
          <h2 className="section-title">Topics & skills</h2>
          <div className="flex flex-wrap gap-2">{c.topics?.map(t => <span key={t} className="chip cursor-default">{t}</span>)}</div>
          <ul className="mt-2 list-disc pl-5 text-sm">{c.skills?.map(s => <li key={s}>{s}</li>)}</ul>
        </section>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="section-title">Requires</h2>
          <CourseList items={c.prerequisites_of} empty="No prerequisites listed." />
        </section>
        <section>
          <h2 className="section-title">Unlocks</h2>
          <CourseList items={c.unlocks} empty="Not a listed prerequisite for other courses." />
        </section>
      </div>
      {c.programs.length > 0 && <>
        <h2 className="section-title">Part of</h2>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
          {c.programs.map(p => <li key={p.program_id}><Link className="link" to="/programs/$id" params={{ id: p.program_id }}>{p.title}</Link></li>)}
        </ul>
      </>}
    </article>
  )
}
