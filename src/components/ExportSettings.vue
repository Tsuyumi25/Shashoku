<template>
  <div class="flex h-full min-h-0 flex-col">
    <h3 class="mb-1 text-sm font-medium">匯出配置</h3>
    <p class="mb-3 text-xs text-muted-foreground">
      新專案第一次打開時抄一份過去，之後那本書用自己的；這裡改了不會動到已經有配置的專案。
    </p>

    <div class="flex min-h-0 flex-1 gap-3">
      <div class="flex w-56 shrink-0 flex-col rounded border border-border">
        <div class="flex h-7 shrink-0 items-center border-b border-border pr-1 pl-2">
          <span class="text-xs text-muted-foreground">{{ seeds.length }} 份</span>
          <button type="button" class="head-btn ml-auto" @click="add">
            <Plus :size="13" />
            <span>新增</span>
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-1">
          <p v-if="seeds.length === 0" class="p-2 text-xs text-muted-foreground">
            沒有配置。新專案打開時，匯出配置會是空的。
          </p>
          <div
            v-for="(profile, i) in seeds"
            :key="i"
            class="seed"
            :class="i === selected && 'seed-on'"
            @click="selected = i"
          >
            <span class="min-w-0 flex-1 text-xs break-all" :class="!profile.name && 'font-mono'">
              {{ profile.name || profileFolderName(profile) }}
            </span>
            <DropdownMenuRoot>
              <DropdownMenuTrigger class="seed-more" title="更多" @click.stop>
                <MoreHorizontal :size="14" />
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent class="dropdown-content" align="end" :side-offset="4">
                  <DropdownMenuItem class="dropdown-item" @select="remove(i)">刪除</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </div>
        </div>
      </div>

      <div class="min-h-0 min-w-0 flex-1 overflow-y-auto rounded border border-border">
        <p v-if="!current" class="p-3 text-xs text-muted-foreground">選一份配置來編輯。</p>
        <template v-else>
          <div class="px-2 pt-2">
            <input
              class="name"
              :value="current.name ?? ''"
              :placeholder="profileFolderName(current)"
              aria-label="配置名稱"
              @input="onName"
            />
          </div>
          <ExportProfileEditor :profile="current" @change="edit" />
          <p class="px-2 pb-2 text-xs text-muted-foreground">
            資料夾：export/&lt;譯文面&gt;-{{ profileFolderName(current) }}/
          </p>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { MoreHorizontal, Plus } from '@lucide/vue'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'
import { profileFolderName } from '@shared/export/profile'
import { defaultExportProfile, type ExportProfile } from '@shared/export/types'
import ExportProfileEditor from '@/components/ExportProfileEditor.vue'
import { usePreferencesStore } from '@/stores/preferencesStore'

const preferences = usePreferencesStore()

const seeds = computed(() => preferences.prefs.exportMenuSeed)
const selected = ref(0)
const current = computed<ExportProfile | null>(() => seeds.value[selected.value] ?? null)

function set(next: ExportProfile[]) {
  preferences.prefs.exportMenuSeed = next
}

function edit(profile: ExportProfile) {
  set(seeds.value.map((p, i) => (i === selected.value ? profile : p)))
}

function onName(e: Event) {
  if (!current.value) return
  const { name: _name, ...unnamed } = current.value
  const name = (e.target as HTMLInputElement).value
  edit(name.trim().length > 0 ? { ...unnamed, name } : unnamed)
}

/** A copy of the one being edited, or of the defaults, without its name. */
function add() {
  const { name: _name, ...copy } = JSON.parse(JSON.stringify(current.value ?? defaultExportProfile())) as ExportProfile
  set([...seeds.value, copy])
  selected.value = seeds.value.length - 1
}

function remove(index: number) {
  set(seeds.value.filter((_, i) => i !== index))
  if (selected.value > index || selected.value >= seeds.value.length) selected.value = Math.max(0, selected.value - 1)
}
</script>

<style scoped>
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
.head-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.seed {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.25rem 0.25rem 0.5rem;
  border: 1px solid transparent;
  border-radius: 0.3rem;
  cursor: pointer;
}
.seed:hover {
  background: var(--secondary);
}
.seed-on {
  border-color: var(--primary);
}
.seed-more {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 1.375rem;
  padding: 0 0.25rem;
  border-radius: 0.3rem;
  color: var(--muted-foreground);
}
.seed-more:hover {
  background: var(--background);
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
</style>
