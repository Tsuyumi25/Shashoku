<template>
  <div class="flex items-center gap-1">
    <button
      class="flex h-6 items-center rounded px-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
      :disabled="!project.isOpen"
      :title="`切換為${previewDirection === 'horizontal' ? '直排' : '橫排'}`"
      @click="toggleDirection"
    >
      {{ previewDirection === 'horizontal' ? '橫排' : '直排' }}
    </button>

    <Dialog>
      <DialogTrigger as-child>
        <button
          class="flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
          :disabled="!project.isOpen"
          title="Canvas 2D 文字預覽設定"
        >
          <Paintbrush :size="13" />
          文字預覽
        </button>
      </DialogTrigger>
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>Canvas 2D 文字預覽</DialogTitle>
          <DialogDescription>
            設定會寫入工程檔並交給 JSX；字級以原圖像素表示，JSX 會依 PSD resolution 換算。
          </DialogDescription>
        </DialogHeader>

        <div class="grid grid-cols-[5rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
          <label for="preview-font" class="text-muted-foreground">字型名稱</label>
          <input
            id="preview-font"
            :value="project.exportConfig.font ?? ''"
            class="h-8 min-w-0 rounded border border-input bg-background px-2"
            placeholder="例如 Source Han Sans TC"
            @input="onFontInput"
          />

          <label for="preview-size" class="text-muted-foreground">字級（px）</label>
          <input
            id="preview-size"
            :value="project.exportConfig.fontSizePx ?? ''"
            class="h-8 min-w-0 rounded border border-input bg-background px-2"
            type="number"
            min="1"
            step="1"
            @input="onFontSizeInput"
          />

          <label for="preview-direction" class="text-muted-foreground">文字方向</label>
          <select
            id="preview-direction"
            :value="previewDirection"
            class="h-8 min-w-0 rounded border border-input bg-background px-2"
            @change="onDirectionChange"
          >
            <option value="horizontal">水平</option>
            <option value="vertical">直排</option>
          </select>

          <label for="preview-color" class="text-muted-foreground">文字顏色</label>
          <div class="flex items-center gap-2">
            <input
              id="preview-color"
              :value="project.exportConfig.textColor"
              class="h-8 w-12 rounded border border-input bg-background p-1"
              type="color"
              @input="onColorInput"
            />
            <span class="font-mono text-xs text-muted-foreground">
              {{ project.exportConfig.textColor }}
            </span>
          </div>
        </div>

        <div class="flex justify-end">
          <Button variant="outline" size="sm" @click="resetTextStyle">重設</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Paintbrush } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const previewDirection = computed(() =>
  project.exportConfig.textDirection === 'vertical' ? 'vertical' : 'horizontal'
)

function markDirty() {
  project.dirty = true
}

function toggleDirection() {
  project.exportConfig.textDirection =
    previewDirection.value === 'horizontal' ? 'vertical' : 'horizontal'
  markDirty()
}

function onFontInput(e: Event) {
  const value = (e.target as HTMLInputElement).value.trim()
  project.exportConfig.font = value === '' ? null : value
  markDirty()
}

function onFontSizeInput(e: Event) {
  const value = Number((e.target as HTMLInputElement).value)
  project.exportConfig.fontSizePx = Number.isFinite(value) && value > 0 ? value : null
  markDirty()
}

function onDirectionChange(e: Event) {
  project.exportConfig.textDirection =
    (e.target as HTMLSelectElement).value === 'vertical' ? 'vertical' : 'horizontal'
  markDirty()
}

function onColorInput(e: Event) {
  project.exportConfig.textColor = (e.target as HTMLInputElement).value
  markDirty()
}

function resetTextStyle() {
  project.exportConfig.font = null
  project.exportConfig.fontSizePx = null
  project.exportConfig.textDirection = 'keep'
  project.exportConfig.textColor = '#000000'
  markDirty()
}
</script>
