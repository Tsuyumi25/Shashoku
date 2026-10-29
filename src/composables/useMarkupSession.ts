import { computed, effectScope, nextTick, watch, type ComputedRef } from 'vue'
import {
  applyPlainEdit,
  codeSelection,
  parseMarkup,
  plainCaret,
  unwrapPlainRange,
  wrapCode,
  type Markup,
} from '@shared/page/markup'
import { shownCodeOf } from '@shared/page/units'
import {
  codeEditSurface,
  plainEditSurface,
  textWriter,
} from '@/composables/useTextEditSurface'
import { spanOf, type TextSelection } from '@/lib/textSelection'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * What a press on the floating toolbar does to the code.
 *
 * Only these two: everything the bar offers is either a tag put round the
 * selection or every tag inside it taken off, and saying so in one type is what
 * keeps the bar from growing a branch per button.
 */
export type MarkupAction = { kind: 'wrap'; attrs: string } | { kind: 'clear' }

export interface MarkupSession {
  /** Which block is being typed into, or nothing when no visit is open. */
  editing: ComputedRef<{ pageId: string; labelId: string } | null>
  /** The stored string, tags and all. */
  code: ComputedRef<string | null>
  /** The words that string sets, which is what the canvas is showing. */
  plain: ComputedRef<string | null>
  markup: ComputedRef<Markup | null>
  codeRange: ComputedRef<TextSelection>
  plainRange: ComputedRef<TextSelection>
  writeCode(next: string): void
  writePlain(next: string): void
  selectPlain(anchor: number, focus: number): void
  apply(action: MarkupAction): void
  keepsSession(to: EventTarget | null): boolean
}

/**
 * One body being typed into, held in two notations at once.
 *
 * The stored string is markup code. The translation list shows that code and
 * the canvas shows the words it sets, and both are real controls with real
 * carets — so the same session has two fields, one of which is writing and the
 * other of which is a live projection. This is the arithmetic between them:
 * which range each field is standing on, what an edit on either side does to
 * the one string underneath, and what a tag pressed on either side comes out
 * as.
 *
 * ⭐ There is still exactly one copy of the text. Neither field holds state of
 * its own: both are rendered from the code on the page, and every keystroke
 * goes back to it before anything is drawn.
 */
function createMarkupSession(): MarkupSession {
  const project = useProjectStore()
  const editor = useEditorStore()

  const editing = computed(() => editor.pendingTextEdit)

  /**
   * The code of the body being typed into, read back off the page rather than
   * held here — the session owns a position, never a string.
   */
  const code = computed<string | null>(() => {
    const at = editing.value
    if (at === null) return null
    const page = project.pageById(at.pageId)?.page
    const block = project.blockById(at.pageId, at.labelId)
    return page === undefined || block === undefined ? null : shownCodeOf(page, block)
  })

  const markup = computed<Markup | null>(() =>
    code.value === null ? null : parseMarkup(code.value),
  )

  const plain = computed<string | null>(() => markup.value?.plain ?? null)

  /**
   * Where the selection stands in the code, which is the one notation both
   * sides can be asked about: the field that is writing answers for itself,
   * and the other one is projected onto it.
   */
  const codeRange = computed<TextSelection>(() => {
    const m = markup.value
    if (textWriter.value === 'code' || m === null) return codeEditSurface.range.value
    const at = plainEditSurface.range.value
    const code = codeSelection(m, at.anchor, at.focus)
    return { anchor: code.start, focus: code.end }
  })

  const plainRange = computed<TextSelection>(() => {
    const m = markup.value
    if (textWriter.value === 'plain' || m === null) return plainEditSurface.range.value
    const at = codeEditSurface.range.value
    return { anchor: plainCaret(m, at.anchor), focus: plainCaret(m, at.focus) }
  })

  /**
   * ⭐ The field that is not writing is kept standing on the same text as the
   * one that is, so moving the keyboard from one to the other is a click and
   * nothing else — no handler has to work out where the caret was, because it
   * is already there.
   *
   * It cannot feed back: whichever field is writing is the one every range is
   * derived from, and the write goes to the other one.
   */
  watch(
    () => [textWriter.value, codeRange.value, plainRange.value] as const,
    () => {
      if (editing.value === null) return
      const to = textWriter.value === 'code' ? plainRange.value : codeRange.value
      const surface = textWriter.value === 'code' ? plainEditSurface : codeEditSurface
      surface.setRange(to.anchor, to.focus)
    },
    { flush: 'post' },
  )

  /** What the list's box typed, which is the stored string itself. */
  function writeCode(next: string): void {
    const at = editing.value
    if (at === null || editor.isLayerLocked(at.labelId)) return
    project.updateLabelText(at.pageId, at.labelId, next)
  }

  /**
   * What the canvas's box typed, carried back into the code: the words are the
   * edit, and the tags around them are kept where they stood.
   */
  function writePlain(next: string): void {
    const at = editing.value
    const from = code.value
    if (at === null || from === null || editor.isLayerLocked(at.labelId)) return
    project.updateLabelText(at.pageId, at.labelId, applyPlainEdit(from, next))
  }

  /** The canvas was pointed at, so the canvas takes the keyboard. */
  function selectPlain(anchor: number, focus: number): void {
    textWriter.value = 'plain'
    plainEditSurface.setRange(anchor, focus)
    plainEditSurface.field.value?.focus({ preventScroll: true })
  }

  function nextCode(from: string, m: Markup, at: TextSelection, action: MarkupAction) {
    const span = spanOf(at)
    if (action.kind === 'wrap') {
      return span.from === span.to ? null : wrapCode(from, span.from, span.to, action.attrs)
    }
    // Clearing is asked in plain offsets, since what it takes off is every tag
    // whose words lie inside the selection rather than every tag the code
    // happens to hold between two code offsets.
    const words = { start: plainCaret(m, span.from), end: plainCaret(m, span.to) }
    const cleared = unwrapPlainRange(from, words.start, words.end)
    const after = parseMarkup(cleared)
    return { code: cleared, ...codeSelection(after, words.start, words.end) }
  }

  /**
   * Put a tag round the selection, or take the tags off it.
   *
   * One entry on the undo stack per press: what was typed before the press is
   * banked as the visit it was, the tag goes on as a command of its own, and
   * the session reopens on the same body so the caret never leaves. The
   * selection comes back on the same words it was on, which is what makes 粗
   * then 大 two presses rather than two selections.
   */
  function apply(action: MarkupAction): void {
    const at = editing.value
    const from = code.value
    const m = markup.value
    if (at === null || from === null || m === null) return
    const next = nextCode(from, m, codeRange.value, action)
    if (next === null || next.code === from) return

    const who = textWriter.value
    editor.commitTextEdit()
    editor.cmdUpdateLabelText(at.pageId, at.labelId, from, next.code)
    editor.beginTextEdit(at.pageId, at.labelId, next.code)

    const after = parseMarkup(next.code)
    // After the box has been re-rendered from the new code: writing a value
    // into a textarea drops its selection on the floor.
    void nextTick(() => {
      textWriter.value = who
      if (who === 'code') {
        codeEditSurface.setRange(next.start, next.end)
        codeEditSurface.field.value?.focus({ preventScroll: true })
        return
      }
      plainEditSurface.setRange(plainCaret(after, next.start), plainCaret(after, next.end))
      plainEditSurface.field.value?.focus({ preventScroll: true })
    })
  }

  /**
   * Whether a box losing focus to `to` is still the same visit.
   *
   * The session ends when the keyboard leaves it, and three places are not
   * leaving: the other notation of the same body, the toolbar, and the colour
   * picker the toolbar opens — which is portalled out of the bar and so has to
   * be named rather than contained.
   */
  function keepsSession(to: EventTarget | null): boolean {
    if (!(to instanceof HTMLElement)) return false
    if (to === codeEditSurface.field.value || to === plainEditSurface.field.value) return true
    return to.closest('[data-markup-toolbar], .color-popover') !== null
  }

  return {
    editing,
    code,
    plain,
    markup,
    codeRange,
    plainRange,
    writeCode,
    writePlain,
    selectPlain,
    apply,
    keepsSession,
  }
}

let session: MarkupSession | null = null

/**
 * One per application, not one per component: the frames on the canvas, the
 * row in the list and the bar over either are all looking at the same caret,
 * and a copy each would be the same projection worked out several times and
 * several chances for them to disagree.
 *
 * Its scope is detached so the component that happened to ask first cannot take
 * the session away with it when it unmounts.
 */
export function useMarkupSession(): MarkupSession {
  if (session === null) session = effectScope(true).run(createMarkupSession) as MarkupSession
  return session
}
