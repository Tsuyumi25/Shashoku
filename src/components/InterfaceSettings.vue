<template>
  <div>
    <h3 class="mb-3 text-sm font-medium">介面</h3>

    <section class="rounded border border-border p-3">
      <div class="flex items-center justify-between gap-3">
        <span class="text-xs">介面縮放</span>
        <span class="text-xs text-muted-foreground">
          Ctrl + = 放大　Ctrl + - 縮小　Ctrl + 數字鍵 0 還原
        </span>
      </div>
      <!--
        Every step laid out rather than a stepper: the point of this is trying
        sizes against each other, and a row lets that be one press apiece.
      -->
      <div class="mt-2.5 flex overflow-hidden rounded border border-border">
        <button
          v-for="level in LEVELS"
          :key="level"
          type="button"
          class="zoom-btn"
          :class="preferences.prefs.uiZoomLevel === level && 'zoom-btn-on'"
          @click="preferences.setUiZoomLevel(level)"
        >
          {{ percentOf(level) }}%
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { MAX_UI_ZOOM_LEVEL, MIN_UI_ZOOM_LEVEL } from '@shared/preferences/types'
import { usePreferencesStore } from '@/stores/preferencesStore'

const preferences = usePreferencesStore()

const LEVELS = Array.from(
  { length: MAX_UI_ZOOM_LEVEL - MIN_UI_ZOOM_LEVEL + 1 },
  (_, i) => MIN_UI_ZOOM_LEVEL + i,
)

function percentOf(level: number): number {
  return Math.round(1.2 ** level * 100)
}
</script>

<style scoped>
.zoom-btn {
  flex: 1;
  padding: 0.25rem 0;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground);
}
.zoom-btn + .zoom-btn {
  border-left: 1px solid var(--border);
}
.zoom-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.zoom-btn-on,
.zoom-btn-on:hover {
  background: var(--primary);
  color: var(--primary-foreground);
}
</style>
