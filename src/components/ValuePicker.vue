<template>
  <div ref="rootEl" class="flex h-full min-h-0 flex-col bg-background text-sm">
    <div
      class="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs text-muted-foreground"
    >
      <span class="font-medium text-foreground">{{ NAMES[kind] }}</span>
      <span class="tabular-nums">本話 {{ shown.length }} 種</span>
      <span v-if="!targets.length" class="ml-auto">先選一個文字物件</span>
    </div>
    <!--
      The list holds still while the pointer is over it. Trying a value on the
      selection moves that selection into the value's count; counted live, the
      entries would reorder under the pointer, which then points at another one
      and tries that instead — round and round.
    -->
    <div
      class="min-h-0 flex-1 overflow-y-auto p-3"
      @mouseenter="holding = true"
      @mouseleave="release"
    >
      <div v-if="kind === 'stroke'" class="dots">
        <button
          v-for="v in shown"
          :key="v.key"
          type="button"
          class="dot"
          :class="v.key === currentKey && 'on'"
          :title="`${v.label} · 本話 ${v.count} 句`"
          :disabled="!targets.length"
          @mouseenter="preview(v)"
          @mouseleave="endPreview"
          @click="apply(v)"
        >
          <span class="ring" :style="ringStyle(v)" />
          <span class="tabular-nums">{{ v.stroke ? `${v.stroke.width}px` : '無' }} · {{ v.count }}</span>
        </button>
      </div>

      <div v-else-if="kind === 'color'" class="flex flex-wrap gap-2">
        <button
          v-for="v in shown"
          :key="v.key"
          type="button"
          class="swatch"
          :class="v.key === currentKey && 'on'"
          :title="`${v.label} · 本話 ${v.count} 句`"
          :disabled="!targets.length"
          @mouseenter="preview(v)"
          @mouseleave="endPreview"
          @click="apply(v)"
        >
          <span class="chip-colour" :style="{ backgroundColor: v.key }" />
          <span class="font-mono text-xs">{{ v.label }}</span>
          <span class="text-[10px] tabular-nums text-muted-foreground">{{ v.count }}</span>
        </button>
      </div>

      <div v-else class="flex flex-wrap gap-1.5">
        <button
          v-for="v in shown"
          :key="v.key"
          type="button"
          class="amount"
          :class="v.key === currentKey && 'on'"
          :title="`${v.label} · 本話 ${v.count} 句`"
          :disabled="!targets.length"
          @mouseenter="preview(v)"
          @mouseleave="endPreview"
          @click="apply(v)"
        >
          {{ v.label }}<span class="ml-1 text-[10px] text-muted-foreground">{{ v.count }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { LayerEffect, StrokeEffect } from '@shared/effects/types'
import type { TextLayerEntry } from '@shared/page/types'
import { blocksOnSide } from '@shared/page/units'
import type { TextStyle } from '@shared/text-style/types'
import type { AppearanceTarget } from '@/lib/appearance'
import type { AmountField, ValueKind } from '@/composables/useValuePicker'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * The values this chapter already holds for one property, each drawn as the
 * least that tells it apart — a ring for a stroke, a swatch for a colour, the
 * number for an amount. What it looks like on the letters is shown where the
 * letters are: pointing at a value tries it on the selection, pressing gives it.
 */
const props = defineProps<{ kind: Exclude<ValueKind, 'font'> }>()

const editor = useEditorStore()
const project = useProjectStore()

const NAMES: Record<Exclude<ValueKind, 'font'>, string> = {
  stroke: '描邊',
  color: '文字色',
  fontSizePx: '字級',
  leadingPercent: '行距',
  weightPx: '字粗',
  scaleXPercent: '水平',
  scaleYPercent: '垂直',
}

const targets = computed(() =>
  editor
    .selectedNodes()
    .filter((t): t is AppearanceTarget<TextLayerEntry> => t.entry.kind === 'text'),
)

interface Value {
  key: string
  label: string
  count: number
  /** Kinds go by how often they are used; amounts by size. */
  order: number
  stroke?: StrokeEffect | null
  amount?: number
}

const strokeOf = (entry: TextLayerEntry) =>
  (entry.effects.find((e) => e.kind === 'stroke') as StrokeEffect | undefined) ?? null
const strokeKey = (stroke: StrokeEffect | null) =>
  stroke ? `${stroke.color}|${stroke.width}|${stroke.position}` : 'none'

function amountLabel(field: AmountField, v: number): string {
  if (field === 'fontSizePx') return `${v}px`
  if (field === 'weightPx') return v > 0 ? `+${v}` : String(v)
  return `${v}%`
}

function valueOf(entry: TextLayerEntry): Omit<Value, 'count'> {
  const kind = props.kind
  if (kind === 'stroke') {
    const stroke = strokeOf(entry)
    return {
      key: strokeKey(stroke),
      label: stroke ? `${stroke.color} ${stroke.width}px` : '無描邊',
      order: 0,
      stroke: stroke ? { ...stroke } : null,
    }
  }
  if (kind === 'color') return { key: entry.body.style.color, label: entry.body.style.color, order: 0 }
  const v = entry.body.style[kind]
  return { key: String(v), label: amountLabel(kind, v), order: v, amount: v }
}

const values = computed<Value[]>(() => {
  const byKey = new Map<string, Value>()
  for (const file of project.files) {
    if (file.badge !== 'ok') continue
    for (const block of blocksOnSide(file.page.layers, 'translation')) {
      const value = valueOf(block)
      const held = byKey.get(value.key)
      if (held) held.count += 1
      else byKey.set(value.key, { ...value, count: 1 })
    }
  }
  const list = [...byKey.values()]
  return props.kind === 'stroke' || props.kind === 'color'
    ? list.sort((a, b) => b.count - a.count)
    : list.sort((a, b) => a.order - b.order)
})

/** What is listed, refreshed only while the pointer is elsewhere. */
const holding = shallowRef(false)
const shown = shallowRef<Value[]>(values.value)
watch(values, (next) => {
  if (!holding.value) shown.value = next
})
watch(
  () => props.kind,
  () => {
    endPreview()
    holding.value = false
    shown.value = values.value
  },
)
function release() {
  holding.value = false
  endPreview()
  shown.value = values.value
}

/** The value every selected object shares, if they share one. */
const currentKey = computed(() => {
  const keys = new Set(targets.value.map((t) => valueOf(t.entry).key))
  return keys.size === 1 ? [...keys][0] : null
})

const effectsFor = (v: Value): LayerEffect[] => (v.stroke ? [{ ...v.stroke }] : [])
function patchFor(v: Value): Partial<TextStyle> {
  if (props.kind === 'color') return { color: v.key }
  return { [props.kind]: v.amount } as Partial<TextStyle>
}

function preview(v: Value) {
  if (!targets.value.length) return
  if (props.kind === 'stroke') editor.previewEffects(targets.value, effectsFor(v))
  else editor.previewStyle(targets.value, patchFor(v))
}

/**
 * Both kinds, whichever is showing: a preview is put back however the pointer
 * came to be elsewhere, and the property may have changed under it since.
 */
function endPreview() {
  editor.endEffectsPreview()
  editor.endStylePreview()
}

// The leave event is the usual way out, not the only one. A press anywhere
// else, the window losing focus, the selection moving or the list going away
// all end what is being tried, so nothing tried can be kept by accident.
const rootEl = useTemplateRef<HTMLElement>('rootEl')
useEventListener(
  document,
  'pointerdown',
  (e: PointerEvent) => {
    if (!(e.target instanceof Node) || !rootEl.value?.contains(e.target)) endPreview()
  },
  { capture: true },
)
useEventListener(window, 'blur', endPreview)
watch(() => editor.selectedIds, endPreview)
onBeforeUnmount(endPreview)

function apply(v: Value) {
  if (!targets.value.length) return
  if (props.kind === 'stroke') editor.cmdApplyEffects(targets.value, effectsFor(v))
  else editor.cmdApplyStyle(targets.value, patchFor(v))
}

/** The stroke's own colour, drawn as thick as it is set, on the grey every colour shows against. */
function ringStyle(v: Value) {
  if (!v.stroke) return { border: '1px dashed currentColor', background: 'transparent' }
  return { border: `${Math.min(16, v.stroke.width * 1.4)}px solid ${v.stroke.color}` }
}
</script>

<style scoped>
.dots {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  border-radius: 6px;
  background: oklch(0.66 0 0);
  padding: 10px;
}
.dot {
  display: flex;
  width: 3.5rem;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #1f1f1f;
}
.ring {
  display: block;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 9999px;
  background: oklch(0.55 0 0);
}
.dot:hover:not(:disabled) .ring {
  box-shadow: 0 0 0 2px var(--primary);
}
.dot.on .ring {
  box-shadow: 0 0 0 2px var(--primary-foreground), 0 0 0 4px var(--primary);
}
.swatch {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--card);
  padding: 0.3rem 0.6rem;
}
.chip-colour {
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
}
.amount {
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: var(--card);
  padding: 0.2rem 0.55rem;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.swatch:hover:not(:disabled),
.amount:hover:not(:disabled) {
  border-color: var(--primary);
}
.swatch.on,
.amount.on {
  border-color: var(--primary);
  background: color-mix(in oklch, var(--primary) 15%, var(--card));
}
.dot:disabled,
.swatch:disabled,
.amount:disabled {
  cursor: default;
}
</style>
