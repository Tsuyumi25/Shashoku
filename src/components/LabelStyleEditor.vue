<template>
  <div class="h-full min-h-0 overflow-y-auto p-2">
    <template v-if="selectedLabel">
      <div class="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <span class="min-w-0 truncate text-xs text-muted-foreground">
          標號 {{ selectedIndex + 1 }} · 繼承自 {{ baseName }}
        </span>
        <button
          v-if="hasOverride"
          type="button"
          class="shrink-0 rounded px-1 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          title="清除這個標籤的樣式覆寫"
          @click="onClearOverride"
        >
          清除覆寫
        </button>
      </div>

      <StyleEditor :value="effectiveStyle" @patch="onStylePatch" />
    </template>

    <p v-else class="px-0.5 text-xs text-muted-foreground">未選取標籤</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TextStyle } from '@shared/text-style/types'
import StyleEditor from '@/components/StyleEditor.vue'
import { resolveTextStyle } from '@/lib/textStyle'
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

const baseGroup = computed(() => {
  const gid = selectedLabel.value?.groupId
  if (!gid) return undefined
  return project.header.groups.find((g) => g.id === gid)
})

const baseName = computed(() => baseGroup.value?.name ?? '預設樣式')

const effectiveStyle = computed<TextStyle>(() =>
  resolveTextStyle(
    selectedLabel.value ?? { groupId: null },
    project.header.groups,
    project.header.defaultStyle,
  ),
)

const hasOverride = computed(
  () => Object.keys(selectedLabel.value?.styleOverride ?? {}).length > 0,
)

function onStylePatch(patch: Partial<TextStyle>) {
  if (!selectedLabel.value || !editor.currentFilename) return
  project.updateLabelStyleOverride(editor.currentFilename, selectedLabel.value.id, {
    ...(selectedLabel.value.styleOverride ?? {}),
    ...patch,
  })
}

function onClearOverride() {
  if (!selectedLabel.value || !editor.currentFilename) return
  project.updateLabelStyleOverride(editor.currentFilename, selectedLabel.value.id, undefined)
}
</script>
