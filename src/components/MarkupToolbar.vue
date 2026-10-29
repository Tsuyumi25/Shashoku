<template>
  <!--
    Focus never leaves the box being typed into. A press that moved it would
    end the visit under the hand that is still working on it, so every item
    refuses the default of its own mousedown and acts on the click instead.
    The colour picker is the one thing here that really does want the keyboard;
    it is let through, and the session knows to stay open for it.
  -->
  <div
    class="markup-bar"
    data-markup-toolbar
    :style="placement"
    @pointerdown.stop
    @mousedown.prevent
  >
    <button
      v-if="canCut"
      type="button"
      class="markup-item"
      title="把選起來的字剪成另一塊，留在原位"
      @click.stop="emit('cut')"
    >
      <Scissors :size="12" />
      剪成一塊
    </button>

    <!--
      Steppers rather than presses: each press edits the one tag the words
      already have, so ten steps down is one tag saying how small, and as many
      back takes it off again.
    -->
    <div v-for="item in STEPPERS" :key="item.field" class="markup-item">
      <span class="markup-key">{{ item.key }}</span>
      <span class="flex-1">{{ item.label }}</span>
      <button
        type="button"
        class="markup-step"
        :title="item.down"
        @click.stop="emit('step', item.field, -1)"
      >
        <Minus :size="11" />
      </button>
      <span class="markup-value">{{ item.shown(markup.stepped.value[item.field]) }}</span>
      <button type="button" class="markup-step" :title="item.up" @click.stop="emit('step', item.field, 1)">
        <Plus :size="11" />
      </button>
    </div>

    <button
      v-if="vertical"
      type="button"
      class="markup-item"
      title="直排時讓選起來的字橫著並排"
      @click.stop="emit('wrap', 'upright')"
    >
      <span class="markup-key">縱</span>
      縱中橫
    </button>

    <!--
      The colour is picked rather than named, so the item is the picker itself
      with a label beside it. What it writes is one tag per settled colour: the
      live steps of a drag would be one undo entry each.
    -->
    <div class="markup-item markup-color">
      <span class="markup-key">色</span>
      <ColorField
        :model-value="color"
        label="字的顏色"
        @update:model-value="emit('wrap', `color=${$event}`)"
      />
    </div>

    <button type="button" class="markup-item" title="拿掉選起來的字上面的標記" @click.stop="emit('clear')">
      <span class="markup-key">清</span>
      清除
    </button>
  </div>
</template>

<script setup lang="ts">
import { Minus, Plus, Scissors } from '@lucide/vue'
import type { SteppedField } from '@shared/page/markup'
import ColorField from '@/components/ColorField.vue'
import { useMarkupSession } from '@/composables/useMarkupSession'

/**
 * What can be put on a stretch of text, over whichever box is holding it.
 *
 * One component for both notations. The list shows the code and the canvas
 * shows the words, but a tag means the same thing from either — so the bar is
 * placed by whoever owns the selection and says nothing about where it is
 * standing.
 */
defineProps<{
  /** Where the bar goes, in the coordinates of whatever is placing it. */
  placement: Record<string, string>
  /** Cutting is the canvas's alone: it is about blocks, not about lettering. */
  canCut?: boolean
  /** 縱中橫 is meaningless across a line that already runs left to right. */
  vertical?: boolean
  /** What the picker opens on — the object's own colour. */
  color: string
}>()

const emit = defineEmits<{
  wrap: [attrs: string]
  step: [field: SteppedField, dir: 1 | -1]
  clear: []
  cut: []
}>()

const markup = useMarkupSession()

/**
 * Relative rather than absolute everywhere it can be: a tag written as a
 * multiple goes on meaning the same thing after the object is resized, which
 * is the point of the object's size being the one the typesetter set.
 */
const STEPPERS: {
  field: SteppedField
  key: string
  label: string
  down: string
  up: string
  shown: (value: number) => string
}[] = [
  {
    field: 'size',
    key: '大',
    label: '字級',
    down: '縮成 0.8 倍',
    up: '放大 1.25 倍',
    shown: (scale) => `×${Number(scale.toPrecision(3))}`,
  },
  {
    field: 'weight',
    key: '粗',
    label: '字粗',
    down: '變細一級',
    up: '加粗一級',
    shown: (add) => (add === 0 ? '±0' : add > 0 ? `+${add}` : `${add}`),
  },
]
</script>

<style scoped>
/*
 * A menu rather than a row: the items are words of different lengths in two
 * scripts, and a row of them would be a different width for every selection.
 * Stacked, the bar is one shape wherever it opens.
 */
.markup-bar {
  position: absolute;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 7rem;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--popover);
  color: var(--popover-foreground);
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: auto;
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.25);
}
.markup-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 4px;
  text-align: left;
}
button.markup-item:hover {
  background: var(--secondary);
}
.markup-key {
  width: 1.25rem;
  flex: none;
  text-align: center;
  color: var(--muted-foreground);
}
.markup-color {
  gap: 6px;
}
.markup-step {
  display: flex;
  height: 1.25rem;
  width: 1.25rem;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  color: var(--muted-foreground);
}
.markup-step:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.markup-value {
  min-width: 3.25rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
