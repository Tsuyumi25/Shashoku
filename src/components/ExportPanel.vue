<template>
  <div class="flex h-full min-h-0 flex-col bg-card">
    <div class="flex h-7 shrink-0 items-center border-b border-border pr-1 pl-2 select-none">
      <span class="text-xs font-medium text-muted-foreground">輸出設定</span>
      <button
        type="button"
        class="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        title="刪除目前這組設定"
        :disabled="!active"
        @click="onRemove"
      >
        <Trash2 :size="13" />
      </button>
      <button
        type="button"
        class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        title="新增一組輸出設定"
        :disabled="!project.isOpen"
        @click="onAdd"
      >
        <Plus :size="14" />
      </button>
    </div>

    <p v-if="profiles.length === 0" class="p-3 text-center text-xs text-muted-foreground">
      還沒有輸出設定。按上面的 + 新增一組。
    </p>

    <template v-else>
      <!--
        Every profile on screen at once, and exactly one of them current. A
        project keeps a handful of its own, so there is nothing to gain from
        folding them away; and each is a whole delivery, so choosing is picking
        which delivery to make rather than how many to make at once.
      -->
      <div
        class="grid shrink-0 gap-1 border-b border-border p-1 select-none"
        :style="{ gridTemplateColumns: 'repeat(auto-fill, minmax(7.5rem, 1fr))' }"
      >
        <button
          v-for="(profile, i) in profiles"
          :key="folderOf(profile)"
          type="button"
          class="cursor-pointer truncate rounded-[5px] border px-2 py-1.5 text-left text-xs"
          :class="
            i === exportRun.activeProfile
              ? 'border-primary bg-primary/10'
              : 'border-border text-muted-foreground hover:bg-secondary'
          "
          :title="folderOf(profile)"
          @click="exportRun.activeProfile = i"
        >
          {{ folderOf(profile) }}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <ExportProfileEditor
          v-if="active"
          :profile="active"
          :problem="problem"
          @change="onChange(exportRun.activeProfile, $event)"
        />
      </div>

      <ExportRunner class="shrink-0" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Trash2 } from '@lucide/vue'
import { profileFolderName, withFormat } from '@shared/export/profile'
import { defaultExportProfile, type ExportProfile } from '@shared/export/types'
import ExportProfileEditor from '@/components/ExportProfileEditor.vue'
import ExportRunner from '@/components/ExportRunner.vue'
import { useExportStore } from '@/stores/exportStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const exportRun = useExportStore()

const profiles = computed(() => project.exportProfiles)
const problem = ref<string | null>(null)

const folderOf = profileFolderName
const active = computed<ExportProfile | undefined>(() => profiles.value[exportRun.activeProfile])

/** A first profile is the plain one; later ones start from the one in hand. */
function onAdd() {
  problem.value = null
  const seed = active.value ?? defaultExportProfile()
  try {
    project.addExportProfile(withFormat(seed, nextFreeFormat(seed)))
    exportRun.activeProfile = profiles.value.length - 1
  } catch (err) {
    problem.value = err instanceof Error ? err.message : String(err)
  }
}

/**
 * A copy of the current profile would deliver into the folder that profile
 * already owns, which the store refuses. Opening on a format nobody is using
 * yet makes the common case — one profile per format — one click.
 */
function nextFreeFormat(seed: ExportProfile): ExportProfile['format'] {
  const taken = new Set(profiles.value.map(folderOf))
  for (const format of ['png', 'jpeg', 'webp', 'png-8'] as const) {
    if (!taken.has(folderOf({ ...seed, format }))) return format
  }
  return seed.format
}

function onChange(index: number, next: ExportProfile) {
  problem.value = null
  try {
    project.updateExportProfile(index, next)
  } catch (err) {
    problem.value = err instanceof Error ? err.message : String(err)
  }
}

function onRemove() {
  problem.value = null
  project.removeExportProfile(exportRun.activeProfile)
}
</script>
