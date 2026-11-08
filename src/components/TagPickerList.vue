<template>
  <div class="px-3 pt-2.5 pb-1 text-xs text-muted-foreground">
    {{ targets.length > 1 ? `標記 ${targets.length} 句` : '標記' }}
  </div>
  <div class="px-2">
    <input
      ref="searchEl"
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
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Circle, CircleCheck, CircleDot, Plus } from '@lucide/vue'
import { tagColor, tagNameRefusal, tagsInRegistryOrder } from '@shared/tags/set'
import { tagsOfUnit } from '@shared/page/units'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * Every tag the chapter knows, ticked by how many of these sentences carry it.
 * A press puts the tag on all of them, or takes it off when all already carry
 * it; their other tags are left be.
 */
const props = defineProps<{ targets: readonly { pageId: string; unitId: string }[] }>()

const project = useProjectStore()
const editor = useEditorStore()

const query = ref('')
const searchEl = ref<HTMLInputElement | null>(null)
defineExpose({ focus: () => searchEl.value?.focus() })

const carriedBy = computed(() =>
  props.targets.map(({ pageId, unitId }) => {
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
  editor.cmdTagSentences(props.targets, tag, carried(tag) !== 'all')
}

function onEnter() {
  if (exact.value) toggle(exact.value)
  else if (creatable.value) create()
}

/** A tag made from here arrives already on what the picker was opened for. */
function create() {
  const name = query.value.trim()
  editor.cmdAddTag(name)
  query.value = ''
  editor.cmdTagSentences(props.targets, name, true)
}
</script>

<style>
/* Rendered inside portalled popovers, so the scoped block would not reach it. */
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
