/** How long the edits have to stop before what they produced goes to disk. */
export const DEBOUNCE_MS = 800

/**
 * The longest a burst can hold the write off. Deliberately not restarted by
 * later marks: without it, work that never pauses — a long drag, a page of
 * uninterrupted typing — would keep pushing the write past the horizon.
 */
export const MAX_WAIT_MS = 5000

/**
 * The same two numbers for pixels, and much larger ones.
 *
 * Encoding a whole layer is a tenth of a second or two. Paid once per stroke
 * that is two orders of magnitude too much; paid once every few tens of seconds
 * in the background it is nothing at all — which is the whole argument against
 * writing pixels when they are committed.
 *
 * So the two schedulers are separate rather than one with a compromise between
 * them: a manifest is small and cheap and should follow the hand closely, and
 * pixels are neither.
 */
export const PIXEL_DEBOUNCE_MS = 2000
export const PIXEL_MAX_WAIT_MS = 30000

export interface Autosave {
  /** Something changed. The write follows once the burst settles. */
  mark(): void
  /** Write now, and resolve once nothing is left pending or in flight. */
  flush(): Promise<void>
  /** Drop what is pending without writing it. */
  cancel(): void
}

export interface AutosaveOptions {
  debounceMs?: number
  maxWaitMs?: number
  /** A failed write is reported here; the scheduler itself stays usable. */
  onError?: (err: unknown) => void
}

/**
 * Turns a stream of edits into as few writes as it can get away with.
 *
 * `write` is expected to be self-describing about what is dirty — this only
 * decides when to call it. One call is ever out at a time, and a mark that
 * arrives mid-write earns exactly one more call afterwards, however many marks
 * there were: the writer reads the current state, so a queue of them would be
 * a queue of identical work.
 */
export function createAutosave(write: () => Promise<void>, opts: AutosaveOptions = {}): Autosave {
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS
  const maxWaitMs = opts.maxWaitMs ?? MAX_WAIT_MS

  let pending = false
  let inflight: Promise<void> | null = null
  let quietTimer: ReturnType<typeof setTimeout> | null = null
  let ceilingTimer: ReturnType<typeof setTimeout> | null = null

  function clearTimers() {
    if (quietTimer !== null) clearTimeout(quietTimer)
    if (ceilingTimer !== null) clearTimeout(ceilingTimer)
    quietTimer = null
    ceilingTimer = null
  }

  function run() {
    if (inflight || !pending) return
    clearTimers()
    pending = false
    const started = (async () => {
      try {
        await write()
      } catch (err) {
        opts.onError?.(err)
      } finally {
        inflight = null
      }
    })()
    inflight = started
    void started.then(run)
  }

  function mark() {
    pending = true
    if (quietTimer !== null) clearTimeout(quietTimer)
    quietTimer = setTimeout(run, debounceMs)
    if (ceilingTimer === null) ceilingTimer = setTimeout(run, maxWaitMs)
  }

  async function flush() {
    clearTimers()
    while (pending || inflight) {
      if (inflight) await inflight
      else run()
    }
  }

  function cancel() {
    clearTimers()
    pending = false
  }

  return { mark, flush, cancel }
}
