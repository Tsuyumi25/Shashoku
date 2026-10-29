import { computed, readonly, ref, shallowRef } from 'vue'
import { pinnedInputBox, type CaretOnScreen, type PinnedBox } from '@/lib/pinnedInput'

/**
 * A native control something is being typed into, and where its caret stands.
 *
 * Typing never happens on an engine-drawn surface (ADR 0001, decision 4), so
 * something has to hold the keyboard. This is that control, published so a
 * surface can project what it says and point it somewhere new. There is no
 * second copy of the text: the control owns the string, the projection owns
 * nothing.
 *
 * One per body of text rather than one for the application. A caret is singular
 * within the thing it is in, and the font picker's sample and a page's
 * translations are two different things — sharing a surface between them would
 * be one answer to two questions.
 *
 * `onFocus` is how a surface says it has become the one being written into,
 * for the pair below that hold the same body in two notations.
 */
export function createTextEditSurface(options: { onFocus?: () => void } = {}) {
  const field = shallowRef<HTMLTextAreaElement | null>(null)

  const range = ref<{ start: number; end: number }>({ start: 0, end: 0 })

  /**
   * Bumped whenever the caret moves, so a projection can restart its blink from
   * the bright half. A caret that lands mid-blink reads as a keystroke that did
   * not register.
   */
  const moved = ref(0)

  function publish(start: number, end: number): void {
    const held = range.value
    if (held.start === start && held.end === end) return
    range.value = { start, end }
    moved.value += 1
  }

  function read(): void {
    const el = field.value
    if (!el) return
    publish(el.selectionStart ?? 0, el.selectionEnd ?? 0)
  }

  let pending = 0

  /**
   * ⭐ Measured rather than assumed: during `keydown` the field still reports
   * the selection the key is about to change, and the next animation frame
   * reports the one it changed it to. Reading late is what makes an arrow key
   * land the caret in the right place without predicting what the key would
   * have done — and predicting is exactly what would go wrong the first time a
   * key means something else to the platform's own editing.
   */
  function readSoon(): void {
    if (pending !== 0) return
    pending = requestAnimationFrame(() => {
      pending = 0
      read()
    })
  }

  /** Everything that can move a caret without the application being told. */
  const WATCHED = ['keydown', 'keyup', 'input', 'select', 'pointerup', 'focus'] as const

  function tookFocus(): void {
    options.onFocus?.()
  }

  function attach(el: HTMLTextAreaElement): void {
    for (const name of WATCHED) el.addEventListener(name, readSoon)
    el.addEventListener('focus', tookFocus)
  }

  function detach(el: HTMLTextAreaElement): void {
    for (const name of WATCHED) el.removeEventListener(name, readSoon)
    el.removeEventListener('focus', tookFocus)
  }

  /**
   * Hand over the box being typed into, or nothing when it goes away.
   * Idempotent: a template ref fires on every re-render with the same element,
   * and re-registering has to be free.
   */
  function register(el: HTMLTextAreaElement | null): void {
    const held = field.value
    if (held === el) return
    if (held) detach(held)
    field.value = el
    if (!el) {
      publish(0, 0)
      return
    }
    attach(el)
    read()
  }

  /**
   * Put the caret somewhere, as an act rather than an observation — a click on
   * a projection is the application deciding where the caret goes, so the field
   * is told and the projection follows in the same turn instead of a frame
   * later.
   *
   * Clamped, because the text can have been replaced under a caret that was
   * standing past the end of what replaced it.
   *
   * `start` is where a drag began and `end` where it is now, so the two can come
   * in either order. The field is handed them ordered with a direction: given
   * end first, it collapses the selection to that end, and a paste or a typed
   * key then lands beside the words instead of replacing them.
   */
  function setRange(start: number, end = start): void {
    const el = field.value
    if (!el) return
    const limit = el.value.length
    const from = Math.max(0, Math.min(start, limit))
    const to = Math.max(0, Math.min(end, limit))
    el.setSelectionRange(Math.min(from, to), Math.max(from, to), to < from ? 'backward' : 'forward')
    publish(from, to)
  }

  /**
   * Whether the box should ride the caret on the drawn text instead of sitting
   * wherever the layout puts it, decided by whoever opened the session — which
   * is the one thing that says where the user is looking.
   */
  const pinned = ref(false)

  /** Where the caret stands on screen, published by whatever is projecting it. */
  const caret = ref<CaretOnScreen | null>(null)

  /**
   * The window as it was when the caret was last published. Taken there rather
   * than read where the box is worked out: a caret is republished whenever
   * anything moves it, resizing the window included, so this cannot go stale
   * without the caret going stale first.
   */
  const viewport = ref({ w: 0, h: 0 })

  function pin(to: boolean): void {
    pinned.value = to
  }

  function showCaretAt(at: CaretOnScreen | null): void {
    caret.value = at
    if (at !== null) viewport.value = { w: window.innerWidth, h: window.innerHeight }
  }

  /** The box the input should take, or null to leave it where the layout puts it. */
  const pinnedBox = computed<PinnedBox | null>(() => {
    const at = caret.value
    if (!pinned.value || at === null) return null
    return pinnedInputBox(at, viewport.value)
  })

  return {
    field,
    range: readonly(range),
    moved: readonly(moved),
    pinned: readonly(pinned),
    pinnedBox,
    register,
    setRange,
    pin,
    showCaretAt,
    read,
    readSoon,
  }
}

export type TextEditSurface = ReturnType<typeof createTextEditSurface>

/**
 * Which of the two boxes below is the one being written into.
 *
 * A body is held in one string — the markup code — and shown in two notations
 * at once: the code itself in the translation list, and the words it sets on
 * the canvas. Both are real controls with real carets, so something has to say
 * which caret is the user's and which is a projection of it. Focus says it,
 * and this is focus remembered: a popover opened from the toolbar takes the
 * keyboard for a moment without the session changing hands.
 */
export type TextWriter = 'code' | 'plain'

export const textWriter = ref<TextWriter>('code')

/**
 * The translation list's box, holding the code with its tags in it. Shared
 * because the row that holds it and the canvas that projects its caret are
 * different components looking at the same selection.
 */
export const codeEditSurface = createTextEditSurface({
  onFocus: () => {
    textWriter.value = 'code'
  },
})

/**
 * The canvas's own box, holding the plain words the engine sets. It is never
 * anywhere but on the insertion point — being where the IME opens its
 * candidates is the whole of its job — so it is pinned once and for good.
 */
export const plainEditSurface = createTextEditSurface({
  onFocus: () => {
    textWriter.value = 'plain'
  },
})
plainEditSurface.pin(true)
