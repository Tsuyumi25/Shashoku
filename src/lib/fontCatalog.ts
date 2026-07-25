import type { EngineFontSource } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'

/**
 * Representative face per family, held as Local Font Access handles rather
 * than bytes: a handle is cheap, the bytes behind it run to tens of megabytes
 * for a CJK family and are only worth fetching when something rasterizes.
 */
const systemFaces = new Map<string, FontData>()

let scanned = false

export async function loadFontCatalog(): Promise<FontEntry[]> {
  if (!scanned) {
    for (const face of await queryLocalFonts()) {
      const held = systemFaces.get(face.family)
      // Prefer the upright face, otherwise the sample shows whichever weight
      // the platform happened to enumerate first.
      if (!held || (held.style !== 'Regular' && face.style === 'Regular')) {
        systemFaces.set(face.family, face)
      }
    }
    scanned = true
  }

  return [...systemFaces.entries()]
    .map(([family, face]) => ({
      family,
      origin: { kind: 'system' as const, postscriptName: face.postscriptName },
    }))
    .sort((a, b) => a.family.localeCompare(b.family, 'zh-Hant'))
}

export async function engineSourceFor(entry: FontEntry): Promise<EngineFontSource> {
  if (entry.origin.kind === 'imported') {
    return { path: entry.origin.path, faceIndex: entry.origin.faceIndex }
  }

  const face = systemFaces.get(entry.family)
  if (!face) throw new Error(`no system face enumerated for ${entry.family}`)

  // Measured on Electron 43: blob() on a member of a .ttc hands back the
  // entire collection, byte-identical to the file on disk. The face therefore
  // has to be named, or the engine would rasterize whichever member happens to
  // sit at index 0.
  const bytes = new Uint8Array(await (await face.blob()).arrayBuffer())
  return { bytes, postscriptName: entry.origin.postscriptName }
}
