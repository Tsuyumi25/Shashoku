import { useStorage } from '@vueuse/core'
import {
  DEFAULT_LABEL_TEXT_STYLE,
  type LabelTextStyle,
} from '@/lib/labelTextStyle'

const TEXT_BOARD_STYLE_KEY = 'shashoku:text-board-style'

/**
 * BrowserWindow 共用同一個 localStorage origin；useStorage 會透過 storage
 * event 把主視窗的全域文字樣式即時同步到草稿紙 renderer。
 */
export function useTextBoardStyle() {
  return useStorage<LabelTextStyle>(
    TEXT_BOARD_STYLE_KEY,
    { ...DEFAULT_LABEL_TEXT_STYLE },
    undefined,
    { mergeDefaults: true },
  )
}
