/**
 * The renderer-facing shape of OCR.
 *
 * Unlike the text engine next door, this one really is an IPC surface: the
 * models run in a Python process of their own, the main process owns that
 * process, and a page crosses the boundary as a path rather than as pixels.
 *
 * ⭐ Reading a page is one call and not one per model. Only the loop on the far
 * side knows which station comes next, so only it can hold one set of weights at
 * a time; a caller driving the models one at a time cannot, and six sets
 * resident at once is what stops a machine that has other things to do from
 * opening a page. What comes back is a page's worth of findings, and this side
 * decides what to do with them.
 *
 * Every argument has to be a plain value: a reactive object from a Vue store is
 * a Proxy, which structured clone refuses.
 */

/** What the detector was trained to tell apart. */
export type OcrLabel = 'bubble' | 'text_bubble' | 'text_free' | 'text' | 'onomatopoeia' | 'panel' | 'line'

/**
 * Which detector proposed a region, read back off what it called it.
 *
 * The three vocabularies do not overlap, so the label is enough and a reading
 * does not have to carry a second field saying where its box came from. Null
 * for a name none of them uses — a model swapped in later may know other
 * things, and guessing on its behalf would be worse than saying nothing.
 */
export function detectorOf(label: string): 'bubble' | 'layout' | 'ppocr' | null {
  if (label === 'bubble' || label === 'text_bubble' || label === 'text_free') return 'bubble'
  if (label === 'panel' || label === 'text' || label === 'onomatopoeia') return 'layout'
  if (label === 'line') return 'ppocr'
  return null
}

/**
 * A model, named by what it does rather than by who made it.
 *
 * `bubble` and `layout` find regions, and any one's regions can be read by any
 * of `mangaocr`, `baberu` and `hayai` — no recognizer knows or cares which
 * detector proposed what it is looking at.
 *
 * `ppocr` does both. What it finds are columns rather than regions — a column is
 * a slice of a region, so it is what says where a region's lines are; what it
 * reads is one column at a time, which is why it is the one reader that knows
 * its own line breaks without being told.
 *
 * `fontdet` reads no characters at all. It is asked how a region is *set* —
 * which way it runs, at what size, at what leading.
 */
export type OcrModel =
  | 'bubble'
  | 'layout'
  | 'fontdet'
  | 'mangaocr'
  | 'baberu'
  | 'hayai'
  | 'ppocr'

/** A rectangle on the page, in the page's own pixels. */
export interface OcrCrop {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A model, as it stands right now.
 *
 * `cached` is not `loaded`: one says the weights are on the disk, the other
 * says they are in memory. The first is what makes a click cost a download, the
 * second is what makes it cost a wait.
 */
export interface OcrModelState {
  model: OcrModel
  loaded: boolean
  cached: boolean
}

/**
 * What the engine is doing, for saying so while someone waits.
 *
 * Pushed rather than polled because the interesting moments — a first load, a
 * crash, a restart — all happen while a request is already outstanding.
 */
export interface OcrStatus {
  state: 'stopped' | 'starting' | 'ready' | 'loading' | 'error'
  model?: OcrModel
  detail?: string
}

/**
 * A region as the trip left it: where the writing is, and how it is set.
 *
 * The typography is a measurement of *this run* rather than a fact about the
 * page — a better model would answer a little differently — which is why only
 * three of these fields go on to ride with a reading, and why none of them
 * takes part in a reading's identity.
 */
export interface OcrRegion extends OcrCrop {
  /** Unconstrained on purpose: a model swapped in later may know other things. */
  label: OcrLabel | string
  /** Which axis the lines stack on. */
  vertical: boolean
  fontSizePx: number
  /** Baseline to baseline, as a percentage of the type size. */
  leadingPercent: number
  /**
   * The region's own lines as the column cutter measured them, in the order
   * they are read.
   *
   * ⭐ Measured, not derived. A transplant that has to place a break in a
   * reading with no line breaks of its own would otherwise divide the
   * characters evenly and call that the answer — over the very lengths
   * something already went and measured. Empty when the cutter found fewer than
   * two, which is the ordinary state of a one-line balloon.
   */
  columns: OcrCrop[]
}

/**
 * One recognizer's answer for one region.
 *
 * `lines` is empty for the two readers that cannot say where the artwork broke
 * — which is most of the time, and is why a winner usually has to borrow its
 * line breaks from whoever could.
 */
export interface OcrReading {
  /** Index into the same answer's `regions`. */
  region: number
  model: OcrModel
  text: string
  confidence: number
  lines: string[]
}

/** Everything one trip found on one page. */
export interface OcrPageResult {
  regions: OcrRegion[]
  readings: OcrReading[]
}

/**
 * Which station the trip is at. The whole list rides along so a caller can say
 * "four of eight" without keeping its own copy of an order it does not choose.
 */
export interface OcrProgress {
  station: string
  stations: string[]
}

export interface ShashokuOcrApi {
  /**
   * Every model and where it stands. Answered without loading anything, so the
   * interface can decide what to offer before paying for it.
   */
  models(): Promise<OcrModelState[]>
  /**
   * Everything written on one page, from every detector and every reader, in
   * one trip.
   *
   * `onomatopoeia` says whether the hand-drawn effects take part at all. Which
   * reader is any good at them is not a choice and is not offered here.
   */
  readPage(imagePath: string, onomatopoeia: boolean): Promise<OcrPageResult>
  /** Drops one model's weights. The process stays, so the next load is cheaper. */
  unload(model: OcrModel): Promise<boolean>
  /** Ends the engine process, giving back everything including its allocator. */
  stop(): Promise<void>
  /** Told when the engine starts, becomes ready, loads a model, or dies. */
  onStatus(handler: (status: OcrStatus) => void): void
  /** Told as a trip passes each station, so a long wait is not a hung one. */
  onProgress(handler: (progress: OcrProgress) => void): void
}
