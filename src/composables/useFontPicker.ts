import { ref, shallowRef } from 'vue'
import type { EngineStrokeSpec } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'

export interface FontPickerRequest {
  /** Current family; prefills the search box so the user starts from it. */
  current: string
  /**
   * Fill and stroke of the style being edited. Samples are rasterized with
   * them so what the grid shows is the same stroke that will be typeset.
   */
  fillColor: string
  stroke?: EngineStrokeSpec
  /**
   * Writing direction of the style being edited. Omitted when there is no style
   * behind the request — the font manager — in which case the picker falls back
   * to whatever direction was left selected last time.
   */
  vertical?: boolean
  /** Signed pixels the strokes move by, so the grid previews what is set. */
  weightPx?: number
}

/**
 * Both halves of the answer. The weight rides along because the picker owns a
 * slider for it: someone who found the right thickness while browsing would
 * otherwise watch it reset the moment they chose a face.
 */
export interface FontPickerResult {
  face: FontEntry
  weightPx: number
}

const isOpen = ref(false)

/**
 * Shallow on purpose. A deep ref would hand out a reactive proxy of `stroke`,
 * and contextBridge refuses to clone a Proxy — the engine call would fail with
 * nothing but "An object could not be cloned". The request is replaced whole on
 * every open and never mutated in place, so deep reactivity buys nothing.
 */
const request = shallowRef<FontPickerRequest>({ current: '', fillColor: '#000000' })

let resolver: ((result: FontPickerResult | null) => void) | null = null

function settle(result: FontPickerResult | null) {
  isOpen.value = false
  const resolve = resolver
  resolver = null
  resolve?.(result)
}

export function useFontPicker() {
  return {
    isOpen,
    request,
    open(req: FontPickerRequest): Promise<FontPickerResult | null> {
      // Reopening while a request is outstanding would otherwise leave the
      // earlier caller awaiting a promise nobody can settle.
      settle(null)
      request.value = req
      isOpen.value = true
      return new Promise((resolve) => {
        resolver = resolve
      })
    },
    select(face: FontEntry, weightPx: number) {
      settle({ face, weightPx })
    },
    cancel() {
      settle(null)
    },
  }
}
