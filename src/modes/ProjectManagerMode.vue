<template>
  <div class="flex h-full w-full flex-col items-center justify-center gap-8 p-8">
    <div class="text-center">
      <h1 class="text-2xl font-semibold">Shashoku 写植</h1>
      <p class="mt-1 text-sm text-muted-foreground">漫畫翻譯 · 校對 · 嵌字</p>
    </div>

    <div class="flex flex-col gap-2 w-72">
      <button class="pm-btn pm-btn-primary" @click="onNew">
        <FilePlus :size="18" />
        <span>新增專案</span>
      </button>
      <button class="pm-btn" @click="onOpen">
        <FolderOpen :size="18" />
        <span>開啟專案</span>
      </button>
    </div>

    <div v-if="project.isOpen" class="text-xs text-muted-foreground">
      目前開啟:{{ project.folderPath }}
    </div>
    <p v-if="lastError" class="max-w-md text-center text-sm text-destructive">
      {{ lastError }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FilePlus, FolderOpen } from '@lucide/vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const project = useProjectStore()
const editor = useEditorStore()
const ui = useUiStore()

const lastError = ref<string | null>(null)

async function onNew() {
  lastError.value = null
  try {
    const created = await project.createNewProject()
    if (created === null) return
    editor.clearHistory()
    editor.selectFile(project.files[0]?.filename ?? null)
    ui.setView('translate')
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : String(err)
  }
}

async function onOpen() {
  lastError.value = null
  try {
    const opened = await project.openExisting()
    if (opened === null) return
    editor.clearHistory()
    editor.selectFile(project.files[0]?.filename ?? null)
    ui.setView('translate')
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<style scoped>
.pm-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  height: 2.5rem;
  padding: 0 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--foreground);
  font-size: 0.9375rem;
  transition: background 0.12s;
}
.pm-btn:hover {
  background: var(--secondary);
}
.pm-btn-primary {
  background: var(--primary);
  color: var(--primary-foreground);
  border-color: transparent;
}
.pm-btn-primary:hover {
  background: color-mix(in oklch, var(--primary), black 8%);
}
</style>
