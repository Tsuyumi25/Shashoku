/**
 * Font samples drawn a slice of each frame rather than all at once. The engine
 * draws on the renderer's own thread, so a grid's worth of samples asked for in
 * one go is a freeze; spread over frames, the list keeps scrolling while they
 * arrive. What is on screen goes before what is only mounted around it.
 */

export interface SampleJob {
  run: () => void
  /** Asked when the job is picked, since a cell scrolls in and out while it waits. */
  visible: () => boolean
}

/** How long one frame may spend drawing samples, in milliseconds. */
const FRAME_BUDGET_MS = 8

const waiting = new Set<SampleJob>()
let frame: number | null = null

function next(): SampleJob | undefined {
  for (const job of waiting) if (job.visible()) return job
  return waiting.values().next().value
}

function drain() {
  frame = null
  const until = performance.now() + FRAME_BUDGET_MS
  while (waiting.size > 0 && performance.now() < until) {
    const job = next()
    if (job === undefined) break
    waiting.delete(job)
    job.run()
  }
  if (waiting.size > 0) frame = requestAnimationFrame(drain)
}

/** Queues a job; the returned function takes it back out if it has not run. */
export function enqueueSample(job: SampleJob): () => void {
  waiting.add(job)
  frame ??= requestAnimationFrame(drain)
  return () => {
    waiting.delete(job)
  }
}
