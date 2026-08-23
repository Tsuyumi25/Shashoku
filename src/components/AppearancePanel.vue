<template>
  <div class="h-full min-h-0 overflow-y-auto p-2">
    <template v-if="kind !== 'none'">
      <div class="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <span class="min-w-0 truncate text-xs text-muted-foreground">{{ scopeLine }}</span>
      </div>

      <p v-if="scope.offPage" class="mb-1.5 px-0.5 text-[10px] text-amber-500">
        其中有不在目前頁面的物件
      </p>

      <CommonAppearance :targets="targets" />

      <div v-if="kind === 'mixed'" class="mt-2 px-0.5 text-[10px] text-muted-foreground/60">
        選取的種類不同,只有共通的能一起調
      </div>

      <template v-else-if="kind === 'text'">
        <div class="mt-2 border-t border-border pt-2">
          <TextAppearance :targets="textTargets" />
        </div>
      </template>

      <template v-else-if="kind === 'raster'">
        <div class="mt-2 border-t border-border pt-2">
          <LayerAppearance :targets="rasterTargets" />
        </div>
      </template>
    </template>

    <p v-else class="px-0.5 text-xs text-muted-foreground">未選取物件</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RasterLayerEntry, TextLayerEntry } from '@shared/page/types'
import CommonAppearance from '@/components/appearance/CommonAppearance.vue'
import LayerAppearance from '@/components/appearance/LayerAppearance.vue'
import TextAppearance from '@/components/appearance/TextAppearance.vue'
import type { AppearanceTarget } from '@/lib/appearance'
import { scopeText } from '@/lib/appearanceText'
import { useEditorStore } from '@/stores/editorStore'

/**
 * One panel over whatever is selected, and the only thing it decides is who the
 * selection goes to.
 *
 * It knows no fields. What it reads off a node is `kind` and nothing else, so
 * adding a control to one consumer is an edit inside that consumer — which is
 * the whole reason the split is here rather than a `v-if` per field inside one
 * long panel.
 *
 * A folder falls through to the shared section alone, and so does a mixture,
 * for different reasons: one is a kind with nothing of its own to adjust yet,
 * the other is a selection that disagrees about what it holds. Only the second
 * is worth saying out loud.
 *
 * ⚠️ No `key` anywhere below. A consumer is remounted when the kind changes and
 * left alone when it does not — so extending the selection while a number is
 * half typed leaves the caret where it was, rather than rebuilding the field
 * under the hand.
 */
const editor = useEditorStore()

const targets = computed(() => editor.selectedNodes())
const kind = computed(() => editor.appearanceKind)
const scope = computed(() => editor.batchScope)

const scopeLine = computed(() => scopeText(scope.value))

/**
 * Narrowed once, here, because the kind has already been decided — a consumer
 * that had to re-ask what its own targets are would be answering the question
 * this panel exists to answer.
 */
const textTargets = computed(() =>
  targets.value.filter((t): t is AppearanceTarget<TextLayerEntry> => t.entry.kind === 'text'),
)

const rasterTargets = computed(() =>
  targets.value.filter((t): t is AppearanceTarget<RasterLayerEntry> => t.entry.kind === 'raster'),
)
</script>
