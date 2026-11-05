<template>
  <SplitterGroup
    direction="vertical"
    class="h-full min-h-0 bg-card"
    auto-save-id="export:sidebar:v1"
    :storage="preferences.panelStorage"
  >
    <SplitterPanel :order="1" :default-size="40" :min-size="15" class="flex min-h-0 flex-col">
      <div class="flex h-7 shrink-0 items-center border-b border-border pr-1 pl-2 select-none">
        <span class="text-xs font-medium text-muted-foreground">匯出配置</span>
        <button type="button" class="head-btn ml-auto" :disabled="!project.isOpen" @click="exportRun.add()">
          <Plus :size="13" />
          <span>新增</span>
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <p v-if="project.exportMenu.length === 0" class="p-2 text-xs text-muted-foreground">
          還沒有匯出配置。按右上角「新增」建一份。
        </p>
        <div
          v-for="entry in project.exportMenu"
          :key="entry.id"
          class="entry"
          :class="entry.id === exportRun.current?.id && 'entry-on'"
          @click="exportRun.select(entry.id)"
        >
          <div class="text-xs break-all" :class="!entry.profile.name && 'font-mono'">
            {{ entry.profile.name || folderOf(entry) }}
          </div>

          <div v-if="exportRun.runningId === entry.id && exportRun.progress" class="entry-acts" @click.stop>
            <div class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
              <div class="h-full bg-primary transition-[width]" :style="{ width: `${percent}%` }" />
            </div>
            <span class="text-xs text-muted-foreground tabular-nums">
              {{ exportRun.progress.done }} / {{ exportRun.progress.total }}
            </span>
            <button type="button" class="entry-btn" @click="exportRun.cancel()">取消</button>
          </div>

          <div v-else class="entry-acts">
            <button type="button" class="entry-btn" @click.stop="openFolder(entry)">開啟</button>
            <button
              type="button"
              class="entry-btn entry-run"
              :disabled="exportRun.running || exportRun.pagesToRun.length === 0 || !exportRun.deliveryOf(entry.profile)"
              @click.stop="deliver(entry.id)"
            >
              匯出
            </button>
            <DropdownMenuRoot>
              <DropdownMenuTrigger class="entry-btn entry-more" title="更多" @click.stop>
                <MoreHorizontal :size="14" />
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent class="dropdown-content" align="end" :side-offset="4">
                  <DropdownMenuItem class="dropdown-item" @select="promote(entry)">加進全域匯出配置</DropdownMenuItem>
                  <DropdownMenuSeparator class="dropdown-separator" />
                  <DropdownMenuItem class="dropdown-item" @select="exportRun.remove(entry.id)">刪除</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </div>
        </div>
      </div>
    </SplitterPanel>

    <ResizeHandle vertical />

    <SplitterPanel :order="2" :default-size="60" :min-size="25" class="flex min-h-0 flex-col">
      <div class="flex h-7 shrink-0 items-center border-b border-border px-2 select-none">
        <span class="text-xs font-medium text-muted-foreground">匯出參數</span>
      </div>

      <p v-if="!current" class="p-3 text-xs text-muted-foreground">選一份匯出配置來編輯。</p>

      <template v-else>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <div class="px-2 pt-2">
            <input
              class="name"
              :value="current.profile.name ?? ''"
              :placeholder="folderOf(current)"
              aria-label="配置名稱"
              @input="onName"
            />
          </div>

          <div class="faces">
            <span class="faces-label">譯文面</span>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="face in project.faces"
                :key="face.id"
                type="button"
                class="pill"
                :class="exportRun.delivery?.face === face.id && 'pill-on'"
                @click="exportRun.edit({ ...current.profile, face: face.id })"
              >
                {{ face.name }}
              </button>
            </div>
          </div>

          <ExportProfileEditor :profile="current.profile" @change="exportRun.edit($event)" />

          <div class="dest">
            <template v-if="exportRun.delivery">
              <div class="break-all">export/{{ exportRun.delivery.folder }}/</div>
              <div class="mt-0.5 text-muted-foreground">例如 {{ sampleName }}</div>
            </template>
            <span v-else>沒有選譯文面</span>
          </div>
        </div>

      </template>
    </SplitterPanel>
  </SplitterGroup>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { MoreHorizontal, Plus } from '@lucide/vue'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SplitterGroup,
  SplitterPanel,
} from 'reka-ui'
import { useToast } from 'vue-toastification'
import { outputFilename, profileFolderName } from '@shared/export/profile'
import type { ExportMenuEntry, ExportProfile } from '@shared/export/types'
import ExportProfileEditor from '@/components/ExportProfileEditor.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import { useExportStore } from '@/stores/exportStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const exportRun = useExportStore()
const preferences = usePreferencesStore()
const toast = useToast()

const current = computed(() => exportRun.current)

function folderOf(entry: ExportMenuEntry): string {
  return exportRun.deliveryOf(entry.profile)?.folder ?? profileFolderName(entry.profile)
}

function onName(e: Event) {
  const p = current.value?.profile
  if (!p) return
  const { name: _name, ...unnamed } = p
  const name = (e.target as HTMLInputElement).value
  exportRun.edit(name.trim().length > 0 ? { ...unnamed, name } : unnamed)
}

const sampleName = computed(() =>
  current.value ? outputFilename(current.value.profile, project.files[0]?.page.name ?? '001.png', 0) : '',
)

const percent = computed(() => {
  const p = exportRun.progress
  if (!p || p.total === 0) return 0
  return Math.round((p.done / p.total) * 100)
})

function deliver(id: string) {
  exportRun.select(id)
  void exportRun.run(id)
}

async function openFolder(entry: ExportMenuEntry) {
  const root = project.rootPath
  const target = exportRun.deliveryOf(entry.profile)
  if (root === null || !target) return
  const reason = await window.api.openExportFolder(root, target.folder)
  if (reason) toast.error(`開不了資料夾:${reason}`)
}

function promote(entry: ExportMenuEntry) {
  // Without its face: a face id means nothing in another book.
  const { face: _face, ...recipe } = JSON.parse(JSON.stringify(entry.profile)) as ExportProfile
  preferences.prefs.exportMenuSeed = [...preferences.prefs.exportMenuSeed, recipe]
  toast.success('加進全域匯出配置；之後新專案會帶著它')
}

/**
 * The result leaves as a toast rather than as a line in the panel: the answer
 * to "did that work" belongs wherever the reader is looking, not only in the
 * panel they may have already left.
 */
watch(
  () => exportRun.outcome,
  (outcome) => {
    if (!outcome) return
    if (outcome.kind === 'done') toast.success(`已寫出 ${outcome.written} 個檔案`)
    else
      toast.error(`在寫出 ${outcome.written} 個檔案後停下:${outcome.why}。已寫出的留在原處。`, { timeout: 8000 })
    exportRun.clearOutcome()
  },
)
</script>

<style scoped>
.faces {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.5rem 0;
  font-size: 0.8125rem;
}
.faces-label {
  width: 5.5rem;
  flex-shrink: 0;
  color: var(--muted-foreground);
}
.pill {
  border: 1px solid var(--border);
  border-radius: 0.3rem;
  padding: 0 0.5rem;
  font-size: 0.75rem;
  line-height: 1.375rem;
  color: var(--muted-foreground);
}
.pill:hover {
  background: var(--secondary);
}
.pill-on {
  border-color: var(--primary);
  background: color-mix(in oklab, var(--primary) 12%, transparent);
  color: var(--foreground);
}
.dest {
  margin: 0 0.5rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.3rem;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.6875rem;
  line-height: 1.5;
}
.name {
  width: 100%;
  height: 1.75rem;
  padding: 0 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: var(--background);
  font-size: 0.8125rem;
}
.head-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.375rem;
  padding: 0 0.375rem;
  border-radius: 0.3rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}
.head-btn:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.entry {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin-top: 0.375rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  cursor: pointer;
}
.entry:hover {
  background: var(--secondary);
}
.entry-on {
  border-color: var(--primary);
}
.entry-acts {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}
.entry-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 1.375rem;
  padding: 0 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.3rem;
  background: var(--background);
  font-size: 0.75rem;
}
.entry-btn:hover:not(:disabled) {
  border-color: var(--primary);
}
.entry-btn:disabled {
  opacity: 0.5;
}
.entry-run {
  border-color: transparent;
  background: var(--primary);
  color: var(--primary-foreground);
}
.entry-run:hover:not(:disabled) {
  border-color: transparent;
  background: color-mix(in oklch, var(--primary), black 8%);
}
.entry-more {
  padding: 0 0.25rem;
  color: var(--muted-foreground);
}
</style>
