<template>
  <div class="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-xs">
    <template v-if="tagState.kind === 'one'">
      <span v-for="tag in tagState.value" :key="tag" class="flex min-w-0 items-center gap-1">
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          :style="{ backgroundColor: tagColor(tag, project.header.tags) }"
        />
        <span class="min-w-0 truncate font-medium">{{ tag }}</span>
      </span>
      <span v-if="tagState.value.length === 0" class="text-muted-foreground">
        未標記
      </span>
    </template>
    <span v-else-if="tagState.kind === 'many'" class="text-muted-foreground">
      標記不一致
    </span>
  </div>

  <div class="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
    <StyleEditor
      :value="representative"
      :mixed="mixedFields"
      @preview="(patch) => editor.previewStyle(targets, patch)"
      @patch="onPatch"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TextLayerEntry } from '@shared/page/types'
import type { TextStyle } from '@shared/text-style/types'
import { TEXT_STYLE_FIELDS } from '@shared/text-style/schema'
import { sharedValue } from '@shared/batch/value'
import { tagColor } from '@shared/tags/set'
import StyleEditor from '@/components/StyleEditor.vue'
import { useSelectionTags } from '@/composables/useSelectionTags'
import type { AppearanceTarget } from '@/lib/appearance'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * What a selection of text objects can be adjusted about: how the text is set,
 * and what it means.
 *
 * How a disagreement is drawn is decided here rather than by whoever handed the
 * selection over. Which fields disagree is mechanical and the same question
 * everywhere; what to show for one is an interface decision, and this consumer
 * shows the field itself saying it has no single answer.
 */
const props = defineProps<{ targets: readonly AppearanceTarget<TextLayerEntry>[] }>()

const editor = useEditorStore()
const project = useProjectStore()

const targets = computed(() => props.targets)
const tagState = useSelectionTags(targets)

const styles = computed(() =>
  props.targets.map((t) => t.entry.body.style),
)

/**
 * One member's style, standing for the selection. Only the fields everyone
 * agrees on are ever shown from it — `mixedFields` names the rest, and the
 * editor draws those as having no single answer.
 */
const representative = computed(() => styles.value[0]!)

const mixedFields = computed(() =>
  TEXT_STYLE_FIELDS.filter((field) => sharedValue(styles.value, field).kind === 'many'),
)

function onPatch(patch: Partial<TextStyle>) {
  editor.cmdApplyStyle(props.targets, patch)
}
</script>
