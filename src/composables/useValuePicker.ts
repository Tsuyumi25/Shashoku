import { ref } from 'vue'

/** The amounts a style holds, each laid out as a row of its values. */
export type AmountField = 'fontSizePx' | 'leadingPercent' | 'weightPx' | 'scaleXPercent' | 'scaleYPercent'

/**
 * The properties the left column can lay out the values of. Direction and
 * alignment are absent: their controls already show every value there is.
 */
export type ValueKind = 'font' | 'stroke' | 'color' | AmountField

/**
 * Which property's values the left column is showing. Asked for from the
 * appearance panel: a property's name there is the way in, so the column
 * needs no rail of its own.
 */
const shown = ref<ValueKind>('font')

export function useValuePicker() {
  return {
    shown,
    show(kind: ValueKind) {
      shown.value = kind
    },
  }
}
