import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api, type Recommendation, type SearchHit } from '#/api'
import { CourseLink, DivisionSelect } from '#/components'

export const Route = createFileRoute('/discover')({ component: Discover })

const SUGGESTIONS = ['machine learning', 'cybersecurity', 'web development', 'databases and data engineering', 'video games']

function Discover() {
  const [text, setText] = useState('')
  const [division, setDivision] = useState('Undergraduate')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recs, setRecs] = useState<Recommendation[] | null>(null)
  const [hits, setHits] = useState<SearchHit[]>([])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true); setError(null)
    try {
      const r = await api.recommend(text, division)
      setRecs(r.recommendations); setHits(r.candidates)
    } catch (err) { setError(String(err)) } finally { setBusy(false) }
  }

  const picked = new Set(recs?.map(r => r.course_code))
  const others = hits.filter(h => !picked.has(h.course_code))
  return (
    <>
      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <h1 className="page-title">What are you interested in?</h1>
        <p className="text-stone-500">Describe topics, hobbies or career goals. We'll match them against every CISC course and syllabus.</p>
        <form onSubmit={submit} className="mt-4 grid gap-3">
          <textarea className="field w-full resize-y" value={text} onChange={e => setText(e.target.value)} rows={3}
            placeholder="e.g. I like building games and want to learn how 3D graphics work" />
          <div className="flex flex-wrap items-center gap-3">
            <DivisionSelect value={division} onChange={setDivision} />
            <button className="btn" disabled={busy}>{busy ? 'Thinking…' : 'Recommend courses'}</button>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map(s => <button key={s} type="button" className="chip" onClick={() => setText(s)}>{s}</button>)}
        </div>
      </section>
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {recs && (
        <section>
          <h2 className="section-title">Recommended for you</h2>
          {recs.length === 0 && <p className="text-stone-500">No strong matches. Try different wording.</p>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {recs.map(r => (
              <CourseLink key={r.course_code} code={r.course_code} className="card">
                <div className="text-sm font-bold text-accent">{r.course_code}</div>
                <h3 className="font-semibold">{r.title}</h3>
                <p className="mt-1.5 text-sm text-stone-700">{r.reason}</p>
              </CourseLink>
            ))}
          </div>
          {others.length > 0 && <>
            <h3 className="mt-6 mb-2 font-semibold">Also related</h3>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
              {others.map(h => <li key={h.course_code}><CourseLink code={h.course_code}>{h.course_code} {h.title}</CourseLink></li>)}
            </ul>
          </>}
        </section>
      )}
    </>
  )
}
