<template>
  <div class="h-full min-h-0 overflow-y-auto p-2">
    <template v-if="tagState.kind === 'one'">
      <div class="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-xs">
        <span
          v-for="tag in tagState.value"
          :key="tag"
          class="flex min-w-0 items-center gap-1"
        >
          <span
            class="h-2 w-2 shrink-0 rounded-full"
            :style="{ backgroundColor: tagColor(tag, project.header.tags) }"
          />
          <span class="min-w-0 truncate font-medium">{{ tag }}</span>
        </span>
        <span v-if="tagState.value.length === 0" class="text-muted-foreground">
          未標記，統計整話
        </span>
      </div>

      <div class="grid grid-cols-[auto_1fr] items-start gap-x-2 gap-y-1.5 text-xs">
        <template v-for="row in rows" :key="row.field">
          <label class="pt-1 text-muted-foreground">
            {{ TEXT_STYLE_FIELD_NAMES[row.field] }}
          </label>
          <div class="flex min-w-0 flex-wrap gap-1">
            <button
              v-for="(candidate, i) in row.candidates"
              :key="i"
              type="button"
              class="flex items-center gap-1 rounded border bg-background px-1.5 py-0.5"
              :class="
                isCurrent(candidate)
                  ? 'border-primary text-foreground'
                  : 'border-input text-muted-foreground hover:border-primary hover:text-foreground'
              "
              :title="applyHint(row, candidate)"
              @click="apply(candidate)"
            >
              <span>{{ candidateText(row, candidate) }}</span>
              <span class="tabular-nums text-muted-foreground/70">{{ candidate.count }}</span>
              <span
                v-if="stationText(candidate)"
                class="text-[10px] text-muted-foreground/70"
              >{{ stationText(candidate) }}</span>
            </button>
            <span v-if="row.candidates.length === 0" class="pt-0.5 text-muted-foreground/60">
              沒有樣本
            </span>
          </div>
        </template>
      </div>
    </template>

    <p v-else-if="tagState.kind === 'many'" class="px-0.5 text-xs text-muted-foreground">
      選取的標記不一致，推薦需要單一語意。用上面的「按語意分堆」點一組，就能把選取收窄到同類。
    </p>

    <p v-else class="px-0.5 text-xs text-muted-foreground">未選取標籤</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TextStyle } from '@shared/text-style/types'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { TEXT_STYLE_FIELDS } from '@shared/text-style/schema'
import { sharedValue } from '@shared/text-style/batch'
import { sameTagSet, tagColor, tagsInRegistryOrder } from '@shared/tags/set'
import { bucketObjectsOf } from '@/lib/valueBuckets'
import {
  recommendStyle,
  type StyleCandidate,
  type StyleRow,
} from '@/lib/styleRecommendation'
import { styleFieldText, TEXT_STYLE_FIELD_NAMES } from '@/lib/textStyleFields'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

const targets = computed(() => editor.selectedTextObjects())
const styles = computed(() => targets.value.map((t) => t.label.style))

/**
 * The three states `sharedValue` already draws everywhere else, asked of the
 * tags. A selection that disagrees gets no recommendation at all: every value
 * in this panel is a click away, so guessing which meaning was meant would not
 * turn one field into a trap but a whole column of them.
 */
type TagState = { kind: 'none' } | { kind: 'many' } | { kind: 'one'; value: string[] }

const tagState = computed<TagState>(() => {
  const first = targets.value[0]
  if (!first) return { kind: 'none' }
  for (const { label } of targets.value) {
    if (!sameTagSet(label.tags, first.label.tags)) return { kind: 'many' }
  }
  return { kind: 'one', value: tagsInRegistryOrder(first.label.tags, project.header.tags) }
})

/**
 * The family every row but the font one is narrowed by. A selection that
 * disagrees narrows by nothing, the same answer as a selection that has not
 * been given a font — there is no single face for the other fields to depend
 * on either way.
 */
const fontFamily = computed(() => {
  const shared = sharedValue(styles.value, 'fontFamily')
  return shared.kind === 'one' ? shared.value : ''
})

const chapterObjects = computed(() =>
  project.files.flatMap((file) => bucketObjectsOf(file.filename, file.page.layers)),
)

const rows = computed<StyleRow[]>(() => {
  if (tagState.value.kind !== 'one') return []
  return recommendStyle(
    chapterObjects.value,
    tagState.value.value,
    project.header.tags,
    fontFamily.value,
  )
})

/**
 * What the selection holds now, so the candidate it is already on can be marked.
 * Auto-styling leaves the object on the head of every row, so what this shows
 * from then on is how far the object has drifted from its own kind — visible
 * while the work is happening rather than at some later audit.
 */
const currentValues = computed(() => {
  const out = new Map<string, string>()
  for (const field of TEXT_STYLE_FIELDS) {
    const shared = sharedValue(styles.value, field)
    if (shared.kind === 'one') out.set(field, JSON.stringify(shared.value))
  }
  return out
})

function isCurrent(candidate: StyleCandidate): boolean {
  return Object.entries(candidate.patch).every(
    ([field, value]) => currentValues.value.get(field) === JSON.stringify(value),
  )
}

function candidateText(row: StyleRow, candidate: StyleCandidate): string {
  if (row.field === 'fontFamily') {
    const family = candidate.patch.fontFamily || '未指定'
    return candidate.patch.fontStyleName ? `${family} ${candidate.patch.fontStyleName}` : family
  }
  return styleFieldText({ ...DEFAULT_TEXT_STYLE, ...candidate.patch } as TextStyle, row.field)
}

/**
 * Which station of the chain a candidate came from, shown only where it is not
 * the selection's own tag set. The rest of a row is what this meaning looks
 * like; these are what the meaning one tag shorter looks like, which is the
 * only thing there is to offer the first object of a new kind.
 */
function stationText(candidate: StyleCandidate): string {
  if (candidate.from.length === 0) return ''
  if (tagState.value.kind === 'one' && sameTagSet(candidate.from, tagState.value.value)) return ''
  return candidate.from.join('、')
}

function applyHint(row: StyleRow, candidate: StyleCandidate): string {
  const where = stationText(candidate)
  const field = TEXT_STYLE_FIELD_NAMES[row.field]
  const source = where === '' ? '' : `（來自「${where}」）`
  return `把${field}套成 ${candidateText(row, candidate)}${source}`
}

function apply(candidate: StyleCandidate) {
  editor.cmdApplyStyleToSelection(candidate.patch)
}
</script>
