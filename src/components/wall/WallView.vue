<template>
  <div class="flex h-full min-h-0 flex-col bg-muted">
    <div class="flex h-7 shrink-0 items-center gap-3 border-b border-border bg-card px-2 text-xs select-none">
      <span class="font-medium">{{ wallScope === 'page' ? '這一頁' : '這一話' }}的全部譯文</span>
      <span class="text-muted-foreground tabular-nums">
        {{ pieces.length }} 個物件 · {{ groups.length }} 組 · {{ bucketCount }} 堆
        <template v-if="missingCount">
          · <span class="text-destructive">{{ missingCount }} 個缺字型</span>
        </template>
      </span>
    </div>

    <p v-if="scene.entries.length === 0" class="p-4 text-sm text-muted-foreground">
      主視窗開啟專案後，這裡會列出它的每一句譯文
    </p>

    <p v-else-if="shown.length === 0" class="p-4 text-sm text-muted-foreground">
      {{ scene.currentPageId === null ? '主視窗還沒翻到任何一頁' : '這一頁沒有譯文' }}
    </p>

    <div v-else ref="bodyEl" class="min-h-0 flex-1 overflow-auto" :class="dense ? 'p-1.5' : 'p-4'">
      <section v-for="group in groups" :key="group.key" class="group">
        <!-- What it means first, as the semantic buckets read; how it looks under it. -->
        <div class="group-head">
          <button
            type="button"
            class="row-action"
            :title="folded.has(group.key) ? '展開' : '收合'"
            @click="toggleGroup(group.key)"
          >
            <ChevronRight :size="12" class="transition-transform" :class="!folded.has(group.key) && 'rotate-90'" />
          </button>
          <button
            type="button"
            class="row-action"
            :title="`用「${group.tags.join('、') || '未標記'}」裝上標記畫筆`"
            @click="emit('brush', group.tags)"
          >
            <Palette :size="12" />
          </button>
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 text-left"
            :title="`選中「${group.tags.join('、') || '未標記'}」的全部 ${group.count} 個物件`"
            @click="emit('select', group.buckets.flatMap((b) => b.ids))"
          >
            <span v-if="group.tags.length === 0" class="text-muted-foreground">未標記</span>
            <span v-for="tag in group.tags" :key="tag" class="flex min-w-0 items-center gap-1">
              <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: tagColor(tag, scene.registry) }" />
              <span class="truncate font-medium">{{ tag }}</span>
            </span>
            <span
              v-if="group.manyStyles"
              class="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-600"
              title="意思相同，但分成好幾種樣式"
            >
              樣式群 {{ group.buckets.length }}
            </span>
            <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">{{ group.count }}</span>
          </button>
        </div>

        <template v-if="!folded.has(group.key)">
          <!-- Every piece packed tight, each bucket a cluster, the biggest bucket first. -->
          <div class="flex flex-wrap items-start" :class="dense ? 'gap-1.5' : 'gap-4'">
            <div v-for="lane in group.lanes" :key="lane.key" class="cluster">
              <!-- The bucket's name picks the whole bucket, as a row of the semantic buckets did. -->
              <button
                type="button"
                class="cluster-label"
                :title="`選中這一堆的 ${lane.items.length} 個物件${lane.details ? `\n${lane.details}` : ''}`"
                @click="emit('select', lane.items.map((i) => i.id))"
              >
                <span class="truncate">{{ lane.title }}</span>
                <span class="tabular-nums text-muted-foreground">{{ lane.items.length }}</span>
              </button>
              <div class="flex flex-wrap items-center gap-1">
                <WallPiece
                  v-for="item in bySizeDown(lane.items)"
                  :key="item.id"
                  :sample="item.sample"
                  :scale="item.scale * fit"
                  :missing="item.missing"
                  :title="item.title"
                  @open="open(item)"
                />
              </div>
            </div>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { useElementSize } from '@vueuse/core'
import { ChevronRight, Palette } from '@lucide/vue'
import type { TextStyle } from '@shared/text-style/types'
import { TEXT_STYLE_FIELDS } from '@shared/text-style/schema'
import { tagColor } from '@shared/tags/set'
import type { WallScene } from '@shared/wall/scene'
import WallPiece from '@/components/wall/WallPiece.vue'
import { drawnLabel } from '@/lib/labelRaster'
import type { Sample } from '@/lib/fontSampleCache'
import { styleFieldText, TEXT_STYLE_FIELD_NAMES } from '@/lib/textStyleFields'
import { groupByValue } from '@/lib/valueBuckets'
import { shownEm, wallFields, wallScope, wallSize } from '@/lib/wall'

/**
 * Every translation in the open chapter on one surface, each drawn as the page
 * draws it, gathered the way the semantic buckets gather them: by what it
 * means, then by how it looks on the fields being compared. So a missing face,
 * a size that wandered and a meaning that split into several looks can all be
 * read at a glance. Packed tight, each bucket a cluster, the biggest first.
 *
 * Draws what it is handed rather than reading a project: it stands in a window
 * of its own, and the chapter lives in the editor's.
 */
const props = defineProps<{
  scene: WallScene
  /** Tighter margins, for a column rather than a window. */
  dense?: boolean
}>()
const emit = defineEmits<{
  reveal: [pageId: string, id: string]
  /** Every object of a bucket or a meaning, the way the semantic buckets pick them. */
  select: [ids: string[]]
  brush: [tags: readonly string[]]
}>()

interface Item {
  id: string
  pageId: string
  sizePx: number
  sample: Sample | null
  missing: boolean
  scale: number
  title: string
}

const shown = computed(() =>
  props.scene.entries.filter(
    (entry) =>
      entry.code.trim() && (wallScope.value === 'chapter' || entry.pageId === props.scene.currentPageId),
  ),
)

/** Drawn once per entry and size mode; regrouping does not draw anything again. */
const pieces = computed<Item[]>(() =>
  shown.value.map((entry) => {
    const style = entry.style
    // Upright: the wall compares how pieces are set, not how they lie.
    const drawn = drawnLabel(entry.code, style, entry.effects, { x: 0, y: 0 }, 0)
    const scale = shownEm(style.fontSizePx, wallSize.value) / style.fontSizePx
    const font = style.fontFamily || '未指定'
    return {
      id: entry.id,
      pageId: entry.pageId,
      sizePx: style.fontSizePx,
      sample: drawn.sample,
      missing: drawn.missingFamily !== null,
      scale,
      title: `第 ${entry.pageNumber} 頁 · ${font} ${style.fontStyleName} · ${style.fontSizePx}px${drawn.missingFamily ? ' · 缺字型' : ''}`,
    }
  }),
)

const bodyEl = useTemplateRef<HTMLElement>('bodyEl')
const { width: bodyW } = useElementSize(bodyEl)

/**
 * One factor for every piece, so the largest is at most half the width it
 * stands in. The sizes keep their proportion to each other; only the whole is
 * brought within reach, which is what lets a 300px column hold a 368px shout.
 */
const fit = computed(() => {
  const widest = Math.max(1, ...pieces.value.map((p) => (p.sample?.image.width ?? 40) * p.scale))
  const room = bodyW.value > 0 ? bodyW.value / 2 : Infinity
  return Math.min(1, room / widest)
})

const missingCount = computed(() => pieces.value.filter((p) => p.missing).length)

const comparedFields = computed(() => TEXT_STYLE_FIELDS.filter((f) => wallFields.value.has(f)))

function laneTitle(style: TextStyle): { title: string; details: string } {
  const [first, ...rest] = comparedFields.value
  if (!first) return { title: '未比較任何欄位', details: '' }
  const say = (f: keyof TextStyle) => `${TEXT_STYLE_FIELD_NAMES[f]} ${styleFieldText(style, f)}`
  return { title: styleFieldText(style, first), details: rest.map(say).join('、') }
}

const groups = computed(() => {
  const byId = new Map(pieces.value.map((p) => [p.id, p]))
  const objects = shown.value.map((e) => ({ id: e.id, pageId: e.pageId, tags: e.tags, style: e.style }))
  return groupByValue(objects, comparedFields.value, props.scene.registry).map((group) => ({
    ...group,
    lanes: group.buckets.map((bucket) => {
      const items = bucket.ids.map((id) => byId.get(id)).filter((p): p is Item => p !== undefined)
      return { key: bucket.key, ...laneTitle(bucket.style), items }
    }),
  }))
})

const bucketCount = computed(() => groups.value.reduce((n, g) => n + g.lanes.length, 0))

/** Folded by meaning, and kept folded across regrouping, since a meaning outlives the fields. */
const folded = ref(new Set<string>())
function toggleGroup(key: string) {
  const next = new Set(folded.value)
  if (!next.delete(key)) next.add(key)
  folded.value = next
}

function bySizeDown(items: readonly Item[]): Item[] {
  return [...items].sort((a, b) => b.sizePx - a.sizePx)
}

/** Back to the page in the editor's window, with the piece selected where it stands. */
function open(item: Item) {
  emit('reveal', item.pageId, item.id)
}
</script>

<style scoped>
.group {
  margin-bottom: 1rem;
}
.group-head {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 0.3rem;
  border-radius: 4px;
  padding: 0.1rem 0.2rem;
  font-size: 12px;
}
.group-head:hover {
  background: color-mix(in oklch, var(--secondary) 50%, transparent);
}
.row-action {
  display: flex;
  height: 1.25rem;
  width: 1.25rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.row-action:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.cluster {
  max-width: 100%;
  border-radius: 6px;
  background: white;
  padding: 0.5rem;
}
.cluster-label {
  display: flex;
  width: 100%;
  min-width: 0;
  border-radius: 3px;
  gap: 0.4rem;
  margin-bottom: 0.3rem;
  font-size: 11px;
  color: #444;
}
.cluster-label:hover {
  background: var(--secondary);
}
</style>
