<template>
  <div class="h-full min-h-0 overflow-y-auto p-2">
    <template v-if="representative">
      <div class="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <span class="min-w-0 truncate text-xs text-muted-foreground">{{ scopeText }}</span>
      </div>

      <p v-if="scope.offPage" class="mb-1.5 px-0.5 text-[10px] text-amber-500">
        其中有不在目前頁面的物件
      </p>

      <StyleEditor :value="representative" :mixed="mixedFields" @patch="onStylePatch" />

      <div
        v-if="batchedFields.length > 0"
        class="mt-2 border-t border-border pt-1.5 text-[10px] text-muted-foreground"
      >
        <div v-for="line in batchedFields" :key="line.field" class="truncate">
          {{ line.text }}
        </div>
      </div>
    </template>

    <p v-else class="px-0.5 text-xs text-muted-foreground">未選取標籤</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TextStyle } from '@shared/text-style/types'
import { TEXT_STYLE_FIELDS } from '@shared/text-style/schema'
import { provenanceTally, sharedValue } from '@shared/text-style/batch'
import StyleEditor from '@/components/StyleEditor.vue'
import { TEXT_STYLE_FIELD_NAMES, batchLabelFor } from '@/lib/textStyleFields'
import { useEditorStore } from '@/stores/editorStore'

const editor = useEditorStore()

const targets = computed(() => editor.selectedTextObjects())
const scope = computed(() => editor.batchScope)

/**
 * One member's style, standing for the selection. Only the fields everyone
 * agrees on are ever shown from it — `mixedFields` names the rest, and the
 * editor draws those as having no single answer.
 */
const representative = computed<TextStyle | null>(() => targets.value[0]?.label.style ?? null)

const mixedFields = computed(() => {
  const styles = targets.value.map((t) => t.label.style)
  return TEXT_STYLE_FIELDS.filter((field) => sharedValue(styles, field).kind === 'many')
})

/**
 * A selection reaches across pages and most of it may be somewhere nobody can
 * see, so an edit about to change forty objects on six pages says so before
 * anyone touches a control.
 */
const scopeText = computed(() => {
  const { objects, pages } = scope.value
  if (objects === 1) return '1 個物件'
  return pages > 1 ? `${objects} 個物件、${pages} 頁` : `${objects} 個物件`
})

/**
 * Which batches left their mark on this selection, per field. Deliberately
 * shown rather than acted on: it explains why a bunch agrees without becoming
 * part of what makes them a bunch.
 */
const batchedFields = computed(() => {
  const provenances = targets.value.map((t) => t.label.provenance)
  const lines: { field: string; text: string }[] = []
  for (const field of TEXT_STYLE_FIELDS) {
    const tally = provenanceTally(provenances, field)
    for (const [label, count] of tally) {
      lines.push({
        field: `${field}:${label}`,
        text: `${TEXT_STYLE_FIELD_NAMES[field]}:${count} 個來自「${label}」`,
      })
    }
  }
  return lines
})

/**
 * One object edited by hand is a hand edit and leaves no note. Several at once
 * is a batch, and every field it wrote carries its name afterwards.
 */
function onStylePatch(patch: Partial<TextStyle>) {
  const source = targets.value.length > 1 ? batchLabelFor(patch) : null
  editor.cmdApplyStyleToSelection(patch, source)
}
</script>
