<template>
  <div class="h-full min-h-0 overflow-y-auto p-1.5">
    <!--
      The whole row is the drag handle. A grip column would be one more thing on
      a row that is already a colour, a name and a count, and there is nothing
      else on it a drag could be mistaken for.
    -->
    <Draggable
      :model-value="project.header.tags"
      item-key="name"
      class="flex flex-col gap-0.5"
      @update:model-value="onReorder"
    >
      <template #item="{ element }">
        <div
          class="flex min-w-0 cursor-grab items-center gap-2 rounded px-1 py-1 text-xs hover:bg-secondary/40"
          :style="{ color: element.color }"
          :title="applyHint(element.name)"
          @click="editor.cmdToggleTagOnSelection(element.name)"
        >
          <!--
            The tag's own colour is the state: filled means every selected
            object carries it, hollow means not. One circle rather than a swatch
            beside a box, since the colour and the answer are about the same tag
            and two circles on one row read as two tags.
          -->
          <span
            class="h-3 w-3 shrink-0 rounded-full border-2 border-current"
            :style="carriedByAll(element.name) ? { backgroundColor: element.color } : undefined"
          />
          <span class="min-w-0 flex-1 truncate font-medium">{{ element.name }}</span>
          <span class="shrink-0 tabular-nums text-muted-foreground">
            {{ counts.get(element.name) ?? 0 }}
          </span>
        </div>
      </template>
    </Draggable>

    <template v-if="unregistered.length > 0">
      <div class="mt-2 border-t border-border pt-1.5 pl-1 text-[10px] text-muted-foreground">
        未註冊（無顏色、無補全）
      </div>
      <div class="flex flex-col gap-0.5">
        <div
          v-for="tag in unregistered"
          :key="tag.name"
          class="group flex min-w-0 items-center gap-2 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-secondary/40"
        >
          <span
            class="h-3 w-3 shrink-0 rounded-full border-2 border-muted-foreground/40"
            :class="carriedByAll(tag.name) && 'bg-muted-foreground/40'"
          />
          <button
            type="button"
            class="min-w-0 flex-1 truncate text-left"
            :title="applyHint(tag.name)"
            @click="editor.cmdToggleTagOnSelection(tag.name)"
          >
            {{ tag.name }}
          </button>
          <span class="shrink-0 tabular-nums">{{ tag.count }}</span>
          <button
            type="button"
            class="shrink-0 opacity-0 group-hover:opacity-100 hover:text-foreground"
            title="加進註冊表"
            @click="editor.cmdAddTag(tag.name)"
          >
            <Plus :size="12" />
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Draggable from 'vuedraggable'
import { Plus } from '@lucide/vue'
import type { TagDefinition } from '@shared/tags/types'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

/** How many objects in the chapter carry each tag, registered or not. */
const counts = computed(() => {
  const tally = new Map<string, number>()
  for (const { label } of project.allTextObjects()) {
    for (const tag of label.tags) tally.set(tag, (tally.get(tag) ?? 0) + 1)
  }
  return tally
})

/**
 * Tags in use that the registry has never heard of. Shown rather than hidden:
 * the registry is advisory, so an unregistered tag is not a mistake — but it is
 * the one thing the user cannot discover any other way, and giving it a colour
 * has to be one click from seeing it.
 */
const unregistered = computed(() => {
  const known = new Set(project.header.tags.map((t) => t.name))
  return [...counts.value]
    .filter(([name]) => !known.has(name))
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
})

const selectionSize = computed(() => editor.batchScope.objects)

function carriedByAll(name: string): boolean {
  if (selectionSize.value === 0) return false
  return editor.selectedTextObjects().every(({ label }) => label.tags.includes(name))
}

function applyHint(name: string): string {
  if (selectionSize.value === 0) return '先選取物件才能套用標記'
  return carriedByAll(name)
    ? `從選取的 ${selectionSize.value} 個物件移除「${name}」`
    : `為選取的 ${selectionSize.value} 個物件加上「${name}」`
}

/** Position is priority, so a drop is a change to the project worth undoing. */
function onReorder(next: TagDefinition[]) {
  const before = project.header.tags
  const from = before.findIndex((tag, i) => tag.name !== next[i]?.name)
  if (from === -1) return
  const to = next.findIndex((tag) => tag.name === before[from].name)
  if (to === -1) return
  editor.cmdMoveTag(from, to)
}
</script>
