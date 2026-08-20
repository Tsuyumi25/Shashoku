import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { NOTICE_MS, useNoticeStore } from '@/stores/noticeStore'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('saying one thing at a time', () => {
  it('starts with nothing to say', () => {
    expect(useNoticeStore().notice).toBeNull()
  })

  it('holds the sentence it was given', () => {
    const notices = useNoticeStore()
    notices.say('選區是空的')
    expect(notices.notice?.text).toBe('選區是空的')
  })

  it('replaces rather than stacks', () => {
    const notices = useNoticeStore()
    notices.say('第一則')
    notices.say('第二則')
    expect(notices.notice?.text).toBe('第二則')
  })

  it('replays the entrance when the same thing is said twice', () => {
    const notices = useNoticeStore()
    notices.say('選區是空的')
    const first = notices.notice?.seq
    notices.say('選區是空的')
    expect(notices.notice?.seq).not.toBe(first)
  })
})

describe('taking itself away', () => {
  it('goes on its own', () => {
    const notices = useNoticeStore()
    notices.say('選區是空的')
    vi.advanceTimersByTime(NOTICE_MS)
    expect(notices.notice).toBeNull()
  })

  it('gives a replacement the full time rather than the remains of the last', () => {
    const notices = useNoticeStore()
    notices.say('第一則')
    vi.advanceTimersByTime(NOTICE_MS - 1)
    notices.say('第二則')
    vi.advanceTimersByTime(NOTICE_MS - 1)
    expect(notices.notice?.text).toBe('第二則')
    vi.advanceTimersByTime(1)
    expect(notices.notice).toBeNull()
  })

  it('leaves no timer behind when dismissed', () => {
    const notices = useNoticeStore()
    notices.say('第一則')
    notices.dismiss()
    expect(notices.notice).toBeNull()
    notices.say('第二則')
    vi.advanceTimersByTime(NOTICE_MS - 1)
    expect(notices.notice?.text).toBe('第二則')
  })
})
