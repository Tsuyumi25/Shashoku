<template>
  <div class="h-full min-h-0 overflow-y-auto p-1.5">
    <Draggable
      :model-value="project.header.tags"
      item-key="name"
      handle=".tag-grip"
      class="flex flex-col gap-0.5"
      @update:model-value="onReorder"
    >
      <template #item="{ element, index }">
        <div
          class="group flex min-w-0 items-center gap-1.5 rounded border border-transparent px-1 py-1 text-xs hover:bg-secondary/40"
          :class="carriedByAll(element.name) && 'border-current bg-secondary/60'"
          :style="{ color: element.color }"
        >
          <span class="tag-grip shrink-0 cursor-grab text-muted-foreground/50" title="拖曳排序">
            <GripVertical :size="12" />
          </span>

          <label class="relative shrink-0" :title="`${element.name} 的顏色`">
            <span
              class="block h-2.5 w-2.5 rounded-full"
              :style="{ backgroundColor: element.color }"
            />
            <input
              type="color"
              class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              :value="hexOf(element.color)"
              @change="onColor(index, $event)"
            />
          </label>

          <input
            v-if="renaming === element.name"
            ref="renameEl"
            class="h-5 min-w-0 flex-1 rounded border border-input bg-background px-1 text-foreground"
            :value="element.name"
            @keydown.enter="onRenameCommit($event)"
            @keydown.esc="renaming = null"
            @blur="onRenameCommit($event)"
          />
          <button
            v-else
            type="button"
            class="min-w-0 flex-1 truncate text-left font-medium"
            :title="applyHint(element.name)"
            @click="editor.cmdToggleTagOnSelection(element.name)"
            @dblclick="startRename(element.name)"
          >
            {{ element.name }}
          </button>

          <span class="shrink-0 tabular-nums text-muted-foreground">{{
            counts.get(element.name) ?? 0
          }}</span>

          <button
            type="button"
            class="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
            title="從註冊表移除（物件上的標記保留）"
            @click="editor.cmdRemoveTag(index)"
          >
            <X :size="12" />
          </button>
        </div>
      </template>
    </Draggable>

    <p v-if="error" class="mt-1 px-1 text-[10px] text-destructive">{{ error }}</p>

    <template v-if="unregistered.length > 0">
      <div class="mt-2 border-t border-border pt-1.5 pl-1 text-[10px] text-muted-foreground">
        未註冊（無顏色、無補全）
      </div>
      <div class="flex flex-col gap-0.5">
        <div
          v-for="tag in unregistered"
          :key="tag.name"
          class="group flex min-w-0 items-center gap-1.5 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-secondary/40"
        >
          <span class="ml-3.5 h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/40" />
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
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import Draggable from 'vuedraggable'
import { GripVertical, Plus, X } from '@lucide/vue'
import type { TagDefinition } from '@shared/tags/types'
import { RESERVED_TAG_NAMES } from '@shared/ssk/constants'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

const renaming = ref<string | null>(null)
const renameEl = useTemplateRef<HTMLInputElement>('renameEl')
const error = ref('')

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

/**
 * `<input type="color">` only speaks `#rrggbb`, and the palette this project
 * ships is written as `rgb(...)`. A colour it cannot read comes back as black
 * the moment the picker opens, so anything it would not understand is shown as
 * the swatch it already is and the input starts from a neutral value.
 */
function hexOf(color: string): string {
  const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color)
  if (match) {
    return `#${[1, 2, 3].map((i) => Number(match[i]).toString(16).padStart(2, '0')).join('')}`
  }
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#808080'
}

function onColor(index: number, e: Event) {
  project.setTagColor(index, (e.target as HTMLInputElement).value)
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

function startRename(name: string) {
  renaming.value = name
  void nextTick(() => renameEl.value?.select())
}

function onRenameCommit(e: Event) {
  const from = renaming.value
  if (from === null) return
  const to = (e.target as HTMLInputElement).value.trim()
  renaming.value = null
  if (to === '' || to === from) return
  if (RESERVED_TAG_NAMES.includes(to)) {
    error.value = `「${to}」是保留名稱，請換一個`
    return
  }
  // Refused rather than merged: two tags becoming one is a decision about the
  // translation, and a rename that quietly made it would be unrecoverable.
  if (!editor.cmdRenameTag(from, to)) {
    error.value = `「${to}」已經有了，改名取消`
    return
  }
  error.value = ''
}
</script>
