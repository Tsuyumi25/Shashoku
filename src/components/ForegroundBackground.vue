<template>
  <div class="pair">
    <ColorField
      :model-value="editor.background"
      label="背景色"
      side="right"
      opaque
      @input="(hex: string) => (editor.background = hex)"
      @update:model-value="(hex: string) => (editor.background = hex)"
    >
      <template #trigger>
        <button type="button" class="chip chip-back" :style="{ background: editor.background }" title="背景色" aria-label="背景色" />
      </template>
    </ColorField>
    <ColorField
      :model-value="editor.foreground"
      label="前景色"
      side="right"
      opaque
      @input="(hex: string) => (editor.foreground = hex)"
      @update:model-value="(hex: string) => (editor.foreground = hex)"
    >
      <template #trigger>
        <button type="button" class="chip chip-front" :style="{ background: editor.foreground }" title="前景色" aria-label="前景色" />
      </template>
    </ColorField>
    <button type="button" class="mini mini-swap" title="交換前景與背景（X）" aria-label="交換前景與背景" @click="editor.swapColors()">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 6h11a4 4 0 0 1 4 4v10" />
        <path d="M8 2 4 6l4 4" />
        <path d="m15 16 4 4 4-4" />
      </svg>
    </button>
    <button type="button" class="mini mini-reset" title="預設的黑與白（D）" aria-label="預設的黑與白" @click="editor.resetColors()">
      <span class="mini-chip mini-chip-back" />
      <span class="mini-chip mini-chip-front" />
    </button>
  </div>
</template>

<script setup lang="ts">
import ColorField from '@/components/ColorField.vue'
import { useEditorStore } from '@/stores/editorStore'

/**
 * The foreground and background pair, Photoshop's arrangement: two equal
 * squares, the foreground over the background's corner, and above them a row
 * holding black-and-white on the left and swap on the right. A click on either
 * square opens its picker.
 */
const editor = useEditorStore()
</script>

<style scoped>
.pair {
  position: relative;
  width: 1.75rem;
  height: 39px;
  flex-shrink: 0;
}
.chip {
  position: absolute;
  width: 17px;
  height: 17px;
  border-radius: 3px;
  border: 1px solid var(--muted-foreground);
}
.chip-front {
  left: 1px;
  top: 13px;
}
.chip-back {
  left: 10px;
  top: 22px;
}
.chip[data-state='open'] {
  box-shadow: 0 0 0 1.5px var(--primary);
}
.mini {
  position: absolute;
  display: flex;
  color: var(--muted-foreground);
}
.mini:hover {
  color: var(--foreground);
}
.mini-swap {
  right: 0;
  top: 0;
}
.mini-reset {
  left: 1px;
  top: 0;
  width: 9px;
  height: 9px;
}
.mini-chip {
  position: absolute;
  width: 6px;
  height: 6px;
  border: 1px solid var(--muted-foreground);
}
.mini-chip-front {
  left: 0;
  top: 0;
  background: #000;
}
.mini-chip-back {
  left: 3px;
  top: 3px;
  background: #fff;
}
</style>
