<template>
  <div>
    <h3 class="mb-3 text-sm font-medium">文字辨識</h3>

    <!--
      ⭐ Settings for the run, not for a model. The recognizers became stages of
      one job, and "which device" and "read the drawn effects" are questions
      about that job — a per-model answer to them was always a way of saying
      which models you meant to use, and a machine with a card runs the whole
      trip on it.
    -->
    <section class="rounded border border-border p-3">
      <div class="flex items-center justify-between gap-3">
        <span class="text-xs">執行裝置</span>
        <div class="flex shrink-0 overflow-hidden rounded border border-border">
          <button
            v-for="choice in DEVICES"
            :key="choice.device"
            type="button"
            class="device-btn"
            :class="[
              ocr.settings().device === choice.device && 'device-btn-active',
              !choice.ready && 'device-btn-unready',
            ]"
            :disabled="!choice.ready"
            :title="choice.ready ? choice.label : `${choice.label}（未實作）`"
            @click="ocr.configure({ device: choice.device })"
          >
            {{ choice.label }}
          </button>
        </div>
      </div>

      <label class="mt-2.5 flex cursor-pointer items-start gap-2 text-xs">
        <input
          type="checkbox"
          class="mt-0.5"
          :checked="ocr.settings().onomatopoeia"
          @change="ocr.configure({ onomatopoeia: ($event.target as HTMLInputElement).checked })"
        />
        <span>
          辨識手繪擬聲詞
          <span class="block text-muted-foreground">
            <code>{{ LAYOUT_REPO }}</code> 標成 <code>onomatopoeia</code> 的區域。
            只交給讀得動它的辨識器，其餘三個不會在上面作答。
          </span>
        </span>
      </label>
    </section>

    <!--
      What one press runs, in order. Not a list of choices — it is here so that
      the wait has a shape, and so that a reader can tell which stage a bad
      answer came out of.
    -->
    <h4 class="mt-4 mb-2 text-xs font-medium text-muted-foreground">一次辨識會跑過</h4>
    <ol class="space-y-1">
      <li
        v-for="(stage, index) in STAGES"
        :key="stage.repo"
        class="flex items-baseline gap-2 rounded border border-border px-2.5 py-1.5"
      >
        <span class="w-4 shrink-0 text-[11px] text-muted-foreground">{{ index + 1 }}</span>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2">
            <span class="text-xs">{{ stage.name }}</span>
            <span class="truncate text-[11px] text-muted-foreground">{{ stage.job }}</span>
          </div>
          <code class="block truncate text-[11px] text-muted-foreground">{{ stage.repo }}</code>
        </div>
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
import { useOcrStore } from '@/stores/ocrStore'

const ocr = useOcrStore()

/** Named rather than described: this is the only detector that emits that label. */
const LAYOUT_REPO = 'koharu-layout-rfdetr-seg-2xl-1152'

interface DeviceChoice {
  device: 'cpu' | 'gpu'
  label: string
  ready: boolean
}

/**
 * ⚠️ The GPU column is drawn but not wired: the sidecar has one path today and
 * it is the processor. Shown rather than hidden because a column that appears
 * later moves everything under it, and because "this exists and is not ready"
 * is what a reader wanting it needs told.
 */
const DEVICES: DeviceChoice[] = [
  { device: 'cpu', label: 'CPU', ready: true },
  { device: 'gpu', label: 'GPU', ready: false },
]

/**
 * The stages a page goes through, in order, so a reader can see what one press
 * costs. Listed rather than chosen from — none of these is an alternative to
 * any other.
 */
const STAGES: { name: string; repo: string; job: string }[] = [
  { name: '氣球偵測', repo: 'ogkalu/comic-text-and-bubble-detector', job: '哪裡有字' },
  { name: '版面偵測', repo: LAYOUT_REPO, job: '哪裡有字，含手繪擬聲詞' },
  { name: '字體偵測', repo: 'fffonion/yuzumarker-font-detection', job: '直排橫排、字級、行高、傾斜' },
  { name: 'PP-OCR', repo: 'PP-OCRv6_medium', job: '行框在哪，以及一票文字' },
  { name: 'manga-ocr', repo: 'kha-white/manga-ocr-base', job: '文字，以及每個字的位置' },
  { name: 'Baberu', repo: 'genshiai-daichi/baberu-ocr', job: '一票文字' },
  { name: 'Hayai', repo: 'JustANormalTinkerer/hayai-ocr-v2', job: '手繪擬聲詞的文字' },
]
</script>

<style scoped>
.device-btn {
  padding: 0.25rem 0.5rem;
  font-size: 0.8125rem;
  color: var(--muted-foreground);
}
.device-btn + .device-btn {
  border-left: 1px solid var(--border);
}
.device-btn:not(:disabled):hover {
  background: var(--secondary);
  color: var(--foreground);
}
.device-btn-active,
.device-btn-active:hover {
  background: var(--primary);
  color: var(--primary-foreground);
}
.device-btn-unready {
  cursor: not-allowed;
  opacity: 0.4;
}
</style>
