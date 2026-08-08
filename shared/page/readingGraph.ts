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
 * Every line with an end on one of these objects — what deleting them takes
 * with them, and what putting them back has to bring.
 */
export function edgesTouching(
  edges: readonly ReadingEdge[],
  ids: ReadonlySet<string>,
): ReadingEdge[] {
  return edges.filter((edge) => ids.has(edge.from) || ids.has(edge.to))
}
