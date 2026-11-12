<template>
  <!--
    Photoshop's options bar: one row under the title bar holding the armed
    tool's own settings, always in view, so pressing a tool's key shows at the
    corner of the eye how it will behave — a setting that has to be opened to be
    seen is one that gets forgotten until a click does nothing.
  -->
  <div class="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-card px-2 select-none">
    <div v-if="current" class="flex items-center gap-1.5 pr-2 text-xs text-foreground" :title="`${current.name}（${current.key}）`">
      <component :is="current.icon" :size="14" />
      <span>{{ current.name }}</span>
    </div>
    <div v-if="current" class="h-4 w-px bg-border" />

    <template v-if="editor.tool === 'select'">
      <button
        v-for="choice in ALIGN_CHOICES"
        :key="choice.axes"
        type="button"
        class="option-btn"
        :disabled="!aligner.ready.value"
        :title="choice.title"
        @click="aligner.align(choice.axes)"
      >
        <component :is="choice.icon" :size="12" />
        <span>{{ choice.text }}</span>
      </button>
    </template>

    <template v-else-if="editor.tool === 'wand'">
      <button
        type="button"
        class="option-btn"
        :aria-pressed="preferences.prefs.wandSamplesAll"
        :class="preferences.prefs.wandSamplesAll && 'option-btn-on'"
        title="開著時讀所有看得到的點陣圖層，選著文字也能點；關著時只讀選中的那一層。文字不算進去"
        @click="preferences.setWandSamplesAll(!preferences.prefs.wandSamplesAll)"
      >
        取樣全部圖層
      </button>
    </template>

    <template v-else-if="editor.tool === 'remove'">
      <button
        type="button"
        class="option-btn"
        :aria-pressed="preferences.prefs.removeEachStroke"
        :class="preferences.prefs.removeEachStroke && 'option-btn-on'"
        title="開著時每塗一筆、放開就修；關著時塗好的地方先留著，按 Enter 一起修，Esc 清掉"
        @click="preferences.setRemoveEachStroke(!preferences.prefs.removeEachStroke)"
      >
        每一筆都修復
      </button>
      <button
        v-if="!preferences.prefs.removeEachStroke"
        type="button"
        class="option-btn"
        :disabled="!removal.hasPending.value || removal.working.value"
        title="把移除工具塗好的地方送去修補（Enter）"
        @click="removal.commit()"
      >
        ✓ 修復塗好的地方
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, SquareDot } from '@lucide/vue'
import { CANVAS_TOOLS } from '@/components/canvasTools'
import { useAlignToSelection } from '@/composables/useAlignToSelection'
import { useRemoveStrokes } from '@/composables/useRemoveStrokes'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'

/** Photoshop's two centre buttons, and the pair pressed together — where Photoshop keeps them, on the move tool. */
const ALIGN_CHOICES = [
  { axes: 'x', text: '水平置中', icon: AlignHorizontalJustifyCenter, title: '把選中的物件左右移到選區的中間，上下不動；沒有選區時，選中兩個以上的物件彼此對齊' },
  { axes: 'y', text: '垂直置中', icon: AlignVerticalJustifyCenter, title: '把選中的物件上下移到選區的中間，左右不動；沒有選區時，選中兩個以上的物件彼此對齊' },
  { axes: 'both', text: '置中', icon: SquareDot, title: '把選中的物件移到選區的正中間；沒有選區時，選中兩個以上的物件彼此對齊。對齊的是看得到的字和像素，不是文字框' },
] as const

const editor = useEditorStore()
const preferences = usePreferencesStore()
const aligner = useAlignToSelection()
const removal = useRemoveStrokes()

const current = computed(() => CANVAS_TOOLS.find((t) => t.tool === editor.tool) ?? null)
</script>

<style scoped>
.option-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border);
  padding: 0.125rem 0.375rem;
  font-size: 12px;
  color: var(--muted-foreground);
}
.option-btn:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.option-btn:disabled {
  opacity: 0.5;
}
.option-btn-on,
.option-btn-on:hover:not(:disabled) {
  border-color: var(--primary);
  background: color-mix(in oklch, var(--primary) 14%, transparent);
  color: var(--foreground);
}
</style>
