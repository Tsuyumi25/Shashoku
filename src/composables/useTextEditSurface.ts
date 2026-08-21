import { computed, readonly, ref, shallowRef } from 'vue'
import { pinnedInputBox, type CaretOnScreen, type PinnedBox } from '@/lib/pinnedInput'

/**
 * The one native control a translation is being typed into, and where its caret
 * currently stands.
 *
 * Typing never happens on the engine-drawn surface (ADR 0001, decision 4), so
 * something has to hold the keyboard. The translation list already has a box
 * per row and already owns focus, Esc, blur and the undo grain — this is that
 * box, published so the canvas can project what it says and point it somewhere
 * new. There is no second copy of the text: the field owns the string, the
 * canvas owns nothing.
 *
 * Module scope rather than per-caller, because a caret is a singular thing.
 * Two of these would be two answers to where it is.
 */
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
 * ⭐ Measured rather than assumed: during `keydown` the field still reports the
 * selection the key is about to change, and the next animation frame reports
 * the one it changed it to. Reading late is what makes an arrow key land the
 * caret in the right place without predicting what the key would have done —
 * and predicting is exactly what would go wrong the first time a key means
 * something else to the platform's own editing.
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

function attach(el: HTMLTextAreaElement): void {
  for (const name of WATCHED) el.addEventListener(name, readSoon)
}

function detach(el: HTMLTextAreaElement): void {
  for (const name of WATCHED) el.removeEventListener(name, readSoon)
}

/**
 * Hand over the box a translation is being typed into, or nothing when it goes
 * away. Idempotent: a template ref fires on every re-render with the same
 * element, and re-registering has to be free.
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
 * the canvas is the application deciding where the caret goes, so the field is
 * told and the projection follows in the same turn instead of a frame later.
 */
function setRange(start: number, end = start): void {
  const el = field.value
  if (!el) return
  el.setSelectionRange(start, end)
  publish(start, end)
}

/**
 * Whether the box should ride the caret on the canvas instead of sitting in its
 * row, decided by whoever opened the session — which is the one thing that says
 * where the user is looking. Typing down the list leaves it exactly where it
 * has always been.
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

/** The box the input should take, or null to leave it in the flow of its row. */
const pinnedBox = computed<PinnedBox | null>(() => {
  const at = caret.value
  if (!pinned.value || at === null) return null
  return pinnedInputBox(at, viewport.value)
})

export function useTextEditSurface() {
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
