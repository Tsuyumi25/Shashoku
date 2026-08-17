<template>
  <!--
    A floating panel, not a view: settings is a short, self-contained errand,
    and the panel keeps the place it was opened over — scroll, selection,
    half-drawn shapes — waiting underneath. The library and export stay full
    views for the same reason in reverse: working surfaces need ground to
    stand on, forms do not.

    Every control writes the moment it is touched. There is no Save because
    there is nothing unsaved to confirm.
  -->
  <DialogRoot :open="ui.settingsOpen" @update:open="(v) => (ui.settingsOpen = v)">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="settings-panel" :aria-describedby="undefined">
        <nav class="settings-nav">
          <DialogTitle class="settings-nav-title">設定</DialogTitle>
          <button
            v-for="tab in TABS"
            :key="tab.key"
            type="button"
            class="settings-tab"
            :class="active === tab.key && 'settings-tab-on'"
            @click="active = tab.key"
          >
            <component :is="tab.icon" :size="14" />
            <span>{{ tab.title }}</span>
          </button>
        </nav>

        <div class="settings-body">
          <OcrSettings v-if="active === 'ocr'" />

          <div v-else-if="active === 'about'">
            <h3 class="mb-3 text-sm font-medium">關於</h3>
            <p class="text-sm">Shashoku 写植 <span class="text-xs text-muted-foreground">v{{ VERSION }}</span></p>
            <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
              為漫畫漢化而做的圖像編輯器。從翻譯到完稿，都在同一個軟體裡。
            </p>
          </div>
        </div>

        <DialogClose class="settings-close" title="關閉">
          <X :size="14" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { ref, type Component } from 'vue'
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { Info, ScanText, X } from '@lucide/vue'
import OcrSettings from '@/components/OcrSettings.vue'
import { useUiStore } from '@/stores/uiStore'
import { version as VERSION } from '../../package.json'

const ui = useUiStore()

type TabKey = 'ocr' | 'about'

const TABS: { key: TabKey; title: string; icon: Component }[] = [
  { key: 'ocr', title: '文字辨識', icon: ScanText },
  { key: 'about', title: '關於', icon: Info },
]

const active = ref<TabKey>('ocr')
</script>

<style scoped>
.settings-panel {
  position: fixed;
  z-index: 50;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  width: min(58rem, calc(100vw - 4rem));
  height: min(38rem, calc(100vh - 4rem));
  overflow: hidden;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
}
.settings-nav {
  display: flex;
  width: 9rem;
  flex-shrink: 0;
  flex-direction: column;
  gap: 0.125rem;
  border-right: 1px solid var(--border);
  background: var(--card);
  padding: 0.5rem;
}
.settings-nav-title {
  padding: 0.25rem 0.5rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--muted-foreground);
}
.settings-tab {
  display: flex;
  align-items: center;
  gap: 0.4375rem;
  padding: 0.3125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.8125rem;
  text-align: left;
  color: var(--muted-foreground);
}
.settings-tab:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.settings-tab-on,
.settings-tab-on:hover {
  background: var(--primary);
  color: var(--primary-foreground);
}
.settings-body {
  min-width: 0;
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.25rem;
}
.settings-close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  height: 1.5rem;
  width: 1.5rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.settings-close:hover {
  background: var(--secondary);
  color: var(--foreground);
}
</style>
