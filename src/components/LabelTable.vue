<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto select-none">
      <table class="w-full border-collapse">
        <thead class="sticky top-0 bg-card text-xs text-muted-foreground">
          <tr class="border-b border-border text-left">
            <th class="w-10 px-2 py-1 font-normal">ID</th>
            <th class="w-24 px-2 py-1 font-normal">分組</th>
            <th class="px-2 py-1 font-normal">文字</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(label, i) in labels"
            :key="label.id"
            class="cursor-default border-b border-border/40 hover:bg-secondary/40"
            :class="[label.id === editor.selectedLabelId && 'bg-accent/50']"
            @click="editor.selectedLabelId = label.id"
          >
            <td class="px-2 py-1 tabular-nums">{{ i + 1 }}</td>
            <td class="px-2 py-1">
              <span class="inline-flex max-w-full items-center gap-1.5 align-middle">
                <span
                  class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  :style="{ backgroundColor: colorOf(label.groupId) }"
                />
                <span
                  class="min-w-0 truncate text-xs"
                  :class="label.groupId === null ? 'text-muted-foreground' : ''"
                >{{ nameOf(label.groupId) }}</span>
              </span>
            </td>
            <td class="h-7 max-w-0 truncate px-2 py-1 text-sm">
              {{ label.text.split('\n')[0] || '(未翻譯)' }}
            </td>
          </tr>
          <tr v-if="labels.length === 0">
            <td colspan="3" class="px-2 py-4 text-center text-xs text-muted-foreground">
              {{ project.isOpen ? '本頁無標籤' : '尚未開啟專案' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

const labels = computed(() =>
  editor.currentFilename ? (project.fileByName(editor.currentFilename)?.labels ?? []) : [],
)

function colorOf(groupId: string | null): string {
  if (!groupId) return 'rgb(128, 128, 128)'
  return project.header.groups.find((g) => g.id === groupId)?.color ?? 'rgb(128, 128, 128)'
}

function nameOf(groupId: string | null): string {
  if (!groupId) return '未分組'
  return project.header.groups.find((g) => g.id === groupId)?.name ?? '未分組'
}
</script>
