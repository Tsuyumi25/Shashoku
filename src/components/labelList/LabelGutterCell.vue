<template>
  <div
    class="gutter-cell border-b border-border/40 pt-1 pr-1 text-right text-xs text-muted-foreground tabular-nums select-none"
    :class="selected && 'bg-accent/50'"
  >{{ row.kind === 'block' ? '' : (row.depth ?? '') }}</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { rowSelected, type ListRow } from '@/lib/labelRows'
import { useEditorStore } from '@/stores/editorStore'

const props = defineProps<{ row: ListRow }>()

const editor = useEditorStore()

const selected = computed(() => rowSelected(props.row, editor.selectedIds))
</script>

<style scoped>
.gutter-cell {
  grid-column: 2;
}
</style>
