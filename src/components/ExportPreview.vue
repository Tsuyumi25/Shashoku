<template>
  <div class="flex min-h-0 flex-1 flex-col border-l border-border bg-card">
    <div class="flex h-7 shrink-0 items-center border-b border-border px-2 select-none">
      <span class="text-xs font-medium text-muted-foreground">預覽</span>
      <span v-if="busy" class="ml-auto text-xs text-muted-foreground">產生中…</span>
    </div>

    <p v-if="!file" class="p-3 text-xs text-muted-foreground">點一頁，看它匯出後的樣子。</p>
    <p v-else-if="!exportRun.current" class="p-3 text-xs text-muted-foreground">選一份匯出配置。</p>

    <template v-else>
      <div class="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted p-3">
        <ImageCompare
          v-if="shown?.original"
          :width="shown.w"
          :height="shown.h"
          before-label="原圖"
          after-label="匯出後"
        >
          <template #before><img :src="shown.original" class="block h-full w-full" alt="" draggable="false" /></template>
          <template #after><img :src="shown.encoded" class="block h-full w-full" alt="" draggable="false" /></template>
        </ImageCompare>
        <img
          v-else-if="shown"
          :src="shown.encoded"
          class="max-h-full max-w-full object-contain shadow"
          alt=""
          draggable="false"
        />
        <p v-else-if="problem" class="text-xs text-destructive">{{ problem }}</p>
      </div>

      <!-- Describes the page in the picture, which runs behind the cursor while the next one is made. -->
      <dl v-if="shown" class="info">
        <dt>檔名</dt>
        <dd class="font-mono break-all">{{ exportRun.outputNames.get(shown.pageId) }}</dd>
        <template v-if="exportRun.delivery">
          <dt>資料夾</dt>
          <dd class="font-mono break-all">export/{{ exportRun.delivery.folder }}/</dd>
        </template>
        <dt>尺寸</dt>
        <dd class="tabular-nums">{{ shown.w }} × {{ shown.h }}</dd>
        <dt>檔案大小</dt>
        <dd class="tabular-nums">{{ sizeText(shown.bytes) }}</dd>
      </dl>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { targetSize } from '@shared/export/profile'
import type { ExportFormat, ExportProfile } from '@shared/export/types'
import { pageArtwork } from '@shared/page/tree'
import { layersDirOf } from '@shared/ssk/constants'
import ImageCompare from '@/components/ImageCompare.vue'
import { compositePage } from '@/lib/pageComposite'
import { encodePage } from '@/lib/pageEncode'
import { useExportStore } from '@/stores/exportStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * The page under the cursor as the file the export would write: composited for
 * the config's face and put through the same encoder, so a colour mode, a
 * palette or a size cap shows here as it will arrive, and the size is the
 * file's own rather than a guess.
 */
const project = useProjectStore()
const exportRun = useExportStore()

const file = computed(() => project.files.find((f) => f.pageId === exportRun.cursor) ?? null)

const MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  'png-8': 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/**
 * One page's two pictures, put on screen together. Each loads at its own pace,
 * and showing either the moment it arrived set one page's artwork beside the
 * last page's delivery until the slower one caught up.
 */
interface Shown {
  pageId: string
  /** The page's artwork file as it came in: what a delivery is judged against. */
  original: string | null
  encoded: string
  w: number
  h: number
  bytes: number
}

const shown = shallowRef<Shown | null>(null)
const problem = ref<string | null>(null)
const busy = ref(false)
let generation = 0

function swapIn(next: Shown | null) {
  const old = shown.value
  if (old) {
    URL.revokeObjectURL(old.encoded)
    if (old.original) URL.revokeObjectURL(old.original)
  }
  shown.value = next
}

async function render() {
  const mine = ++generation
  const of = file.value
  const face = exportRun.delivery?.face
  const config = exportRun.current
  if (!of || !face || !config || of.badge !== 'ok') {
    swapIn(null)
    problem.value = null
    busy.value = false
    return
  }
  const profile = JSON.parse(JSON.stringify(config.profile)) as ExportProfile
  const dir = layersDirOf(of.pageDir)
  const art = pageArtwork(of.page.pageTree)
  busy.value = true
  try {
    await project.flush()
    const [original, page] = await Promise.all([
      art ? window.api.readImage(dir, art.file) : Promise.resolve(null),
      compositePage({ page: of.page, face, loadLayer: (name) => window.api.readImage(dir, name) }),
    ])
    if (mine !== generation) return
    const bytes = encodePage(page, profile)
    const size = targetSize({ w: page.width, h: page.height }, profile.size)
    problem.value = null
    swapIn({
      pageId: of.pageId,
      original: original ? URL.createObjectURL(new Blob([original as BlobPart])) : null,
      encoded: URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[profile.format] })),
      ...size,
      bytes: bytes.length,
    })
  } catch (err) {
    if (mine !== generation) return
    swapIn(null)
    problem.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (mine === generation) busy.value = false
  }
}

// Another page, or another face, starts at once: an arrow key is a request
// for that page now.
watch(
  () => [file.value?.pageId, file.value?.page, exportRun.delivery?.face] as const,
  () => void render(),
  { immediate: true },
)

/**
 * What changes the pixels, and nothing else: the naming rule and the config's
 * name only change what the file is called. Debounced, or a number typed digit
 * by digit encodes the whole page once per keystroke.
 */
watchDebounced(
  () => {
    const p = exportRun.current?.profile
    return p && JSON.stringify([p.format, p.colorMode, p.size, p.maxBytes])
  },
  () => void render(),
  { debounce: 200 },
)

onBeforeUnmount(() => {
  generation++
  swapIn(null)
})

function sizeText(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
</script>

<style scoped>
.info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.125rem 0.75rem;
  flex-shrink: 0;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border);
  font-size: 0.75rem;
}
.info dt {
  color: var(--muted-foreground);
}
</style>
