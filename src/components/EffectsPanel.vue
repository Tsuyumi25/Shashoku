<template>
  <section
    v-if="preferences.prefs.effectsPanel?.open"
    class="effects-panel"
    :style="{ left: `${shown.x}px`, top: `${shown.y}px`, width: `${EFFECTS_PANEL_WIDTH}px` }"
    aria-label="特效"
  >
    <header class="effects-panel-head" @pointerdown="startDrag" @pointermove="drag" @pointerup="endDrag" @pointercancel="endDrag">
      <span class="font-medium text-foreground">特效</span>
      <span class="min-w-0 flex-1 truncate text-muted-foreground">{{ kind === 'none' ? '沒有選取' : scopeLine }}</span>
      <button type="button" class="effects-panel-close" title="關閉" aria-label="關閉特效" @pointerdown.stop @click="close">
        <X :size="13" />
      </button>
    </header>
    <div class="max-h-[60vh] overflow-y-auto p-2">
      <template v-if="kind !== 'none'">
        <p v-if="scope.offPage" class="mb-1.5 px-0.5 text-[11px] text-amber-500">其中有不在目前頁面的物件</p>
        <EffectsTab :targets="targets" />
      </template>
      <p v-else class="px-0.5 py-2 text-xs text-muted-foreground">選一個文字或點陣圖層，這裡就會換成它的特效。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { X } from '@lucide/vue'
import EffectsTab from '@/components/appearance/EffectsTab.vue'
import { scopeText } from '@/lib/appearanceText'
import { EFFECTS_PANEL_WIDTH } from '@/lib/effectsPanel'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'

/**
 * The effects of whatever is selected, in a panel that floats over the window
 * and blocks nothing: it follows the selection rather than holding on to the
 * object it was opened on, and stays where it was dragged, open or shut,
 * across restarts.
 */
const editor = useEditorStore()
const preferences = usePreferencesStore()

const targets = computed(() => editor.selectedNodes())
const kind = computed(() => editor.appearanceKind)
const scope = computed(() => editor.batchScope)
const scopeLine = computed(() => scopeText(scope.value))

/** How much of the title bar has to stay inside the window, so it can always be grabbed back. */
const KEEP_VISIBLE = 48
const HEAD_HEIGHT = 28

const { width: windowW, height: windowH } = useWindowSize()

/** Where a drag has the panel right now; the stored place takes over when it ends. */
const dragging = ref<{ x: number; y: number } | null>(null)
let grab = { dx: 0, dy: 0 }

/**
 * The stored place, kept inside the window. The window may have shrunk since
 * it was stored, or the panel been dragged to a screen that is gone; either
 * way a panel off the edge would be open with nothing to grab.
 */
const shown = computed(() => {
  const at = dragging.value ?? preferences.prefs.effectsPanel ?? { x: 0, y: 0 }
  return {
    x: Math.min(windowW.value - KEEP_VISIBLE, Math.max(KEEP_VISIBLE - EFFECTS_PANEL_WIDTH, at.x)),
    y: Math.min(windowH.value - HEAD_HEIGHT, Math.max(0, at.y)),
  }
})

function startDrag(e: PointerEvent) {
  if (e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  grab = { dx: e.clientX - shown.value.x, dy: e.clientY - shown.value.y }
  dragging.value = { ...shown.value }
}

function drag(e: PointerEvent) {
  if (dragging.value === null) return
  dragging.value = { x: e.clientX - grab.dx, y: e.clientY - grab.dy }
}

function endDrag() {
  if (dragging.value === null) return
  const { x, y } = shown.value
  dragging.value = null
  preferences.placeEffectsPanel(x, y)
}

function close() {
  preferences.setEffectsPanelOpen(false, shown.value)
}
</script>

<style scoped>
.effects-panel {
  position: fixed;
  z-index: 40;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--background);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
}
.effects-panel-head {
  display: flex;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  gap: 0.5rem;
  border-bottom: 1px solid var(--border);
  padding: 0 0.25rem 0 0.625rem;
  font-size: 12px;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.effects-panel-head:active {
  cursor: grabbing;
}
.effects-panel-close {
  display: flex;
  height: 1.375rem;
  width: 1.375rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.effects-panel-close:hover {
  background: var(--secondary);
  color: var(--foreground);
}
</style>
