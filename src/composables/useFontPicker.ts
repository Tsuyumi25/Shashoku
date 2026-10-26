import { ref, shallowRef } from 'vue'
import type { FontEntry } from '@shared/fonts/types'
import type { TextStyle } from '@shared/text-style/types'

/**
 * Whether the left column shows the picker instead of the tools. A panel bound
 * to the selection rather than a question asked once: choosing writes to what is
 * selected now, and leaves the panel where it is.
 */
const isOpen = ref(false)

/**
 * The face being tried on the page. While set, the canvas draws the selection
 * with this face instead of what the objects store — letting go restores
 * everything, because nothing was written.
 */
const previewFace = shallowRef<FontEntry | null>(null)

/**
 * The style an object is drawn and measured with while a face is being tried.
 * Both the frames and the run canvas read it, so the box and the letters agree.
 */
export function previewedStyle(style: TextStyle, selected: boolean): TextStyle {
  const face = previewFace.value
  if (face === null || !selected) return style
  return {
    ...style,
    fontFamily: face.family,
    fontFace: face.postscriptName,
    fontStyleName: face.style,
  }
}

export function useFontPicker() {
  return {
    isOpen,
    previewFace,
    show() {
      isOpen.value = true
    },
    startPreview(face: FontEntry) {
      previewFace.value = face
    },
    endPreview() {
      previewFace.value = null
    },
  }
}
