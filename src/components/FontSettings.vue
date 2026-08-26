<template>
  <div>
    <h3 class="mb-3 text-sm font-medium">字體</h3>

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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
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

onMounted(() => {
  loadFontCatalog(preferences.prefs.fontFolders).catch((err: unknown) => {
    console.error('fonts: catalogue failed to load', err)
  })
})
</script>
