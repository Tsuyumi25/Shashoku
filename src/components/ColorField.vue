<template>
  <span class="color-field">
    <PopoverRoot v-model:open="open">
      <PopoverTrigger
        class="color-swatch"
        :style="{ '--swatch': mixed ? 'transparent' : modelValue }"
        :title="label"
      />
      <PopoverPortal>
        <PopoverContent class="color-popover" side="bottom" align="start" :side-offset="6">
          <hex-color-picker
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
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
    <input
      class="color-hex"
      type="text"
      maxlength="7"
      spellcheck="false"
      autocomplete="off"
      :aria-label="label"
      :placeholder="mixed ? MIXED_TEXT : undefined"
      :value="mixed ? '' : modelValue"
      @change="onOuterHex"
      @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
    />
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useClipboard, useEventListener } from '@vueuse/core'
import { Check, Copy } from '@lucide/vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import 'vanilla-colorful/hex-color-picker.js'
import { MIXED_TEXT } from '@/lib/appearanceText'

/**
 * A swatch that opens a picker, beside the hex it stands for. Every step of a
 * drag goes out as `input` so the page follows it live; letting go settles it
 * as `update:modelValue`, so one drag is one undo.
 */
const props = defineProps<{
  modelValue: string
  label: string
  /** The selection disagrees: nothing is shown as the value, and any pick writes. */
  mixed?: boolean
}>()
const emit = defineEmits<{
  /** Every step of a drag, for the canvas to follow. */
  input: [value: string]
  /** The settled colour, once per gesture. */
  'update:modelValue': [value: string]
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
watch(open, (now) => {
  if (!now) commit()
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

function write(hex: string) {
  const changed = moving || props.mixed || hex !== props.modelValue.toLowerCase()
  moving = false
  if (changed) emit('update:modelValue', hex)
  else show(props.modelValue)
}

function commit() {
  write(picking.value.toLowerCase())
}

function commitHex() {
  const hex = parseHex(hexText.value)
  if (hex) write(hex)
  else show(props.modelValue)
}

function commitRgb() {
  const hex = parseRgb(rgbText.value)
  if (hex) write(hex)
  else show(props.modelValue)
}

function onOuterHex(e: Event) {
  const input = e.target as HTMLInputElement
  const hex = parseHex(input.value)
  if (hex) write(hex)
  else input.value = props.mixed ? '' : props.modelValue
}

function parseHex(raw: string): string | null {
  const text = raw.trim().replace(/^#?/, '#').toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(text)) return text
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${[...text.slice(1)].map((c) => c + c).join('')}`
  return null
}

function parseRgb(raw: string): string | null {
  const parts = raw.match(/\d+(\.\d+)?/g)
  if (!parts || parts.length !== 3) return null
  const channels = parts.map(Number)
  if (channels.some((c) => c > 255)) return null
  return `#${channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}

function rgbOf(hex: string): string {
  const parsed = parseHex(hex)
  if (!parsed) return ''
  const n = Number.parseInt(parsed.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
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
.color-hex {
  width: 5.5rem;
  height: 1.5rem;
  padding: 0 0.375rem;
  border: 1px solid var(--input);
  border-radius: 0.25rem;
  background: var(--background);
  font-family: var(--font-mono, ui-monospace, monospace);
  outline: none;
}
.color-hex:focus-visible {
  border-color: var(--ring);
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
  font-size: 12px;
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
</style>
