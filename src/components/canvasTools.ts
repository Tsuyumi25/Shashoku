import type { Component } from 'vue'
import {
  Bandage,
  CircleDashed,
  Eraser,
  Lasso,
  LassoSelect,
  MousePointer2,
  MousePointerClick,
  Paintbrush,
  SquareDashed,
  Type,
  Wand,
  Waypoints,
} from '@lucide/vue'
import type { CanvasTool } from '@/stores/editorStore'

/**
 * Every tool visible at once, rather than Photoshop's stacked slots with a
 * fly-out. That fly-out exists because Photoshop has seventy tools and one
 * column; these fit, and a tool one click away beats a tool one press-and-hold
 * away. The pairs still share their key, so `M` and `Shift+M` reach the two
 * marquees whichever is showing.
 */
export interface CanvasToolEntry {
  tool: CanvasTool
  icon: Component
  name: string
  key: string
  /** What the name alone does not say, after it in the rail's tooltip. */
  hint?: string
  /** Draws a rule above this one in the rail, so order and grouping are one list to read. */
  opensGroup?: boolean
}

export const CANVAS_TOOLS: CanvasToolEntry[] = [
  { tool: 'select', icon: MousePointer2, name: '選取工具', key: 'V' },
  { tool: 'select-text', icon: MousePointerClick, name: '文字選取工具', key: 'Shift+V' },
  { tool: 'text', icon: Type, name: '文字工具', key: 'T' },
  { tool: 'connect', icon: Waypoints, name: '閱讀順序連線', key: 'C' },
  { tool: 'marquee-rect', icon: SquareDashed, name: '矩形選區', key: 'M', opensGroup: true },
  { tool: 'marquee-ellipse', icon: CircleDashed, name: '橢圓選區', key: 'Shift+M' },
  { tool: 'lasso', icon: Lasso, name: '套索', key: 'L' },
  { tool: 'lasso-polygon', icon: LassoSelect, name: '多邊形套索', key: 'Shift+L' },
  { tool: 'wand', icon: Wand, name: '魔術棒', key: 'W' },
  { tool: 'brush', icon: Paintbrush, name: '筆刷', key: 'B' },
  { tool: 'eraser', icon: Eraser, name: '橡皮擦', key: 'E' },
  { tool: 'remove', icon: Bandage, name: '移除工具', key: 'J', hint: '塗過的地方交給 LaMa 補回來' },
]
