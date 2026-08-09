/**
 * The lines drawn on a page, and what can be read off them.
 *
 * One primitive only — "A comes before B" — held apart from `readingOrder`
 * rather than replacing it. The order is the typing surface and has to cover
 * every object in one column, so it stays a total order; a line says something
 * the column cannot, which is that two objects split off the same place.
 *
 * ⚠️ The absence of a line means the user has not maintained that stretch, and
 * nothing else. It does not mean "at the same time" — a page with no lines at
 * all would then be saying all fifteen of its objects are simultaneous. Being
 * at the same time is said by a split, so it needs lines to be said at all.
 *
 * The geometry of a line is nowhere here: both ends are ids, and where the line
 * meets each object is worked out from where that object is standing. Moving an
 * object therefore moves its lines with it and writes nothing.
 */
export interface ReadingEdge {
  from: string
  to: string
}

function edgeKey(edge: ReadingEdge): string {
  // A separator no id can hold, so no pair of ends spells another pair's key.
  // Escaped rather than written out: a literal NUL in the source makes the
  // whole file binary to ripgrep, which then skips it without saying so.
  return `${edge.from}\u0000${edge.to}`
}

/**
 * Deduplicated and sorted, for the same reason a tag set is: the order lines
 * were drawn in carries nothing, and a canonical form is what keeps two pages
 * saying the same thing byte-identical on disk.
 */
export function normalizeEdges(edges: readonly ReadingEdge[]): ReadingEdge[] {
  const seen = new Map<string, ReadingEdge>()
  for (const edge of edges) {
    const key = edgeKey(edge)
    if (!seen.has(key)) seen.set(key, { from: edge.from, to: edge.to })
  }
  return [...seen.values()].sort((a, b) => {
    const ka = edgeKey(a)
    const kb = edgeKey(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

export function hasEdge(edges: readonly ReadingEdge[], edge: ReadingEdge): boolean {
  return edges.some((e) => e.from === edge.from && e.to === edge.to)
}

/** What is left after rubbing some lines out. A line not there is not a fault. */
export function withoutEdges(
  edges: readonly ReadingEdge[],
  rubbedOut: readonly ReadingEdge[],
): ReadingEdge[] {
  const gone = new Set(rubbedOut.map(edgeKey))
  return edges.filter((edge) => !gone.has(edgeKey(edge)))
}

function successors(edges: readonly ReadingEdge[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const edge of edges) {
    const list = out.get(edge.from)
    if (list === undefined) out.set(edge.from, [edge.to])
    else list.push(edge.to)
  }
  return out
}

/** Whether following the lines from one object ever arrives at the other. */
function reaches(edges: readonly ReadingEdge[], from: string, to: string): boolean {
  const next = successors(edges)
  const seen = new Set<string>([from])
  const queue = [from]
  while (queue.length > 0) {
    const at = queue.pop() as string
    if (at === to) return true
    for (const step of next.get(at) ?? []) {
      if (seen.has(step)) continue
      seen.add(step)
      queue.push(step)
    }
  }
  return false
}

/**
 * Whether drawing this line would close a ring, which is the one thing the
 * canvas refuses.
 *
 * Not model tidiness: there is no such thing as reading to the end of a page
 * and arriving back at its beginning, so a ring has nothing it could refer to.
 * Refusing them is also what makes `readingDepths` always answerable — a ring
 * holds no object with nothing pointing into it, and no longest path.
 *
 * Cheap enough to ask while the pointer is still down: a page holds a dozen
 * objects, so the tool can draw a target it will refuse as refused instead of
 * reporting the refusal after the drop.
 */
export function wouldCycle(edges: readonly ReadingEdge[], edge: ReadingEdge): boolean {
  if (edge.from === edge.to) return true
  return reaches(edges, edge.to, edge.from)
}

/**
 * How far along the reading each object stands: the longest path into it,
 * counted from an object nothing points into.
 *
 * The number is derived and never stored. Storing it would put a second truth
 * beside the lines, free to disagree with them.
 *
 * Objects the lines never touch are absent rather than numbered, which is what
 * an empty gutter says: nobody has maintained the semantics of that stretch.
 * Objects caught in a ring are absent too — the lines cannot make one, and
 * repair drops one that arrives from elsewhere, so this only decides what a
 * broken file looks like, and unnumbered is the honest answer.
 */
export function readingDepths(edges: readonly ReadingEdge[]): Map<string, number> {
  const next = successors(edges)
  const waitingOn = new Map<string, number>()
  for (const edge of edges) {
    if (!waitingOn.has(edge.from)) waitingOn.set(edge.from, 0)
    waitingOn.set(edge.to, (waitingOn.get(edge.to) ?? 0) + 1)
  }

  const depths = new Map<string, number>()
  const ready: string[] = []
  for (const [id, count] of waitingOn) {
    if (count === 0) {
      depths.set(id, 1)
      ready.push(id)
    }
  }

  // Topological, so an object is only numbered once every way into it has been
  // measured — which is what makes the number the longest path rather than
  // whichever one happened to be walked first.
  while (ready.length > 0) {
    const at = ready.shift() as string
    const depth = depths.get(at) as number
    for (const step of next.get(at) ?? []) {
      depths.set(step, Math.max(depths.get(step) ?? 0, depth + 1))
      const left = (waitingOn.get(step) as number) - 1
      waitingOn.set(step, left)
      if (left === 0) ready.push(step)
    }
  }

  for (const [id, left] of waitingOn) {
    if (left > 0) depths.delete(id)
  }
  return depths
}

/**
 * One row of the list: an object, and where the rail holds it.
 *
 * A row the rail does not hold carries none of the rail — no lane, no beat, no
 * parents. That absence is the whole of the boundary between the stretch
 * somebody has maintained and the stretch nobody has: there is no second
 * section and no heading, the rail simply stops.
 */
export interface ReadingRow {
  id: string
  /** Which column of the rail the dot stands in, 0 being the line the reading runs down. */
  lane: number | undefined
  /** The beat, counted the way `readingDepths` counts it. */
  depth: number | undefined
  /** The objects a line arrives from, in the order the page lists them. */
  parents: readonly string[]
  /**
   * The lanes still carrying a line downwards once this row has been laid.
   *
   * Only this walk knows them, because a lane is handed back and taken again:
   * reading the rows on their own, a lane used at the top and again at the
   * bottom is indistinguishable from one held open the whole way down. What a
   * row draws is the difference between this and the row above it.
   */
  carries: readonly number[]
}

function push(lists: Map<string, string[]>, key: string, value: string): void {
  const list = lists.get(key)
  if (list === undefined) lists.set(key, [value])
  else list.push(value)
}

/**
 * The page as one column: the objects lines touch first, laid out so that every
 * line points downwards, then the ones no line touches.
 *
 * ⚠️ A column can show a graph, but only while its order is a linear extension
 * of that graph — one edge pointing back up and the rail has to draw a line
 * running the wrong way, which is the point at which one dimension really has
 * run out. So the order is not a rendering detail that can be settled later; it
 * is the condition the rail is drawn under.
 *
 * Where the graph does not decide, `order` does. That is not the fallback
 * `types.ts` refuses: breaking a tie the lines left open with an order the same
 * person typed is not the same as recovering an order nobody set.
 *
 * ⭐ A graph has many linear extensions and this picks one. It does not pick a
 * canonical one, because there is no such thing — git's `--topo-order` documents
 * two valid answers for one history and promises only that it prints one of
 * them. What is promised here is the weaker and sufficient thing: the same
 * input lays out the same way every time.
 *
 * At a split, the ways out are laid shortest first and the longest last, so the
 * short branches sit against what they hang off and the reading carries on down
 * the same lane. Laying the longest first would push every branch to the foot of
 * the page, far from the object it says something about.
 */
export function flattenReading(
  edges: readonly ReadingEdge[],
  order: readonly string[],
): ReadingRow[] {
  const rank = new Map(order.map((id, position) => [id, position] as const))
  // The page's roster decides who gets a row. An edge naming something this page
  // does not hold is repair's business, not a reason to invent a row for it.
  const live = edges.filter((edge) => rank.has(edge.from) && rank.has(edge.to))

  const depths = readingDepths(live)
  // The same walk run backwards: how far the reading still has to go from here,
  // which is what says which way out of a split it carries on along.
  const heights = readingDepths(live.map((edge) => ({ from: edge.to, to: edge.from })))

  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  const waysIn = new Map<string, number>()
  const waysOut = new Map<string, number>()
  for (const edge of live) {
    push(parentsOf, edge.to, edge.from)
    push(childrenOf, edge.from, edge.to)
    waysIn.set(edge.to, (waysIn.get(edge.to) ?? 0) + 1)
    waysOut.set(edge.from, (waysOut.get(edge.from) ?? 0) + 1)
    if (!waysIn.has(edge.from)) waysIn.set(edge.from, 0)
    if (!waysOut.has(edge.to)) waysOut.set(edge.to, 0)
  }

  const positionOf = (id: string): number => rank.get(id) as number
  for (const list of childrenOf.values()) {
    list.sort((a, b) => (heights.get(a) ?? 0) - (heights.get(b) ?? 0) || positionOf(a) - positionOf(b))
  }
  for (const list of parentsOf.values()) list.sort((a, b) => positionOf(a) - positionOf(b))

  const held: (string | undefined)[] = []
  const laneOf = new Map<string, number>()
  const rows: ReadingRow[] = []

  const openLane = (): number => {
    const free = held.indexOf(undefined)
    if (free >= 0) return free
    held.push(undefined)
    return held.length - 1
  }

  const lay = (id: string): void => {
    // Arriving here is one line fewer left to draw out of each object it comes
    // from. An object with none left hands its lane over instead of keeping it
    // open, and the leftmost of those is the lane the reading carries on down —
    // so a branch laid earlier, while its parent still owes another line, has to
    // open a lane of its own and sits indented.
    let inherited: number | undefined
    for (const parent of parentsOf.get(id) ?? []) {
      const owed = (waysOut.get(parent) as number) - 1
      waysOut.set(parent, owed)
      if (owed > 0) continue
      const lane = laneOf.get(parent) as number
      held[lane] = undefined
      if (inherited === undefined || lane < inherited) inherited = lane
    }

    const lane = inherited ?? openLane()
    laneOf.set(id, lane)
    held[lane] = (waysOut.get(id) ?? 0) > 0 ? id : undefined
    const carries: number[] = []
    for (let at = 0; at < held.length; at += 1) {
      if (held[at] !== undefined) carries.push(at)
    }
    rows.push({ id, lane, depth: depths.get(id), parents: parentsOf.get(id) ?? [], carries })

    for (const child of childrenOf.get(id) ?? []) {
      const owed = (waysIn.get(child) as number) - 1
      waysIn.set(child, owed)
      // Held back until every way in has been laid, which is what keeps the
      // order a linear extension where two branches meet again.
      if (owed === 0) lay(child)
    }
  }

  const starts = [...waysIn]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort((a, b) => positionOf(a) - positionOf(b))
  for (const id of starts) lay(id)

  // Whatever the rail never reached: the objects no line touches, and — only if
  // a ring ever survives both the canvas and repair — the ones caught in it.
  for (const id of order) {
    if (!laneOf.has(id)) {
      rows.push({ id, lane: undefined, depth: undefined, parents: [], carries: [] })
    }
  }
  return rows
}

/**
 * Every line with an end on one of these objects — what deleting them takes
 * with them, and what putting them back has to bring.
 */
export function edgesTouching(
  edges: readonly ReadingEdge[],
  ids: ReadonlySet<string>,
): ReadingEdge[] {
  return edges.filter((edge) => ids.has(edge.from) || ids.has(edge.to))
}
