<template>
  <div class="col-span-2 flex min-w-0 flex-col">
    <div class="flex h-6 items-center gap-1">
      <span class="mr-auto text-muted-foreground">{{ title ?? '描邊' }}</span>
      <StrokeJoinOptions v-if="joins !== undefined" :state="joins" @change="(on) => emit('joins', on)" />
      <button
        v-if="!mixed"
        type="button"
        class="h-6 rounded border border-input px-1.5 text-muted-foreground hover:border-primary hover:text-foreground"
        @click="add"
      >
        + 新增
      </button>
    </div>

    <div v-if="$slots.lead" class="stroke-row">
      <span class="handle pinned" title="固定在最上面：第一圈描邊從這裡量">
        <GripVertical :size="12" />
      </span>
      <slot name="lead" />
    </div>

    <div ref="list" class="relative flex flex-col">
      <div
        v-for="(row, index) in rows"
        :key="index"
        class="stroke-row"
        :class="drag?.from === index && 'lifted'"
        :style="drag?.from === index ? { transform: `translateY(${drag.dy}px)` } : undefined"
      >
        <span
          v-if="!mixed"
          class="handle"
          title="拖曳換順序"
          @pointerdown="startDrag(index, $event)"
          @pointermove="moveDrag"
          @pointerup="endDrag"
          @pointercancel="endDrag"
        >
          <GripVertical :size="12" />
        </span>
        <ColorField
          :model-value="row.color"
          label="描邊顏色"
          :mixed="mixed"
          clearable
          @input="(color) => emit('preview', withStrokes(effects, listWith(index, { ...row, color })))"
          @update:model-value="(color) => put(index, { ...row, color })"
          @clear="put(index, null)"
        />
        <NumberStepper
          :model-value="mixed ? null : row.width"
          label="描邊寬度"
          :min="0"
          :placeholder="mixed ? MIXED_TEXT : ''"
          @update:model-value="(width: number) => onWidth(index, row, width)"
        />
        <span class="text-muted-foreground">px</span>
        <select
          class="h-6 min-w-0 rounded border border-input bg-background px-1"
          title="描邊位置"
          :value="mixed ? '' : row.position"
          @change="onPosition(index, row, $event)"
        >
          <option v-if="mixed" value="">{{ MIXED_TEXT }}</option>
          <option v-for="(text, position) in POSITION_LABELS" :key="position" :value="position">{{ text }}</option>
        </select>
        <button v-if="!mixed" type="button" class="remove" title="刪除描邊" @click="put(index, null)">
          <X :size="12" />
        </button>
      </div>
      <div v-if="drag && drag.line !== null" class="dropline" :style="{ top: `${drag.line}px` }" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { GripVertical, X } from '@lucide/vue'
import ColorField from '@/components/ColorField.vue'
import NumberStepper from '@/components/NumberStepper.vue'
import StrokeJoinOptions, { type JoinState } from '@/components/appearance/StrokeJoinOptions.vue'
import type { LayerEffect, StrokeEffect, StrokePosition } from '@shared/effects/types'
import { DEFAULT_STROKE } from '@shared/effects/types'
import { strokesOf, withStrokes } from '@shared/effects/stroke'
import { MIXED_TEXT } from '@/lib/appearanceText'

/**
 * The stroke controls, over whatever node carries them.
 *
 * Shared by the two consumers that have one, which is the whole reason effects
 * left the text style: a band grown from a letter and a band grown from a
 * layer's edge are one effect, so they are set by one set of controls rather
 * than by two that would have to be kept saying the same thing.
 *
 * One section of the caller's grid: a heading with the button that adds a
 * stroke, an optional pinned row for what the first stroke is measured off,
 * then one row per stroke in the order they apply — each measured off what the
 * ones above it left showing.
 * The handle reorders them. A width of zero draws nothing but keeps the colour
 * and position for when it is turned up again.
 *
 * A selection that disagrees shows a single row, and whatever is set on it
 * lands on every object as their only stroke.
 */
const props = defineProps<{
  /**
   * One node's list, standing for the whole selection. What it holds while
   * `mixed` is an arbitrary member's, and is never shown.
   */
  effects: readonly LayerEffect[]
  /** Whether the selection disagrees about them. */
  mixed?: boolean
  /**
   * Whether the outermost strokes join others of their colour, for text, which
   * is the only kind that joins; absent offers no such control.
   */
  joins?: JoinState
  /** The heading; 描邊 when absent. */
  title?: string
}>()

defineSlots<{
  /** A row pinned above the strokes, for what the first of them is measured off. */
  lead?: () => unknown
}>()

const emit = defineEmits<{
  /** A step of a gesture still under way; nothing for history yet. */
  preview: [effects: LayerEffect[]]
  patch: [effects: LayerEffect[]]
  /** Joining let go of or taken back, on each object over its own strokes. */
  joins: [on: boolean]
}>()

const POSITION_LABELS: Record<StrokePosition, string> = {
  outside: '外',
  center: '中',
  inside: '內',
}

const strokes = computed(() => strokesOf(props.effects))
const rows = computed<readonly StrokeEffect[]>(() =>
  props.mixed ? [strokes.value[0] ?? DEFAULT_STROKE] : strokes.value,
)

function listWith(index: number, next: StrokeEffect | null): StrokeEffect[] {
  const list = props.mixed ? [] : [...strokes.value]
  if (next === null) list.splice(index, 1)
  else list[index] = next
  return list
}

// No same-colour guard on the colour: after a live drag the node already reads
// as the new colour, and the commit is still owed to close the gesture.
function put(index: number, next: StrokeEffect | null) {
  emit('patch', withStrokes(props.effects, listWith(index, next)))
}

function onWidth(index: number, row: StrokeEffect, width: number) {
  if (width < 0) return
  if (!props.mixed && width === row.width) return
  put(index, { ...row, width })
}

function onPosition(index: number, row: StrokeEffect, e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (v !== 'inside' && v !== 'center' && v !== 'outside') return
  if (!props.mixed && v === row.position) return
  put(index, { ...row, position: v })
}

/** A new outermost stroke, joining as the object's strokes already do. */
function add() {
  const off = strokes.value.some((stroke) => stroke.joins === false)
  const added: StrokeEffect = off ? { ...DEFAULT_STROKE, joins: false } : { ...DEFAULT_STROKE }
  emit('patch', withStrokes(props.effects, [...strokes.value, added]))
}

const list = useTemplateRef<HTMLElement>('list')

/**
 * A row held by its handle. `to` is where it would land among the others, and
 * `line` where that is drawn, in the list's own pixels.
 */
const drag = ref<{ from: number; y0: number; dy: number; to: number; line: number | null } | null>(null)
let others: { top: number; bottom: number; mid: number }[] = []

function startDrag(index: number, e: PointerEvent) {
  const el = list.value
  if (!el) return
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  const top = el.getBoundingClientRect().top
  others = [...el.querySelectorAll<HTMLElement>('.stroke-row')]
    .filter((_, i) => i !== index)
    .map((row) => {
      const box = row.getBoundingClientRect()
      return { top: box.top - top, bottom: box.bottom - top, mid: (box.top + box.bottom) / 2 - top }
    })
  drag.value = { from: index, y0: e.clientY, dy: 0, to: index, line: null }
}

function moveDrag(e: PointerEvent) {
  const held = drag.value
  const el = list.value
  if (!held || !el) return
  held.dy = e.clientY - held.y0
  const y = e.clientY - el.getBoundingClientRect().top
  held.to = others.filter((row) => row.mid < y).length
  held.line = held.to === held.from ? null : (others[held.to - 1]?.bottom ?? others[0]?.top ?? null)
}

function endDrag() {
  const held = drag.value
  drag.value = null
  if (!held || held.to === held.from) return
  const next = [...strokes.value]
  const [moved] = next.splice(held.from, 1)
  next.splice(held.to, 0, moved!)
  emit('patch', withStrokes(props.effects, next))
}
</script>

<style scoped>
.stroke-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  height: 1.875rem;
  border-radius: 0.25rem;
  background: var(--background);
}
.stroke-row.lifted {
  position: relative;
  z-index: 1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
}
.handle {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--muted-foreground);
  cursor: grab;
  touch-action: none;
}
.handle.pinned {
  cursor: default;
  opacity: 0.3;
}
.remove {
  display: inline-flex;
  margin-left: auto;
  padding: 0.25rem;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.remove:hover {
  background: var(--accent);
  color: var(--foreground);
}
.dropline {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  margin-top: -1px;
  background: var(--primary);
  pointer-events: none;
}
</style>
