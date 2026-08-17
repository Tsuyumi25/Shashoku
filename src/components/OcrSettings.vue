<template>
  <div>
    <h3 class="mb-3 text-sm font-medium">文字辨識</h3>

    <!--
      One row per model, and the row is the model: the device it runs on and
      what it is allowed to read are both facts about that model, so a reader
      changing one is looking at the other while they do it.
    -->
    <div class="space-y-2">
      <section v-for="model in MODELS" :key="model.route" class="rounded border border-border p-3">
        <div class="flex items-center justify-between gap-3">
          <code class="min-w-0 truncate text-xs">{{ model.repo }}</code>

          <div class="flex shrink-0 overflow-hidden rounded border border-border">
            <button
              v-for="choice in model.devices"
              :key="choice.device"
              type="button"
              class="device-btn"
              :class="[
                ocr.settingsFor(model.route).device === choice.device && 'device-btn-active',
                !choice.ready && 'device-btn-unready',
              ]"
              :disabled="!choice.ready"
              :title="choice.ready ? choice.runtime : `${choice.runtime}（未實作）`"
              @click="ocr.configure(model.route, { device: choice.device })"
            >
              {{ choice.label }}
              <span class="ml-1 opacity-60">{{ choice.runtime }}</span>
            </button>
          </div>
        </div>

        <!--
          Only where it is a real question. The other three read nothing worth
          keeping off the artwork, so the row simply does not carry the switch
          — a control whose every setting is wrong reads as one the reader has
          not found the right value for yet.
        -->
        <label
          v-if="ocr.readsDrawn(model.route)"
          class="mt-2.5 flex cursor-pointer items-center gap-2 text-xs"
        >
          <input
            type="checkbox"
            :checked="ocr.settingsFor(model.route).onomatopoeia"
            @change="
              ocr.configure(model.route, {
                onomatopoeia: ($event.target as HTMLInputElement).checked,
              })
            "
          />
          <span>使用 <code>{{ LAYOUT_REPO }}</code> 產生的 <code>onomatopoeia</code> 偵測框</span>
        </label>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useOcrStore, OCR_ROUTES, type OcrRoute } from '@/stores/ocrStore'

const ocr = useOcrStore()

/** Named rather than described: this is the only detector that emits that label. */
const LAYOUT_REPO = 'koharu-layout-rfdetr-seg-2xl-1152'

interface DeviceChoice {
  device: 'cpu' | 'gpu'
  label: string
  /** Which library runs it there. Not the choice, but the two differ for PP-OCR. */
  runtime: string
  ready: boolean
}

interface ModelRow {
  route: OcrRoute
  repo: string
  devices: DeviceChoice[]
}

/**
 * ⚠️ The GPU column is drawn but not wired: the sidecar has one path today and
 * it is the processor. Shown rather than hidden because a column that appears
 * later moves everything under it, and because "this exists and is not ready"
 * is what a reader wanting it needs told.
 */
function devices(cpu: string, gpu: string): DeviceChoice[] {
  return [
    { device: 'cpu', label: 'CPU', runtime: cpu, ready: true },
    { device: 'gpu', label: 'GPU', runtime: gpu, ready: false },
  ]
}

const ROWS: Record<OcrRoute, ModelRow> = {
  'manga-ocr': {
    route: 'manga-ocr',
    repo: 'kha-white/manga-ocr-base',
    devices: devices('PyTorch', 'PyTorch'),
  },
  'ppocr-v6': {
    route: 'ppocr-v6',
    repo: 'PP-OCRv6_medium',
    devices: devices('ONNX Runtime', 'PyTorch'),
  },
  'baberu-ocr': {
    route: 'baberu-ocr',
    repo: 'genshiai-daichi/baberu-ocr',
    devices: devices('PyTorch', 'PyTorch'),
  },
  'hayai-ocr-v2': {
    route: 'hayai-ocr-v2',
    repo: 'JustANormalTinkerer/hayai-ocr-v2',
    devices: devices('PyTorch', 'PyTorch'),
  },
}

const MODELS: ModelRow[] = OCR_ROUTES.map((route) => ROWS[route])
</script>

<style scoped>
.device-btn {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
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
