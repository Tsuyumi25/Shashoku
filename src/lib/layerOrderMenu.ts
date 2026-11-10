import type { MenuItem } from '@/components/CanvasMenu.vue'
import type { Restack } from '@/lib/layerOrder'

const CHOICES: readonly { how: Restack; label: string; hint: string }[] = [
  { how: 'top', label: '移到最上層', hint: 'Ctrl+Shift+]' },
  { how: 'up', label: '往上一層', hint: 'Ctrl+]' },
  { how: 'down', label: '往下一層', hint: 'Ctrl+[' },
  { how: 'bottom', label: '移到最下層', hint: 'Ctrl+Shift+[' },
]

const PREFIX = 'restack-'

/** The same submenu on the canvas, the shelf, the label list and the layer list. */
export const LAYER_ORDER_MENU: MenuItem = {
  id: 'layer-order',
  label: '圖層順序',
  children: CHOICES.map((c) => ({ id: PREFIX + c.how, label: c.label, hint: c.hint })),
}

/** Which way a picked id restacks, or null when the pick was not one of these. */
export function restackOf(id: string): Restack | null {
  return CHOICES.find((c) => PREFIX + c.how === id)?.how ?? null
}
