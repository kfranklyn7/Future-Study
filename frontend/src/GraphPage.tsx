import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import '@xyflow/react/dist/style.css'
import { api, courseLink, type GraphData } from './api'
import { Status, useData } from './hooks'

const W = 190, H = 54

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
    const cls = !n.in_catalog ? 'external' : n.in_scope ? (n.division === 'Graduate' ? 'grad' : 'ugrad') : 'prereq'
    return {
      id: n.id,
      position: { x: p.x - W / 2, y: p.y - H / 2 },
      data: { label: <div><b>{n.id}</b><div className="node-title">{n.title ?? 'outside CISC'}</div></div> },
      className: `node ${cls}`,
      style: { width: W },
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

export default function GraphPage() {
  const [params, setParams] = useSearchParams()
  const program = params.get('program') ?? 'computer-science-bs'
  const navigate = useNavigate()
  const { data: programs } = useData(api.programs, [])
  const { data, error } = useData(() => api.graph(program === 'all' ? '' : program), [program])
  const flow = useMemo(() => (data ? layout(data) : null), [data])

  return (
    <>
      <h1>Course map</h1>
      <div className="row toolbar">
        <select value={program} onChange={e => setParams({ program: e.target.value })}>
          <option value="all">Entire CISC catalog</option>
          {programs?.map(p => <option key={p.program_id} value={p.program_id}>{p.title}</option>)}
        </select>
        <span className="legend">
          <i className="node ugrad" /> undergrad <i className="node grad" /> graduate
          <i className="node prereq" /> prerequisite from outside program <i className="node external" /> non-CISC
        </span>
      </div>
      <p className="muted small">Arrows point from a prerequisite to the course that needs it; dashed means corequisite. Click a course for details.
        Edges show every course mentioned in the prerequisite text, not the exact and/or rule.</p>
      {!flow ? <Status error={error} /> : (
        <div className="graph">
          <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView minZoom={0.1} nodesConnectable={false}
            onNodeClick={(_, n) => navigate(courseLink(n.id))}>
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      )}
    </>
  )
}
