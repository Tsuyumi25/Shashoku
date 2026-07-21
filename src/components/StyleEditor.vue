<template>
  <!-- TextStyle 編輯器:5 欄位 grid,每個欄位變動走 patch emit(呼叫端決定
       落到哪個 store method:updateGroupStyle / updateDefaultStyle /
       label.styleOverride)。numeric input 用 @change(blur / Enter 才 commit,
       避免每 keystroke 進 metaDirty),select/color 用 @change(即時 preview)。 -->
  <div class="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
    <label class="text-muted-foreground">字型</label>
    <button
      type="button"
      class="flex h-6 w-full min-w-0 items-center justify-between gap-1 rounded border border-input bg-background px-1.5 text-left hover:border-primary"
      :title="value.fontFamily || '選擇字型'"
      @click="emit('openFontPicker')"
    >
      <span class="min-w-0 truncate">{{ value.fontFamily || '選擇字型' }}</span>
      <ChevronDown :size="12" class="shrink-0 text-muted-foreground" />
    </button>

    <label class="text-muted-foreground">字級</label>
    <div class="flex items-center gap-1">
      <input
        type="number"
        min="1"
        step="1"
        class="h-6 w-16 rounded border border-input bg-background px-1.5"
        :value="value.fontSizePx"
        @change="onNumber('fontSizePx', $event)"
      />
      <span class="text-muted-foreground">px</span>
    </div>

    <label class="text-muted-foreground">方向</label>
    <select
      class="h-6 w-full rounded border border-input bg-background px-1.5"
      :value="value.direction"
      @change="onDirection($event)"
    >
      <option value="horizontal">橫排</option>
      <option value="vertical">直排</option>
    </select>

    <label class="text-muted-foreground">文字色</label>
    <div class="flex items-center gap-1.5">
      <input
        type="color"
        class="h-6 w-8 cursor-pointer rounded border border-input bg-background"
        :value="value.color"
        @change="onColor($event)"
      />
      <span class="font-mono text-muted-foreground">{{ value.color }}</span>
    </div>

    <label class="text-muted-foreground">行距</label>
    <div class="flex items-center gap-1">
      <input
        type="number"
        min="1"
        step="10"
        class="h-6 w-16 rounded border border-input bg-background px-1.5"
        :value="value.leadingPercent"
        @change="onNumber('leadingPercent', $event)"
      />
      <span class="text-muted-foreground">%</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// prop 名叫 value 不叫 style:Vue 3 對 class / style 兩個名字有 fallthrough
// 特殊處理,即使 defineProps 宣告過也會被 merge 到 root element,寫成 value
// 避開這個坑,並跟未來可能的 v-model 對齊
import { ChevronDown } from '@lucide/vue'
import type { TextStyle } from '@shared/text-style/types'

const props = defineProps<{
  value: TextStyle
}>()

const emit = defineEmits<{
  patch: [patch: Partial<TextStyle>]
  /** 字型欄位按鈕點擊:交給呼叫端開啟字型 picker(視覺覆蓋畫布) */
  openFontPicker: []
}>()

function onNumber(key: 'fontSizePx' | 'leadingPercent', e: Event) {
  const raw = (e.target as HTMLInputElement).valueAsNumber
  if (!Number.isFinite(raw) || raw <= 0) return
  if (raw === props.value[key]) return
  emit('patch', { [key]: raw })
}

function onDirection(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (v !== 'horizontal' && v !== 'vertical') return
  if (v === props.value.direction) return
  emit('patch', { direction: v })
}

function onColor(e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (v === props.value.color) return
  emit('patch', { color: v })
}
</script>
