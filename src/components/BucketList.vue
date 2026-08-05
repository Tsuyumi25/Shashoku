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

      <div class="flex flex-wrap items-center gap-1">
        <span class="text-muted-foreground">比較</span>
        <button
          v-for="f in TEXT_STYLE_FIELDS"
          :key="f"
          type="button"
          class="rounded px-1.5 py-0.5"
          :class="
            fields.has(f)
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          "
          @click="toggleField(f)"
        >
          {{ TEXT_STYLE_FIELD_NAMES[f] }}
        </button>
      </div>

      <p v-if="scopeNote" class="text-[10px] text-muted-foreground">{{ scopeNote }}</p>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-1.5">
      <p v-if="groups.length === 0" class="px-0.5 text-xs text-muted-foreground">
        這個範圍裡沒有文字物件
      </p>

      <div v-for="group in groups" :key="group.key" class="mb-2">
        <button
          type="button"
          class="flex w-full min-w-0 items-center gap-1 rounded px-0.5 py-0.5 text-left text-xs hover:bg-secondary/50"
          :title="`選中「${group.tags.join('、') || '未標記'}」的全部 ${group.count} 個物件`"
          @click="selectIds(group.buckets.flatMap((b) => b.ids))"
        >
          <span
            class="h-2 w-2 shrink-0 rounded-full"
            :style="{ backgroundColor: colorOf(group.tags) }"
          />
          <span class="min-w-0 truncate font-medium">
            {{ group.tags.length === 0 ? '未標記' : group.tags.join('、') }}
          </span>
          <span
            v-if="group.manyStyles"
            class="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-500"
            title="意思相同，但分成好幾種樣式"
          >
            樣式群 {{ group.buckets.length }}
          </span>
          <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">{{ group.count }}</span>
        </button>

        <template v-for="bucket in group.buckets" :key="bucket.key">
          <div
            class="mt-0.5 flex w-full min-w-0 items-center gap-1 rounded text-xs hover:bg-secondary/50"
          >
            <button
              type="button"
              class="flex h-5 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
              :title="expanded.has(bucket.key) ? '收合' : '展開其餘欄位'"
              @click="toggleExpanded(bucket.key)"
            >
              <ChevronRight
                :size="11"
                class="transition-transform"
                :class="expanded.has(bucket.key) && 'rotate-90'"
              />
            </button>

            <button
              type="button"
              class="min-w-0 flex-1 truncate py-1 text-left"
              :title="`選中這一堆的 ${bucket.ids.length} 個物件`"
              @click="selectIds(bucket.ids)"
            >
              {{ bucketTitle(bucket) }}
            </button>

            <span class="shrink-0 pr-1 tabular-nums text-muted-foreground">
              {{ bucket.ids.length }}
            </span>
          </div>

          <div
            v-if="expanded.has(bucket.key)"
            class="mb-0.5 ml-5 flex flex-col text-[10px] text-muted-foreground"
          >
            <span v-for="line in details(bucket)" :key="line" class="truncate">{{ line }}</span>
            <span v-if="details(bucket).length === 0">沒有其他比較中的欄位</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, RefreshCw } from '@lucide/vue'
import type { TextStyle } from '@shared/text-style/types'
import { TEXT_STYLE_FIELDS } from '@shared/text-style/schema'
import { primaryTag, UNKNOWN_TAG_COLOR } from '@shared/tags/set'
import { textObjects } from '@shared/page/tree'
import { groupByValue, type BucketObject, type StyleBucket } from '@/lib/valueBuckets'
import { TEXT_STYLE_FIELD_NAMES } from '@/lib/textStyleFields'
import { useSeriesObjects } from '@/composables/useSeriesObjects'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

type Scope = 'page' | 'chapter' | 'series'

const SCOPES = [
  { scope: 'page', label: '本頁', title: '只看目前這一頁' },
  { scope: 'chapter', label: '本話', title: '整個開啟的專案' },
  { scope: 'series', label: '全書', title: '同一層資料夾下的其他話，從磁碟讀' },
] as const satisfies readonly { scope: Scope; label: string; title: string }[]

/**
 * Size is off to begin with. It is the field that legitimately differs inside
 * one meaning — a line squeezed to fit its bubble is not a different kind of
 * text — so comparing on it out of the box would split nearly every group and
 * bury the disagreements that do matter.
 */
const UNCOMPARED_BY_DEFAULT: readonly (keyof TextStyle)[] = ['fontSizePx']

const project = useProjectStore()
const editor = useEditorStore()
const series = useSeriesObjects()

const scope = ref<Scope>('chapter')
const fields = ref(
  new Set<keyof TextStyle>(TEXT_STYLE_FIELDS.filter((f) => !UNCOMPARED_BY_DEFAULT.includes(f))),
)
const expanded = ref(new Set<string>())

function chooseScope(next: Scope) {
  scope.value = next
  if (next === 'series' && series.loadedFor.value !== project.rootPath) void series.load()
}

function toggleField(field: keyof TextStyle) {
  const next = new Set(fields.value)
  if (!next.delete(field)) next.add(field)
  fields.value = next
}

function toggleExpanded(key: string) {
  const next = new Set(expanded.value)
  if (!next.delete(key)) next.add(key)
  expanded.value = next
}

/**
 * A bucket's identity is the values its members hold, so narrowing what counts
 * as looking alike rebuilds every one of them — and what was open was open on
 * groupings that no longer exist.
 */
watch([scope, fields], () => {
  expanded.value = new Set()
})

function flatten(filename: string, layers: Parameters<typeof textObjects>[0]): BucketObject[] {
  return textObjects(layers).map((label) => ({
    id: label.id,
    filename,
    tags: label.tags,
    style: label.style,
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

const comparedFields = computed(() => TEXT_STYLE_FIELDS.filter((f) => fields.value.has(f)))

const groups = computed(() =>
  groupByValue(objects.value, comparedFields.value, project.header.tags),
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

/**
 * Whichever field is being compared first — never a fixed one. A row carrying
 * all seven was unreadable in a sidebar this wide, but leading with a field
 * nobody is comparing would say something that has nothing to do with what
 * makes this bucket a bucket.
 */
const titleField = computed<keyof TextStyle | null>(() => comparedFields.value[0] ?? null)

function bucketTitle(bucket: StyleBucket): string {
  const field = titleField.value
  if (field === null) return '未比較任何欄位'
  return `${TEXT_STYLE_FIELD_NAMES[field]} ${valueText(bucket.style, field)}`
}

/** Everything else being compared, which is what opening the row is for. */
function details(bucket: StyleBucket): string[] {
  return comparedFields.value
    .filter((f) => f !== titleField.value)
    .map((f) => `${TEXT_STYLE_FIELD_NAMES[f]} ${valueText(bucket.style, f)}`)
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
function selectIds(ids: readonly string[]) {
  const here = new Set(chapterObjects.value.map((o) => o.id))
  editor.selectMany(ids.filter((id) => here.has(id)), false)
}
</script>
