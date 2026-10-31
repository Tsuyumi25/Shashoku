/**
 * Everything the hand does in the app, one line each, so the working of a
 * chapter can be read back afterwards — by a person, or by an agent asked
 * where the time went. Moving the view is the one thing left out: it is most
 * of the events and says nothing about the work.
 *
 * Words are written as they are. What was typed is part of how the work went.
 *
 * Batched and handed over once a second rather than per event: a stroke or a
 * run of keys is dozens of lines, and each would otherwise be a round trip.
 */

const FLUSH_MS = 1000

/** How long a run of the same setting has to rest before it counts as one change. */
const SETTLE_MS = 600

let enabled = false
let buffer: string[] = []
let timer: ReturnType<typeof setTimeout> | undefined

/** The latest of a run still moving, written once the run stops or anything else happens. */
let settling: { key: string; line: string } | undefined
let settleTimer: ReturnType<typeof setTimeout> | undefined

export function setActivityLogging(on: boolean): void {
  enabled = on
  if (!on) {
    buffer = []
    clearTimeout(settleTimer)
    settling = undefined
  }
}

function push(line: string): void {
  buffer.push(line)
  if (timer === undefined) timer = setTimeout(() => void flushActivity(), FLUSH_MS)
}

function landSettling(): void {
  clearTimeout(settleTimer)
  if (settling) push(settling.line)
  settling = undefined
}

export function logActivity(kind: string, data: Record<string, unknown> = {}): void {
  if (!enabled) return
  landSettling()
  push(JSON.stringify({ t: Date.now(), kind, ...data }))
}

/**
 * As `logActivity`, but a run under the same `key` is one line, the value it
 * came to rest at. A slider dragged across its range is one change to the
 * hand, not the eighty values it passed through on the way.
 */
export function logSettled(key: string, kind: string, data: Record<string, unknown> = {}): void {
  if (!enabled) return
  if (settling && settling.key !== key) landSettling()
  clearTimeout(settleTimer)
  settling = { key, line: JSON.stringify({ t: Date.now(), kind, ...data }) }
  settleTimer = setTimeout(landSettling, SETTLE_MS)
}

/** Hand over what is waiting now — for the moment before the window goes. */
export function flushActivity(): Promise<void> {
  landSettling()
  clearTimeout(timer)
  timer = undefined
  if (buffer.length === 0) return Promise.resolve()
  const lines = buffer.join('\n') + '\n'
  buffer = []
  return window.api.appendActivity(lines).catch((err: unknown) => {
    console.error('activity log: write failed', err)
  })
}
