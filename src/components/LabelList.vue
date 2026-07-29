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
          tabindex="0"
          :data-page-id="rows[vrow.index].filename"
          class="flex items-baseline gap-2 border-y border-border px-2 py-1 select-none focus:ring-1 focus:ring-inset focus:ring-primary focus:outline-none"
          :class="[
            rows[vrow.index].filename === editor.currentFilename && 'text-foreground',
            isHere(rows[vrow.index]) ? 'bg-accent/50' : 'bg-secondary/60 hover:bg-secondary',
          ]"
          @mousedown="editor.selectFile(rows[vrow.index].filename)"
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
          tabindex="0"
          :data-row-id="(rows[vrow.index] as LabelRow).label.id"
          class="flex items-start gap-1.5 border-b border-border/40 px-2 py-1 focus:ring-1 focus:ring-inset focus:ring-primary focus:outline-none"
          :class="[
            isSelected(rows[vrow.index] as LabelRow) ? 'bg-accent/50' : 'hover:bg-secondary/40',
            !isEditing(rows[vrow.index] as LabelRow) && 'select-none',
          ]"
          @mousedown="onPick(rows[vrow.index] as LabelRow, $event)"
          @dblclick="onEdit(rows[vrow.index] as LabelRow)"
          @keydown="onRowKey(rows[vrow.index] as LabelRow, $event)"
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
            v-if="isEditing(rows[vrow.index] as LabelRow)"
            :ref="takeFocus"
            rows="1"
            spellcheck="false"
            placeholder="(未翻譯)"
            class="label-input min-w-0 flex-1 resize-none bg-transparent text-sm leading-snug focus:outline-none placeholder:text-muted-foreground/50"
            :value="textOf((rows[vrow.index] as LabelRow).label)"
            @input="onInput(rows[vrow.index] as LabelRow, $event)"
            @keydown="onInputKey($event)"
            @blur="editor.commitTextEdit()"
          />
          <span
            v-else
            class="min-w-0 flex-1 text-sm leading-snug whitespace-pre-wrap"
            :class="isBlank(rows[vrow.index] as LabelRow) && 'text-muted-foreground/50'"
          >{{ preview(rows[vrow.index] as LabelRow) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { textOf } from '@shared/page/text'
import { buildLabelRows, type ChapterRow, type LabelRow, type PageRow } from '@/lib/labelRows'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

/**
 * The whole chapter, not the open page. Translating and proofreading are read
 * at that scale — which is also what makes selecting across pages fall out of
 * this list rather than needing anything of its own.
 */
const rows = computed(() => buildLabelRows(project.files))

/** What a range reaches over, in the order the panel is showing it. */
const sequence = computed(() =>
  rows.value.filter((r): r is LabelRow => r.kind === 'label').map((r) => r.label.id),
)

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

/**
 * A page with nothing on it is still somewhere the cursor can be. Walking onto
 * one leaves no object to stand on, so its heading takes the position instead —
 * otherwise the highlight stays behind on the page just left, pointing at an
 * object that is no longer where anyone is.
 */
function isHere(row: ChapterRow): boolean {
  return row.filename === editor.currentFilename && editor.cursorId === null
}

/**
 * A row is being typed into when the editing session names it. There is no
 * second flag for "this row is in the input layer" — the session is that state,
 * and holding it in two places is how the two drift apart.
 */
function isEditing(row: LabelRow): boolean {
  const pending = editor.pendingTextEdit
  return pending?.filename === row.filename && pending?.labelId === row.label.id
}

function isBlank(row: LabelRow): boolean {
  return row.label.lines.every((line) => line.length === 0)
}

function preview(row: LabelRow): string {
  return isBlank(row) ? '(未翻譯)' : textOf(row.label)
}

/** Focus follows the input into being, so Enter lands the caret without a click. */
function takeFocus(el: unknown) {
  if (el instanceof HTMLTextAreaElement && document.activeElement !== el) el.focus()
}

function focusIn(selector: string) {
  scrollEl.value?.querySelector<HTMLElement>(selector)?.focus()
}

function onPick(row: LabelRow, e: MouseEvent) {
  if (isEditing(row)) return
  if (e.shiftKey) editor.extendSelectionTo(row.label.id, sequence.value)
  else if (e.ctrlKey || e.metaKey) editor.toggleSelected(row.label.id)
  else editor.revealLabel(row.filename, row.label.id)
}

function onEdit(row: LabelRow) {
  editor.revealLabel(row.filename, row.label.id)
  editor.beginTextEdit(row.filename, row.label.id, textOf(row.label))
}

/**
 * The keys a row answers to itself. Everything else — moving between rows,
 * deleting, turning the page — acts on the document and is handled once, above.
 */
function onRowKey(row: LabelRow, e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key !== 'Enter' && e.key !== 'i') return
  // Opening the input layer is a single-object act. Rather than quietly
  // throwing away a selection someone built on purpose, it declines.
  if (editor.selectedIds.size > 1) return
  e.preventDefault()
  onEdit(row)
}

function onInputKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    const id = editor.pendingTextEdit?.labelId ?? null
    editor.commitTextEdit()
    if (id !== null) void nextTick(() => focusIn(`[data-row-id="${CSS.escape(id)}"]`))
    return
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    editor.editBy(e.shiftKey ? -1 : 1)
  }
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
    if (filename === null) return
    const index =
      labelId === null
        ? rows.value.findIndex((r) => r.kind === 'page' && r.filename === filename)
        : rows.value.findIndex(
            (r) => r.kind === 'label' && r.filename === filename && r.label.id === labelId,
          )
    if (index === -1) return
    const selector =
      labelId === null
        ? `[data-page-id="${CSS.escape(filename)}"]`
        : `[data-row-id="${CSS.escape(labelId)}"]`

    // Focus goes where the cursor went, but only while the list is the thing
    // being used: keys are dispatched by what they act on, so moving the cursor
    // from here would otherwise leave focus on the row left behind, and the
    // next Enter would open a row nobody is looking at.
    const held = scrollEl.value?.contains(document.activeElement) ?? false

    if (!virtualRows.value.some((v) => v.index === index)) {
      await nextTick()
      virtualizer.value.scrollToIndex(index, { align: 'center' })
    }
    if (held && editor.pendingTextEdit === null) {
      await nextTick()
      focusIn(selector)
    }
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
