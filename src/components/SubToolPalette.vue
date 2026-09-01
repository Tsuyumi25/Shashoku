<template>
  <!--
    What the brush is loaded with, and the registry it is loaded from — one
    list, because a tag being on the brush and a tag existing are two states of
    the same row, and two lists would have to be kept saying the same thing.
  -->
  <div class="h-full min-h-0 overflow-y-auto p-1.5">
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
          @click="toggle(element.name)"
          @contextmenu.prevent="openMenu($event, element.name)"
        >
          <span
            class="h-3 w-3 shrink-0 rounded-full border-2 border-current"
            :style="loaded(element.name) ? { backgroundColor: element.color } : undefined"
          />
          <input
            v-if="renaming !== null && renaming.name === element.name"
            ref="renameEl"
            v-model="renaming.draft"
            type="text"
            class="min-w-0 flex-1 rounded border border-input bg-background px-1 text-xs text-foreground"
            @click.stop
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="renaming = null"
            @blur="commitRename"
          />
          <span v-else class="min-w-0 flex-1 truncate font-medium">{{ element.name }}</span>
          <span class="shrink-0 tabular-nums text-muted-foreground">
            {{ counts.get(element.name) ?? 0 }}
          </span>
        </div>
      </template>
    </Draggable>

    <!--
      Tags in use the registry has never heard of. The registry is advisory, so
      one of these is not a mistake — but it is the one thing nothing else on
      screen would show, and giving it a colour has to be one click from seeing
      it.
    -->
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
            :class="loaded(tag.name) && 'bg-muted-foreground/40'"
          />
          <button type="button" class="min-w-0 flex-1 truncate text-left" @click="toggle(tag.name)">
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

    <CanvasMenu :at="menuAt" :items="MENU" @pick="onPick" @close="menuAt = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import Draggable from 'vuedraggable'
import { Plus } from '@lucide/vue'
import CanvasMenu, { type MenuItem } from '@/components/CanvasMenu.vue'
import type { TagDefinition } from '@shared/tags/types'
import { withTag, withoutTag } from '@shared/tags/set'
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

const unregistered = computed(() => {
  const known = new Set(project.header.tags.map((t) => t.name))
  return [...counts.value]
    .filter(([name]) => !known.has(name))
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
})

function loaded(tag: string): boolean {
  return editor.paintTags.includes(tag)
}

function toggle(tag: string) {
  editor.loadPaintTags(
    loaded(tag) ? withoutTag(editor.paintTags, tag) : withTag(editor.paintTags, tag),
  )
}

function onReorder(next: TagDefinition[]) {
  const before = project.header.tags
  const from = before.findIndex((tag, i) => tag.name !== next[i]?.name)
  if (from === -1) return
  const to = next.findIndex((tag) => tag.name === before[from].name)
  if (to === -1) return
  editor.cmdMoveTag(from, to)
}

const MENU: readonly MenuItem[] = [
  { id: 'rename', label: '重新命名' },
  { id: 'remove', label: '從註冊表移除' },
]

const menuAt = ref<{ x: number; y: number } | null>(null)
const menuTag = ref<string | null>(null)

function openMenu(e: MouseEvent, tag: string) {
  menuTag.value = tag
  menuAt.value = { x: e.clientX, y: e.clientY }
}

function onPick(id: string) {
  const tag = menuTag.value
  menuAt.value = null
  if (tag === null) return
  if (id === 'remove') {
    editor.cmdRemoveTag(project.header.tags.findIndex((entry) => entry.name === tag))
    return
  }
  void beginRename(tag)
}

const renaming = ref<{ name: string; draft: string } | null>(null)
const renameEl = useTemplateRef<HTMLInputElement>('renameEl')

async function beginRename(tag: string) {
  renaming.value = { name: tag, draft: tag }
  await nextTick()
  renameEl.value?.select()
}

/**
 * Enter and losing focus both land the name; Escape clears the draft first, so
 * the blur that follows finds nothing to commit. An empty name is refused —
 * the name it had is the better answer.
 *
 * ⚠️ Renaming reaches every object carrying the old name, so the brush is
 * reloaded with it too: a load naming a tag nobody carries any more would go on
 * spraying the name that was just retired.
 */
function commitRename() {
  const editing = renaming.value
  renaming.value = null
  if (editing === null) return
  const name = editing.draft.trim()
  if (name.length === 0 || name === editing.name) return
  if (!editor.cmdRenameTag(editing.name, name)) return
  if (loaded(editing.name)) {
    editor.loadPaintTags(withTag(withoutTag(editor.paintTags, editing.name), name))
  }
}
</script>
