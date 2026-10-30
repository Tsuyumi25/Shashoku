<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-1 border-b border-border p-1">
      <button class="lib-entry" title="新增一個群組" @click="startNew">
        <FolderPlus :size="13" />
        <span>新群組</span>
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-1">
      <div
        v-for="row in BUILT_IN"
        :key="row.kind"
        class="lib-row"
        :class="{ 'lib-row-on': section.kind === row.kind }"
        @click="go({ kind: row.kind })"
      >
        <component :is="row.icon" :size="15" class="shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
        <span class="lib-count">{{ builtInCount(row.kind) }}</span>
      </div>

      <div class="mt-3 mb-1 px-1.5 text-xs text-muted-foreground">群組</div>
      <p v-if="preferences.prefs.fontGroups.length === 0" class="px-2 py-2 text-xs text-muted-foreground">
        還沒有群組。用上面的「新群組」開一個，再從右邊每套字型的「設置群組」放進去。
      </p>

      <ContextMenuRoot v-for="group in preferences.prefs.fontGroups" :key="group.id">
        <ContextMenuTrigger as-child>
          <div
            class="lib-row"
            :class="{ 'lib-row-on': section.kind === 'group' && section.id === group.id }"
            @click="go({ kind: 'group', id: group.id })"
            @dblclick="beginRename(group)"
          >
            <ListMusic :size="15" class="shrink-0 text-muted-foreground" />
            <input
              v-if="renaming?.id === group.id"
              ref="renameEl"
              v-model="renaming.draft"
              class="min-w-0 flex-1 rounded border bg-background px-1 text-sm"
              :class="clash ? 'border-destructive' : 'border-border'"
              :title="clash ? `已經有叫「${renaming.draft.trim()}」的群組` : undefined"
              @click.stop
              @dblclick.stop
              @keydown.enter="commitRename"
              @keydown.escape="renaming = null"
              @blur="commitRename"
            />
            <span v-else class="min-w-0 flex-1 truncate">{{ group.name }}</span>
            <span class="lib-count">{{ installedCount(group.families) }}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuPortal>
          <ContextMenuContent class="dropdown-content" :collision-padding="8">
            <ContextMenuItem class="dropdown-item" @select="beginRename(group)">
              <Pencil :size="14" />
              <span>重新命名</span>
            </ContextMenuItem>
            <ContextMenuSeparator class="dropdown-separator" />
            <ContextMenuItem class="dropdown-item" @select="remove(group.id)">
              <Trash2 :size="14" />
              <span>刪除群組</span>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenuRoot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import type { FontGroup } from '@shared/preferences/types'
import { BookOpen, FolderPlus, LibraryBig, ListMusic, Pencil, Star, Trash2 } from '@lucide/vue'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from 'reka-ui'
import { catalogByFamily } from '@/lib/fontCatalog'
import { useChapterFontCounts } from '@/composables/useChapterFontCounts'
import { useFontLibrary, type FontLibrarySection } from '@/composables/useFontLibrary'
import { usePreferencesStore } from '@/stores/preferencesStore'

const preferences = usePreferencesStore()
const { section } = useFontLibrary()
const usedCounts = useChapterFontCounts()

const BUILT_IN = [
  { kind: 'all', label: '全部', icon: LibraryBig },
  { kind: 'fav', label: '最愛', icon: Star },
  { kind: 'used', label: '本話', icon: BookOpen },
] as const

function builtInCount(kind: 'all' | 'fav' | 'used'): number {
  const families = catalogByFamily.value
  if (kind === 'all') return families.size
  const named = kind === 'fav' ? preferences.prefs.fontFavorites : [...usedCounts.value.keys()]
  return named.filter((f) => families.has(f)).length
}

function installedCount(families: readonly string[]): number {
  return families.filter((f) => catalogByFamily.value.has(f)).length
}

const renaming = ref<{ id: string; draft: string } | null>(null)
// Inside the v-for, so Vue hands back an array even though only one row edits at a time.
const renameEls = useTemplateRef<HTMLInputElement[]>('renameEl')

async function beginRename(group: FontGroup) {
  renaming.value = { id: group.id, draft: group.name }
  await nextTick()
  const field = renameEls.value?.[0]
  field?.focus()
  field?.select()
}

const clash = computed(() => {
  const at = renaming.value
  const name = at?.draft.trim()
  return !!name && preferences.prefs.fontGroups.some((g) => g.id !== at!.id && g.name === name)
})

/**
 * Enter refuses a taken name and leaves the field open on it; losing focus
 * walks away from the edit instead, keeping the name the group had. An empty
 * draft is the same as no change.
 */
function commitRename(e: Event) {
  const at = renaming.value
  if (!at) return
  const name = at.draft.trim()
  if (name && !preferences.renameFontGroup(at.id, name) && e.type !== 'blur') return
  renaming.value = null
}

function go(next: FontLibrarySection) {
  const at = section.value
  if (at.kind === next.kind && (at.kind !== 'group' || (next.kind === 'group' && at.id === next.id))) return
  section.value = next
}

function startNew() {
  const id = preferences.createFontGroup('新群組')
  section.value = { kind: 'group', id }
  void beginRename(preferences.prefs.fontGroups.find((g) => g.id === id)!)
}

function remove(id: string) {
  if (section.value.kind === 'group' && section.value.id === id) section.value = { kind: 'all' }
  preferences.deleteFontGroup(id)
}
</script>

<style scoped>
.lib-entry {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-width: 0;
  height: 1.75rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.8125rem;
  color: var(--muted-foreground);
  white-space: nowrap;
}
.lib-entry:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.lib-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  height: 1.75rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
  text-align: left;
  cursor: default;
  user-select: none;
}
.lib-row:hover {
  background: var(--secondary);
}
.lib-row-on,
.lib-row-on:hover {
  background: var(--accent);
  color: var(--accent-foreground);
}
.lib-count {
  flex-shrink: 0;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground);
}
</style>
