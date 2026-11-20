// Every course map in the dropdown: the hand-drawn BS in Computer Science map (csMap.ts) first,
// then maps for the other majors, generated from their official degree maps by
// scripts/build_map_data.py (programMaps.json, read from CISC.CORE in Snowflake).

import generated from './programMaps.json'
import { COL, core, electives, mapNodes, type CourseInfo, type MapNodeDef, type Resource, type Track } from './csMap'

export type ProgramMap = {
  id: string
  title: string
  /** Shown under the title, e.g. which bulletin year a generated map comes from. */
  subtitle?: string
  nodes: MapNodeDef[]
  /** localStorage key for this map's progress. */
  storageKey: string
}

type GeneratedNode = {
  id: string
  label: string
  codes: string[]
  track: string
  col: number
  row: number
  requires: string[]
  group?: { id: string; label: string }
  pick?: { count: number; options: string[] }
}

const generatedCourses = generated.courses as Record<string, CourseInfo>
const generatedResources = generated.resources as Record<string, Resource[]>

/** Free resources for a course from CISC.CORE.RESOURCES (AI-picked plus curated links). */
export const resourcesFor = (code: string): Resource[] => generatedResources[code] ?? []

/** Course text for any code on any map or pick list. */
export const courseInfo = (code: string): CourseInfo | undefined =>
  core[code] ?? generatedCourses[code] ?? electives.find((c) => c.code === code)

// Generated maps lay semesters out left to right, one column each.
const ROW = 115

function fromGenerated(m: { id: string; title: string; bulletinYear: string; nodes: GeneratedNode[] }): ProgramMap {
  return {
    id: m.id,
    title: m.title,
    subtitle: `From the ${m.bulletinYear} degree map, one column per semester`,
    storageKey: `future-study:map:${m.id}`,
    nodes: m.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      codes: n.codes,
      group: n.group,
      track: n.track as Track,
      x: n.col * COL,
      y: n.row * ROW,
      requires: n.requires,
      pick: n.pick && {
        count: n.pick.count,
        options: n.pick.options.map(courseInfo).filter((c): c is CourseInfo => !!c),
      },
      note: n.pick
        ? `Pick ${n.pick.count} of these. Check the bulletin for any extra rules on which combinations count.`
        : undefined,
      careers: [],
      resources: n.codes.flatMap(resourcesFor),
    })),
  }
}

export const DEFAULT_MAP_ID = 'computer-science-bs'

export const programMaps: ProgramMap[] = [
  {
    id: DEFAULT_MAP_ID,
    title: 'Computer Science, B.S.',
    nodes: mapNodes,
    // Kept from before there were several maps, so existing progress still loads.
    storageKey: 'future-study:map:v1',
  },
  ...(generated.maps as Parameters<typeof fromGenerated>[0][]).map(fromGenerated),
]

export const programMapById = Object.fromEntries(programMaps.map((m) => [m.id, m])) as Record<string, ProgramMap>

/** The requirement a box fills: its group when it has alternatives, else the box itself. */
export const slotOf = (def: MapNodeDef) => def.group?.id ?? def.id

/** The other boxes in the same "take one of these" group. */
export const alternativesOf = (nodes: MapNodeDef[], def: MapNodeDef) =>
  def.group ? nodes.filter((n) => n.group?.id === def.group!.id && n.id !== def.id) : []

/**
 * A box for one course chosen in a pick box, placed in the column to its right. Its arrows come
 * from map courses named in the catalog prerequisite rule; with none named, it follows the pick
 * box's own prerequisites. placeChosen() sets the final position.
 */
function pickedNode(nodes: MapNodeDef[], from: MapNodeDef, code: string): MapNodeDef {
  const info = courseInfo(code)
  const byCode = new Map(nodes.flatMap((n) => n.codes.map((c) => [c, n.id] as const)))
  // Rules spell departments several ways ("CISC 3130", "Computer and Information Science
  // 3130", "Mathematics 1201"); CISC and MATH numbers don't collide, so match on the number.
  const named = [...(info?.prerequisites ?? '').matchAll(/\b(\d{4}[A-Z]?)\b/g)]
    .map((m) => byCode.get(`CISC ${m[1]}`) ?? byCode.get(`MATH ${m[1]}`))
    .filter((id): id is string => !!id && id !== from.id)
  const requires = [...new Set(named)]
  return {
    id: `${from.id}:${code}`,
    label: info?.title ?? code,
    codes: [code],
    track: from.track === 'elective' ? 'elective' : from.track,
    x: from.x + COL,
    y: from.y,
    requires: requires.length ? requires : [...from.requires, ...(from.softRequires ?? [])],
    pickedFrom: from.id,
    careers: from.careers,
    // The course's own links when it has any; otherwise the pick box's general ones.
    resources: resourcesFor(code).length ? resourcesFor(code) : from.resources,
  }
}

// Tallest box: two-line title, code, "or ..." line and padding.
export const NODE_SPACING = 115

/**
 * Stack a pick box's chosen courses in the column to its right, centered on it, skipping any
 * spot that would overlap a box already in that column (fixed boxes or earlier picks).
 */
function placeChosen(placed: MapNodeDef[], chosen: MapNodeDef[], from: MapNodeDef, nodeWidth: number) {
  const x = from.x + COL
  const taken = placed.filter((n) => Math.abs(n.x - x) < nodeWidth).map((n) => n.y)
  let y = from.y - ((chosen.length - 1) / 2) * NODE_SPACING
  for (const node of chosen) {
    while (taken.some((t) => Math.abs(t - y) < NODE_SPACING)) y += 10
    node.x = x
    node.y = y
    taken.push(y)
    y += NODE_SPACING
  }
}

/**
 * A map's fixed boxes plus one box per chosen course. picked holds "<pick box id>:<code>" ids,
 * so two pick boxes that share an option keep separate choices.
 */
export function withChosen(map: ProgramMap, picked: string[], nodeWidth: number): MapNodeDef[] {
  const nodes = [...map.nodes]
  for (const from of map.nodes) {
    if (!from.pick) continue
    const options = new Set(from.pick.options.map((o) => o.code))
    const chosen = picked
      .filter((p) => p.startsWith(`${from.id}:`) && options.has(p.slice(from.id.length + 1)))
      .map((p) => pickedNode(map.nodes, from, p.slice(from.id.length + 1)))
    placeChosen(nodes, chosen, from, nodeWidth)
    nodes.push(...chosen)
  }
  return nodes
}
