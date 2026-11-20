import { useState, type ReactNode } from 'react'
import {
  core,
  electives,
  ELECTIVES_NEEDED,
  mapNodeById,
  trackStyle,
  type CourseInfo,
  type MapNodeDef,
  type Resource,
} from '#/data/csMap'
import type { NodeStatus } from './CourseNode'

type Props = {
  def: MapNodeDef
  status: NodeStatus
  pickedElectives: string[]
  onSetStatus: (status: 'done' | 'progress' | null) => void
  onToggleElective: (code: string) => void
  onSelect: (id: string) => void
  onClose: () => void
}

const kindLabel: Record<Resource['kind'], string> = {
  course: 'Course',
  book: 'Book',
  tool: 'Tool',
  guide: 'Guide',
}

export function CourseDrawer({
  def,
  status,
  pickedElectives,
  onSetStatus,
  onToggleElective,
  onSelect,
  onClose,
}: Props) {
  const [tab, setTab] = useState(0)
  const options = def.codes.map((c) => core[c]).filter((c): c is CourseInfo => !!c)
  const course = options[Math.min(tab, options.length - 1)]
  const isElective = def.track === 'elective'
  const prereqIds = [...def.requires, ...(def.softRequires ?? [])]

  return (
    <aside
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[460px] flex-col border-l border-stone-300 bg-white shadow-2xl"
      aria-label={`${def.label} details`}
    >
      <header className="flex items-start gap-3 border-b border-stone-200 px-6 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-stone-500 uppercase">
            <span
              className="inline-block h-3 w-3 rounded-sm border"
              style={{ background: trackStyle[def.track].bg, borderColor: trackStyle[def.track].border }}
            />
            {trackStyle[def.track].label}
          </div>
          <h2 className="mt-1 text-2xl leading-tight font-bold text-stone-900">{def.label}</h2>
          {def.codes.length > 0 && (
            <p className="mt-0.5 text-sm font-medium text-stone-600">{def.codes.join(' or ')}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-xl leading-none text-stone-500 hover:bg-stone-100 hover:text-stone-900"
          aria-label="Close"
        >
          ×
        </button>
      </header>

      {!isElective && (
        <div className="flex gap-2 border-b border-stone-200 px-6 py-3">
          <StatusButton active={status === 'done'} color="green" onClick={() => onSetStatus(status === 'done' ? null : 'done')}>
            Done
          </StatusButton>
          <StatusButton
            active={status === 'progress'}
            color="amber"
            onClick={() => onSetStatus(status === 'progress' ? null : 'progress')}
          >
            Taking now
          </StatusButton>
          {status === 'locked' && (
            <span className="ml-auto self-center text-xs text-stone-500">Prerequisites not done yet</span>
          )}
        </div>
      )}

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {def.note && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{def.note}</p>
        )}

        {options.length > 1 && (
          <div className="flex gap-1 rounded-lg bg-stone-100 p-1">
            {options.map((o, i) => (
              <button
                key={o.code}
                onClick={() => setTab(i)}
                className={[
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium',
                  i === tab ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900',
                ].join(' ')}
              >
                {o.code}
              </button>
            ))}
          </div>
        )}

        {course ? (
          <CourseDetails course={course} />
        ) : (
          !isElective && (
            <p className="text-sm text-stone-600">
              Taught outside the CIS department. Check the Brooklyn College bulletin for the full description.
            </p>
          )
        )}

        {prereqIds.length > 0 && (
          <Section title="Comes after">
            <div className="flex flex-wrap gap-2">
              {prereqIds.map((id) => (
                <button
                  key={id}
                  onClick={() => onSelect(id)}
                  className="rounded-full border border-stone-300 px-3 py-1 text-sm text-stone-700 hover:border-accent/60 hover:text-accent"
                >
                  {mapNodeById[id].label}
                </button>
              ))}
            </div>
          </Section>
        )}

        {isElective && (
          <Section title={`Pick ${ELECTIVES_NEEDED} (${pickedElectives.length} picked)`}>
            <ul className="divide-y divide-stone-100 rounded-md border border-stone-200">
              {electives.map((e) => {
                const checked = pickedElectives.includes(e.code)
                return (
                  <li key={e.code}>
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-stone-50">
                      <input
                        type="checkbox"
                        className="mt-1 accent-green-600"
                        checked={checked}
                        onChange={() => onToggleElective(e.code)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-semibold text-stone-900">{e.code}</span>{' '}
                        <span className="text-sm text-stone-700">{e.title}</span>
                        {e.lastSeen && <span className="block text-xs text-stone-500">Last listed {e.lastSeen}</span>}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </Section>
        )}

        <Section title="Career paths">
          <div className="flex flex-wrap gap-2">
            {def.careers.map((c) => (
              <span key={c} className="rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent">
                {c}
              </span>
            ))}
          </div>
        </Section>

        <Section title="Free resources">
          <ul className="space-y-2">
            {def.resources.map((r) => (
              <li key={r.url}>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 hover:border-accent/60 hover:bg-accent-soft/50"
                >
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-semibold text-stone-600 uppercase">
                    {kindLabel[r.kind]}
                  </span>
                  <span className="text-sm text-stone-800 group-hover:text-accent">{r.title}</span>
                  <span className="ml-auto text-stone-400 group-hover:text-accent">↗</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </aside>
  )
}

function CourseDetails({ course }: { course: CourseInfo }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-stone-900">{course.title}</h3>
        <div className="mt-1 flex flex-wrap gap-2 text-xs">
          {course.credits != null && (
            <span className="rounded bg-stone-100 px-2 py-0.5 font-medium text-stone-700">{course.credits} credits</span>
          )}
          {course.offeredRecently ? (
            <span className="rounded bg-green-50 px-2 py-0.5 font-medium text-green-700">Offered recently</span>
          ) : (
            <span className="rounded bg-stone-100 px-2 py-0.5 font-medium text-stone-500">Not offered recently</span>
          )}
        </div>
      </div>
      {course.description && <p className="text-sm leading-relaxed text-stone-700">{course.description}</p>}
      {course.prerequisites && (
        <div className="rounded-md bg-stone-50 px-3 py-2">
          <div className="text-xs font-semibold tracking-wider text-stone-500 uppercase">Catalog prerequisite rule</div>
          <p className="mt-1 text-sm text-stone-700">{course.prerequisites}</p>
        </div>
      )}
      {(course.syllabusUrl || course.catalogUrl) && (
        <div className="flex flex-wrap gap-3 text-sm">
          {course.syllabusUrl && (
            <a href={course.syllabusUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
              Syllabus (PDF) ↗
            </a>
          )}
          {course.catalogUrl && (
            <a href={course.catalogUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
              Catalog entry ↗
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-bold tracking-wider text-stone-500 uppercase">{title}</h3>
      {children}
    </section>
  )
}

function StatusButton({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean
  color: 'green' | 'amber'
  onClick: () => void
  children: ReactNode
}) {
  const on = color === 'green' ? 'bg-green-600 border-green-600 text-white' : 'bg-amber-500 border-amber-500 text-white'
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={[
        'rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors',
        active ? on : 'border-stone-300 text-stone-700 hover:bg-stone-50',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
