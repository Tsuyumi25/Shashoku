import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { OcrBox, OcrCrop, OcrRecognition } from '@shared/ocr/types'
import type { LayerEntry, TextLayerEntry } from '@shared/page/types'
import { textOf } from '@shared/page/text'
import { layersDirOf } from '@shared/ssk/constants'
import { settleReadings } from '@shared/ocr/candidates'
import type { OcrArrival } from '@shared/ocr/pool'
import type { OcrModelPreference } from '@shared/preferences/types'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { drawnLabel } from '@/lib/labelRaster'

/**
 * Part of a reading's identity: rewording one turns every reading it made
 * into a stranger the next run would add all over again.
 */
const MANGA_OCR = 'manga-ocr'
const PP_OCR = 'ppocr-v6'
const BABERU_OCR = 'baberu-ocr'
const HAYAI_OCR = 'hayai-ocr-v2'

/**
 * Here rather than in the component: the name is the identity a reading is
 * stored under, and a second list of the same names is a second thing to keep
 * in step.
 */
export const OCR_ROUTES = [MANGA_OCR, PP_OCR, BABERU_OCR, HAYAI_OCR] as const
export type OcrRoute = (typeof OCR_ROUTES)[number]

/**
 * The key is what a reading is stored under and can never be reworded; the
 * value is what the engine calls a model and is free to move. PP-OCR is
 * absent: it reads one column at a time and finds its own, a differently
 * shaped route rather than the same route with other weights.
 */
type OcrReader = 'mangaocr' | 'baberu' | 'hayai'

const REGION_READERS: Record<Exclude<OcrRoute, typeof PP_OCR>, OcrReader> = {
  [MANGA_OCR]: 'mangaocr',
  [BABERU_OCR]: 'baberu',
  [HAYAI_OCR]: 'hayai',
}

/**
 * Two detectors' vocabularies side by side: `text_bubble`/`text_free` are the
 * balloon detector's kinds, `text`/`onomatopoeia` the layout detector's.
 * `bubble` and `panel` are absent — nothing is written on a container itself.
 */
const WRITING = new Set(['text_bubble', 'text_free', 'text', 'onomatopoeia'])

/**
 * The one label a reader can be told to leave alone: drawn by hand over the
 * artwork, and three of the four readers answer rubbish on it.
 */
const DRAWN = 'onomatopoeia'

/**
 * ⭐ A capability, not a default: measured on the same forty-six hand-cut
 * effects, the routes absent from here answer nothing worth listing, and a
 * line nobody will ever pick is one more candidate to rule out by hand. Here
 * rather than in preferences because this is what was measured about each
 * model; that file only records where a reader has since disagreed.
 */
const READS_DRAWN = new Set<OcrRoute>([HAYAI_OCR])

/** How much two boxes have to share before they are one region seen twice. */
const SAME_REGION = 0.5

/**
 * Where the object visually sits, not the stored anchor, whose corner depends
 * on how the text is aligned.
 */
function labelCentre(object: TextLayerEntry) {
  return drawnLabel(textOf(object), object.style, { x: object.x, y: object.y }, object.rotation)
    .center
}

/**
 * What a page's artwork was measured to hold. None of it is part of the
 * document — rerunning is free, and nothing downstream can come to depend on
 * a box a better model would have drawn elsewhere.
 */
export const useOcrStore = defineStore('ocr', () => {
  const running = ref(new Set<string>())
  const problem = ref<string | null>(null)

  function busy(route: string): boolean {
    return running.value.has(route)
  }

  function mark(route: string, working: boolean) {
    const next = new Set(running.value)
    if (working) next.add(route)
    else next.delete(route)
    running.value = next
  }

  /**
   * Every writing region proposed for a page, from every detector at once.
   *
   * ⭐ Which regions hold writing is a fact about the page; which model reads
   * them is a choice made afterwards. Tying the two together kept the layout
   * detector's findings to itself — and it is the only detector that sees
   * hand-drawn sound effects: seven in eight against one in seven, measured
   * over ninety-two annotated pages.
   *
   * Memoized as the promise, so two recognizers pressed in a row wait on one
   * detection pass; a failed pass is forgotten, or the first bad page would
   * stay bad all session. ⚠️ Keyed by page alone — the artwork read is the
   * raster underneath everything, which nothing yet paints on.
   */
  const proposals = new Map<string, Promise<OcrBox[]>>()

  /** What was measured about a route, with whatever the reader changed on top. */
  function settingsFor(route: OcrRoute): OcrModelPreference {
    const stored = usePreferencesStore().prefs.ocr[route]
    // A stored `true` on a route that cannot read them is ignored: capability
    // is measured, and a preferences file edited by hand must not be able to
    // turn a model into one it is not.
    return {
      device: stored?.device ?? 'cpu',
      onomatopoeia: READS_DRAWN.has(route) && (stored?.onomatopoeia ?? true),
    }
  }

  /** Whether this route is one the drawn effects are worth offering to. */
  function readsDrawn(route: OcrRoute): boolean {
    return READS_DRAWN.has(route)
  }

  /**
   * Writes the whole entry rather than the changed field: a half entry would
   * be merged against a default that is free to move, and a model quietly
   * changing behaviour under a setting somebody already looked at is worse
   * than a file that repeats itself.
   */
  function configure(route: OcrRoute, change: Partial<OcrModelPreference>) {
    usePreferencesStore().prefs.ocr[route] = { ...settingsFor(route), ...change }
  }

  function writingOf(pageId: string, path: string): Promise<OcrBox[]> {
    const held = proposals.get(pageId)
    if (held) return held
    const asked = Promise.all([
      window.ocr.detect('bubble', path),
      window.ocr.detect('layout', path),
    ])
      .then(([balloons, layout]) =>
        distinct([...balloons, ...layout].filter((b) => WRITING.has(b.label))),
      )
      .catch((e) => {
        proposals.delete(pageId)
        throw e
      })
    proposals.set(pageId, asked)
    return asked
  }

  /**
   * Which reading the pointer is over in the list, so the canvas can say
   * where it was read — without it the list's order has no visible cause.
   */
  const pointedAt = ref<string | null>(null)

  function pointAt(hash: string | null) {
    pointedAt.value = hash
  }

  /**
   * Which routes are drawing their boxes over the artwork. A set of names
   * rather than a flag per route, so a fifth recognizer is a name and nothing
   * else; not part of the document, like everything else here.
   */
  const shown = ref(new Set<string>())

  function showing(route: string): boolean {
    return shown.value.has(route)
  }

  /**
   * On a page the route has read, pressing again only changes what is drawn:
   * the same weights cannot answer differently for the same page, so a second
   * run would cost the wait and buy nothing.
   *
   * ⚠️ `shown` outlives the page while `alreadyRead` does not. A route lit up
   * on one page and pressed on the next must read the new page, not switch
   * itself off — turning off is only an answer where there is something on.
   */
  async function toggleRoute(
    route: OcrRoute,
    pageId: string,
    pageDir: string,
    layers: readonly LayerEntry[],
    alreadyRead: boolean,
  ) {
    const next = new Set(shown.value)
    if (shown.value.has(route) && alreadyRead) {
      next.delete(route)
      shown.value = next
      return
    }
    next.add(route)
    shown.value = next
    if (alreadyRead) return

    if (route === PP_OCR) await readColumns(pageId, pageDir, layers)
    else await readRegions(route, REGION_READERS[route], pageId, pageDir, layers)
  }

  /**
   * ⭐ Both region readers are this function; only the weights differ. A
   * region cut out of the page is the only thing either ever sees, which is
   * what lets one detector's findings be read by a recognizer somebody else
   * shipped alongside a different one. The detector's own name for the region
   * rides along, so the list can say where a reading came out of.
   */
  async function readRegions(
    route: OcrRoute,
    model: OcrReader,
    pageId: string,
    pageDir: string,
    layers: readonly LayerEntry[],
  ) {
    if (busy(route)) return
    problem.value = null

    const artwork = baseMapFile(layers)
    if (!artwork) {
      problem.value = '這一頁底下沒有點陣圖層可以辨識'
      return
    }
    mark(route, true)
    try {
      const path = `${layersDirOf(pageDir)}/${artwork}`
      // The filter is applied to what comes back, not to the detectors, so
      // turning the drawn effects on for one reader costs the next one nothing.
      const found = await writingOf(pageId, path)
      const regions = settingsFor(route).onomatopoeia
        ? found
        : found.filter((b) => b.label !== DRAWN)
      const said = await window.ocr.read(model, path, regions.map(justTheBox))

      settle(
        pageId,
        regions.flatMap((b, i) =>
          said[i]?.text ? [{ source: route, label: b.label, ...justTheBox(b), ...said[i] }] : [],
        ),
      )
    } catch (e) {
      problem.value = e instanceof Error ? e.message : String(e)
    } finally {
      mark(route, false)
    }
  }

  /**
   * ⭐ The one route that is not the function above, because of what this
   * recognizer is: a multilingual model reading printed type, from which a
   * hand-drawn sound effect comes back as Chinese or as a digit. Its own
   * detector is the filter — what it finds is what it can read, and it finds
   * no sound effects. So the columns come from it, and the regions they are
   * joined into come from the shared pass.
   */
  async function readColumns(pageId: string, pageDir: string, layers: readonly LayerEntry[]) {
    if (busy(PP_OCR)) return
    problem.value = null

    const artwork = baseMapFile(layers)
    if (!artwork) {
      problem.value = '這一頁底下沒有點陣圖層可以辨識'
      return
    }
    mark(PP_OCR, true)
    try {
      const path = `${layersDirOf(pageDir)}/${artwork}`
      const [found, columns] = await Promise.all([
        writingOf(pageId, path),
        window.ocr.detect('ppocr', path),
      ])
      // The same switch as the region readers: leaving the drawn effects out
      // here means no reading is assembled over them at all.
      const regions = settingsFor(PP_OCR).onomatopoeia
        ? found
        : found.filter((b) => b.label !== DRAWN)
      const spoken = await window.ocr.read('ppocr', path, columns.map(justTheBox))

      settle(
        pageId,
        assemble(regions, columns, spoken).map((r) => ({ source: PP_OCR, ...r })),
      )
    } catch (e) {
      problem.value = e instanceof Error ? e.message : String(e)
    } finally {
      mark(PP_OCR, false)
    }
  }

  /**
   * One act, not two call sites: a reading that entered the pool without
   * being offered to the objects waiting for it would leave the page looking
   * as if the run had done nothing.
   */
  function settle(pageId: string, arrivals: readonly OcrArrival[]) {
    const project = useProjectStore()
    const born = project.absorbReadings(pageId, arrivals)
    if (born.size === 0) return

    const pool = project.readingsOfPage(pageId)
    const confidenceOf = new Map(pool.map((c) => [c.hash, c.confidence]))
    const settled = settleReadings(
      project.labelsOf(pageId).map((object) => {
        const held = object.source.hash
        return {
          id: object.id,
          centre: labelCentre(object),
          source: object.source,
          heldConfidence:
            held === null || held === 'own' ? null : (confidenceOf.get(held) ?? null),
        }
      }),
      pool.filter((c) => born.has(c.hash)),
    )
    for (const [id, source] of settled) project.setLabelSource(pageId, id, source)
  }


  /**
   * For working on the recognizers. Detection is forgotten too — keeping the
   * boxes would make the next press reuse the very pass being questioned.
   */
  function forget(pageId: string) {
    proposals.delete(pageId)
    useProjectStore().forgetReadings(pageId)
    shown.value = new Set()
    problem.value = null
  }

  return {
    pointedAt,
    pointAt,
    shown,
    showing,
    toggleRoute,
    running,
    busy,
    forget,
    problem,
    settingsFor,
    readsDrawn,
    configure,
  }
})

/**
 * The regions two detectors both proposed, counted once: two rows saying the
 * same sentence is noise, not a second opinion — a second opinion is a second
 * *model*. ⚠️ The surer box wins across scores from different networks, which
 * are only roughly the same quantity; safe enough because either box would be
 * read, and the choice is between two views of the same writing.
 */
function distinct(boxes: readonly OcrBox[]): OcrBox[] {
  const kept: OcrBox[] = []
  for (const box of [...boxes].sort((a, b) => b.score - a.score)) {
    if (!kept.some((k) => overlap(k, box) >= SAME_REGION)) kept.push(box)
  }
  return kept
}

function overlap(a: OcrCrop, b: OcrCrop): number {
  const wide = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const tall = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const both = wide * tall
  const either = a.width * a.height + b.width * b.height - both
  return either > 0 ? both / either : 0
}

/**
 * A column goes to whichever region contains its centre — the middle stays
 * inside even when the detector let the ends spill over the edge, which
 * corners do not survive. Within a region the columns run right to left: a
 * fact about Japanese set vertically, which will have to become a property of
 * the document the day a second writing direction shows up. A column inside
 * no region is kept as itself, labelled `line` — on a measured page those
 * were a caption in the margin and print on the spine.
 */
function assemble(
  regions: readonly OcrBox[],
  columns: readonly OcrCrop[],
  spoken: readonly OcrRecognition[],
): (OcrCrop & { label: string; text: string; confidence: number })[] {
  const held: number[][] = regions.map(() => [])
  const loose: number[] = []

  columns.forEach((column, index) => {
    if (!spoken[index]?.text) return
    const x = column.x + column.width / 2
    const y = column.y + column.height / 2
    const at = regions.findIndex(
      (b) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height,
    )
    if (at === -1) loose.push(index)
    else held[at].push(index)
  })

  const assembled: (OcrCrop & { label: string; text: string; confidence: number })[] = []
  regions.forEach((region, at) => {
    const members = held[at]
    if (members.length === 0) return
    members.sort((a, b) => columns[b].x + columns[b].width - (columns[a].x + columns[a].width))
    assembled.push({
      label: region.label,
      ...justTheBox(region),
      text: members.map((i) => spoken[i].text).join(''),
      // The worst column, not the average: one unreadable column spoils the
      // sentence it is part of.
      confidence: Math.min(...members.map((i) => spoken[i].confidence)),
    })
  })
  for (const index of loose) {
    assembled.push({
      label: 'line',
      ...justTheBox(columns[index]),
      text: spoken[index].text,
      confidence: spoken[index].confidence,
    })
  }
  return assembled
}

/**
 * Copied field by field: a box that has been through the store is a Proxy,
 * which structured clone refuses.
 */
function justTheBox(b: OcrCrop) {
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

/**
 * The bottom raster, not the composite: what has been lettered on top is our
 * own text, and feeding it back to a model that would then propose it as a
 * reading is a loop with nothing in it.
 */
function baseMapFile(layers: readonly LayerEntry[]): string | null {
  for (const entry of layers) {
    if (entry.kind === 'raster') return entry.file
    if (entry.kind === 'group') {
      const found = baseMapFile(entry.children)
      if (found) return found
    }
  }
  return null
}
