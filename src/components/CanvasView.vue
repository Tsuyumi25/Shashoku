<template>
  <div
    class="canvas-area relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-muted"
  >
    <template v-if="currentFile">
      <div v-if="src" class="relative">
        <img :src="src" class="canvas-image pointer-events-none block" alt="" />

        <LabelMarker
          v-for="(label, i) in currentFile.labels"
          :key="label.id"
          :index="i + 1"
          :x="label.x"
          :y="label.y"
          :color="colorOf(label.groupId)"
          :selected="label.id === editor.selectedLabelId"
          @select="editor.selectedLabelId = label.id"
        />
      </div>

      <div v-else class="text-xs text-muted-foreground select-none">
        {{ currentFile.badge === 'ok' ? '載入中…' : `圖檔不存在：${currentFile.filename}` }}
      </div>
    </template>

    <div v-else class="text-sm text-muted-foreground select-none">開啟一個資料夾開始工作</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LabelMarker from '@/components/LabelMarker.vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

const currentFile = computed(() =>
  editor.currentFilename ? (project.fileByName(editor.currentFilename) ?? null) : null,
)

function colorOf(groupId: string | null): string {
  if (!groupId) return 'rgb(128, 128, 128)'
  const g = project.header.groups.find((gg) => gg.id === groupId)
  return g?.color ?? 'rgb(128, 128, 128)'
}

const src = ref<string | null>(null)
let currentUrl: string | null = null

function revoke() {
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
}

watch(
  () => [project.rawsDir, editor.currentFilename, currentFile.value?.badge] as const,
  async ([rawsDir, filename, badge]) => {
    revoke()
    src.value = null
    if (!rawsDir || !filename || badge !== 'ok') return
    try {
      const bytes = await window.api.readImage(rawsDir, filename)
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]))
      currentUrl = url
      src.value = url
    } catch (err) {
      console.error(err)
    }
  },
  { immediate: true },
)

onBeforeUnmount(revoke)
</script>

<style scoped>
.canvas-area {
  container-type: size;
}
.canvas-image {
  max-height: 92cqh;
  max-width: 92cqw;
}
</style>
