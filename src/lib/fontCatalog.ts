import type { EngineFontSource } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'

/**
 * Languages a family name is preferred in, most wanted first. Matches the
 * application locale; a font with no name in any of them falls back to English.
 */
const LOCALE_PREFERENCE = ['zh-Hant', 'zh', 'en']

let catalog: FontEntry[] | null = null

export async function loadFontCatalog(): Promise<FontEntry[]> {
  if (catalog) return catalog

  const byFamily = new Map<string, FontEntry>()
  for (const face of await window.engine.listFonts(undefined, LOCALE_PREFERENCE)) {
    const held = byFamily.get(face.family)
    // One row per family, drawn by its upright face — otherwise the grid shows
    // whichever weight the directory walk happened to reach first.
    if (held && !(held.style !== 'Regular' && face.style === 'Regular')) continue
    byFamily.set(face.family, {
      family: face.family,
      displayName: face.displayName || face.family,
      style: face.style,
      origin: { kind: 'system', path: face.path, faceIndex: face.faceIndex },
    })
  }

  catalog = [...byFamily.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'zh-Hant'),
  )
  return catalog
}

export function engineSourceFor(entry: FontEntry): EngineFontSource {
  return { path: entry.origin.path, faceIndex: entry.origin.faceIndex }
}
