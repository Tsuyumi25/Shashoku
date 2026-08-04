<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 flex-col gap-1 border-b border-border px-1.5 py-1 text-xs">
      <div class="flex items-center gap-1">
        <button
          v-for="choice in SCOPES"
          :key="choice.scope"
          type="button"
          class="rounded px-1.5 py-0.5"
          :class="
            scope === choice.scope
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          "
          :title="choice.title"
          @click="chooseScope(choice.scope)"
        >
          {{ choice.label }}
        </button>

        <button
          v-if="scope === 'series'"
          type="button"
          class="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
          :title="series.loading.value ? '讀取中…' : '重新讀取其他話'"
          :disabled="series.loading.value"
          @click="series.load()"
        >
          <RefreshCw :size="12" :class="series.loading.value && 'animate-spin'" />
        </button>
      </div>

      <div class="flex items-center gap-1">
        <span class="text-muted-foreground">比較</span>
        <select
          v-model="field"
          class="h-5 min-w-0 flex-1 rounded border border-input bg-background px-1"
        >
          <option value="">所有欄位</option>
          <option v-for="f in TEXT_STYLE_FIELDS" :key="f" :value="f">
            {{ TEXT_STYLE_FIELD_NAMES[f] }}
          </option>
        </select>
      </div>

      <p v-if="scopeNote" class="text-[10px] text-muted-foreground">{{ scopeNote }}</p>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-1.5">
      <p v-if="groups.length === 0" class="px-0.5 text-xs text-muted-foreground">
        這個範圍裡沒有文字物件
      </p>

      <div v-for="group in groups" :key="group.key" class="mb-2">
        <div class="flex min-w-0 items-center gap-1 px-0.5 text-xs">
          <span
            class="h-2 w-2 shrink-0 rounded-full"
            :style="{ backgroundColor: colorOf(group.tags) }"
          />
          <span class="min-w-0 truncate font-medium">
            {{ group.tags.length === 0 ? '未標記' : group.tags.join('、') }}
          </span>
          <span
            v-if="group.drifting"
            class="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-500"
            title="意思相同，但看起來不一樣"
          >
            漂移 {{ group.buckets.length }}
          </span>
          <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">{{ group.count }}</span>
        </div>

        <button
          v-for="bucket in group.buckets"
          :key="bucket.key"
          type="button"
          class="mt-0.5 flex w-full min-w-0 items-start gap-1.5 rounded px-1 py-1 text-left text-xs hover:bg-secondary/50"
          :class="ui.reviewedBuckets.has(bucket.key) && 'opacity-50'"
          :title="`選中這一堆的 ${bucket.ids.length} 個物件`"
          @click="selectBucket(bucket)"
        >
          <span
            class="mt-px shrink-0 rounded p-0.5 hover:bg-secondary"
            :title="ui.reviewedBuckets.has(bucket.key) ? '取消「看過了」' : '標記為看過了'"
            @click.stop="ui.toggleReviewed(bucket.key)"
          >
            <Check
              :size="11"
              :class="
                ui.reviewedBuckets.has(bucket.key) ? 'text-primary' : 'text-muted-foreground/40'
              "
            />
          </span>

          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ describe(bucket.style) }}</span>
            <span
              v-for="source in bucket.sources"
              :key="source.label"
              class="block truncate text-[10px] text-muted-foreground"
            >
              {{ source.count }} 個來自「{{ source.label }}」
            </span>
          </span>

          <span class="shrink-0 tabular-nums text-muted-foreground">{{ bucket.ids.length }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, RefreshCw } from '@lucide/vue'
import type { TextStyle } from '@shared/text-style/types'
import { TEXT_STYLE_FIELDS } from '@shared/text-style/schema'
import { primaryTag, UNKNOWN_TAG_COLOR } from '@shared/tags/set'
import { textObjects } from '@shared/page/tree'
import { groupByValue, type BucketObject, type StyleBucket } from '@/lib/valueBuckets'
import { TEXT_STYLE_FIELD_NAMES } from '@/lib/textStyleFields'
import { useSeriesObjects } from '@/composables/useSeriesObjects'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

type Scope = 'page' | 'chapter' | 'series'

const SCOPES = [
  { scope: 'page', label: '本頁', title: '只看目前這一頁' },
  { scope: 'chapter', label: '本話', title: '整個開啟的專案' },
  { scope: 'series', label: '全書', title: '同一層資料夾下的其他話，從磁碟讀' },
] as const satisfies readonly { scope: Scope; label: string; title: string }[]

const project = useProjectStore()
const editor = useEditorStore()
const ui = useUiStore()
const series = useSeriesObjects()

const scope = ref<Scope>('chapter')
const field = ref<'' | keyof TextStyle>('')

function chooseScope(next: Scope) {
  scope.value = next
  if (next === 'series' && series.loadedFor.value !== project.rootPath) void series.load()
}

/**
 * A verdict is about a bucket, and a bucket's identity is the values its
 * members hold. Narrowing what counts as looking alike rebuilds every one of
 * them, so the marks left on the old buckets are about groupings that no
 * longer exist.
 */
watch([scope, field], () => ui.clearReviewed())

function flatten(filename: string, layers: Parameters<typeof textObjects>[0]): BucketObject[] {
  return textObjects(layers).map((label) => ({
    id: label.id,
    filename,
    tags: label.tags,
    style: label.style,
    provenance: label.provenance,
  }))
}

const chapterObjects = computed<BucketObject[]>(() =>
  project.files.flatMap((file) => flatten(file.filename, file.page.layers)),
)

const objects = computed<BucketObject[]>(() => {
  if (scope.value === 'page') {
    const file = editor.currentFilename ? project.fileByName(editor.currentFilename) : null
    return file ? flatten(file.filename, file.page.layers) : []
  }
  if (scope.value === 'chapter') return chapterObjects.value
  return [...chapterObjects.value, ...series.objects.value]
})

const groups = computed(() =>
  groupByValue(
    objects.value,
    field.value === '' ? [] : [field.value],
    project.header.tags,
  ),
)

const scopeNote = computed(() => {
  if (scope.value !== 'series') return ''
  if (series.loading.value) return '讀取其他話中…'
  const skipped = series.skipped.value
  const read = `另外讀了 ${series.chapters.value} 話`
  return skipped.length === 0 ? read : `${read}；讀不開：${skipped.join('、')}`
})

function colorOf(tags: readonly string[]): string {
  return primaryTag(tags, project.header.tags)?.color ?? UNKNOWN_TAG_COLOR
}

/** What tells one bucket from another, in the terms the panel above uses. */
function describe(style: TextStyle): string {
  const shown = field.value === '' ? TEXT_STYLE_FIELDS : [field.value]
  return shown.map((f) => `${TEXT_STYLE_FIELD_NAMES[f]} ${valueText(style, f)}`).join(' · ')
}

function valueText(style: TextStyle, f: keyof TextStyle): string {
  const value = style[f]
  if (f === 'fontFamily') return (value as string) || '未指定'
  if (f === 'fontSizePx') return `${value as number}px`
  if (f === 'leadingPercent') return `${value as number}%`
  if (f === 'direction') return value === 'vertical' ? '直排' : '橫排'
  if (f === 'align') return { start: '起', center: '中', end: '末' }[value as string] ?? ''
  if (f === 'effects') return (value as unknown[]).length === 0 ? '無' : '描邊'
  return String(value)
}

/**
 * Only the objects this window is actually holding. A bucket in the series
 * scope reaches into chapters that are not open, and selecting an id from one
 * of those would name something nothing on screen can show.
 */
function selectBucket(bucket: StyleBucket) {
  const here = new Set(chapterObjects.value.map((o) => o.id))
  const reachable = bucket.ids.filter((id) => here.has(id))
  editor.selectMany(reachable, false)
}
</script>
