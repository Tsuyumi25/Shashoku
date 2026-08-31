import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosave, DEBOUNCE_MS, MAX_WAIT_MS } from './autosave'

/** A write whose completion the test decides. */
function deferredWrite() {
  const resolvers: Array<(value?: unknown) => void> = []
  const write = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve as (value?: unknown) => void)
      }),
  )
  return {
    write,
    settleAll: () => {
      for (const resolve of resolvers.splice(0)) resolve()
    },
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createAutosave', () => {
  it('leaves a mark alone until the burst settles', () => {
    const write = vi.fn(async () => {})
    const autosave = createAutosave(write)

    autosave.mark()
    vi.advanceTimersByTime(DEBOUNCE_MS - 1)
    expect(write).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(write).toHaveBeenCalledOnce()
  })

  it('restarts the quiet period on every mark', () => {
    const write = vi.fn(async () => {})
    const autosave = createAutosave(write)

    for (let i = 0; i < 4; i++) {
      autosave.mark()
      vi.advanceTimersByTime(DEBOUNCE_MS - 1)
    }
    expect(write).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(write).toHaveBeenCalledOnce()
  })

  it('lands at the ceiling however long the marks keep coming', () => {
    const write = vi.fn(async () => {})
    const autosave = createAutosave(write)

    // Typing that never pauses long enough for the quiet period to expire.
    for (let elapsed = 0; elapsed < MAX_WAIT_MS; elapsed += DEBOUNCE_MS - 1) {
      autosave.mark()
      vi.advanceTimersByTime(DEBOUNCE_MS - 1)
    }
    expect(write).toHaveBeenCalledOnce()
  })

  it('keeps one write in flight and follows it with one more', async () => {
    const { write, settleAll } = deferredWrite()
    const autosave = createAutosave(write)

    autosave.mark()
    vi.advanceTimersByTime(DEBOUNCE_MS)
    expect(write).toHaveBeenCalledOnce()

    // Three marks arrive while the first write is still out.
    autosave.mark()
    autosave.mark()
    autosave.mark()
    vi.advanceTimersByTime(DEBOUNCE_MS)
    expect(write).toHaveBeenCalledOnce()

    settleAll()
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))

    settleAll()
    await Promise.resolve()
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('writes on flush without waiting out the quiet period', async () => {
    const write = vi.fn(async () => {})
    const autosave = createAutosave(write)

    autosave.mark()
    await autosave.flush()
    expect(write).toHaveBeenCalledOnce()

    // The timer that was pending must not fire a second write.
    vi.advanceTimersByTime(MAX_WAIT_MS)
    expect(write).toHaveBeenCalledOnce()
  })

  it('resolves flush only once the write has landed', async () => {
    const { write, settleAll } = deferredWrite()
    const autosave = createAutosave(write)

    autosave.mark()
    let landed = false
    const flushed = autosave.flush().then(() => {
      landed = true
    })

    await Promise.resolve()
    expect(landed).toBe(false)

    settleAll()
    await flushed
    expect(landed).toBe(true)
  })

  it('drains work that arrives during a flush', async () => {
    const { write, settleAll } = deferredWrite()
    const autosave = createAutosave(write)

    autosave.mark()
    const flushed = autosave.flush()
    await Promise.resolve()

    autosave.mark()
    settleAll()
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    settleAll()

    await flushed
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('writes nothing when there is nothing to write', async () => {
    const write = vi.fn(async () => {})
    const autosave = createAutosave(write)

    await autosave.flush()
    expect(write).not.toHaveBeenCalled()
  })

  it('reports a failed write and stays usable', async () => {
    const onError = vi.fn()
    const write = vi.fn().mockRejectedValueOnce(new Error('disk gone')).mockResolvedValue(undefined)
    const autosave = createAutosave(write, { onError })

    autosave.mark()
    await expect(autosave.flush()).rejects.toThrow('disk gone')
    expect(onError).toHaveBeenCalledOnce()

    autosave.mark()
    await autosave.flush()
    expect(write).toHaveBeenCalledTimes(2)
  })

  /**
   * Whoever awaits a flush is asking whether the bytes are on disk. Answering
   * yes to a write that failed is how a change already accepted from the user
   * disappears with nothing saying so.
   */
  it('hands the write’s own error to whoever awaited the flush', async () => {
    const boom = new Error('read-only file system')
    const autosave = createAutosave(vi.fn().mockRejectedValue(boom), { onError: vi.fn() })

    autosave.mark()
    await expect(autosave.flush()).rejects.toBe(boom)
  })

  it('goes again on the next flush rather than carrying the old failure forward', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('disk gone')).mockResolvedValue(undefined)
    const autosave = createAutosave(write, { onError: vi.fn() })

    autosave.mark()
    await expect(autosave.flush()).rejects.toThrow('disk gone')

    await expect(autosave.flush()).resolves.toBeUndefined()
    expect(write).toHaveBeenCalledTimes(2)
  })

  /**
   * The failure arrived with nobody waiting on it, so nothing was scheduled to
   * try again and nothing was left pending. A flush that read that quiet as a
   * yes is how a project switch, a handle's retirement and the close flow each
   * came to believe a change was on disk when it was not.
   */
  it('does not call a write that already failed in the background landed', async () => {
    const write = vi.fn().mockRejectedValue(new Error('disk full'))
    const autosave = createAutosave(write, { onError: vi.fn() })

    autosave.mark()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(write).toHaveBeenCalledOnce()

    await expect(autosave.flush()).rejects.toThrow('disk full')
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('keeps going again for as long as the write keeps failing', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined)
    const autosave = createAutosave(write, { onError: vi.fn() })

    autosave.mark()
    await expect(autosave.flush()).rejects.toThrow('disk full')
    await expect(autosave.flush()).rejects.toThrow('disk full')
    await expect(autosave.flush()).resolves.toBeUndefined()
    expect(write).toHaveBeenCalledTimes(3)
  })

  it('forgets pending work on cancel', () => {
    const write = vi.fn(async () => {})
    const autosave = createAutosave(write)

    autosave.mark()
    autosave.cancel()
    vi.advanceTimersByTime(MAX_WAIT_MS)
    expect(write).not.toHaveBeenCalled()
  })
})
