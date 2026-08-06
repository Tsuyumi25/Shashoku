import { computed, ref, shallowRef } from 'vue'
import type { EngineFaceInfo, EngineFontSource } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'

/**
 * Languages a family name is preferred in, most wanted first. Matches the
 * application locale; a font with no name in any of them falls back to English.
 */
const LOCALE_PREFERENCE = ['zh-Hant', 'zh', 'en']

/**
 * Shared rather than returned only to the caller that asked for it: a text
 * style names a family, and whoever has to draw that text needs the face
 * behind the name synchronously, on every repaint.
 *
 * Shallow because entries are replaced wholesale and never mutated — and
 * because a reactive Proxy cannot cross contextBridge into the engine.
 */
export const catalog = shallowRef<FontEntry[]>([])

/** A family's faces, in the order a style menu shows them. */
export const catalogByFamily = computed(() => {
  const map = new Map<string, FontEntry[]>()
  for (const entry of catalog.value) {
    const held = map.get(entry.family)
    if (held) held.push(entry)
    else map.set(entry.family, [entry])
  }
  return map
})

/**
 * The face a PostScript name answers to. Faces that declare none are absent —
 * they can only be reached through their family.
 */
export const catalogByFace = computed(() => {
  const map = new Map<string, FontEntry>()
  for (const entry of catalog.value) {
    if (entry.postscriptName && !map.has(entry.postscriptName)) {
      map.set(entry.postscriptName, entry)
    }
  }
  return map
})

/**
 * What tells one catalogue row from another. The PostScript name identifies a
 * face across directories; the path stands in for the rare face that has none.
 */
export function faceKey(entry: FontEntry): string {
  return entry.postscriptName || `${entry.origin.path}#${entry.origin.faceIndex}`
}

/**
 * Whether an enumeration has ever finished. Without it an empty catalogue is
 * ambiguous, and a caller looking up a family cannot tell "not yet" from
 * "no such font" — which are opposite things to show a user.
 */
export const catalogLoaded = ref(false)

let cachedFor: string | null = null
let inFlight: { signature: string; entries: Promise<FontEntry[]> } | null = null

function collect(
  byFace: Map<string, FontEntry>,
  faces: EngineFaceInfo[],
  kind: 'system' | 'imported',
) {
  for (const face of faces) {
    const entry: FontEntry = {
      family: face.family,
      displayName: face.displayName || face.family,
      style: face.style,
      postscriptName: face.postscriptName,
      weight: face.weight,
      width: face.width,
      slant: face.slant,
      origin: { kind, path: face.path, faceIndex: face.faceIndex },
    }
    // One row per face, not per copy: the same face reachable through two
    // directories is one thing to list.
    const key = faceKey(entry)
    if (!byFace.has(key)) byFace.set(key, entry)
  }
}

/**
 * The nine standard English weight steps, with the synonyms OS/2 names for
 * them. Consulted only inside a width/weight/slant bucket that holds more
 * than one face — which is exactly where the declared numbers are known to be
 * untrustworthy. A name not on the ladder sorts after it, naturally; no face
 * is ever hidden for being badly named.
 */
const WEIGHT_STEPS = [
  ['thin'],
  ['extralight', 'ultralight'],
  ['light'],
  ['regular', 'normal', ''],
  ['medium'],
  ['semibold', 'demibold'],
  ['bold'],
  ['extrabold', 'ultrabold'],
  ['black', 'heavy'],
]

function styleStep(style: string): number {
  const folded = style.toLowerCase().replace(/[\s-]/g, '')
  const step = WEIGHT_STEPS.findIndex((names) => names.includes(folded))
  return step === -1 ? WEIGHT_STEPS.length : step
}

/**
 * Adobe's menu order — width, then weight, then slant, then the style name —
 * as documented by Glyphs from Technote #5088.
 */
export function faceOrder(a: FontEntry, b: FontEntry): number {
  return (
    a.width - b.width ||
    a.weight - b.weight ||
    Math.abs(a.slant) - Math.abs(b.slant) ||
    styleStep(a.style) - styleStep(b.style) ||
    a.style.localeCompare(b.style, 'zh-Hant')
  )
}

/**
 * The face that draws where only a family is named: the closest to an upright
 * regular. Ties around 400 resolve upward first — CSS's direction — so a
 * family of Light, Medium and Bold lands on Medium on every machine, rather
 * than on whichever file the directory walk reached first.
 */
export function representativeOf(faces: readonly FontEntry[]): FontEntry | null {
  const distance = (e: FontEntry) => [
    Math.abs(e.slant),
    Math.abs(e.width - 100),
    Math.abs(e.weight - 400),
    e.weight < 400 ? 1 : 0,
    Math.abs(styleStep(e.style) - styleStep('regular')),
  ]
  const firstSmaller = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i]! < b[i]!
    }
    return false
  }
  let best: FontEntry | null = null
  let bestKey: number[] | null = null
  for (const face of faces) {
    const key = distance(face)
    if (!bestKey || firstSmaller(key, bestKey)) {
      best = face
      bestKey = key
    }
  }
  return best
}

/**
 * Families in reading order, faces inside each family in menu order. Grouped
 * before sorting so a family whose faces disagree about the display name
 * still comes out as one contiguous block.
 */
function sortCatalog(entries: FontEntry[]): FontEntry[] {
  const groups = new Map<string, FontEntry[]>()
  for (const entry of entries) {
    const held = groups.get(entry.family)
    if (held) held.push(entry)
    else groups.set(entry.family, [entry])
  }
  const families = [...groups.values()]
  for (const faces of families) faces.sort(faceOrder)
  families.sort(
    (a, b) =>
      a[0].displayName.localeCompare(b[0].displayName, 'zh-Hant') ||
      a[0].family.localeCompare(b[0].family),
  )
  return families.flat()
}

async function enumerate(dirs: string[]): Promise<FontEntry[]> {
  const [system, imported] = await Promise.all([
    window.engine.listFonts(undefined, LOCALE_PREFERENCE),
    dirs.length > 0
      ? window.engine.listFonts(dirs, LOCALE_PREFERENCE)
      : Promise.resolve<EngineFaceInfo[]>([]),
  ])

  const byFace = new Map<string, FontEntry>()
  // Imported first, so a folder the user added on top of a platform directory
  // does not end up listed as if the application had found it on its own.
  collect(byFace, imported, 'imported')
  collect(byFace, system, 'system')

  return sortCatalog([...byFace.values()])
}

/**
 * Every family the application can draw with: the platform's own directories
 * plus whatever folders the user added. Both are read the same way, so the
 * origin is only there for the interface to tell them apart.
 *
 * Two callers want the catalogue at startup — the canvas and, on its first
 * opening, the picker — so an enumeration already running is joined rather
 * than repeated. Opening a thousand font files twice is not free.
 */
export async function loadFontCatalog(folders: readonly string[] = []): Promise<FontEntry[]> {
  // Copied rather than passed along: these come from the preferences store,
  // which holds them reactively, and contextBridge cannot clone a Proxy. It
  // reports that as "An object could not be cloned", which names neither the
  // argument nor the reason.
  const dirs = [...folders]
  const signature = JSON.stringify(dirs)
  if (cachedFor === signature) return catalog.value
  if (inFlight?.signature === signature) return inFlight.entries

  const entries = enumerate(dirs)
  inFlight = { signature, entries }
  try {
    catalog.value = await entries
    cachedFor = signature
    catalogLoaded.value = true
    return catalog.value
  } finally {
    if (inFlight?.entries === entries) inFlight = null
  }
}

export function engineSourceFor(entry: FontEntry): EngineFontSource {
  return {
    path: entry.origin.path,
    faceIndex: entry.origin.faceIndex,
    // The name wins over the index inside the engine, so a collection whose
    // members moved since the scan still lands on the face that was chosen.
    postscriptName: entry.postscriptName || undefined,
  }
}
