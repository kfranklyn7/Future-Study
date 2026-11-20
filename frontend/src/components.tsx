import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { Resource } from './api'

export const DIVISIONS = ['', 'Undergraduate', 'Graduate']

export function DivisionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className="field" value={value} onChange={e => onChange(e.target.value)}>
      {DIVISIONS.map(d => <option key={d} value={d}>{d || 'All levels'}</option>)}
    </select>
  )
}

export function CourseLink({ code, className = 'link', children }: { code: string; className?: string; children?: ReactNode }) {
  return <Link to="/courses/$code" params={{ code }} className={className}>{children ?? code}</Link>
}

export function CourseList({ items, empty }: { items: { course_code: string; title: string | null }[]; empty: string }) {
  if (!items.length) return <p className="text-stone-500">{empty}</p>
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map(i => <li key={i.course_code}>
        {i.title
          ? <CourseLink code={i.course_code}>{i.course_code} {i.title}</CourseLink>
          : <span className="text-stone-500">{i.course_code} (outside CISC)</span>}
      </li>)}
    </ul>
  )
}

export function Resources({ items }: { items: Resource[] }) {
  if (!items.length) return <p className="text-stone-500">None yet.</p>
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map(r => (
        <li key={r.url + r.title}>
          <a className="link" href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
          <span className="text-sm text-stone-500"> {r.provider}</span>
          {r.type && <span className="tag">{r.type}</span>}
        </li>
      ))}
    </ul>
  )
}

export const relevanceRank = (r: string) => ({ high: 0, medium: 1, low: 2 } as Record<string, number>)[r] ?? 3
