import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api, type Recommendation, type SearchHit } from '#/api'
import { CourseLink, DivisionSelect } from '#/components'

export const Route = createFileRoute('/')({ component: Discover })

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
      <section className="hero">
        <h1>What are you interested in?</h1>
        <p className="muted">Describe topics, hobbies or career goals. We'll match them against every CISC course and syllabus.</p>
        <form onSubmit={submit} className="ask">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
            placeholder="e.g. I like building games and want to learn how 3D graphics work" />
          <div className="row">
            <DivisionSelect value={division} onChange={setDivision} />
            <button disabled={busy}>{busy ? 'Thinking…' : 'Recommend courses'}</button>
          </div>
        </form>
        <div className="chips">
          {SUGGESTIONS.map(s => <button key={s} className="chip" onClick={() => setText(s)}>{s}</button>)}
        </div>
      </section>
      {error && <p className="error">{error}</p>}
      {recs && (
        <section>
          <h2>Recommended for you</h2>
          {recs.length === 0 && <p className="muted">No strong matches. Try different wording.</p>}
          <div className="grid">
            {recs.map(r => (
              <CourseLink key={r.course_code} code={r.course_code} className="card">
                <div className="code">{r.course_code}</div>
                <h3>{r.title}</h3>
                <p>{r.reason}</p>
              </CourseLink>
            ))}
          </div>
          {others.length > 0 && <>
            <h3>Also related</h3>
            <ul className="inline-list">
              {others.map(h => <li key={h.course_code}><CourseLink code={h.course_code}>{h.course_code} {h.title}</CourseLink></li>)}
            </ul>
          </>}
        </section>
      )}
    </>
  )
}
