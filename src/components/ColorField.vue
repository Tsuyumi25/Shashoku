<template>
  <span class="color-field">
    <PopoverRoot v-model:open="open">
      <PopoverTrigger
        class="color-swatch"
        :class="mixed && 'is-mixed'"
        :style="{ '--swatch': mixed ? 'transparent' : modelValue }"
        :title="mixed ? `${label}：${MIXED_TEXT}` : label"
        :aria-label="label"
      />
      <PopoverPortal>
        <PopoverContent class="color-popover" side="bottom" align="start" :side-offset="6">
          <hex-alpha-color-picker
            class="color-picker"
            :color="picking"
            @color-changed="onPicked"
            @keyup="commit"
          />
          <div class="color-row">
            <input
              v-model="hexText"
              class="color-input"
              placeholder="#rrggbb"
              spellcheck="false"
              @change="commitHex"
              @keydown.enter.prevent="commitHex"
            />
            <button type="button" class="color-copy" :title="hexClip.copied.value ? '已複製' : '複製'" @click="hexClip.copy(hexText)">
              <Check v-if="hexClip.copied.value" :size="12" />
              <Copy v-else :size="12" />
            </button>
          </div>
          <div class="color-row">
            <input
              v-model="rgbText"
              class="color-input"
              placeholder="rgb(r, g, b)"
              spellcheck="false"
              @change="commitRgb"
              @keydown.enter.prevent="commitRgb"
            />
            <button type="button" class="color-copy" :title="rgbClip.copied.value ? '已複製' : '複製'" @click="rgbClip.copy(rgbText)">
              <Check v-if="rgbClip.copied.value" :size="12" />
              <Copy v-else :size="12" />
            </button>
          </div>
          <button v-if="clearable" type="button" class="color-clear" @click="clear">
            <X :size="12" /> 清除
          </button>
          <slot />
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useClipboard, useEventListener } from '@vueuse/core'
import { Check, Copy, X } from '@lucide/vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import 'vanilla-colorful/hex-alpha-color-picker.js'
import { MIXED_TEXT } from '@/lib/appearanceText'
import { normalHex } from '@/lib/color'

/**
 * A swatch that opens a picker; the hex it stands for lives in the picker.
 * Every step of a drag goes out as `input` so the page follows it live;
 * letting go settles it as `update:modelValue`, so one drag is one undo.
 */
const props = defineProps<{
  modelValue: string
  label: string
  /** The selection disagrees: nothing is shown as the value, and any pick writes. */
  mixed?: boolean
  /** Offer taking the colour away altogether, for a property that can be absent. */
  clearable?: boolean
}>()
const emit = defineEmits<{
  /** Every step of a drag, for the canvas to follow. */
  input: [value: string]
  /** The settled colour, once per gesture. */
  'update:modelValue': [value: string]
  /** Asked for no colour at all; only offered when `clearable`. */
  clear: []
}>()

const open = ref(false)
const picking = ref(props.modelValue)
const hexText = ref(props.modelValue)
const rgbText = ref(rgbOf(props.modelValue))

const hexClip = useClipboard({ legacy: true })
const rgbClip = useClipboard({ legacy: true })

function show(hex: string) {
  picking.value = hex
  hexText.value = hex
  rgbText.value = rgbOf(hex)
}

watch(() => props.modelValue, show)

// A drag ends wherever the hand lets go, which is often off the picker — so the
// release is listened for on the window, before a press elsewhere can change
// what is selected. Closing, or the field going away, settles anything left.
let moving = false
useEventListener(window, 'pointerup', () => {
  if (moving) commit()
})
// Cleared rather than closed: there is no colour left to settle.
let clearing = false
watch(open, (now) => {
  if (now) return
  if (clearing) clearing = false
  else commit()
})
onBeforeUnmount(() => {
  if (moving) commit()
})

function onPicked(e: Event) {
  const hex = (e as CustomEvent<{ value: string }>).detail.value
  hexText.value = hex
  rgbText.value = rgbOf(hex)
  picking.value = hex
  moving = true
  emit('input', hex)
}

function clear() {
  moving = false
  clearing = true
  open.value = false
  emit('clear')
}

function write(hex: string) {
  const changed = moving || props.mixed || hex !== (normalHex(props.modelValue) ?? props.modelValue)
  moving = false
  if (changed) emit('update:modelValue', hex)
  else show(props.modelValue)
}

function commit() {
  write(normalHex(picking.value) ?? picking.value.toLowerCase())
}

function commitHex() {
  const hex = normalHex(hexText.value)
  if (hex) write(hex)
  else show(props.modelValue)
}

function commitRgb() {
  const hex = parseRgb(rgbText.value)
  if (hex) write(hex)
  else show(props.modelValue)
}

/** `rgb(r, g, b)`, or `rgba(r, g, b, a)` with the alpha as a fraction, as CSS writes it. */
function parseRgb(raw: string): string | null {
  const parts = raw.match(/\d*\.?\d+/g)
  if (!parts || (parts.length !== 3 && parts.length !== 4)) return null
  const [r, g, b, a = 1] = parts.map(Number)
  if ([r, g, b].some((c) => c! > 255) || a > 1) return null
  const bytes = [r!, g!, b!, a * 255].map((c) => Math.round(c).toString(16).padStart(2, '0'))
  return normalHex(bytes.join(''))
}

function rgbOf(color: string): string {
  const hex = normalHex(color)
  if (!hex) return ''
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
  if (hex.length === 7) return `rgb(${r}, ${g}, ${b})`
  const a = Math.round(Number.parseInt(hex.slice(7), 16) / 2.55) / 100
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
</script>

<style scoped>
.color-field {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}
.color-swatch {
  width: 1.5rem;
  height: 1.5rem;
  flex-shrink: 0;
  border: 1px solid var(--input);
  border-radius: 0.25rem;
  background:
    linear-gradient(var(--swatch), var(--swatch)),
    repeating-conic-gradient(#ffffff 0 25%, #cccccc 0 50%) 0 0 / 0.5rem 0.5rem;
}
.color-swatch:hover,
.color-swatch[data-state='open'] {
  border-color: var(--muted-foreground);
}
/* No single colour: a slash across the swatch, distinct from a transparent one. */
.color-swatch.is-mixed {
  background:
    linear-gradient(to top right, transparent 46%, var(--muted-foreground) 46% 54%, transparent 54%),
    repeating-conic-gradient(#ffffff 0 25%, #cccccc 0 50%) 0 0 / 0.5rem 0.5rem;
}
</style>

<!--
  Not scoped: the popover is teleported to the body, and its root element never
  receives this component's scope attribute, so a scoped rule could not reach it.
-->
<style>
.color-popover {
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.color-picker {
  width: 180px;
  height: 180px;
  user-select: none;
}
.color-row {
  display: flex;
  gap: 4px;
}
.color-input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--input);
  border-radius: 3px;
  background: var(--background);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 13px;
  outline: none;
}
.color-input:focus-visible {
  border-color: var(--ring);
}
.color-copy {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  padding: 4px 6px;
  border-radius: 3px;
  background: var(--secondary);
}
.color-copy:hover {
  background: var(--accent);
}
.color-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 3px;
  background: var(--secondary);
  font-size: 13px;
}
.color-clear:hover {
  background: var(--accent);
}
</style>
