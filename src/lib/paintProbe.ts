import { ref } from 'vue'

/**
 * TEMPORARY — measuring what a stroke costs the stack. Delete with its callers
 * once the numbers are in.
 *
 * `__paint.sync = true` in the console puts the preview back on the old path —
 * repaint inside the pointer event, and the wand's whole-page composite keyed
 * on it — so both sides of the comparison come from one session, on one
 * machine, in one power state.
 */
const sync = ref(false)

const counts = { events: 0, paints: 0, ms: 0, composites: 0 }

const probe = {
  get sync(): boolean {
    return sync.value
  },
  set sync(on: boolean) {
    sync.value = on
  },
  get counts(): Readonly<typeof counts> {
    return counts
  },
  report(): void {
    if (counts.events === 0) return
    const each = counts.paints === 0 ? 0 : counts.ms / counts.paints
    console.log(
      `stroke: ${counts.events} events → ${counts.paints} paints ` +
        `(${counts.ms.toFixed(1)} ms total, ${each.toFixed(2)} ms each), ` +
        `${counts.composites} page composites, sync=${sync.value}`,
    )
    counts.events = 0
    counts.paints = 0
    counts.ms = 0
    counts.composites = 0
  },
}

;(globalThis as unknown as { __paint: typeof probe }).__paint = probe

/** Reactive, so the wand's key re-tracks when the switch is thrown. */
export function probeSync(): boolean {
  return sync.value
}

export function probeEvent(): void {
  counts.events++
}

export function probePaint(ms: number): void {
  counts.paints++
  counts.ms += ms
}

export function probeComposite(): void {
  counts.composites++
}

export function probeReport(): void {
  probe.report()
}
