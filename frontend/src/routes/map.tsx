import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import '#/components/map/map.css'

export const Route = createFileRoute('/map')({
  component: MapPage,
})

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

function MapPage() {
  const [progress, setProgress] = useState<Progress>(emptyProgress)
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [rf, setRf] = useState<ReactFlowInstance<CourseFlowNode, Edge> | null>(null)

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
        const color = lit ? '#4f46e5' : done ? '#2f8f46' : '#44403c'
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
    [focusId, focusSet, statusOf],
  )

  const doneCount = mapNodes.filter((n) => statusOf(n.id) === 'done').length
  const nextUp = mapNodes.filter((n) => statusOf(n.id) === 'available').map((n) => n.label)
  const pct = Math.round((doneCount / mapNodes.length) * 100)

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
    <div className="fs-map flex h-[calc(100vh-190px)] min-h-[560px] flex-col overflow-hidden rounded-xl border border-stone-200 bg-[#faf8f3] text-stone-900">
      <header className="z-10 border-b border-stone-200 bg-white px-6 py-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-xs font-semibold tracking-wider text-indigo-600 uppercase">
              Brooklyn College · Computer and Information Science
            </p>
            <h1 className="text-2xl font-bold">BS in Computer Science roadmap</h1>
          </div>

          <div className="min-w-[240px] flex-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold">
                {doneCount} of {mapNodes.length} done
              </span>
              <span className="text-stone-500">{pct}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-200">
              <div className="h-full rounded-full bg-green-600 transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 truncate text-xs text-stone-500">
              {nextUp.length ? (
                <>
                  <span className="font-semibold text-stone-700">You can take next:</span> {nextUp.join(', ')}
                </>
              ) : (
                'Nothing left to unlock.'
              )}
            </p>
          </div>

          <button
            onClick={() => {
              if (confirm('Clear all progress on this map?')) setProgress(emptyProgress)
            }}
            className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Reset progress
          </button>
        </div>
        <Legend />
      </header>

      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={setRf}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onNodeMouseEnter={(_, node) => setHoverId(node.id)}
          onNodeMouseLeave={() => setHoverId(null)}
          onPaneClick={() => setSelectedId(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          style={{ colorScheme: 'light' }}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.3}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#d6d3d1" />
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

const legendTracks: Track[] = ['math', 'core', 'programming', 'english']

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-stone-700">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
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
          <span className="inline-block h-3.5 w-5 rounded-sm border-2 border-green-700 bg-[#d9f2dc]" />
          Done
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-5 rounded-sm border-2 border-dashed border-stone-500 bg-stone-100" />
          Locked (prereqs left)
        </li>
        <li className="flex items-center gap-2">
          <svg width="20" height="8">
            <line x1="0" y1="4" x2="20" y2="4" stroke="#44403c" strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          Leads to (electives)
        </li>
      </ul>
      <p className="text-stone-500">Click a box for details, free resources, and to mark it done.</p>
    </div>
  )
}
