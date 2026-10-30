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

    <section class="mt-3 rounded border border-border p-3">
      <label class="block text-xs">
        新專案的頁列圖層
        <input
          type="text"
          class="mt-1.5 w-full rounded border border-border bg-background px-2 py-1 text-xs"
          :value="preferences.prefs.pinnedLayerSeed.join('、')"
          @change="onSeed($event)"
        />
        <span class="mt-1 block text-muted-foreground">
          用「、」或逗號分開。一本書第一次打開時抄一份過去，之後那本書用自己的；
          要改某一本，在圖層面板按圖層旁的圖釘。
        </span>
      </label>
    </section>

    <section class="mt-3 rounded border border-border p-3">
      <label class="flex cursor-pointer items-start gap-2 text-xs">
        <input
          type="checkbox"
          class="mt-0.5"
          :checked="preferences.prefs.activityLog"
          @change="preferences.prefs.activityLog = ($event.target as HTMLInputElement).checked"
        />
        <span>
          記錄操作
          <span class="block text-muted-foreground">
            每一次按鍵、點擊、換工具、選取、打的字、套的樣式都寫進本機的
            <code>logs/日期.jsonl</code>，不寫進專案資料夾。移動畫布不記。
            之後可以交給 agent 問哪裡不夠有效率。
          </span>
        </span>
      </label>
    </section>
  </div>
</template>

<script setup lang="ts">
import { MAX_UI_ZOOM_LEVEL, MIN_UI_ZOOM_LEVEL } from '@shared/preferences/types'
import { usePreferencesStore } from '@/stores/preferencesStore'

const preferences = usePreferencesStore()

function onSeed(e: Event) {
  const names = (e.target as HTMLInputElement).value.split(/[、,，]/).map((n) => n.trim()).filter(Boolean)
  preferences.prefs.pinnedLayerSeed = [...new Set(names)]
}

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
