import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushActivity, logActivity, logSettled, setActivityLogging } from './activityLog'

let written: string[] = []

Object.assign(globalThis, {
  window: {
    api: {
      appendActivity: (lines: string) => {
        written.push(...lines.trim().split('\n'))
        return Promise.resolve()
      },
    },
  },
})

function kinds(): string[] {
  return written.map((line) => {
    const { kind, value } = JSON.parse(line) as { kind: string; value?: unknown }
    return value === undefined ? kind : `${kind}=${String(value)}`
  })
}

describe('settled activity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    written = []
    setActivityLogging(true)
  })

  afterEach(() => {
    setActivityLogging(false)
    vi.useRealTimers()
  })

  it('writes a run of the same setting once, at the value it rested on', async () => {
    for (let v = 100; v <= 180; v++) logSettled('pref:box', 'pref', { value: v })
    vi.advanceTimersByTime(600)
    await flushActivity()
    expect(kinds()).toEqual(['pref=180'])
  })

  it('lands a moving setting before whatever happens next, keeping the order', async () => {
    logSettled('pref:box', 'pref', { value: 120 })
    logActivity('press')
    await flushActivity()
    expect(kinds()).toEqual(['pref=120', 'press'])
  })

  it('keeps two different settings as two lines', async () => {
    logSettled('pref:box', 'pref', { value: 120 })
    logSettled('pref:text', 'pref', { value: 'abc' })
    await flushActivity()
    expect(kinds()).toEqual(['pref=120', 'pref=abc'])
  })

  it('counts the same setting again once it has rested', async () => {
    logSettled('pref:box', 'pref', { value: 120 })
    vi.advanceTimersByTime(600)
    logSettled('pref:box', 'pref', { value: 140 })
    await flushActivity()
    expect(kinds()).toEqual(['pref=120', 'pref=140'])
  })
})
