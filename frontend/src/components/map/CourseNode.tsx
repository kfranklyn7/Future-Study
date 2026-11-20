import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { trackStyle, type MapNodeDef } from '#/data/csMap'

export type NodeStatus = 'done' | 'progress' | 'available' | 'locked'

export type CourseNodeData = {
  def: MapNodeDef
  status: NodeStatus
  selected: boolean
  dimmed: boolean
  highlighted: boolean
  electivesPicked?: number
}

export type CourseFlowNode = Node<CourseNodeData, 'course'>

export const NODE_WIDTH = 210

const hidden = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 'none' }

export function CourseNode({ data }: NodeProps<CourseFlowNode>) {
  const { def, status, selected, dimmed, highlighted, electivesPicked } = data
  const style = trackStyle[def.track]
  const done = status === 'done'

  return (
    <div
      className={[
        // No hover movement: shifting the box under the cursor makes it lose and regain hover in a loop.
        'relative cursor-pointer rounded-md border-2 px-3 py-2.5 text-center shadow-[3px_3px_0_rgba(0,0,0,0.18)] transition-[box-shadow,opacity] duration-150',
        'hover:shadow-[4px_5px_0_rgba(0,0,0,0.26)]',
        selected ? 'ring-4 ring-accent/50' : '',
        highlighted && !selected ? 'ring-2 ring-accent/35' : '',
        dimmed ? 'opacity-35' : status === 'locked' ? 'opacity-70' : '',
      ].join(' ')}
      style={{
        width: NODE_WIDTH,
        background: done ? 'var(--color-done)' : style.bg,
        borderColor: done ? 'var(--color-done-line)' : status === 'progress' ? '#d97706' : style.border,
        borderStyle: status === 'locked' ? 'dashed' : 'solid',
      }}
    >
      <Handle type="target" position={Position.Left} style={hidden} isConnectable={false} />
      <Handle type="source" position={Position.Right} style={hidden} isConnectable={false} />

      <StatusBadge status={status} />

      <div
        className={[
          'text-[15px] leading-tight font-bold tracking-wide text-stone-900 uppercase',
          done ? 'line-through decoration-2 decoration-green-700/70' : '',
        ].join(' ')}
      >
        {def.label}
      </div>
      {def.codes.length > 0 && (
        <div className="mt-1 text-[13px] font-semibold text-stone-700">
          {def.codes.join(' or ')}
        </div>
      )}
      {def.track === 'elective' && (
        <div className="mt-1 text-[13px] font-semibold text-stone-700">
          CISC 3000 to 4899 · {electivesPicked ?? 0}/3 picked
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: NodeStatus }) {
  if (status === 'done')
    return (
      <span className="absolute -top-2.5 -right-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white shadow">
        ✓
      </span>
    )
  if (status === 'progress')
    return (
      <span className="absolute -top-2.5 -right-2.5 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase shadow">
        Now
      </span>
    )
  if (status === 'locked')
    return (
      <span
        className="absolute -top-2.5 -right-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-stone-500 text-[11px] text-white shadow"
        title="Prerequisites not done yet"
        aria-label="Locked: prerequisites not done yet"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </span>
    )
  return null
}
