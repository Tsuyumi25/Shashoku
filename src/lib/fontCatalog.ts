import type { EngineFaceInfo, EngineFontSource } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'

/**
 * Languages a family name is preferred in, most wanted first. Matches the
 * application locale; a font with no name in any of them falls back to English.
 */
const LOCALE_PREFERENCE = ['zh-Hant', 'zh', 'en']

let cached: FontEntry[] | null = null
let cachedFor = ''

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

/**
 * Every family the application can draw with: the platform's own directories
 * plus whatever folders the user added. Both are read the same way, so the
 * origin is only there for the interface to tell them apart.
 */
export async function loadFontCatalog(folders: readonly string[] = []): Promise<FontEntry[]> {
  // Copied rather than passed along: these come from the preferences store,
  // which holds them reactively, and contextBridge cannot clone a Proxy. It
  // reports that as "An object could not be cloned", which names neither the
  // argument nor the reason.
  const dirs = [...folders]
  const signature = JSON.stringify(dirs)
  if (cached && cachedFor === signature) return cached

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

  cached = [...byFamily.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'zh-Hant'),
  )
  cachedFor = signature
  return cached
}

export function engineSourceFor(entry: FontEntry): EngineFontSource {
  return { path: entry.origin.path, faceIndex: entry.origin.faceIndex }
}
