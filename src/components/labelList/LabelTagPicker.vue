<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger
      class="tag-trigger"
      title="標記"
      :disabled="disabled"
      @pointerdown.stop
      @mousedown.stop
      @dblclick.stop
      @keydown.enter.stop
    >
      <Tag :size="12" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="tag-picker" side="bottom" align="end" :side-offset="4" :collision-padding="8">
        <div class="px-3 pt-2.5 pb-1 text-xs text-muted-foreground">
          {{ targets.length > 1 ? `標記選取的 ${targets.length} 句` : '標記' }}
        </div>
        <div class="px-2">
          <input
            v-model="query"
            type="search"
            spellcheck="false"
            placeholder="搜尋或新增標記"
            class="w-full rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
            @keydown.enter="onEnter"
          />
        </div>
        <button v-if="creatable" class="tp-row text-muted-foreground" @click="create">
          <Plus :size="15" />
          <span class="min-w-0 flex-1 truncate">新標記「{{ query.trim() }}」</span>
        </button>
        <div v-if="refusal" class="px-3 py-1 text-xs text-destructive">{{ refusal }}</div>
        <div class="max-h-72 overflow-y-auto pb-1">
          <button v-for="tag in matches" :key="tag" class="tp-row" @click="toggle(tag)">
            <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: tagColor(tag, project.header.tags) }" />
            <span class="min-w-0 flex-1 truncate">{{ tag }}</span>
            <CircleCheck v-if="carried(tag) === 'all'" :size="18" class="shrink-0 fill-primary text-primary-foreground" />
            <CircleDot v-else-if="carried(tag) === 'some'" :size="18" class="shrink-0 text-primary" />
            <Circle v-else :size="18" class="shrink-0 text-muted-foreground/60" />
          </button>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Circle, CircleCheck, CircleDot, Plus, Tag } from '@lucide/vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { tagColor, tagNameRefusal, tagsInRegistryOrder } from '@shared/tags/set'
import { tagsOfUnit } from '@shared/page/units'
import type { LabelRow } from '@/lib/labelRows'
import { rowSelected } from '@/lib/labelRows'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const props = defineProps<{ row: LabelRow; disabled: boolean }>()

const project = useProjectStore()
const editor = useEditorStore()

const open = ref(false)
const query = ref('')
watch(open, (now) => now && (query.value = ''))

/** A row inside the selection speaks for the whole selection; any other row for itself. */
const targets = computed(() => {
  const own = { pageId: props.row.pageId, unitId: props.row.unit.id }
  if (!rowSelected(props.row, editor.selectedIds)) return [own]
  const picked = editor.sentencesOf(editor.selectedIds)
  return picked.some((t) => t.pageId === own.pageId && t.unitId === own.unitId) ? picked : [own, ...picked]
})

const carriedBy = computed(() =>
  targets.value.map(({ pageId, unitId }) => {
    const unit = project.unitById(pageId, unitId)
    const view = project.viewOf(pageId)
    return new Set(unit && view ? tagsOfUnit(view, unit) : [])
  }),
)

function carried(tag: string): 'all' | 'some' | 'none' {
  const count = carriedBy.value.filter((set) => set.has(tag)).length
  return count === 0 ? 'none' : count === carriedBy.value.length ? 'all' : 'some'
}

/** Registered names first, in the project's order, then the ones only objects carry. */
const every = computed(() => {
  const used = new Set<string>(project.header.tags.map((t) => t.name))
  for (const { tags } of project.allUnits()) for (const tag of tags) used.add(tag)
  return tagsInRegistryOrder([...used], project.header.tags)
})

const needle = computed(() => query.value.trim().toLowerCase())
const matches = computed(() => every.value.filter((tag) => tag.toLowerCase().includes(needle.value)))
const exact = computed(() => every.value.find((tag) => tag === query.value.trim()))
const refusal = computed(() => (query.value.trim() === '' ? null : tagNameRefusal(query.value)))
const creatable = computed(() => query.value.trim() !== '' && !exact.value && refusal.value === null)

function toggle(tag: string) {
  editor.cmdTagSentences(targets.value, tag, carried(tag) !== 'all')
}

function onEnter() {
  if (exact.value) toggle(exact.value)
  else if (creatable.value) create()
}

/** A tag made from here arrives already on what the popup was opened for. */
function create() {
  const name = query.value.trim()
  editor.cmdAddTag(name)
  query.value = ''
  editor.cmdTagSentences(targets.value, name, true)
}
</script>

<style scoped>
.tag-trigger {
  display: flex;
  height: 1.25rem;
  width: 1.25rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.tag-trigger:hover:not(:disabled),
.tag-trigger[data-state='open'] {
  background: var(--secondary);
  color: var(--foreground);
}
.tag-trigger:disabled {
  opacity: 0.3;
}
</style>

<style>
/* Portalled out of the component, so the scoped block does not reach it. */
.tag-picker {
  z-index: 50;
  width: 14rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.tag-picker .tp-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  text-align: left;
}
.tag-picker .tp-row:hover {
  background: var(--secondary);
}
</style>
