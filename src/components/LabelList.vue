<template>
  <div ref="scrollEl" class="h-full min-h-0 overflow-y-auto">
    <div v-if="rows.length === 0" class="px-2 py-4 text-center text-xs text-muted-foreground">
      {{ project.isOpen ? '本章沒有頁面' : '尚未開啟專案' }}
    </div>

    <div v-else class="relative w-full" :style="{ height: `${totalSize}px` }">
      <div
        v-for="vrow in virtualRows"
        :key="rows[vrow.index].key"
        :ref="measureRow"
        :data-index="vrow.index"
        class="absolute top-0 left-0 w-full"
        :style="{ transform: `translateY(${vrow.start}px)` }"
      >
        <div
          v-if="rows[vrow.index].kind === 'page'"
          class="flex items-baseline gap-2 border-y border-border bg-secondary/60 px-2 py-1 select-none"
          :class="[rows[vrow.index].filename === editor.currentFilename && 'text-foreground']"
        >
          <span class="min-w-0 truncate text-xs font-medium">
            {{ rows[vrow.index].filename }}
          </span>
          <span class="ml-auto shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">
            {{ (rows[vrow.index] as PageRow).count }}
          </span>
        </div>

        <div
          v-else
          class="flex items-start gap-1.5 border-b border-border/40 px-2 py-1"
          :class="[isSelected(rows[vrow.index] as LabelRow) ? 'bg-accent/50' : 'hover:bg-secondary/40']"
          @mousedown="onPick(rows[vrow.index] as LabelRow)"
        >
          <span class="w-5 shrink-0 pt-0.5 text-right text-xs text-muted-foreground tabular-nums">
            {{ (rows[vrow.index] as LabelRow).index }}
          </span>
          <span
            class="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            :style="{ backgroundColor: colorOf((rows[vrow.index] as LabelRow).label.groupId) }"
            :title="nameOf((rows[vrow.index] as LabelRow).label.groupId)"
          />
          <textarea
            rows="1"
            spellcheck="false"
            placeholder="(未翻譯)"
            class="label-input min-w-0 flex-1 resize-none bg-transparent text-sm leading-snug focus:outline-none placeholder:text-muted-foreground/50"
            :value="textOf((rows[vrow.index] as LabelRow).label)"
            @focus="onFocus(rows[vrow.index] as LabelRow)"
            @input="onInput(rows[vrow.index] as LabelRow, $event)"
            @blur="editor.commitTextEdit()"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { textOf } from '@shared/page/text'
import { buildLabelRows, type LabelRow, type PageRow } from '@/lib/labelRows'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

/**
 * The whole chapter, not the open page. Translating and proofreading are read
 * at that scale — which is also what makes multi-page selection fall out of
 * this list rather than needing anything of its own.
 */
const rows = computed(() => buildLabelRows(project.files))

const scrollEl = ref<HTMLElement | null>(null)

// Rows are as tall as the translation in them, so the estimate is only a
// starting point and measureElement corrects each one as it renders.
const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => 30,
    overscan: 8,
  })),
)
const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

function measureRow(el: unknown) {
  if (el instanceof HTMLElement) virtualizer.value.measureElement(el)
}

function isSelected(row: LabelRow): boolean {
  return row.filename === editor.currentFilename && editor.isSelected(row.label.id)
}

function onPick(row: LabelRow) {
  editor.revealLabel(row.filename, row.label.id)
}

function onFocus(row: LabelRow) {
  editor.revealLabel(row.filename, row.label.id)
  editor.beginTextEdit(row.filename, row.label.id, textOf(row.label))
}

/**
 * Typing writes through so the canvas keeps up; what enters the undo stack is
 * the whole visit to this row, closed by whatever takes the caret away.
 */
function onInput(row: LabelRow, e: Event) {
  project.updateLabelText(row.filename, row.label.id, (e.target as HTMLTextAreaElement).value)
}

/**
 * Selecting on the canvas has to bring the list to the object, or the two stop
 * being about the same thing. A row already on screen is left where it is,
 * which is what keeps clicking a row from scrolling under the pointer.
 */
watch(
  () => [editor.currentFilename, editor.cursorId] as const,
  async ([filename, labelId]) => {
    if (filename === null || labelId === null) return
    const index = rows.value.findIndex(
      (r) => r.kind === 'label' && r.filename === filename && r.label.id === labelId,
    )
    if (index === -1) return
    if (virtualRows.value.some((v) => v.index === index)) return
    await nextTick()
    virtualizer.value.scrollToIndex(index, { align: 'center' })
  },
)

function colorOf(groupId: string | null): string {
  if (!groupId) return 'rgb(128, 128, 128)'
  return project.header.groups.find((g) => g.id === groupId)?.color ?? 'rgb(128, 128, 128)'
}

function nameOf(groupId: string | null): string {
  if (!groupId) return '未分組'
  return project.header.groups.find((g) => g.id === groupId)?.name ?? '未分組'
}
</script>

<style scoped>
/*
 * The row grows with the translation instead of scrolling inside a fixed box:
 * a line the writer cannot see is a line they cannot check.
 */
.label-input {
  field-sizing: content;
}
</style>
