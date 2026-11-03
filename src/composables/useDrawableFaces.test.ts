import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { FontEntry } from '@shared/fonts/types'
import { useDrawableFaces } from './useDrawableFaces'

const face = (family: string) => ({ family }) as FontEntry
const FACES = ['a', 'b', 'c', 'd'].map(face)

let frames: FrameRequestCallback[] = []
let clock = 0

function nextFrame() {
  const due = frames
  frames = []
  for (const run of due) run(0)
}

beforeEach(() => {
  frames = []
  clock = 0
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run))
  vi.stubGlobal('cancelAnimationFrame', () => (frames = []))
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => vi.unstubAllGlobals())

/** Each face asked costs five milliseconds, so a frame's budget holds two. */
function setup(missing: (text: string) => string) {
  const text = ref('one')
  const asked: string[] = []
  const scope = effectScope()
  const drawable = scope.run(() =>
    useDrawableFaces(
      () => FACES,
      () => text.value,
      () => true,
      (entry, words) => {
        clock += 5
        asked.push(words)
        return entry.family !== missing(words)
      },
    ),
  )!
  return { text, drawable, asked }
}

const families = (set: ReadonlySet<FontEntry> | null) => (set ? [...set].map((e) => e.family) : null)

describe('which faces draw the sample', () => {
  /** ⭐ The click that changed the text does not wait for the whole catalogue. */
  it('answers across frames, keeping the last answer until the new one is whole', async () => {
    const { text, drawable } = setup((words) => (words === 'one' ? 'a' : 'b'))
    expect(families(drawable.value)).toBeNull()
    nextFrame()
    expect(families(drawable.value)).toEqual(['b', 'c', 'd'])

    text.value = 'two'
    await nextTick()
    expect(families(drawable.value)).toEqual(['b', 'c', 'd'])
    nextFrame()
    expect(families(drawable.value)).toEqual(['a', 'c', 'd'])
  })

  /** ⚠️ A pass overtaken by a newer text must never land on top of it. */
  it('drops a pass the text moved on from', async () => {
    const { text, drawable, asked } = setup((words) => words)
    text.value = 'b'
    await nextTick()
    text.value = 'c'
    await nextTick()
    nextFrame()
    nextFrame()
    expect(families(drawable.value)).toEqual(['a', 'b', 'd'])
    expect(asked.filter((words) => words === 'b')).toHaveLength(2)
  })
})
