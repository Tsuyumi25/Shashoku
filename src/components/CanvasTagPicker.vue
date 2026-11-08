<template>
  <PopoverRoot :open="at !== null" @update:open="(v) => !v && emit('close')">
    <PopoverAnchor :reference="anchor" />
    <PopoverPortal>
      <PopoverContent
        class="tag-picker"
        side="bottom"
        align="start"
        :side-offset="2"
        :collision-padding="8"
        @open-auto-focus.prevent="list?.focus()"
      >
        <TagPickerList ref="list" :targets="targets" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui'
import TagPickerList from '@/components/TagPickerList.vue'
import { useEditorStore } from '@/stores/editorStore'

/** The tags of every sentence the selection reaches, opened where the object menu was. */
const props = defineProps<{ at: { x: number; y: number } | null }>()
const emit = defineEmits<{ close: [] }>()

const editor = useEditorStore()
const list = useTemplateRef<InstanceType<typeof TagPickerList>>('list')

const anchor = computed(() => {
  const { x, y } = props.at ?? { x: 0, y: 0 }
  return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) }
})

const targets = computed(() => editor.sentencesOf(editor.selectedIds))
</script>
