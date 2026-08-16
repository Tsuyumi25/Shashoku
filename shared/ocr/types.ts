/**
 * The renderer-facing shape of OCR.
 *
 * Unlike the text engine next door, this one really is an IPC surface: the
 * models run in a Python process of their own, the main process owns that
 * process, and a page crosses the boundary as a path rather than as pixels.
 *
 * Which model answers is an argument rather than part of the method name.
 * There are five of them, they are compared against each other rather than
 * ranked, and each is loaded and dropped on its own — none of which survives
 * being spelled into six method names.
 *
 * Detection and recognition stay two calls, because they are two questions with
 * different lifetimes: which box holds text is close to settled, what the box
 * says is the half expected to be replaced. A box drawn by hand is as good an
 * input to reading as a detected one, and will be.
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
 * `ppocr` does both and pairs only with itself. What it finds are columns
 * rather than regions, which is no use to the three above; what it reads is one
 * column at a time, and its own detector is what keeps it to the printed type
 * it is good at.
 */
export type OcrModel = 'bubble' | 'layout' | 'mangaocr' | 'baberu' | 'hayai' | 'ppocr'

/**
 * Something a detector found, in the page's own pixels.
 *
 * `score` rides along because a box is a measurement rather than a fact — the
 * same model that reads a clean balloon perfectly will invent a sentence out of
 * a smudge, and it says which is which.
 */
export interface OcrBox {
  /** Unconstrained on purpose: a model swapped in later may know other things. */
  label: OcrLabel | string
  score: number
  x: number
  y: number
  width: number
  height: number
}

/** A region to read. Nothing says it has to have come from a detector. */
export interface OcrCrop {
  x: number
  y: number
  width: number
  height: number
}

/**
 * What a recognizer made of one crop.
 *
 * All three answer in this shape, and their confidences are the same quantity
 * measured the same way — the geometric mean of the probability the model put
 * on each character it wrote. That is what makes them comparable, which is the
 * only reason the number is here: on its own a confidence decides nothing.
 */
export interface OcrRecognition {
  text: string
  confidence: number
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

export interface ShashokuOcrApi {
  /**
   * Every model and where it stands. Answered without loading anything, so the
   * interface can decide what to offer before paying for it.
   */
  models(): Promise<OcrModelState[]>
  /**
   * Boxes on one page. `minScore` defaults to whatever the chosen model treats
   * as the line between measuring and guessing.
   *
   * Loads the model if it is not loaded — the caller asking for a page is the
   * decision to pay for it, and nothing is loaded before someone asks.
   */
  detect(model: OcrModel, imagePath: string, minScore?: number): Promise<OcrBox[]>
  /**
   * One line per crop, in the order given. Positional rather than keyed: the
   * caller knows what it asked about, and a box has no identity of its own yet.
   */
  read(model: OcrModel, imagePath: string, crops: OcrCrop[]): Promise<OcrRecognition[]>
  /** Drops one model's weights. The process stays, so the next load is cheaper. */
  unload(model: OcrModel): Promise<boolean>
  /** Ends the engine process, giving back everything including its allocator. */
  stop(): Promise<void>
  /** Told when the engine starts, becomes ready, loads a model, or dies. */
  onStatus(handler: (status: OcrStatus) => void): void
}
