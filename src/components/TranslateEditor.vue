<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-7 shrink-0 items-center border-b border-border px-2 select-none">
      <span class="text-xs text-muted-foreground">
        {{ selectedLabel ? `標號 ${selectedIndex + 1}` : '未選取標籤' }}
      </span>
      <span
        v-if="selectedLabel"
        class="ml-2 flex items-center gap-1 text-xs text-muted-foreground"
      >
        <span
          class="inline-block h-2.5 w-2.5 rounded-full"
          :style="{ backgroundColor: selectedGroup?.color ?? 'gray' }"
        />
        {{ selectedGroup?.name ?? '未分組' }}
      </span>
    </div>

    <textarea
      class="min-h-0 w-full flex-1 resize-none bg-card px-3 py-2 text-sm leading-relaxed focus:outline-none disabled:bg-muted disabled:text-muted-foreground"
      :value="selectedLabel?.text ?? ''"
      :disabled="!selectedLabel"
      :placeholder="selectedLabel ? '輸入翻譯…' : ''"
      @input="onInput"
    />

    <div class="flex h-6 shrink-0 items-center border-t border-border px-2 select-none">
      <span class="text-xs text-muted-foreground">Ctrl+S 儲存</span>
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
const selectedIndex = computed(() =>
  labels.value.findIndex((l) => l.id === editor.selectedLabelId),
)
const selectedLabel = computed(() =>
  selectedIndex.value >= 0 ? labels.value[selectedIndex.value] : undefined,
)
const selectedGroup = computed(() => {
  const gid = selectedLabel.value?.groupId
  if (!gid) return undefined
  return project.header.groups.find((g) => g.id === gid)
})

function onInput(e: Event) {
  if (!selectedLabel.value || !editor.currentFilename) return
  project.updateLabelText(
    editor.currentFilename,
    selectedLabel.value.id,
    (e.target as HTMLTextAreaElement).value,
  )
}
</script>
