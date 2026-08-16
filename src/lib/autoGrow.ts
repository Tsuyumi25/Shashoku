import type { Directive } from 'vue'

/**
 * A textarea exactly as tall as what is in it.
 *
 * ⭐ In a list of candidates the whole point of a row is that it can be read at a glance,
 * and a box that scrolls hides the end of the sentence behind a gesture — the
 * one thing a reader has to compare is the part they cannot see. So the row
 * grows instead, and the scrolling happens once, in the list.
 *
 * ⚠️ The reset to `auto` is not redundant. `scrollHeight` never reports less
 * than the height already set, so measuring without letting it shrink first
 * makes a box that only ever gets taller.
 */
function fit(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export const vAutoGrow: Directive<HTMLTextAreaElement> = {
  mounted(el) {
    el.addEventListener('input', () => fit(el))
    fit(el)
  },
  // Typing is not the only thing that changes what is in it: picking another
  // row, or switching object, hands the same element a different sentence.
  updated(el) {
    fit(el)
  },
}
