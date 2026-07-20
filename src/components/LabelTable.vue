<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- 右欄工具列：字級 + 檔案設定（對齊原版 toolStripLabels） -->
    <div class="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2 select-none">
      <button class="tool-btn" title="放大字級" @click="editor.adjustFontSize(1)">
        <span class="text-sm font-bold">F</span><Plus :size="9" class="-ml-0.5" />
      </button>
      <button class="tool-btn" title="縮小字級" @click="editor.adjustFontSize(-1)">
        <span class="text-sm font-bold">F</span><Minus :size="9" class="-ml-0.5" />
      </button>
      <div class="mx-1 h-4 w-px bg-border" />
      <GroupManager />
      <TextPreviewSettings />
      <span class="ml-auto text-xs text-muted-foreground">右鍵設定分組</span>
    </div>

    <!-- 標籤表格：ID | 分組 | 文字。select-none:列是點擊目標(單擊選取/
         雙擊進輸入層),雙擊不該順手反白文字;要改字進編輯框 -->
    <div
      class="min-h-0 flex-1 overflow-y-auto select-none"
      :style="{ fontSize: `${editor.fontSize}px` }"
    >
      <table class="w-full border-collapse">
        <thead class="sticky top-0 bg-card text-xs text-muted-foreground">
          <tr class="border-b border-border text-left">
            <th class="w-10 px-2 py-1 font-normal">ID</th>
            <th class="w-12 px-1 py-1 font-normal">分組</th>
            <th class="px-2 py-1 font-normal">文字</th>
          </tr>
        </thead>
        <tbody>
          <ContextMenu v-for="(label, i) in labels" :key="label.id">
            <ContextMenuTrigger as-child>
              <tr
                :ref="(el) => setRowRef(label.id, el)"
                class="cursor-default border-b border-border/40 hover:bg-secondary/40"
                :class="[label.id === editor.selectedLabelId && 'bg-accent/50']"
                @click="onRowClick(label)"
                @dblclick="onRowDblclick(label)"
              >
                <td class="px-2 py-1 tabular-nums">{{ i + 1 }}</td>
                <td class="px-1 py-1">
                  <span
                    class="inline-block h-3.5 w-3.5 rounded-full align-middle text-center text-[10px] leading-3.5 font-bold text-white"
                    :style="{ backgroundColor: groupColorOf(label) }"
                    :title="groupNameOf(label)"
                  >
                    {{ groupIndexOf(label) }}
                  </span>
                </td>
                <td class="h-7 max-w-0 truncate px-2 py-1">
                  {{ label.text.split('\r\n')[0] }}
                </td>
              </tr>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuLabel class="text-xs">設定分組</ContextMenuLabel>
              <ContextMenuItem
                v-for="group in project.header.groups"
                :key="group.id"
                @select="onSetGroup(label, group.id)"
              >
                <span
                  class="mr-2 inline-block h-3 w-3 rounded-full"
                  :style="{ backgroundColor: group.color }"
                />
                {{ group.name }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem @select="onSetGroup(label, null)">
                <span class="mr-2 inline-block h-3 w-3 rounded-full bg-gray-400" />
                未分組
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" @select="onDelete(label)">
                <Trash2 :size="13" class="mr-1" />
                刪除標籤
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, type ComponentPublicInstance } from 'vue'
import { Minus, Plus, Trash2 } from '@lucide/vue'
import type { LabelItem } from '@/types/project'
import GroupManager from '@/components/GroupManager.vue'
import TextPreviewSettings from '@/components/TextPreviewSettings.vue'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

const labels = computed(() =>
  editor.currentFilename ? (project.fileByName(editor.currentFilename)?.labels ?? []) : [],
)

const rowRefs = new Map<string, HTMLElement>()
function setRowRef(id: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLElement) rowRefs.set(id, el)
  else rowRefs.delete(id)
}
watch(
  () => editor.selectedLabelId,
  (id) => {
    if (id) rowRefs.get(id)?.scrollIntoView({ block: 'nearest' })
  },
)

function onRowClick(label: LabelItem) {
  editor.selectedLabelId = label.id
}

/** 雙擊列 = 選取並進輸入層(與畫布的雙擊 marker/譯文同語義) */
function onRowDblclick(label: LabelItem) {
  editor.selectedLabelId = label.id
  editor.requestEditorFocus()
}

function onSetGroup(label: LabelItem, groupId: string | null) {
  if (!editor.currentFilename) return
  editor.cmdUpdateLabelGroupId(editor.currentFilename, label.id, label.groupId, groupId)
  editor.activeGroupId = groupId
}

function groupOf(label: LabelItem) {
  if (label.groupId === null) return undefined
  return project.header.groups.find((g) => g.id === label.groupId)
}
function groupColorOf(label: LabelItem): string {
  return groupOf(label)?.color ?? 'gray'
}
function groupNameOf(label: LabelItem): string {
  return groupOf(label)?.name ?? '未分組'
}
/** 分組序號(1-based);未分組回空字串。原版標號的視覺對應。 */
function groupIndexOf(label: LabelItem): string {
  const i = project.header.groups.findIndex((g) => g.id === label.groupId)
  return i === -1 ? '' : String(i + 1)
}

function onDelete(label: LabelItem) {
  if (!editor.currentFilename) return
  editor.cmdDeleteLabel(editor.currentFilename, label.id)
}
</script>

<style scoped>
.tool-btn {
  display: flex;
  height: 1.5rem;
  align-items: center;
  border-radius: 0.25rem;
  padding: 0 0.375rem;
  color: var(--muted-foreground);
}
.tool-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
</style>
