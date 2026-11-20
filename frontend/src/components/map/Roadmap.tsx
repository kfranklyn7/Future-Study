import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  getViewportForBounds,
  type Edge,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/style.css'

import { legacyIds, trackStyle, type MapNodeDef, type Track } from '#/data/csMap'
import { alternativesOf, courseInfo, slotOf, withChosen, type ProgramMap } from '#/data/programMaps'
import { CourseNode, NODE_WIDTH, type CourseFlowNode, type NodeStatus } from '#/components/map/CourseNode'
import { CourseDrawer } from '#/components/map/CourseDrawer'
import { useTheme } from '#/theme'


const nodeTypes: NodeTypes = { course: CourseNode }

const DRAWER_WIDTH = 460
const MIN_ZOOM = 0.3
const MAX_ZOOM = 1.8

type Progress = {
  status: Record<string, 'done' | 'progress'>
  /** Chosen courses in pick boxes, as "<pick box id>:<course code>". */
  electives: string[]
}

const emptyProgress: Progress = { status: {}, electives: [] }

function loadProgress(map: ProgramMap): Progress {
  try {
    const raw = localStorage.getItem(map.storageKey)
    if (!raw) return emptyProgress
    const parsed = JSON.parse(raw) as Partial<Progress>
    const known = new Set(map.nodes.map((n) => n.id))
    // Saved before "take one of these" boxes were split up: move to the first option.
    const status = Object.fromEntries(
      Object.entries(parsed.status ?? {})
        .map(([id, s]) => [legacyIds[id] ?? id, s] as const)
        // Chosen-elective boxes are "<pick box id>:<course code>".
        .filter(([id]) => known.has(id.split(':')[0])),
    )
    // Older saves listed bare elective codes; they all belonged to the CS map's electives box.
    const electives = (parsed.electives ?? []).map((e) => (e.includes(':') ? e : `electives:${e}`))
    return { status, electives }
  } catch {
    return emptyProgress
  }
}

function saveProgress(map: ProgramMap, p: Progress) {
  try {
    localStorage.setItem(map.storageKey, JSON.stringify(p))
  } catch {
    // Storage blocked (private mode etc.): progress just won't persist.
  }
}

type Graph = {
  nodes: MapNodeDef[]
  byId: Record<string, MapNodeDef>
  edges: { source: string; target: string; dashed: boolean }[]
}

// The map's boxes plus one box per course chosen in a pick box (the electives).
function buildGraph(map: ProgramMap, picked: string[]): Graph {
  const nodes = withChosen(map, picked, NODE_WIDTH)
  const edges = nodes.flatMap((n) => [
    ...n.requires.map((src) => ({ source: src, target: n.id, dashed: false })),
    ...(n.softRequires ?? []).map((src) => ({ source: src, target: n.id, dashed: true })),
  ])
  return { nodes, byId: Object.fromEntries(nodes.map((n) => [n.id, n])), edges }
}

const parentsOf = (g: Graph, id: string) => {
  const def = g.byId[id]
  return def ? [...def.requires, ...(def.softRequires ?? [])] : []
}
const childrenOf = (g: Graph, id: string) => g.edges.filter((e) => e.source === id).map((e) => e.target)

function ancestors(g: Graph, id: string, acc = new Set<string>()) {
  for (const p of parentsOf(g, id)) {
    if (!acc.has(p)) {
      acc.add(p)
      ancestors(g, p, acc)
    }
  }
  return acc
}

/** One program's course map. Remount it (key by map id) when switching maps. */
export function Roadmap({ map, picker }: { map: ProgramMap; picker?: ReactNode }) {
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
  const graph = useMemo(() => buildGraph(map, progress.electives), [map, progress.electives])

  // Fit the whole map once the layout has settled, and again when the window resizes. While the
  // course drawer is open, fit it into the space left of the drawer so the drawer covers nothing.
  const drawerOpen = !!selectedId
  const mapRef = useRef<HTMLDivElement>(null)
  const wasDrawerOpen = useRef(drawerOpen)
  useEffect(() => {
    if (!rf) return
    const toggled = wasDrawerOpen.current !== drawerOpen
    wasDrawerOpen.current = drawerOpen
    // Computed here and applied with setViewport: rf.fitView only queues a fit for React Flow's
    // next node update, so it doesn't reliably move the map right away.
    const fit = (duration?: number) => {
      const box = mapRef.current
      if (!box) return
      const { width, height } = box.getBoundingClientRect()
      const room = drawerOpen && width - DRAWER_WIDTH >= 240 // phone: the drawer is full width, so leave the map be
      const padding = room ? { top: 24, bottom: 24, left: 24, right: DRAWER_WIDTH + 24 } : 24 // pixels
      // Bounds from our own layout plus each box's rendered size. rf.getNodesBounds can't be
      // used here: React Flow drops its measured sizes when the nodes prop is rebuilt (which
      // happens on every selection), so it would count every box as 0 x 0.
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
      for (const def of graph.nodes) {
        const el = box.querySelector<HTMLElement>(`.react-flow__node[data-id="${def.id}"]`)
        x1 = Math.min(x1, def.x)
        y1 = Math.min(y1, def.y)
        x2 = Math.max(x2, def.x + (el?.offsetWidth || NODE_WIDTH))
        y2 = Math.max(y2, def.y + (el?.offsetHeight || 60))
      }
      const bounds = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
      void rf.setViewport(getViewportForBounds(bounds, width, height, MIN_ZOOM, MAX_ZOOM, padding), { duration })
    }
    const onResize = () => fit()
    // First load: let React Flow fit once the boxes have been measured. Drawer open/close: slide.
    const frame = requestAnimationFrame(() =>
      toggled ? fit(prefersReducedMotion() ? undefined : 350) : void rf.fitView({ padding: '24px' }),
    )
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [rf, drawerOpen, graph])

  // Picking another course while the drawer is open: if the user has zoomed in and the drawer
  // covers that box, slide the map left so the box stays visible.
  const prevSelected = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevSelected.current
    prevSelected.current = selectedId
    if (!rf || !selectedId || !prev) return
    const def = graph.byId[selectedId]
    if (!def) return
    const right = rf.flowToScreenPosition({ x: def.x + NODE_WIDTH, y: def.y }).x
    const drawerLeft = window.innerWidth - Math.min(DRAWER_WIDTH, window.innerWidth)
    if (drawerLeft < 240 || right + 24 <= drawerLeft) return // phone: drawer is full width
    const zoom = rf.getZoom()
    const visibleCenter = drawerLeft / 2
    const offset = (window.innerWidth / 2 - visibleCenter) / zoom
    rf.setCenter(def.x + NODE_WIDTH / 2 + offset, def.y + 30, { zoom, duration: 350 })
  }, [rf, selectedId, graph])

  useEffect(() => {
    setProgress(loadProgress(map))
    setLoaded(true)
  }, [map])
  useEffect(() => {
    if (loaded) saveProgress(map, progress)
  }, [map, progress, loaded])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelectedId(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const statusOf = useCallback(
    (id: string): NodeStatus => {
      const def = graph.byId[id]
      if (def?.pick) {
        // A pick box is done once enough of its chosen courses are done.
        const chosen = graph.nodes.filter((n) => n.pickedFrom === id)
        const done = chosen.filter((n) => progress.status[n.id] === 'done').length
        if (done >= def.pick.count) return 'done'
        if (chosen.length > 0) return 'progress'
      } else {
        const s = progress.status[id]
        if (s) return s
      }
      // A prerequisite with alternatives ("CISC 1115 or 1170") is met when any of them is done.
      const met = (p: string) =>
        statusOf(p) === 'done' ||
        (!!graph.byId[p] && alternativesOf(graph.nodes, graph.byId[p]).some((a) => statusOf(a.id) === 'done'))
      return parentsOf(graph, id).every(met) ? 'available' : 'locked'
    },
    [progress, graph],
  )

  // Hovering or selecting a box lights up everything it depends on plus what it unlocks next.
  const focusId = hoverId ?? selectedId
  const focusSet = useMemo(() => {
    if (!focusId) return null
    return new Set([focusId, ...ancestors(graph, focusId), ...childrenOf(graph, focusId)])
  }, [focusId, graph])

  const nodes: CourseFlowNode[] = useMemo(
    () =>
      graph.nodes.map((def) => ({
        id: def.id,
        type: 'course',
        position: { x: def.x, y: def.y },
        data: {
          def,
          status: statusOf(def.id),
          selected: def.id === selectedId,
          highlighted: !!focusSet?.has(def.id) && def.id !== focusId,
          dimmed: !!focusSet && !focusSet.has(def.id),
          electivesPicked: graph.nodes.filter((n) => n.pickedFrom === def.id && progress.status[n.id] === 'done').length,
          alternatives: alternativesOf(graph.nodes, def).flatMap((a) => a.codes),
        },
      })),
    [graph, statusOf, selectedId, focusSet, focusId, progress.status],
  )

  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const lit =
          !!focusId &&
          !!focusSet &&
          focusSet.has(e.source) &&
          focusSet.has(e.target) &&
          (e.target === focusId || e.source === focusId || ancestors(graph, focusId).has(e.target))
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
    [graph, focusId, focusSet, statusOf, dark],
  )

  // Progress counts requirements, not boxes: a "take one of these" group is one requirement,
  // done when any of its boxes is done.
  const slots = useMemo(() => [...new Set(map.nodes.map(slotOf))], [map])
  const slotStatus = (slot: string): NodeStatus => {
    const members = map.nodes.filter((n) => slotOf(n) === slot).map((n) => statusOf(n.id))
    return members.includes('done') ? 'done' : members.includes('progress') ? 'progress' : members[0]
  }
  const doneCount = slots.filter((s) => slotStatus(s) === 'done').length
  // Skip an alternative once another box in its group is done or being taken. Chosen
  // electives count toward their pick box, so they aren't slots of their own.
  const nextUp = graph.nodes.filter(
    (n) =>
      statusOf(n.id) === 'available' &&
      !(n.pick && graph.nodes.some((c) => c.pickedFrom === n.id)) &&
      alternativesOf(graph.nodes, n).every((a) => !progress.status[a.id]),
  )
  const pct = Math.round((doneCount / slots.length) * 100)
  const takingCount = slots.filter((s) => slotStatus(s) === 'progress').length
  const hasProgress = Object.keys(progress.status).length > 0 || progress.electives.length > 0

  // Live credit totals from the boxes marked Done or Taking now. Pick boxes have no course of
  // their own; their chosen-course boxes carry the credits. Courses with no credits listed in
  // the catalog are counted separately rather than guessed.
  const credits = useMemo(() => {
    let earned = 0, taking = 0, unknown = 0
    for (const n of graph.nodes) {
      const s = progress.status[n.id]
      if (!s || n.pick) continue
      const value = n.codes.reduce<number | null>((sum, c) => {
        const cr = courseInfo(c)?.credits
        return sum === null || cr == null ? null : sum + cr
      }, 0)
      if (value === null) unknown++
      else if (s === 'done') earned += value
      else taking += value
    }
    return { earned, applied: earned + taking, unknown }
  }, [graph, progress.status])

  const selected = selectedId ? (graph.byId[selectedId] ?? null) : null

  const setStatus = (id: string, s: 'done' | 'progress' | null) =>
    setProgress((p) => {
      const status = { ...p.status }
      if (s) status[id] = s
      else delete status[id]
      return { ...p, status }
    })

  // Unchecking an elective removes its box, so drop its status too.
  const toggleElective = (fromId: string, code: string) =>
    setProgress((p) => {
      const id = `${fromId}:${code}`
      const picked = p.electives.includes(id)
      const status = { ...p.status }
      if (picked) delete status[id]
      return {
        status,
        electives: picked ? p.electives.filter((c) => c !== id) : [...p.electives, id],
      }
    })

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
              {picker ?? <h2 className="text-sm font-medium text-stone-500">{map.title}</h2>}
              {map.subtitle && <p className="mt-0.5 text-xs text-stone-500">{map.subtitle}</p>}
              <p className="mt-1 text-3xl font-semibold tracking-tight text-stone-900">
                {doneCount}
                <span className="text-stone-400"> / {slots.length}</span>
              </p>
              <p className="text-sm text-stone-600">
                courses done
                {takingCount > 0 && <span className="text-amber-700"> · {takingCount} in progress</span>}
              </p>
              <dl className="mt-2 flex gap-4 text-sm">
                <div>
                  <dt className="text-xs text-stone-500">Credits earned</dt>
                  <dd className="font-semibold text-stone-900 tabular-nums">{fmtCredits(credits.earned)}</dd>
                </div>
                <div title="Credits earned plus credits for courses you're taking now">
                  <dt className="text-xs text-stone-500">Credits applied</dt>
                  <dd className="font-semibold text-amber-700 tabular-nums">{fmtCredits(credits.applied)}</dd>
                </div>
              </dl>
              {credits.unknown > 0 && (
                <p className="mt-1 text-xs text-stone-500">
                  {credits.unknown} marked course{credits.unknown === 1 ? ' has' : 's have'} no credits listed, not counted
                </p>
              )}
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
                {doneCount === slots.length ? 'Every course on the map is done.' : 'Finish the courses in progress to unlock more.'}
              </p>
            )}
          </div>
        </div>
        <Legend tracks={[...new Set(map.nodes.map((n) => n.track))].filter((t) => t !== 'elective')} />
      </header>

      {/* The map gets a full screen of height to itself, below the progress card. */}
      <div ref={mapRef} className="relative h-[calc(100vh-3.5rem)] min-h-[520px]">
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
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color={dark ? '#4a433c' : '#d6d3d1'} />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>

        {selected && (
          <CourseDrawer
            key={selected.id}
            def={selected}
            status={statusOf(selected.id)}
            pickedElectives={progress.electives
              .filter((p) => p.startsWith(`${selected.id}:`))
              .map((p) => p.slice(selected.id.length + 1))}
            alternatives={alternativesOf(graph.nodes, selected)}
            onSetStatus={(s) => setStatus(selected.id, s)}
            onToggleElective={(code) => toggleElective(selected.pickedFrom ?? selected.id, code)}
            onSelect={setSelectedId}
            nodeLabel={(id) => graph.byId[id]?.label ?? id}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  )
}

// Catalog credits can be fractional (e.g. 4.5); show whole numbers without a decimal.
const fmtCredits = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

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

function Legend({ tracks }: { tracks: Track[] }) {
  return (
    <div
      className="mx-auto mt-4 flex max-w-5xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-stone-700 motion-safe:animate-rise"
      style={{ animationDelay: '300ms' }}
    >
      <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {tracks.map((t) => (
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
