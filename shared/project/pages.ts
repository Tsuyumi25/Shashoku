/**
 * How a page is named and how the list of them meets the disk.
 *
 * A page's directory name is its identity, settled when it is created and never
 * touched again. Renaming is a manifest field instead: tying the two together
 * would make every rename a filesystem operation that can fail or collide, and
 * renaming is something people do often.
 */

/**
 * How much of the source stem a page's name may carry.
 *
 * A single name is capped at 255 *bytes*, and the longest real project folder
 * measured here was 183 of them. With `shashoku/pages/<name>/layers/<file>.png`
 * on the end, sixty leaves the whole path at 11% of Linux's limit and ninety
 * characters short of Windows'.
 */
const STEM_BUDGET_BYTES = 60

/**
 * Characters that would either leave the pages folder or make the project
 * impossible to copy to Windows. A stem that loses all of them still gets a
 * name — the timestamp is always there, and a collision is counted past.
 */
const REFUSED = /[\\/<>:"|?*]|\p{Cc}/gu

const encoder = new TextEncoder()

function byteLength(text: string): number {
  return encoder.encode(text).length
}

function stemOf(name: string): string {
  const at = name.lastIndexOf('.')
  return at <= 0 ? name : name.slice(0, at)
}

/**
 * The longest head of `text` that fits in `budget` bytes, cut between grapheme
 * clusters. Not between code points: `♥️` is a heart plus a variation selector,
 * and a cut between them leaves a selector modifying whatever follows it.
 */
function headWithin(text: string, budget: number): string {
  if (byteLength(text) <= budget) return text
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let out = ''
  let used = 0
  for (const { segment } of graphemes.segment(text)) {
    const size = byteLength(segment)
    if (used + size > budget) break
    out += segment
    used += size
  }
  return out
}

function stampOf(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${pad(at.getFullYear() % 100)}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  return `${date}-${pad(at.getHours())}${pad(at.getMinutes())}`
}

/**
 * What to call the page made from `sourceName` at `at`, given the names already
 * spoken for.
 *
 * The tail of the stem is what survives, because a manga raw is a shared prefix
 * and a page number — cutting from the front would name every page in a chapter
 * the same thing.
 */
export function pageDirName(
  sourceName: string,
  at: Date,
  taken: ReadonlySet<string>,
): string {
  const stem = headWithin(stemOf(sourceName).replace(REFUSED, ''), STEM_BUDGET_BYTES)
  const stamp = stampOf(at)
  const base = stem.length > 0 ? `${stem}-${stamp}` : stamp
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

export interface PageReconciliation {
  /** Every page the project has, in the order it is read. */
  order: string[]
  /** Listed pages whose directory is not on disk. */
  missing: string[]
  /** Directories nobody listed, in the order they joined the end. */
  adopted: string[]
}

/**
 * The list decides who comes before whom; the disk decides who exists. Drift
 * between them is ordinary — a crash, a sync that only got halfway, someone
 * clearing space — and neither refusing to open nor pretending is the answer.
 *
 * A directory nobody listed joins the end, and a listed page with no directory
 * stays in the order carrying a fault. Dropping it silently would be the
 * program deciding a page is gone, which is the user's call to make.
 */
export function reconcilePages(
  listed: readonly string[],
  onDisk: readonly string[],
): PageReconciliation {
  const present = new Set(onDisk)
  const order: string[] = []
  const missing: string[] = []
  const seen = new Set<string>()

  for (const name of listed) {
    if (seen.has(name)) continue
    seen.add(name)
    order.push(name)
    if (!present.has(name)) missing.push(name)
  }

  const adopted = onDisk.filter((name) => !seen.has(name))
  order.push(...adopted)
  return { order, missing, adopted }
}
