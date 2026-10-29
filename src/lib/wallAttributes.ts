import type { LayerEffect } from '@shared/effects/types'
import { visibleStrokeOf } from '@shared/effects/stroke'
import type { TagRegistry } from '@shared/tags/types'
import type { TextStyle } from '@shared/text-style/types'
import { tagSetKey, tagsInRegistryOrder } from '@shared/tags/set'
import { styleFieldText } from '@/lib/textStyleFields'

/**
 * One thing the buckets gather by, as a person sets it — a control of the
 * appearance panel rather than a field of the style. The face is family and
 * weight together, since that is one choice in the picker; the stroke lives in
 * the effects and is gathered all the same.
 */
export type WallAttribute =
  | 'font'
  | 'direction'
  | 'align'
  | 'color'
  | 'stroke'
  | 'weight'
  | 'scaleX'
  | 'scaleY'
  | 'leading'
  | 'size'

export const WALL_ATTRIBUTES: readonly { id: WallAttribute; label: string }[] = [
  { id: 'font', label: '字型' },
  { id: 'direction', label: '方向' },
  { id: 'align', label: '對齊' },
  { id: 'color', label: '文字色' },
  { id: 'stroke', label: '描邊' },
  { id: 'weight', label: '字粗' },
  { id: 'scaleX', label: '水平' },
  { id: 'scaleY', label: '垂直' },
  { id: 'leading', label: '行距' },
  { id: 'size', label: '字級' },
]

export interface WallObject {
  id: string
  tags: readonly string[]
  style: TextStyle
  effects: readonly LayerEffect[]
}

/**
 * The one value an object holds for an attribute: a key to gather by, and how
 * the bucket says it.
 *
 * Sizes alone are gathered in bands. Nearly every line sits at a size of its
 * own — one chapter sets 96 lines at 65 sizes, 46 of them held once — so a
 * bucket per size would be a bucket per line. Bands a tenth wide, fixed so a
 * size always lands in the same one, keep 55 and 59 together and 47 apart from
 * 70; that chapter falls into 20.
 */
export interface WallValue {
  key: string
  label: string
  /** Where it falls on a scale, for the attributes that have one. */
  order?: number
  /** The colour it names, drawn beside the label. */
  swatch?: string
}

/**
 * The attributes that are amounts. Their buckets read as a scale, smallest
 * first, so 61–66px sits between 55–60px and 67–72px however many lines each
 * holds; the rest are kinds, and the biggest kind leads.
 */
export const ORDERED_ATTRIBUTES: ReadonlySet<WallAttribute> = new Set([
  'size',
  'weight',
  'scaleX',
  'scaleY',
  'leading',
])

export function valueOf(object: WallObject, attribute: WallAttribute): WallValue {
  const s = object.style
  switch (attribute) {
    case 'font': {
      const family = s.fontFamily || '未指定'
      const named = s.fontStyleName && s.fontStyleName !== s.fontFamily
      return { key: `${s.fontFamily}|${s.fontStyleName}`, label: named ? `${family} ${s.fontStyleName}` : family }
    }
    case 'stroke': {
      const stroke = visibleStrokeOf(object.effects)
      if (!stroke) return { key: 'none', label: '無描邊' }
      return {
        key: `${stroke.color}|${stroke.width}`,
        label: `${stroke.color} ${stroke.width}px`,
        swatch: stroke.color,
      }
    }
    case 'size': {
      const band = Math.floor(Math.log(s.fontSizePx) / Math.log(1.1))
      const lo = Math.ceil(1.1 ** band)
      const hi = Math.floor(1.1 ** (band + 1) - 1e-9)
      return { key: String(band), label: lo >= hi ? `${lo}px` : `${lo}–${hi}px`, order: band }
    }
    case 'align':
      // The wording follows the direction while the stored value does not, so a
      // vertical start and a horizontal one are two buckets — 上 and 左.
      return { key: `${s.direction}|${s.align}`, label: styleFieldText(s, 'align') }
    case 'direction':
      return { key: s.direction, label: styleFieldText(s, 'direction') }
    case 'color':
      return { key: s.color, label: s.color, swatch: s.color }
    case 'weight':
      return { key: String(s.weightPx), label: String(s.weightPx), order: s.weightPx }
    case 'scaleX':
      return { key: String(s.scaleXPercent), label: `${s.scaleXPercent}%`, order: s.scaleXPercent }
    case 'scaleY':
      return { key: String(s.scaleYPercent), label: `${s.scaleYPercent}%`, order: s.scaleYPercent }
    case 'leading':
      return { key: String(s.leadingPercent), label: `${s.leadingPercent}%`, order: s.leadingPercent }
  }
}

export interface WallBucket {
  key: string
  label: string
  swatch?: string
  order?: number
  ids: string[]
}

export interface WallGroup {
  key: string
  tags: string[]
  count: number
  buckets: WallBucket[]
}

/**
 * The objects gathered by what they mean, then by the one value they hold for
 * an attribute — so every bucket names a single value, and picking one picks
 * every line holding it. Amounts run smallest first, kinds biggest first;
 * meanings in the project's own order, the untagged last.
 */
export function groupByAttribute(
  objects: readonly WallObject[],
  attribute: WallAttribute,
  registry: TagRegistry,
): WallGroup[] {
  const byMeaning = new Map<string, WallObject[]>()
  for (const object of objects) {
    const key = tagSetKey(object.tags)
    const held = byMeaning.get(key)
    if (held) held.push(object)
    else byMeaning.set(key, [object])
  }
  const groups: WallGroup[] = []
  for (const [key, members] of byMeaning) {
    const byValue = new Map<string, WallBucket>()
    for (const object of members) {
      const value = valueOf(object, attribute)
      const held = byValue.get(value.key)
      if (held) held.ids.push(object.id)
      else byValue.set(value.key, { ...value, key: `${key}|${value.key}`, ids: [object.id] })
    }
    const buckets = [...byValue.values()].sort(
      ORDERED_ATTRIBUTES.has(attribute)
        ? (a, b) => (a.order ?? 0) - (b.order ?? 0)
        : (a, b) => b.ids.length - a.ids.length,
    )
    groups.push({ key, tags: tagsInRegistryOrder(members[0]!.tags, registry), count: members.length, buckets })
  }
  const rank = (g: WallGroup) => registry.findIndex((t) => g.tags.includes(t.name))
  return groups.sort((a, b) => {
    if (a.tags.length === 0 || b.tags.length === 0) return a.tags.length === 0 ? 1 : -1
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return (ra === -1 ? Infinity : ra) - (rb === -1 ? Infinity : rb)
    return b.count - a.count
  })
}
