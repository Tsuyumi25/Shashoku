<template>
  <div class="flex flex-col gap-1.5 border-t border-border p-2">
    <!--
      Above the button that fills it, and shown while a run is out as well:
      watching the files appear is half the reason to open it.
    -->
    <button class="panel-btn w-full" :disabled="!project.isOpen" @click="onOpenFolder">
      <FolderOpen :size="14" />
      <span>開啟輸出資料夾</span>
    </button>

    <template v-if="exportRun.progress">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <span>匯出中 {{ exportRun.progress.done }} / {{ exportRun.progress.total }}</span>
        <button class="panel-btn ml-auto" @click="exportRun.cancel()">取消</button>
      </div>
      <div class="h-1 overflow-hidden rounded-full bg-secondary">
        <div class="h-full bg-primary transition-[width]" :style="{ width: `${percent}%` }" />
      </div>
    </template>

    <button
      v-else
      class="panel-btn panel-btn-primary w-full"
      :disabled="!ready"
      @click="exportRun.run()"
    >
      <Download :size="15" />
      <span>匯出 {{ exportRun.pagesToRun.length }} 頁</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { Download, FolderOpen } from '@lucide/vue'
import { useToast } from 'vue-toastification'
import { profileFolderName } from '@shared/export/profile'
import { useExportStore } from '@/stores/exportStore'
import { useProjectStore } from '@/stores/projectStore'

const exportRun = useExportStore()
const project = useProjectStore()
const toast = useToast()

async function onOpenFolder() {
  const root = project.rootPath
  const profile = exportRun.profilesToRun[0]
  if (root === null || !profile) return
  const reason = await window.api.openExportFolder(root, profileFolderName(profile))
  if (reason) toast.error(`開不了資料夾:${reason}`)
}

const ready = computed(() => exportRun.pagesToRun.length > 0 && exportRun.profilesToRun.length > 0)

const percent = computed(() => {
  const p = exportRun.progress
  if (!p || p.total === 0) return 0
  return Math.round((p.done / p.total) * 100)
})

/**
 * The result leaves as a toast rather than as a line under the button. A
 * message that appeared there would push the button out from under the pointer
 * at exactly the moment someone might press it again — and the answer to "did
 * that work" belongs wherever the reader is looking, not only in the panel
 * they may have already left.
 */
watch(
  () => exportRun.outcome,
  (outcome) => {
    if (!outcome) return
    if (outcome.kind === 'done') toast.success(`已寫出 ${outcome.written} 個檔案`)
    else
      toast.error(
        `在寫出 ${outcome.written} 個檔案後停下:${outcome.why}。已寫出的留在原處。`,
        { timeout: 8000 },
      )
    exportRun.clearOutcome()
  },
)
</script>
