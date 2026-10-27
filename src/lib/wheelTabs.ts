/**
 * Ctrl and the wheel anywhere over a tabbed panel steps to its next or previous
 * tab, the way Zen switches tabs — no travelling up to the tab row first. Past
 * either end it comes round to the other.
 *
 * A step is one notch's worth of travel rather than one event. A trackpad sends
 * a stream of small deltas, and with the ends wrapping, stepping on each of
 * them would spin through the tabs and land wherever the stream happened to
 * stop. Without Ctrl the wheel is left alone; with it the event is taken, so
 * the window does not zoom as well.
 */
export function onWheelTabs<T>(
  e: WheelEvent,
  tabs: readonly T[],
  current: T,
  choose: (tab: T) => void,
): void {
  if (!e.ctrlKey) return
  e.preventDefault()
  const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
  // Lines and pages are what a wheel reports when it counts in notches.
  const delta = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? raw : Math.sign(raw) * NOTCH_PX
  const steps = travel(delta, e.timeStamp)
  if (steps === 0 || tabs.length === 0) return
  const at = Math.max(0, tabs.indexOf(current))
  const n = tabs.length
  choose(tabs[(((at + steps) % n) + n) % n])
}

/**
 * Travel worth one step, in pixels: under what one click of a mouse wheel
 * reports, so each click is a step, and a few strokes' worth of a trackpad.
 */
const NOTCH_PX = 50

/** A pause this long ends a gesture, and what it had gathered is dropped. */
const GESTURE_GAP_MS = 250

let gathered = 0
let lastAt = -Infinity

/**
 * One step once enough travel has gathered, and never more than one per event:
 * a mouse notch reporting 120 is still one click of the wheel.
 */
function travel(delta: number, at: number): number {
  if (at - lastAt > GESTURE_GAP_MS || Math.sign(delta) !== Math.sign(gathered)) gathered = 0
  lastAt = at
  gathered += delta
  if (Math.abs(gathered) < NOTCH_PX) return 0
  const step = Math.sign(gathered)
  gathered = 0
  return step
}
