<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger
      class="tag-trigger"
      title="標記"
      :disabled="disabled"
      @pointerdown.stop
      @mousedown.stop
      @dblclick.stop
      @keydown.enter.stop
    >
      <Tag :size="12" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="tag-picker" side="bottom" align="end" :side-offset="4" :collision-padding="8">
        <TagPickerList :targets="targets" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Tag } from '@lucide/vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import TagPickerList from '@/components/TagPickerList.vue'
import type { LabelRow } from '@/lib/labelRows'
import { rowSelected } from '@/lib/labelRows'
import { useEditorStore } from '@/stores/editorStore'

const props = defineProps<{ row: LabelRow; disabled: boolean }>()

const editor = useEditorStore()

const open = ref(false)

/** A row inside the selection speaks for the whole selection; any other row for itself. */
const targets = computed(() => {
  const own = { pageId: props.row.pageId, unitId: props.row.unit.id }
  if (!rowSelected(props.row, editor.selectedIds)) return [own]
  const picked = editor.sentencesOf(editor.selectedIds)
  return picked.some((t) => t.pageId === own.pageId && t.unitId === own.unitId) ? picked : [own, ...picked]
})
</script>

<style scoped>
.tag-trigger {
  display: flex;
  height: 1.25rem;
  width: 1.25rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.tag-trigger:hover:not(:disabled),
.tag-trigger[data-state='open'] {
  background: var(--secondary);
  color: var(--foreground);
}
.tag-trigger:disabled {
  opacity: 0.3;
}
</style>
