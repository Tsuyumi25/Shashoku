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

let enabled = false
let buffer: string[] = []
let timer: ReturnType<typeof setTimeout> | undefined

export function setActivityLogging(on: boolean): void {
  enabled = on
  if (!on) buffer = []
}

export function logActivity(kind: string, data: Record<string, unknown> = {}): void {
  if (!enabled) return
  buffer.push(JSON.stringify({ t: Date.now(), kind, ...data }))
  if (timer === undefined) timer = setTimeout(() => void flushActivity(), FLUSH_MS)
}

/** Hand over what is waiting now — for the moment before the window goes. */
export function flushActivity(): Promise<void> {
  clearTimeout(timer)
  timer = undefined
  if (buffer.length === 0) return Promise.resolve()
  const lines = buffer.join('\n') + '\n'
  buffer = []
  return window.api.appendActivity(lines).catch((err: unknown) => {
    console.error('activity log: write failed', err)
  })
}
