import { createFileRoute } from '@tanstack/react-router'
import { useState, useCallback } from 'react';
import { 
  ReactFlow, 
  addEdge, 
  type Node,
  type Edge,
  type FitViewOptions,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  type OnNodeDrag,
  type DefaultEdgeOptions,
} from '@xyflow/react';
import '@xyflow/react/style.css';

export const Route = createFileRoute('/graph')({
  component: RouteComponent,
})

const initialNodes = [
  { id: 'n1', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
  { id: 'n2', position: { x: 0, y: 100 }, data: { label: 'Node 2' } },
];
const initialEdges = [{ id: 'n1-n2', source: 'n1', target: 'n2' }];
 

function RouteComponent() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
 
  const onNodesChange: OnNodesChange = useCallback((changes) => setNodes((nodesSnapshot) => changes.applyTo(nodesSnapshot)), []);
  const onEdgesChange: OnEdgesChange = useCallback((changes) => setEdges((edgesSnapshot) => changes.applyTo(edgesSnapshot)), []);
  const onConnect: OnConnect = useCallback((params) => setEdges((edgesSnapshot) => addEdge(params, edgesSnapshot)), []);
 
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      />
    </div>
  );
}
