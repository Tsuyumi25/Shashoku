<template>
  <div class="flex flex-col gap-4">
    <h3 class="text-sm font-medium">字體</h3>

    <label class="flex items-center justify-between gap-3 rounded border border-border p-3">
      <span class="shrink-0 text-xs">預設字體</span>
      <select
        class="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1 text-xs"
        :value="defaultFamily"
        @change="preferences.setDefaultFontFamily(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="one in families" :key="one.family" :value="one.family">
          {{ one.label }}
        </option>
      </select>
    </label>

    <section class="flex flex-col gap-2 rounded border border-border p-3 text-xs">
      <div class="flex items-center justify-between gap-3">
        <span>字體資料夾</span>
        <button
          type="button"
          class="rounded border border-border bg-background px-2 py-0.5 hover:bg-secondary disabled:opacity-50"
          :disabled="scanning"
          @click="addFolder()"
        >
          新增資料夾…
        </button>
      </div>
      <ul v-if="preferences.prefs.fontFolders.length" class="flex flex-col gap-1">
        <li v-for="folder in preferences.prefs.fontFolders" :key="folder" class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate font-mono" :title="folder">{{ folder }}</span>
          <span class="shrink-0 tabular-nums text-muted-foreground">
            {{ scanning ? '掃描中…' : `${familiesIn(folder)} 個字型` }}
          </span>
          <button
            type="button"
            class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
            title="從清單移除，不會刪除任何檔案"
            :disabled="scanning"
            @click="removeFolder(folder)"
          >
            <X :size="12" />
          </button>
        </li>
      </ul>
      <p v-else class="text-muted-foreground">尚未加入資料夾。系統字體不用加，一直都在。</p>
      <p v-if="error" class="text-destructive">字體枚舉失敗：{{ error }}</p>
      <p class="leading-relaxed text-muted-foreground">
        這些資料夾裡的字體檔會留在原處，Shashoku 直接讀取，不會複製一份。放在機械硬碟上，樣張會慢一些；放在外接裝置上，裝置沒接上時這些字體不會出現在清單裡。內接
        SSD 不會有這兩種情況。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { X } from '@lucide/vue'
import { catalog, defaultFamily, loadFontCatalog } from '@/lib/fontCatalog'
import { usePreferencesStore } from '@/stores/preferencesStore'

const preferences = usePreferencesStore()

/** System families only — an imported folder is a choice about one project. */
const families = computed(() => {
  const seen = new Set<string>()
  const out: { family: string; label: string }[] = []
  for (const entry of catalog.value) {
    if (entry.origin.kind !== 'system' || seen.has(entry.family)) continue
    seen.add(entry.family)
    out.push({ family: entry.family, label: entry.displayName })
  }
  return out
})

/** Within the folder itself, not merely a neighbour whose name begins the same way. */
function isInside(path: string, folder: string): boolean {
  const root = folder.replace(/[\\/]+$/, '')
  return path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)
}

/**
 * How many families each folder brought in, so a folder that scanned to
 * nothing — unplugged, misspelt, full of something else — says so where it is
 * listed. A face reachable from two folders counts for the first, which is
 * the one the catalogue credits it to.
 */
const familiesByFolder = computed(() => {
  const out = new Map<string, Set<string>>()
  for (const entry of catalog.value) {
    if (entry.origin.kind !== 'imported') continue
    const folder = preferences.prefs.fontFolders.find((f) => isInside(entry.origin.path, f))
    if (folder === undefined) continue
    let held = out.get(folder)
    if (!held) out.set(folder, (held = new Set()))
    held.add(entry.family)
  }
  return out
})

const familiesIn = (folder: string) => familiesByFolder.value.get(folder)?.size ?? 0

const scanning = ref(false)
const error = ref<string | null>(null)

/** The picker reads the same catalogue, so it sees a change here without asking. */
async function rescan() {
  scanning.value = true
  try {
    await loadFontCatalog(preferences.prefs.fontFolders)
    error.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    console.error('fonts: catalogue failed to load', err)
  } finally {
    scanning.value = false
  }
}

async function addFolder() {
  const chosen = await window.api.pickFontFolder()
  if (chosen === null) return
  if (preferences.addFontFolder(chosen)) await rescan()
}

async function removeFolder(path: string) {
  preferences.removeFontFolder(path)
  await rescan()
}

onMounted(rescan)
</script>
