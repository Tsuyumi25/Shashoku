<template>
  <div class="h-full min-h-0 overflow-y-auto p-2">
    <input
      v-if="activeGroupIndex !== -1"
      class="mb-1.5 h-6 w-full rounded border border-input bg-background px-1.5 text-xs"
      :value="project.header.groups[activeGroupIndex].name"
      @focus="nameBeforeEdit = project.header.groups[activeGroupIndex].name"
      @blur="onRename($event)"
    />
    <div v-else class="mb-1.5 px-0.5 text-xs text-muted-foreground">
      預設樣式（未分組標籤）
    </div>

    <StyleEditor :value="activeStyle" @patch="onStylePatch" />

    <p v-if="error" class="mt-1.5 text-[10px] text-destructive">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TextStyle } from '@shared/text-style/types'
import { RESERVED_GROUP_NAMES } from '@shared/ssk/constants'
import StyleEditor from '@/components/StyleEditor.vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

const nameBeforeEdit = ref('')
const error = ref('')

const activeGroupIndex = computed(() => {
  const id = editor.activeGroupId
  return id === null ? -1 : project.header.groups.findIndex((g) => g.id === id)
})

const activeStyle = computed<TextStyle>(() =>
  activeGroupIndex.value === -1
    ? project.header.defaultStyle
    : project.header.groups[activeGroupIndex.value].style,
)

function onStylePatch(patch: Partial<TextStyle>) {
  if (activeGroupIndex.value === -1) project.updateDefaultStyle(patch)
  else project.updateGroupStyle(activeGroupIndex.value, patch)
}

function onRename(e: Event) {
  const idx = activeGroupIndex.value
  if (idx === -1) return
  const input = e.target as HTMLInputElement
  const name = input.value.trim()
  if (name === '' || RESERVED_GROUP_NAMES.includes(name)) {
    input.value = nameBeforeEdit.value
    error.value = RESERVED_GROUP_NAMES.includes(name) ? `「${name}」是保留名稱，請換一個` : ''
    return
  }
  error.value = ''
  if (name === nameBeforeEdit.value) return
  editor.cmdRenameGroup(idx, nameBeforeEdit.value, name)
}
</script>
