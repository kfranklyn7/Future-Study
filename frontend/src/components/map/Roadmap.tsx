import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/style.css'

import { ELECTIVES_NEEDED, mapEdges, mapNodeById, mapNodes, trackStyle, type Track } from '#/data/csMap'
import { CourseNode, NODE_WIDTH, type CourseFlowNode, type NodeStatus } from '#/components/map/CourseNode'
import { CourseDrawer } from '#/components/map/CourseDrawer'
import { useTheme } from '#/theme'


const nodeTypes: NodeTypes = { course: CourseNode }

const DRAWER_WIDTH = 460

const STORAGE_KEY = 'future-study:map:v1'

type Progress = {
  status: Record<string, 'done' | 'progress'>
  electives: string[]
}

const emptyProgress: Progress = { status: {}, electives: [] }

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyProgress
    const parsed = JSON.parse(raw) as Partial<Progress>
    return { status: parsed.status ?? {}, electives: parsed.electives ?? [] }
  } catch {
    return emptyProgress
  }
}

function saveProgress(p: Progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    // Storage blocked (private mode etc.): progress just won't persist.
  }
}

const parentsOf = (id: string) => {
  const def = mapNodeById[id]
  return [...def.requires, ...(def.softRequires ?? [])]
}
const childrenOf = (id: string) => mapEdges.filter((e) => e.source === id).map((e) => e.target)

function ancestors(id: string, acc = new Set<string>()) {
  for (const p of parentsOf(id)) {
    if (!acc.has(p)) {
      acc.add(p)
      ancestors(p, acc)
    }
  }
  return acc
}

export function Roadmap() {
  const theme = useTheme()
  const dark = theme === 'dark'
  const [progress, setProgress] = useState<Progress>(emptyProgress)
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // True during the landing entrance, so the first chips wait for the card to arrive.
  const [intro, setIntro] = useState(true)
  useEffect(() => {
    // Long enough that no entrance chip is still mid-animation when its delay drops.
    const t = window.setTimeout(() => setIntro(false), 2500)
    return () => window.clearTimeout(t)
  }, [])
  const [hoverId, setHoverId] = useState<string | null>(null)
  // Clearing hover waits a moment so moving from one box to the next doesn't flash the
  // whole map back to undimmed in between.
  const hoverTimer = useRef<number | undefined>(undefined)
  const hoverEnter = (id: string) => {
    window.clearTimeout(hoverTimer.current)
    setHoverId(id)
  }
  const hoverLeave = () => {
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setHoverId(null), 120)
  }
  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])
  const [rf, setRf] = useState<ReactFlowInstance<CourseFlowNode, Edge> | null>(null)

  // Fit the whole map once the layout has settled, and again when the window resizes.
  useEffect(() => {
    if (!rf) return
    const fit = () => rf.fitView({ padding: '24px' })
    const frame = requestAnimationFrame(fit)
    window.addEventListener('resize', fit)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', fit)
    }
  }, [rf])

  // If the drawer would cover the selected box, slide the map left so the box stays visible.
  useEffect(() => {
    if (!rf || !selectedId) return
    const def = mapNodeById[selectedId]
    const right = rf.flowToScreenPosition({ x: def.x + NODE_WIDTH, y: def.y }).x
    const drawerLeft = window.innerWidth - Math.min(DRAWER_WIDTH, window.innerWidth)
    if (drawerLeft < 240 || right + 24 <= drawerLeft) return // phone: drawer is full width
    const zoom = rf.getZoom()
    const visibleCenter = drawerLeft / 2
    const offset = (window.innerWidth / 2 - visibleCenter) / zoom
    rf.setCenter(def.x + NODE_WIDTH / 2 + offset, def.y + 30, { zoom, duration: 350 })
  }, [rf, selectedId])

  useEffect(() => {
    setProgress(loadProgress())
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (loaded) saveProgress(progress)
  }, [progress, loaded])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelectedId(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const statusOf = useCallback(
    (id: string): NodeStatus => {
      if (mapNodeById[id].track === 'elective') {
        const n = progress.electives.length
        if (n >= ELECTIVES_NEEDED) return 'done'
        if (n > 0) return 'progress'
      } else {
        const s = progress.status[id]
        if (s) return s
      }
      return parentsOf(id).every((p) => statusOf(p) === 'done') ? 'available' : 'locked'
    },
    [progress],
  )

  // Hovering or selecting a box lights up everything it depends on plus what it unlocks next.
  const focusId = hoverId ?? selectedId
  const focusSet = useMemo(() => {
    if (!focusId) return null
    return new Set([focusId, ...ancestors(focusId), ...childrenOf(focusId)])
  }, [focusId])

  const nodes: CourseFlowNode[] = useMemo(
    () =>
      mapNodes.map((def) => ({
        id: def.id,
        type: 'course',
        position: { x: def.x, y: def.y },
        data: {
          def,
          status: statusOf(def.id),
          selected: def.id === selectedId,
          highlighted: !!focusSet?.has(def.id) && def.id !== focusId,
          dimmed: !!focusSet && !focusSet.has(def.id),
          electivesPicked: progress.electives.length,
        },
      })),
    [statusOf, selectedId, focusSet, focusId, progress.electives.length],
  )

  const edges: Edge[] = useMemo(
    () =>
      mapEdges.map((e) => {
        const lit =
          !!focusId &&
          !!focusSet &&
          focusSet.has(e.source) &&
          focusSet.has(e.target) &&
          (e.target === focusId || e.source === focusId || ancestors(focusId).has(e.target))
        const done = statusOf(e.source) === 'done' && statusOf(e.target) === 'done'
        const color = lit ? (dark ? '#d0627f' : '#8a1538') : done ? '#2f8f46' : dark ? '#968b80' : '#44403c'
        return {
          id: `${e.source}->${e.target}`,
          source: e.source,
          target: e.target,
          type: 'default',
          animated: lit,
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
          style: {
            stroke: color,
            strokeWidth: lit ? 2.5 : 1.5,
            strokeDasharray: e.dashed ? '6 5' : undefined,
            opacity: focusId && !lit ? 0.15 : 1,
          },
        }
      }),
    [focusId, focusSet, statusOf, dark],
  )

  const doneCount = mapNodes.filter((n) => statusOf(n.id) === 'done').length
  const nextUp = mapNodes.filter((n) => statusOf(n.id) === 'available')
  const pct = Math.round((doneCount / mapNodes.length) * 100)
  const takingCount = mapNodes.filter((n) => statusOf(n.id) === 'progress').length
  const hasProgress = Object.keys(progress.status).length > 0 || progress.electives.length > 0

  const selected = selectedId ? mapNodeById[selectedId] : null

  const setStatus = (id: string, s: 'done' | 'progress' | null) =>
    setProgress((p) => {
      const status = { ...p.status }
      if (s) status[id] = s
      else delete status[id]
      return { ...p, status }
    })

  const toggleElective = (code: string) =>
    setProgress((p) => ({
      ...p,
      electives: p.electives.includes(code) ? p.electives.filter((c) => c !== code) : [...p.electives, code],
    }))

  return (
    <div className="bg-map text-stone-900">
      <header className="z-10 border-b border-stone-200 px-4 pt-6 pb-5 sm:px-6">
        <div
          className="mx-auto grid max-w-5xl gap-6 rounded-2xl border border-stone-200 bg-panel p-5 shadow-[0_1px_2px_rgb(0_0_0/0.05)] motion-safe:animate-rise sm:p-6 md:grid-cols-[auto_1fr] md:items-center md:gap-0"
          style={{ animationDelay: '180ms' }}
        >
          <div className="flex items-center gap-5 md:pr-8">
            <ProgressRing pct={pct} />
            <div>
              <h2 className="text-sm font-medium text-stone-500">BS in Computer Science</h2>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-stone-900">
                {doneCount}
                <span className="text-stone-400"> / {mapNodes.length}</span>
              </p>
              <p className="text-sm text-stone-600">
                courses done
                {takingCount > 0 && <span className="text-amber-700"> · {takingCount} in progress</span>}
              </p>
            </div>
          </div>

          <div className="border-t border-stone-200 pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-8">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-base font-semibold text-stone-900">Up next</h3>
              {hasProgress && (
                <button
                  onClick={() => {
                    if (confirm('Clear all progress on this map? This cannot be undone.')) setProgress(emptyProgress)
                  }}
                  className="text-sm text-stone-500 transition-colors hover:text-accent"
                >
                  Reset progress
                </button>
              )}
            </div>
            {nextUp.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {nextUp.map((n, i) => (
                  <button
                    key={n.id}
                    onClick={() => setSelectedId(n.id)}
                    className="flex items-center gap-2 rounded-lg border border-stone-200 bg-panel-muted px-3 py-1.5 text-sm font-medium text-stone-800 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent motion-safe:animate-rise"
                    style={{ animationDelay: `${(intro ? 420 : 0) + i * 60}ms` }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-sm border"
                      style={{ background: trackStyle[n.track].bg, borderColor: trackStyle[n.track].border }}
                    />
                    {n.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-stone-600">
                {doneCount === mapNodes.length ? 'Every course on the map is done.' : 'Finish the courses in progress to unlock more.'}
              </p>
            )}
          </div>
        </div>
        <Legend />
      </header>

      {/* The map gets a full screen of height to itself, below the progress card. */}
      <div className="relative h-[calc(100vh-3.5rem)] min-h-[520px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={setRf}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onNodeMouseEnter={(_, node) => hoverEnter(node.id)}
          onNodeMouseLeave={hoverLeave}
          onPaneClick={() => setSelectedId(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          style={{ colorScheme: theme }}
          zoomOnScroll={false}
          preventScrolling={false}
          fitView
          fitViewOptions={{ padding: '24px' }}
          minZoom={0.3}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color={dark ? '#4a433c' : '#d6d3d1'} />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>

        {selected && (
          <CourseDrawer
            key={selected.id}
            def={selected}
            status={statusOf(selected.id)}
            pickedElectives={progress.electives}
            onSetStatus={(s) => setStatus(selected.id, s)}
            onToggleElective={toggleElective}
            onSelect={setSelectedId}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  )
}

function ProgressRing({ pct }: { pct: number }) {
  const size = 88
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r

  // Shown value eases toward pct. The first fill waits for the card's entrance to finish.
  const [shown, setShown] = useState(0)
  const shownRef = useRef(0)
  const mountedAt = useRef(0)
  useEffect(() => {
    if (!mountedAt.current) mountedAt.current = performance.now()
    if (prefersReducedMotion()) {
      shownRef.current = pct
      setShown(pct)
      return
    }
    const from = shownRef.current
    const delay = Math.max(0, mountedAt.current + 500 - performance.now())
    let raf = 0
    const timer = window.setTimeout(() => {
      let start = 0
      const step = (t: number) => {
        if (!start) start = t
        const k = Math.min(1, (t - start) / 900)
        const v = from + (pct - from) * (1 - Math.pow(1 - k, 3))
        shownRef.current = v
        setShown(v)
        if (k < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }, delay)
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
  }, [pct])

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${pct}% done`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-stone-200" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#16a34a"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ opacity: shown > 0.5 ? 1 : 0 }}
        />
      </svg>
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-lg font-semibold text-stone-800 tabular-nums">
        {Math.round(shown)}%
      </span>
    </div>
  )
}

const legendTracks: Track[] = ['math', 'core', 'programming', 'english']

function Legend() {
  return (
    <div
      className="mx-auto mt-4 flex max-w-5xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-stone-700 motion-safe:animate-rise"
      style={{ animationDelay: '300ms' }}
    >
      <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {legendTracks.map((t) => (
          <li key={t} className="flex items-center gap-2">
            <span
              className="inline-block h-3.5 w-5 rounded-sm border-2"
              style={{ background: trackStyle[t].bg, borderColor: trackStyle[t].border }}
            />
            {trackStyle[t].label}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-5 rounded-sm border-2 border-done-line bg-done" />
          Done
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-5 rounded-sm border-2 border-dashed border-stone-500 bg-stone-100" />
          Locked (prereqs left)
        </li>
        <li className="flex items-center gap-2">
          <svg width="20" height="8">
            <line x1="0" y1="4" x2="20" y2="4" className="stroke-stone-700" strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          Leads to (electives)
        </li>
      </ul>
      <p className="text-stone-500">Click a course to see details and mark it done.<span className="hidden md:inline"> Ctrl + scroll to zoom.</span></p>
    </div>
  )
}
