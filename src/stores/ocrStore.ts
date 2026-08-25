import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { OcrModel, OcrPageResult, OcrProgress, OcrRegion } from '@shared/ocr/types'
import type { LayerEntry, TextLayerEntry } from '@shared/page/types'
import { textOfBody } from '@shared/page/text'
import { layersDirOf } from '@shared/ssk/constants'
import { settleBreaks } from '@shared/ocr/breaks'
import { decide } from '@shared/ocr/decide'
import { fold } from '@shared/ocr/clean'
import type { OcrArrival } from '@shared/ocr/pool'
import type { OcrPreference } from '@shared/preferences/types'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { drawnLabel } from '@/lib/labelRaster'

/**
 * Part of a reading's identity: rewording one turns every reading it made into
 * a stranger the next run would add all over again.
 */
const MANGA_OCR = 'manga-ocr'
const PP_OCR = 'ppocr-v6'
const BABERU_OCR = 'baberu-ocr'
const HAYAI_OCR = 'hayai-ocr-v2'

/**
 * Every reader a page's pool can hold an entry from.
 *
 * ⚠️ Not exported any more, and that is the point: nothing outside this file
 * picks a reader now. They are stages of one trip, and a second list of these
 * names anywhere else would be a second thing to keep in step.
 */
const OCR_ROUTES = [MANGA_OCR, PP_OCR, BABERU_OCR, HAYAI_OCR] as const
type OcrRoute = (typeof OCR_ROUTES)[number]

/**
 * What the engine calls a reader, and what a reading made by it is stored
 * under. ⚠️ The right-hand side can never be reworded; the left-hand side is
 * the engine's and is free to move.
 */
const ROUTE_OF: Partial<Record<OcrModel, OcrRoute>> = {
  mangaocr: MANGA_OCR,
  ppocr: PP_OCR,
  baberu: BABERU_OCR,
  hayai: HAYAI_OCR,
}

/**
 * Which readers may only vote.
 *
 * ⭐ Empty, and kept anyway. Whether a source takes part in the vote and whether
 * it may create an object out of nothing are two separate permissions, and the
 * shape has to exist before the source that needs it arrives — otherwise the
 * first unreliable reader to be added is one that can litter a page.
 */
const MAY_NOT_CREATE: ReadonlySet<string> = new Set()

/**
 * Which readers the list's own floor does not apply to.
 *
 * ⭐ A confidence is only comparable between readers who mean the same thing by
 * it. `hayai` is the one asked about hand-drawn lettering and returns lower
 * numbers across the board than the three that read printed type — on a fully
 * hand-lettered page its median was 0.64 against their 0.48 to 0.53, and it was
 * the one worth reading there. Held to the same line it would be the first
 * thing cut from exactly the pages that need it.
 *
 * ⚠️ A third permission alongside voting and creating, and separate from both
 * on purpose: see `shared/ocr/offer.ts`.
 */
export const OWN_CONFIDENCE_SCALE: ReadonlySet<string> = new Set([HAYAI_OCR])

/**
 * What each station of a trip is called, for saying where a long wait has got
 * to. A station the engine names and this list does not is shown under its own
 * name rather than dropped — a fifth reader should read as an unfamiliar stop,
 * not as no stop at all.
 */
const STATION_NAMES: Record<string, string> = {
  'detect-bubble': '找氣泡',
  'detect-layout': '找版面',
  typography: '量排版',
  'read-ppocr': '逐欄辨識（PP-OCR）',
  'read-mangaocr': 'manga-ocr 辨識',
  'read-baberu': 'Baberu 辨識',
  'read-hayai': 'Hayai 辨識',
}

/**
 * Where the object's source visually sits, not the stored anchor, whose corner
 * depends on how the text is aligned.
 *
 * ⭐ The source and not the translation. A reading is a measurement of the
 * artwork, so what it has to be matched against is the body that stands for the
 * artwork — a translation carried off to the margin for the sake of the page
 * has not moved the balloon it was read out of.
 */
function labelCentre(object: TextLayerEntry) {
  const body = object.source
  return drawnLabel(
    textOfBody(body),
    body.style,
    object.effects,
    { x: body.x, y: body.y },
    body.rotation,
  ).center
}

/**
 * What a page's artwork was measured to hold. None of it is part of the
 * document — rerunning is free, and nothing downstream can come to depend on a
 * box a better model would have drawn elsewhere.
 */
export const useOcrStore = defineStore('ocr', () => {
  /** Which pages have a trip in flight. */
  const running = ref(new Set<string>())
  const problem = ref<string | null>(null)

  function busy(pageId: string): boolean {
    return running.value.has(pageId)
  }

  function mark(pageId: string, working: boolean) {
    const next = new Set(running.value)
    if (working) next.add(pageId)
    else next.delete(pageId)
    running.value = next
  }

  /**
   * How far the trip in flight has got. Null between trips.
   *
   * ⭐ Pushed from the engine rather than counted here: the order of the stations
   * is the engine's, since it is the only thing that knows which weights it can
   * afford to hold next. This side reports and does not decide.
   */
  const station = ref<{ name: string; at: number; of: number } | null>(null)

  window.ocr.onProgress((progress: OcrProgress) => {
    const at = progress.stations.indexOf(progress.station)
    station.value = {
      name: STATION_NAMES[progress.station] ?? progress.station,
      at: at === -1 ? 0 : at + 1,
      of: progress.stations.length,
    }
  })

  /**
   * How this machine reads a page.
   *
   * ⭐ The run's, not each model's. The recognizers are stages of one trip now,
   * so which device to use is a question about the trip — and a machine with a
   * card runs the whole of it there.
   */
  function settings(): OcrPreference {
    return usePreferencesStore().prefs.ocr
  }

  /**
   * Writes the whole entry rather than the changed field: a half entry would be
   * merged against a default that is free to move, and a run quietly changing
   * behaviour under a setting somebody already looked at is worse than a file
   * that repeats itself.
   */
  function configure(change: Partial<OcrPreference>) {
    usePreferencesStore().prefs.ocr = { ...settings(), ...change }
  }

  /**
   * Which reading the pointer is over in the list, so the canvas can say where
   * it was read — without it the list's order has no visible cause.
   */
  const pointedAt = ref<string | null>(null)

  function pointAt(hash: string | null) {
    pointedAt.value = hash
  }

  /**
   * Whether a page's boxes are drawn over the artwork. One switch rather than
   * one per reader: there is one trip now, so there is one set of regions.
   */
  const shown = ref(new Set<string>())

  function showing(pageId: string): boolean {
    return shown.value.has(pageId)
  }

  function toggleBoxes(pageId: string) {
    const next = new Set(shown.value)
    if (next.has(pageId)) next.delete(pageId)
    else next.add(pageId)
    shown.value = next
  }

  /**
   * ⭐ One act. Every detector runs, every reader is asked, and the trip is a
   * single call so that only one model's weights are ever resident.
   *
   * Pressing it a second time on the same page is free and changes nothing: the
   * same weights over the same artwork produce the same identities, which the
   * pool already holds.
   */
  async function readPage(pageId: string, pageDir: string, layers: readonly LayerEntry[]) {
    if (busy(pageId)) return
    problem.value = null

    const artwork = baseMapFile(layers)
    if (!artwork) {
      problem.value = '這一頁底下沒有點陣圖層可以辨識'
      return
    }

    mark(pageId, true)
    try {
      const found = await window.ocr.readPage(
        `${layersDirOf(pageDir)}/${artwork}`,
        settings().onomatopoeia,
      )
      useProjectStore().absorbReadings(pageId, arrivalsOf(found))
      settle(pageId)
      shown.value = new Set(shown.value).add(pageId)
    } catch (e) {
      problem.value = e instanceof Error ? e.message : String(e)
    } finally {
      station.value = null
      mark(pageId, false)
    }
  }

  /**
   * The page's own court, over the whole pool.
   *
   * ⚠️ Held whether or not the trip brought anything new. A rerun that read
   * nothing it had not read before still has to decide again — an object drawn
   * by hand since the last pass is exactly the case that depends on it, and
   * gating this on new readings would leave that object empty for ever.
   */
  function settle(pageId: string) {
    const project = useProjectStore()
    useEditorStore().cmdApplyVerdict(
      pageId,
      decide(
        project.labelsOf(pageId).map((object) => ({
          id: object.id,
          centre: labelCentre(object),
          source: object.source,
        })),
        project.readingsOfPage(pageId),
        MAY_NOT_CREATE,
      ),
    )
  }

  /**
   * For working on the recognizers. Detection is forgotten too — keeping the
   * boxes would make the next press reuse the very pass being questioned.
   */
  function forget(pageId: string) {
    useProjectStore().forgetReadings(pageId)
    shown.value = new Set()
    problem.value = null
  }

  return {
    pointedAt,
    pointAt,
    shown,
    showing,
    toggleBoxes,
    running,
    busy,
    station,
    readPage,
    forget,
    problem,
    settings,
    configure,
  }
})

/**
 * What a trip found, in the shape the pool takes.
 *
 * ⭐ The line breaks are settled here, before anything has an identity, and
 * region by region. That is what keeps a rerun free: a reading's text is fixed
 * by the trip that produced it, so the same page read again produces the same
 * identities and the pool does not move. Settling them later would mean
 * rewriting readings that are already in the pool, which is exactly what nothing
 * automatic is allowed to do.
 *
 * ⚠️ A reading from a reader this side has no name for is dropped rather than
 * stored under the engine's name: the name is the identity, and one invented
 * here would be one a later version could not recognize as already present.
 */
export function arrivalsOf(found: OcrPageResult): OcrArrival[] {
  const byRegion = new Map<number, OcrArrival[]>()

  for (const reading of found.readings) {
    const route = ROUTE_OF[reading.model]
    const region = found.regions[reading.region]
    if (!route || !region) continue

    // A reader's own line breaks are part of what it says the artwork says, so
    // they travel inside the text rather than beside it.
    const text = fold(reading.lines.length > 1 ? reading.lines.join('\n') : reading.text)
    if (!text) continue

    const at = byRegion.get(reading.region) ?? []
    at.push({
      source: route,
      text,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      confidence: reading.confidence,
      label: region.label,
      vertical: region.vertical,
      fontSizePx: region.fontSizePx,
      leadingPercent: region.leadingPercent,
    })
    byRegion.set(reading.region, at)
  }

  return [...byRegion].flatMap(([at, readings]) =>
    settleBreaks(readings, lengthsOf(found.regions[at])),
  )
}

/**
 * How long each of a region's measured lines is, along the direction it is read.
 *
 * ⚠️ Spent here and never stored. These describe one measurement of the page
 * rather than anything about a reading, and a reading carrying them would make
 * every rerun add the whole page again.
 */
function lengthsOf(region: OcrRegion): number[] {
  return region.columns.map((column) => (region.vertical ? column.height : column.width))
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
