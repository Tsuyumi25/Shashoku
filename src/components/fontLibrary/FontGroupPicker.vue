<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger class="row-btn" title="這套字型要放在哪些群組">
      <ListPlus :size="13" />
      <span>設置群組</span>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="group-picker" side="bottom" align="start" :side-offset="4" :collision-padding="8">
        <div class="px-3 pt-2.5 pb-1 text-xs text-muted-foreground">放進群組</div>
        <div class="px-2">
          <input
            v-model="query"
            type="search"
            spellcheck="false"
            placeholder="搜尋群組"
            class="w-full rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
            @keydown.enter="onEnter"
          />
        </div>
        <button v-if="!exact" class="gp-row text-muted-foreground" @click="create">
          <Plus :size="15" />
          <span class="min-w-0 flex-1 truncate">{{ query.trim() ? `新群組「${query.trim()}」` : '新群組' }}</span>
        </button>
        <div class="max-h-72 overflow-y-auto pb-1">
          <button v-if="showFav" class="gp-row" @click="preferences.toggleFavorite(family)">
            <Star :size="15" class="text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate">最愛</span>
            <CircleCheck v-if="preferences.isFavorite(family)" :size="18" class="shrink-0 fill-primary text-primary-foreground" />
            <Circle v-else :size="18" class="shrink-0 text-muted-foreground/60" />
          </button>
          <button v-for="g in matches" :key="g.id" class="gp-row" @click="preferences.toggleFamilyInGroup(g.id, family)">
            <ListMusic :size="15" class="text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate">{{ g.name }}</span>
            <CircleCheck v-if="g.families.includes(family)" :size="18" class="shrink-0 fill-primary text-primary-foreground" />
            <Circle v-else :size="18" class="shrink-0 text-muted-foreground/60" />
          </button>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Circle, CircleCheck, ListMusic, ListPlus, Plus, Star } from '@lucide/vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { usePreferencesStore } from '@/stores/preferencesStore'

const props = defineProps<{ family: string }>()
const preferences = usePreferencesStore()

const open = ref(false)
const query = ref('')
watch(open, (now) => now && (query.value = ''))

const needle = computed(() => query.value.trim().toLowerCase())
const matches = computed(() =>
  preferences.prefs.fontGroups.filter((g) => g.name.toLowerCase().includes(needle.value)),
)
const showFav = computed(() => '最愛'.includes(needle.value))
const exact = computed(() => preferences.prefs.fontGroups.find((g) => g.name === query.value.trim()))

function onEnter() {
  if (exact.value) preferences.toggleFamilyInGroup(exact.value.id, props.family)
  else if (query.value.trim() && !matches.value.length) create()
}

/** A group made from here arrives with this family already in it. */
function create() {
  const id = preferences.createFontGroup(query.value.trim() || '新群組')
  query.value = ''
  preferences.toggleFamilyInGroup(id, props.family)
}
</script>

<style scoped>
.row-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.625rem;
  padding: 0 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: var(--background);
  font-size: 0.75rem;
  white-space: nowrap;
}
.row-btn:hover,
.row-btn[data-state='open'] {
  background: var(--secondary);
}
</style>

<style>
/* Portalled out of the component, so the scoped block does not reach it. */
.group-picker {
  z-index: 50;
  width: 16rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.group-picker .gp-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  text-align: left;
}
.group-picker .gp-row:hover {
  background: var(--secondary);
}
</style>
