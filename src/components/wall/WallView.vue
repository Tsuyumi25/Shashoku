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
            :title="`選中「${group.tags.join('、') || '未標記'}」的全部 ${group.count} 個物件；Shift 加進或拿出目前的選取`"
            @click="pick(group.buckets.flatMap((b) => b.ids), $event)"
          >
            <span v-if="group.tags.length === 0" class="text-muted-foreground">未標記</span>
            <span v-for="tag in group.tags" :key="tag" class="flex min-w-0 items-center gap-1">
              <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: tagColor(tag, scene.registry) }" />
              <span class="truncate font-medium">{{ tag }}</span>
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
                :class="pickedIn(lane.items) === lane.items.length && 'cluster-label-on'"
                :title="`選中這一堆的 ${lane.items.length} 個物件；Shift 加進或拿出目前的選取`"
                @click="pick(lane.items.map((i) => i.id), $event)"
              >
                <span v-if="lane.swatch" class="swatch" :style="{ backgroundColor: lane.swatch }" />
                <span class="truncate">{{ lane.title }}</span>
                <span class="tabular-nums opacity-70">
                  <template v-if="pickedIn(lane.items) > 0 && pickedIn(lane.items) < lane.items.length">
                    {{ pickedIn(lane.items) }}/</template>{{ lane.items.length }}
                </span>
              </button>
              <div class="flex flex-wrap items-center gap-1">
                <WallPiece
                  v-for="item in bySizeDown(lane.items)"
                  :key="item.id"
                  :sample="item.sample"
                  :scale="item.scale * fit"
                  :missing="item.missing"
                  :selected="selected.has(item.id)"
                  :title="item.title"
                  @open="(e: MouseEvent) => onPiece(item, e)"
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
import { tagColor } from '@shared/tags/set'
import type { WallScene } from '@shared/wall/scene'
import WallPiece from '@/components/wall/WallPiece.vue'
import { drawnLabel } from '@/lib/labelRaster'
import type { Sample } from '@/lib/fontSampleCache'
import { groupByAttribute } from '@/lib/wallAttributes'
import { shownEm, wallAttribute, wallScope, wallSize } from '@/lib/wall'

/**
 * Every translation in the open chapter on one surface, each drawn as the page
 * draws it, gathered by what it means and then by the one value it holds for
 * the attribute chosen. So a missing face,
 * a size that wandered and a meaning that split into several looks can all be
 * read at a glance. Packed tight, each bucket a cluster, the biggest first.
 *
 * Draws what it is handed rather than reading a project: it stands in a window
 * of its own, and the chapter lives in the editor's.
 */
const props = defineProps<{
  scene: WallScene
  /** What the editor has selected, marked where it stands. */
  selected: ReadonlySet<string>
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

const groups = computed(() => {
  const byId = new Map(pieces.value.map((p) => [p.id, p]))
  return groupByAttribute(shown.value, wallAttribute.value, props.scene.registry).map((group) => ({
    ...group,
    lanes: group.buckets.map((bucket) => ({
      key: bucket.key,
      title: bucket.label,
      swatch: bucket.swatch,
      items: bucket.ids.map((id) => byId.get(id)).filter((p): p is Item => p !== undefined),
    })),
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

function pickedIn(items: readonly Item[]): number {
  let n = 0
  for (const item of items) if (props.selected.has(item.id)) n++
  return n
}

function bySizeDown(items: readonly Item[]): Item[] {
  return [...items].sort((a, b) => b.sizePx - a.sizePx)
}

// Shift, as on the canvas: this is a picture of objects, not a list with an
// order a range could run along.
const adding = (e: MouseEvent) => e.shiftKey

/**
 * A plain click takes the editor to the piece; with Shift it joins or leaves the
 * selection where it is, so lines from any page can be gathered without
 * leaving the wall.
 */
function onPiece(item: Item, e: MouseEvent) {
  if (!adding(e)) {
    emit('reveal', item.pageId, item.id)
    return
  }
  const next = new Set(props.selected)
  if (!next.delete(item.id)) next.add(item.id)
  emit('select', [...next])
}

/**
 * A bucket or a meaning picked whole. With Shift it is added to what is held, or
 * taken back out when every piece of it is already there — the same press
 * undoes itself.
 */
function pick(ids: readonly string[], e: MouseEvent) {
  if (!adding(e)) {
    emit('select', [...ids])
    return
  }
  const next = new Set(props.selected)
  if (ids.every((id) => next.has(id))) for (const id of ids) next.delete(id)
  else for (const id of ids) next.add(id)
  emit('select', [...next])
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
  /* Grey rather than paper: white text, white strokes and black ones all
     have to show against it, and on white the first two vanish. */
  background: oklch(0.66 0 0);
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
  color: #1f1f1f;
}
.cluster-label:hover {
  background: oklch(0.74 0 0);
}
.cluster-label-on {
  background: var(--primary);
  color: var(--primary-foreground);
}
.cluster-label-on:hover {
  background: var(--primary);
}
.swatch {
  width: 0.75rem;
  height: 0.75rem;
  flex-shrink: 0;
  align-self: center;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
}
</style>
