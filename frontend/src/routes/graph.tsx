import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import '@xyflow/react/style.css'
import { api, type GraphData } from '#/api'
import { Status, useData } from '#/hooks'

export const Route = createFileRoute('/graph')({
  validateSearch: (s: Record<string, unknown>): { program?: string } => ({
    program: typeof s.program === 'string' && s.program ? s.program : undefined,
  }),
  component: GraphPage,
})

const W = 190, H = 54

// Node colors by kind. Inline styles, because React Flow's CSS layer outranks Tailwind's.
type Kind = 'ugrad' | 'grad' | 'prereq' | 'external'
const KIND: Record<Kind, { label: string; background: string; borderColor: string; color: string; borderStyle?: string }> = {
  ugrad: { label: 'undergrad', background: '#fbeef2', borderColor: '#d98aa3', color: '#1c1917' },
  grad: { label: 'graduate', background: '#e9f0fd', borderColor: '#7da2e8', color: '#1c1917' },
  prereq: { label: 'prerequisite from outside program', background: '#f5f5f4', borderColor: '#a8a29e', color: '#1c1917' },
  external: { label: 'non-CISC', background: '#fff', borderColor: '#a8a29e', color: '#78716c', borderStyle: 'dashed' },
}

// Lay the prerequisite DAG out left-to-right with dagre.
function layout(g: GraphData): { nodes: Node[]; edges: Edge[] } {
  const d = new dagre.graphlib.Graph()
  d.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 70 })
  d.setDefaultEdgeLabel(() => ({}))
  g.nodes.forEach(n => d.setNode(n.id, { width: W, height: H }))
  g.edges.forEach(e => d.setEdge(e.source, e.target))
  dagre.layout(d)
  const nodes: Node[] = g.nodes.map(n => {
    const p = d.node(n.id)
    const kind: Kind = !n.in_catalog ? 'external' : n.in_scope ? (n.division === 'Graduate' ? 'grad' : 'ugrad') : 'prereq'
    const { label: _label, ...colors } = KIND[kind]
    return {
      id: n.id,
      position: { x: p.x - W / 2, y: p.y - H / 2 },
      data: { label: <div><b>{n.id}</b><div className="truncate">{n.title ?? 'outside CISC'}</div></div> },
      style: { width: W, borderRadius: 8, fontSize: 11, padding: '6px 8px', textAlign: 'left', cursor: 'pointer', borderWidth: 1, ...colors },
    }
  })
  const edges: Edge[] = g.edges.map(e => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    animated: e.relationship === 'corequisite',
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeDasharray: e.relationship === 'corequisite' ? '4 3' : undefined },
  }))
  return { nodes, edges }
}

function GraphPage() {
  const { program = 'computer-science-bs' } = Route.useSearch()
  const navigate = useNavigate()
  const { data: programs } = useData(api.programs, [])
  const { data, error } = useData(() => api.graph(program === 'all' ? '' : program), [program])
  const flow = useMemo(() => (data ? layout(data) : null), [data])

  return (
    <>
      <h1 className="page-title">All prerequisites</h1>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <select className="field" value={program} onChange={e => navigate({ to: '/graph', search: { program: e.target.value } })}>
          <option value="all">Entire CISC catalog</option>
          {programs?.map(p => <option key={p.program_id} value={p.program_id}>{p.title}</option>)}
        </select>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-500">
          {(Object.keys(KIND) as Kind[]).map(k => (
            <span key={k} className="flex items-center gap-1.5">
              <i className="inline-block h-3.5 w-3.5 rounded-sm border"
                style={{ background: KIND[k].background, borderColor: KIND[k].borderColor, borderStyle: KIND[k].borderStyle }} />
              {KIND[k].label}
            </span>
          ))}
        </span>
      </div>
      <p className="text-sm text-stone-500">Arrows point from a prerequisite to the course that needs it; dashed means corequisite. Click a course for details.
        Edges show every course mentioned in the prerequisite text, not the exact and/or rule.</p>
      {!flow ? <Status error={error} /> : (
        <div className="mt-3 h-[72vh] rounded-xl border border-stone-200 bg-white">
          <ReactFlow style={{ colorScheme: 'light' }} nodes={flow.nodes} edges={flow.edges} fitView minZoom={0.1} nodesConnectable={false}
            onNodeClick={(_, n) => navigate({ to: '/courses/$code', params: { code: n.id } })}>
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      )}
    </>
  )
}
