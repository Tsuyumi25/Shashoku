<template>
  <!--
    ⚠️ A probe, not a feature. It is here to find out whether a selection made
    by hand can be grown and handed to the model at all, and what the result
    looks like on a real page — the two things no amount of reading the model's
    card answers.
  -->
  <div class="shrink-0 border-t border-border">
    <div class="probe-head">
      <span class="text-xs font-medium">修圖(試作)</span>
      <span class="ml-auto pr-1 text-[11px] text-muted-foreground">{{ standing }}</span>
    </div>

    <div class="flex flex-wrap gap-1 px-2 py-2">
      <button
        type="button"
        class="route-btn"
        :disabled="!hasSelection"
        title="沿著選區的邊往外推 5 像素，轉角是圓的"
        @click="growBy5"
      >
        選區 +5px
      </button>
      <button
        type="button"
        class="route-btn"
        :disabled="!inpaint.canErase.value"
        title="把選區連同周邊送給 anime-manga-big-lama，回來的像素只寫進選區裡"
        @click="inpaint.eraseByModel()"
      >
        {{ inpaint.working.value ? '修補中…' : 'LaMa 修補' }}
      </button>
      <button
        type="button"
        class="route-btn"
        :aria-pressed="editor.textsHidden"
        :class="editor.textsHidden && 'route-btn-on'"
        title="畫布上暫時拿掉所有文字物件，看底下的圖。不改任何物件自己的顯示狀態，也不影響匯出"
        @click="editor.textsHidden = !editor.textsHidden"
      >
        {{ editor.textsHidden ? '顯示文字' : '隱藏文字' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useInpaintSelection } from '@/composables/useInpaintSelection'
import { isEmptyRect } from '@/lib/selection/rect'
import { useEditorStore } from '@/stores/editorStore'
import { useSelectionStore } from '@/stores/selectionStore'

/** What the probe was written to try. Five is the amount the notes settled on. */
const GROW_PX = 5

const editor = useEditorStore()
const selection = useSelectionStore()
const inpaint = useInpaintSelection()

const hasSelection = computed(
  () => selection.bounds !== null && !isEmptyRect(selection.bounds),
)

/** The selection's box, or why there is nothing to act on. */
const standing = computed(() => {
  const bounds = selection.bounds
  if (bounds === null || isEmptyRect(bounds)) return '沒有選區'
  return `${bounds.w}×${bounds.h}`
})

function growBy5(): void {
  const target = editor.maskTarget
  if (target === null) return
  selection.grow(target, GROW_PX)
}
</script>

<style scoped>
.probe-head {
  display: flex;
  height: 1.75rem;
  align-items: center;
  padding-left: 0.375rem;
  user-select: none;
}
.route-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border);
  padding: 0.125rem 0.375rem;
  font-size: 11px;
  color: var(--muted-foreground);
}
.route-btn:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.route-btn:disabled {
  opacity: 0.5;
}
.route-btn-on,
.route-btn-on:hover:not(:disabled) {
  border-color: var(--primary);
  background: color-mix(in oklch, var(--primary) 14%, transparent);
  color: var(--foreground);
}
</style>
