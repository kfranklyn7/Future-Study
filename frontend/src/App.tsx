import { useState } from 'react'
import { Link, NavLink, Route, Routes, useParams, useSearchParams } from 'react-router-dom'
import { api, courseLink, type Recommendation, type SearchHit } from './api'
import { Status, useData } from './hooks'
import GraphPage from './GraphPage'

export default function App() {
  return (
    <div className="app">
      <header>
        <Link to="/" className="brand">Future<span>Study</span></Link>
        <nav>
          <NavLink to="/" end>Discover</NavLink>
          <NavLink to="/courses">Courses</NavLink>
          <NavLink to="/programs">Programs</NavLink>
          <NavLink to="/graph">Course map</NavLink>
          <NavLink to="/careers">Careers</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Discover />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/courses/:code" element={<CourseDetail />} />
          <Route path="/programs" element={<Programs />} />
          <Route path="/programs/:id" element={<ProgramDetail />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/careers" element={<Careers />} />
          <Route path="*" element={<p>Page not found. <Link to="/">Go home</Link></p>} />
        </Routes>
      </main>
      <footer>Brooklyn College CIS data · AI output by Snowflake Cortex, verify before relying on it</footer>
    </div>
  )
}

const DIVISIONS = ['', 'Undergraduate', 'Graduate']

function DivisionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      {DIVISIONS.map(d => <option key={d} value={d}>{d || 'All levels'}</option>)}
    </select>
  )
}

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
          {['machine learning', 'cybersecurity', 'web development', 'databases and data engineering', 'video games'].map(s =>
            <button key={s} className="chip" onClick={() => setText(s)}>{s}</button>)}
        </div>
      </section>
      {error && <p className="error">{error}</p>}
      {recs && (
        <section>
          <h2>Recommended for you</h2>
          {recs.length === 0 && <p className="muted">No strong matches. Try different wording.</p>}
          <div className="grid">
            {recs.map(r => (
              <Link key={r.course_code} to={courseLink(r.course_code)} className="card">
                <div className="code">{r.course_code}</div>
                <h3>{r.title}</h3>
                <p>{r.reason}</p>
              </Link>
            ))}
          </div>
          {hits.some(h => !picked.has(h.course_code)) && <>
            <h3>Also related</h3>
            <ul className="inline-list">
              {hits.filter(h => !picked.has(h.course_code)).map(h =>
                <li key={h.course_code}><Link to={courseLink(h.course_code)}>{h.course_code} {h.title}</Link></li>)}
            </ul>
          </>}
        </section>
      )}
    </>
  )
}

function Courses() {
  const [params, setParams] = useSearchParams()
  const division = params.get('division') ?? ''
  const recent = params.get('recent') === 'true'
  const [filter, setFilter] = useState('')
  const { data, error } = useData(() => api.courses(division, recent), [division, recent])
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p) }
  const f = filter.toLowerCase()
  const rows = data?.filter(c => !f || c.course_code.toLowerCase().includes(f) || c.title.toLowerCase().includes(f)
    || c.topics?.some(t => t.toLowerCase().includes(f)))
  return (
    <>
      <h1>Courses</h1>
      <div className="row toolbar">
        <input placeholder="Filter by code, title or topic" value={filter} onChange={e => setFilter(e.target.value)} />
        <DivisionSelect value={division} onChange={v => set('division', v)} />
        <label><input type="checkbox" checked={recent} onChange={e => set('recent', e.target.checked ? 'true' : '')} /> Offered recently</label>
      </div>
      {!rows ? <Status error={error} /> : (
        <table>
          <thead><tr><th>Code</th><th>Title</th><th>Level</th><th>Topics</th></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.course_code}>
                <td><Link to={courseLink(c.course_code)}>{c.course_code}</Link></td>
                <td>{c.title}{!c.recent && <span className="tag dim">not recent</span>}</td>
                <td>{c.division}</td>
                <td className="small">{c.topics?.slice(0, 4).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function CourseDetail() {
  const { code = '' } = useParams()
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
              <Link className="small" to={`/careers?q=${encodeURIComponent(k.career)}`}>Other courses for {k.career} →</Link>
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
        <ul className="inline-list">{c.programs.map(p => <li key={p.program_id}><Link to={`/programs/${p.program_id}`}>{p.title}</Link></li>)}</ul>
      </>}
    </article>
  )
}

function CourseList({ items, empty }: { items: { course_code: string; title: string | null }[]; empty: string }) {
  if (!items.length) return <p className="muted">{empty}</p>
  return (
    <ul>
      {items.map(i => <li key={i.course_code}>
        {i.title ? <Link to={courseLink(i.course_code)}>{i.course_code} {i.title}</Link> : <span className="muted">{i.course_code} (outside CISC)</span>}
      </li>)}
    </ul>
  )
}

function Resources({ items }: { items: { title: string; url: string; provider: string; type: string }[] }) {
  if (!items.length) return <p className="muted">None yet.</p>
  return (
    <ul className="resources">
      {items.map(r => (
        <li key={r.url + r.title}>
          <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
          <span className="small muted"> · {r.provider} · {r.type}</span>
        </li>
      ))}
    </ul>
  )
}

function Programs() {
  const { data, error } = useData(api.programs, [])
  if (!data) return <Status error={error} />
  return (
    <>
      <h1>Programs</h1>
      <div className="grid">
        {data.map(p => (
          <Link key={p.program_id} to={`/programs/${p.program_id}`} className="card">
            <h3>{p.title}</h3>
            <p className="muted small">{p.degree_levels}</p>
            <p className="small">{p.course_count} CISC courses</p>
          </Link>
        ))}
      </div>
    </>
  )
}

function ProgramDetail() {
  const { id = '' } = useParams()
  const { data: p, error } = useData(() => api.program(id), [id])
  if (!p) return <Status error={error} />
  return (
    <article>
      <p className="crumbs"><Link to="/programs">Programs</Link> / {p.title}</p>
      <h1>{p.title}</h1>
      <p className="muted">{p.degree_levels}{p.credits && ` · ${p.credits} credits`} · <a href={p.url} target="_blank" rel="noreferrer">brooklyn.edu</a></p>
      <p>{p.overview}</p>
      <p><Link to={`/graph?program=${p.program_id}`} className="button">View course map →</Link></p>
      <div className="cols">
        <section>
          <h2>Career paths</h2>
          {p.careers?.map(k => (
            <div key={k.title} className="career">
              <h3>{k.title}</h3>
              <p>{k.why}</p>
              <div className="chips">{k.typical_courses.map(c => <Link key={c} to={courseLink(c)} className="chip">{c}</Link>)}</div>
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

function Careers() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const { data, error } = useData(() => api.careers(), [])
  if (!data) return <Status error={error} />
  const f = q.toLowerCase()
  const rows = data.filter(c => !f || c.title.toLowerCase().includes(f))
  return (
    <>
      <h1>Career paths</h1>
      <p className="muted">Generated from each course's description and syllabus. Pick a career to see which courses build toward it.</p>
      <input placeholder="Search careers" value={q} onChange={e => setParams(e.target.value ? { q: e.target.value } : {})} />
      {rows.map(c => (
        <details key={c.title} className="career" open={rows.length <= 3}>
          <summary><b>{c.title}</b> <span className="muted small">{c.course_count} courses</span></summary>
          <ul>
            {[...c.courses].sort((a, b) => rank(a.relevance) - rank(b.relevance)).map(x => (
              <li key={x.course_code}>
                <Link to={courseLink(x.course_code)}>{x.course_code} {x.title}</Link>{' '}
                <span className={`tag ${x.relevance}`}>{x.relevance}</span>
                <div className="small muted">{x.why}</div>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </>
  )
}

const rank = (r: string) => ({ high: 0, medium: 1, low: 2 } as Record<string, number>)[r] ?? 3
