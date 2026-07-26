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

export const catalogByFamily = computed(
  () => new Map(catalog.value.map((entry) => [entry.family, entry])),
)

/**
 * Whether an enumeration has ever finished. Without it an empty catalogue is
 * ambiguous, and a caller looking up a family cannot tell "not yet" from
 * "no such font" — which are opposite things to show a user.
 */
export const catalogLoaded = ref(false)

let cachedFor: string | null = null
let inFlight: { signature: string; entries: Promise<FontEntry[]> } | null = null

function collect(
  byFamily: Map<string, FontEntry>,
  faces: EngineFaceInfo[],
  kind: 'system' | 'imported',
) {
  for (const face of faces) {
    const held = byFamily.get(face.family)
    // One row per family, drawn by its upright face — otherwise the grid shows
    // whichever weight the directory walk happened to reach first.
    if (held && !(held.style !== 'Regular' && face.style === 'Regular')) continue
    byFamily.set(face.family, {
      family: face.family,
      displayName: face.displayName || face.family,
      style: face.style,
      origin: { kind, path: face.path, faceIndex: face.faceIndex },
    })
  }
}

async function enumerate(dirs: string[]): Promise<FontEntry[]> {
  const [system, imported] = await Promise.all([
    window.engine.listFonts(undefined, LOCALE_PREFERENCE),
    dirs.length > 0
      ? window.engine.listFonts(dirs, LOCALE_PREFERENCE)
      : Promise.resolve<EngineFaceInfo[]>([]),
  ])

  const byFamily = new Map<string, FontEntry>()
  // Imported first, so a folder the user added on top of a platform directory
  // does not end up listed as if the application had found it on its own.
  collect(byFamily, imported, 'imported')
  collect(byFamily, system, 'system')

  return [...byFamily.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'zh-Hant'),
  )
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
  return { path: entry.origin.path, faceIndex: entry.origin.faceIndex }
}
