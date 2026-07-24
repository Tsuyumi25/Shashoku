<template>
  <div class="h-full min-h-0 overflow-y-auto p-1.5">
    <div class="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-1">
      <button
        v-for="group in project.header.groups"
        :key="group.id"
        class="flex min-w-0 items-center gap-1.5 rounded border px-1.5 py-1 text-left text-xs font-medium"
        :class="
          editor.activeGroupId === group.id
            ? 'border-current bg-secondary/60'
            : 'border-transparent hover:bg-secondary/40'
        "
        :style="{ color: group.color }"
        :title="group.name"
        @click="editor.activeGroupId = group.id"
      >
        <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: group.color }" />
        <span class="min-w-0 truncate">{{ group.name }}</span>
      </button>

      <button
        class="flex min-w-0 items-center gap-1.5 rounded border px-1.5 py-1 text-left text-xs font-medium text-muted-foreground"
        :class="
          editor.activeGroupId === null
            ? 'border-current bg-secondary/60'
            : 'border-transparent hover:bg-secondary/40'
        "
        title="未分組標籤的樣式來源"
        @click="editor.activeGroupId = null"
      >
        <span class="h-2 w-2 shrink-0 rounded-full bg-gray-400" />
        <span class="min-w-0 truncate">預設樣式</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()
</script>
