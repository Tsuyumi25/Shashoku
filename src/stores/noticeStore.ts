import { ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * How long a notice stays before it takes itself away. Long enough to read a
 * short sentence twice over, short enough that it is gone before the next
 * gesture wants the space.
 */
export const NOTICE_MS = 3200

export interface Notice {
  readonly text: string
  /**
   * Bumped on every `say`, replacement or not. The view keys the message on it
   * so that saying the same thing twice replays the entrance — otherwise a
   * refused action repeated would look like nothing had happened at all.
   */
  readonly seq: number
}

/**
 * One line on the canvas saying why the thing you just did did not happen.
 *
 * Deliberately not the toast: a toast is for a one-off outcome worth a corner
 * of the window and a dismiss button, and it stacks. This is high-frequency,
 * low-severity and always about the gesture just made, so the newest is the
 * only one worth reading and it replaces its predecessor outright.
 *
 * The interface is a sentence, not a reason code. Filling with nothing
 * selected is the first caller; refusing a write to a locked layer, hitting
 * the history ceiling and finishing a bake are all queued behind it, and none
 * of them should have to teach this store what they are.
 */
export const useNoticeStore = defineStore('notice', () => {
  const notice = ref<Notice | null>(null)

  let seq = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer(): void {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  function say(text: string): void {
    clearTimer()
    seq += 1
    notice.value = { text, seq }
    timer = setTimeout(() => {
      timer = null
      notice.value = null
    }, NOTICE_MS)
  }

  /** For whatever wants the canvas clean before it is looked at again. */
  function dismiss(): void {
    clearTimer()
    notice.value = null
  }

  return { notice, say, dismiss }
})
