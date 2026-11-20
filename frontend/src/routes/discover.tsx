import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { api, type Recommendation, type SearchHit } from '#/api'
import { CourseLink, DIVISIONS } from '#/components'

export const Route = createFileRoute('/discover')({ component: Discover })

// Suggestions rotate through the chips below the composer, one chip at a time.
const POOL = [
  'machine learning', 'cybersecurity', 'web development', 'databases and data engineering', 'video games',
  'I want to build mobile apps', 'how do compilers work?', 'AI for healthcare', 'cloud and DevOps',
  'computer graphics and 3D', 'startups and product engineering', 'robotics', 'ethical hacking',
  'data science with Python', 'operating systems internals', 'networks and the internet',
]
const VISIBLE = 4
const STATUS = ['Reading syllabi…', 'Matching your interests…', 'Ranking courses…', 'Writing reasons…']

type Turn = {
  id: number
  query: string
  division: string
  status: 'loading' | 'done' | 'error'
  recs?: Recommendation[]
  hits?: SearchHit[]
  error?: string
}

function Discover() {
  const [text, setText] = useState('')
  const [division, setDivision] = useState('Undergraduate')
  const [turns, setTurns] = useState<Turn[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const busy = turns.some(t => t.status === 'loading')
  const started = turns.length > 0

  useEffect(() => {
    if (started) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, started])

  async function send(query: string) {
    const q = query.trim()
    if (!q || busy) return
    const id = Date.now()
    setTurns(ts => [...ts, { id, query: q, division, status: 'loading' }])
    setText('')
    try {
      const r = await api.recommend(q, division)
      setTurns(ts => ts.map(t => t.id === id ? { ...t, status: 'done', recs: r.recommendations, hits: r.candidates } : t))
    } catch (err) {
      setTurns(ts => ts.map(t => t.id === id ? { ...t, status: 'error', error: String(err) } : t))
    }
  }

  return (
    <div className="relative mx-auto max-w-4xl">
      {/* Warm glow behind the heading, like the landing hero. */}
      <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-80 w-[min(56rem,100%)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-accent)_22%,transparent),color-mix(in_oklab,var(--color-track-math)_35%,transparent)_60%,transparent)] blur-2xl motion-safe:animate-glow" />

      <header className={`text-center transition-all duration-500 ${started ? 'pt-0 pb-6' : 'pt-10 pb-10 sm:pt-16'}`}>
        <p className="text-xs font-semibold tracking-[0.2em] text-rose uppercase motion-safe:animate-rise">Course finder</p>
        <h1 id="discover-title" className={`mt-3 font-display font-semibold tracking-tight text-balance text-ink motion-safe:animate-rise ${started ? 'text-4xl' : 'text-5xl sm:text-7xl'}`} style={{ animationDelay: '80ms' }}>
          What do you want to learn?
        </h1>
        {!started && (
          <p className="mx-auto mt-5 max-w-xl text-lg text-ink-muted motion-safe:animate-rise" style={{ animationDelay: '160ms' }}>
            Describe topics, hobbies or career goals. We'll match them against every CISC course and syllabus.
          </p>
        )}
      </header>

      {started && (
        <div className="space-y-10 pb-8">
          {turns.map(t => <TurnView key={t.id} turn={t} onRetry={() => send(t.query)} />)}
          <div ref={endRef} />
        </div>
      )}

      <div className={started ? 'sticky bottom-4 z-10' : 'motion-safe:animate-rise'} style={started ? undefined : { animationDelay: '240ms' }}>
        <Composer
          inputRef={inputRef}
          text={text}
          setText={setText}
          division={division}
          setDivision={setDivision}
          busy={busy}
          onSend={() => send(text)}
        />
        {!started && <Suggestions onPick={s => { setText(s); inputRef.current?.focus() }} paused={text.length > 0} />}
      </div>
    </div>
  )
}

function Composer({ inputRef, text, setText, division, setDivision, busy, onSend }: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  text: string
  setText: (v: string) => void
  division: string
  setDivision: (v: string) => void
  busy: boolean
  onSend: () => void
}) {
  const canSend = text.trim().length > 0 && !busy
  return (
    <form
      onSubmit={e => { e.preventDefault(); onSend() }}
      className="group rounded-3xl border border-stone-200 bg-surface/95 p-3 shadow-[0_1px_2px_rgb(80_60_40/0.06),0_18px_40px_-18px_rgb(80_60_40/0.28)] backdrop-blur transition-[border-color,box-shadow] focus-within:border-accent/40 focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_12%,transparent),0_18px_40px_-18px_rgb(80_60_40/0.3)]"
    >
      <textarea
        ref={inputRef}
        aria-labelledby="discover-title"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
        rows={2}
        placeholder="I like building games and want to learn how 3D graphics work…"
        className="block max-h-60 min-h-16 w-full resize-none bg-transparent px-3 pt-2 text-lg text-stone-900 [field-sizing:content] placeholder:text-stone-400 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Level" className="flex rounded-full bg-stone-100 p-1 text-sm">
          {DIVISIONS.map(d => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={division === d}
              onClick={() => setDivision(d)}
              className={`cursor-pointer rounded-full px-3 py-1 font-medium transition-colors ${division === d ? 'bg-surface text-ink shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
            >
              {d || 'All'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-stone-400 sm:inline">Enter to send · Shift+Enter for a new line</span>
          <button
            aria-label="Recommend courses"
            disabled={!canSend}
            className={`grid size-11 cursor-pointer place-items-center rounded-full bg-accent text-white shadow-[0_6px_16px_-6px_var(--color-accent)] transition-all hover:scale-105 hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-default disabled:hover:scale-100 ${busy ? '' : 'disabled:bg-stone-300 disabled:shadow-none'}`}
          >
            {busy
              ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              : <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10h12M11 5l5 5-5 5" /></svg>}
          </button>
        </div>
      </div>
    </form>
  )
}

/** A row of chips that swap out one at a time: the old chip blurs away and a new one pops in. */
function Suggestions({ onPick, paused }: { onPick: (s: string) => void; paused: boolean }) {
  const [slots, setSlots] = useState(() => POOL.slice(0, VISIBLE).map((text, i) => ({ text, key: i, leaving: false })))
  const next = useRef(VISIBLE)
  const [hover, setHover] = useState(false)

  useEffect(() => {
    if (paused || hover) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let swap: ReturnType<typeof setTimeout> | undefined
    const tick = setInterval(() => {
      const i = Math.floor(Math.random() * VISIBLE)
      setSlots(s => s.map((x, j) => j === i ? { ...x, leaving: true } : x))
      swap = setTimeout(() => {
        setSlots(s => {
          const shown = new Set(s.map(x => x.text))
          let text = POOL[next.current % POOL.length]
          while (shown.has(text)) text = POOL[++next.current % POOL.length]
          next.current++
          return s.map((x, j) => j === i ? { text, key: Date.now(), leaving: false } : x)
        })
      }, 280)
    }, 2600)
    return () => { clearInterval(tick); clearTimeout(swap) }
  }, [paused, hover])

  return (
    <div
      className={`mt-5 flex min-h-10 flex-wrap justify-center gap-2 transition-opacity duration-300 ${paused ? 'opacity-40' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {slots.map(s => (
        <button
          key={s.key}
          type="button"
          onClick={() => onPick(s.text)}
          className={`group/chip inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-stone-200 bg-surface/80 px-4 py-2 text-sm font-medium text-stone-700 shadow-sm backdrop-blur transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent ${s.leaving ? 'motion-safe:animate-chip-out' : 'motion-safe:animate-chip-in'}`}
        >
          <svg viewBox="0 0 16 16" className="size-3.5 text-rose" fill="currentColor"><path d="M8 0l1.8 6.2L16 8l-6.2 1.8L8 16l-1.8-6.2L0 8l6.2-1.8z" /></svg>
          {s.text}
        </button>
      ))}
    </div>
  )
}

function Avatar() {
  return (
    <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink font-display text-sm font-semibold text-hero shadow-sm">
      fs
    </div>
  )
}

function TurnView({ turn, onRetry }: { turn: Turn; onRetry: () => void }) {
  const picked = new Set(turn.recs?.map(r => r.course_code))
  const others = (turn.hits ?? []).filter(h => !picked.has(h.course_code))
  return (
    <div className="space-y-6">
      <div className="flex justify-end motion-safe:animate-rise">
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-accent px-5 py-3 text-lg text-white shadow-[0_10px_24px_-14px_var(--color-accent)]">
          {turn.query}
          {turn.division && <span className="ml-2 align-middle text-xs font-semibold tracking-wide text-white/70 uppercase">· {turn.division}</span>}
        </div>
      </div>

      <div className="flex gap-3 sm:gap-4">
        <Avatar />
        <div className="min-w-0 flex-1 pt-1">
          {turn.status === 'loading' && <Typing />}
          {turn.status === 'error' && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-800 motion-safe:animate-rise">
              Couldn't get recommendations. <span className="text-sm opacity-80">{turn.error}</span>
              <button type="button" onClick={onRetry} className="ml-3 cursor-pointer font-semibold underline">Try again</button>
            </div>
          )}
          {turn.status === 'done' && turn.recs && (
            <div>
              <p className="text-lg text-stone-800 motion-safe:animate-rise">
                {turn.recs.length
                  ? <>Here {turn.recs.length === 1 ? 'is the course' : `are ${turn.recs.length} courses`} that fit best.</>
                  : 'No strong matches. Try describing it differently.'}
              </p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {turn.recs.map((r, i) => <RecCard key={r.course_code} rec={r} index={i} />)}
              </div>
              {others.length > 0 && (
                <div className="mt-8 motion-safe:animate-rise" style={{ animationDelay: `${turn.recs.length * 90 + 120}ms` }}>
                  <h3 className="mb-3 text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">Also related</h3>
                  <div className="flex flex-wrap gap-2">
                    {others.map(h => (
                      <CourseLink key={h.course_code} code={h.course_code} className="rounded-full border border-stone-200 bg-surface px-3.5 py-1.5 text-sm text-stone-700 transition-colors hover:border-accent/50 hover:text-accent hover:no-underline">
                        <span className="font-semibold">{h.course_code}</span> <span className="text-stone-500">{h.title}</span>
                      </CourseLink>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Typing() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI(n => (n + 1) % STATUS.length), 1600)
    return () => clearInterval(t)
  }, [])
  return (
    <div role="status" aria-live="polite" className="inline-flex items-center gap-4 rounded-2xl rounded-tl-md border border-stone-200 bg-surface px-5 py-4 shadow-sm motion-safe:animate-rise">
      <span className="flex items-center gap-1.5" aria-hidden>
        {[0, 1, 2].map(d => (
          <span key={d} className="size-2.5 rounded-full bg-accent motion-safe:animate-typing" style={{ animationDelay: `${d * 160}ms` }} />
        ))}
      </span>
      <span key={i} className="text-sm font-medium text-stone-600 motion-safe:animate-rise">{STATUS[i]}</span>
    </div>
  )
}

function RecCard({ rec, index }: { rec: Recommendation; index: number }) {
  const top = index === 0
  return (
    <div className={`flex motion-safe:animate-rise ${top ? 'md:col-span-2' : ''}`} style={{ animationDelay: `${index * 90}ms` }}>
    <CourseLink
      code={rec.course_code}
      className={`group relative flex w-full flex-col overflow-hidden rounded-3xl border bg-surface p-6 text-stone-900 shadow-[0_1px_2px_rgb(80_60_40/0.05),0_12px_28px_-20px_rgb(80_60_40/0.35)] transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-accent/50 hover:no-underline hover:shadow-[0_2px_4px_rgb(80_60_40/0.06),0_22px_40px_-20px_rgb(80_60_40/0.45)] sm:p-7 ${top ? 'border-accent/30' : 'border-stone-200'}`}
    >
      {top && <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_100%_0%,var(--color-accent-soft),transparent_60%)]" />}
      <div className="relative flex items-center gap-3">
        <span className="font-display text-3xl font-semibold text-rose/40 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
        <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold tracking-wide text-accent">{rec.course_code}</span>
        {top && <span className="ml-auto rounded-full bg-ink px-3 py-1 text-[11px] font-semibold tracking-wider text-hero uppercase">Top match</span>}
      </div>
      <h3 className={`relative mt-4 font-display font-semibold tracking-tight text-ink ${top ? 'text-3xl' : 'text-2xl'}`}>{rec.title}</h3>
      <p className={`relative mt-3 flex-1 leading-relaxed text-stone-700 ${top ? 'max-w-3xl text-lg' : ''}`}>{rec.reason}</p>
      <span className="relative mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
        View course
        <svg viewBox="0 0 20 20" className="size-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10h12M11 5l5 5-5 5" /></svg>
      </span>
    </CourseLink>
    </div>
  )
}
