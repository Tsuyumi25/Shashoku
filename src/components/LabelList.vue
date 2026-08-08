<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-7 shrink-0 items-center gap-1.5 border-b border-border px-2">
      <Search :size="12" class="shrink-0 text-muted-foreground" />
      <input
        ref="searchEl"
        v-model="query"
        spellcheck="false"
        placeholder="搜尋譯文"
        class="min-w-0 flex-1 bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground/50"
        @keydown="onSearchKey"
      />
      <button
        v-if="query.length > 0"
        type="button"
        class="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
        title="清除搜尋"
        @click="query = ''"
      >
        <X :size="12" />
      </button>
    </div>

  <!--
    Every row rendered, not a window onto them. A chapter's translations are
    hundreds of rows, not an unbounded feed, and dragging needs the real list:
    a virtualizer positions rows absolutely and swaps them under the pointer,
    which is exactly what Sortable measures against.
  -->
  <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto">
    <div v-if="rows.length === 0" class="px-2 py-4 text-center text-xs text-muted-foreground">
      {{ emptyNote }}
    </div>

    <template v-for="group in pageGroups" :key="group.page.key">
      <div
        tabindex="0"
        :data-page-id="group.page.filename"
        class="flex items-baseline gap-2 border-y border-border px-2 py-1 select-none focus:ring-1 focus:ring-inset focus:ring-primary focus:outline-none"
        :class="[
          group.page.filename === editor.currentFilename && 'text-foreground',
          isHere(group.page) ? 'bg-accent/50' : 'bg-secondary/60 hover:bg-secondary',
        ]"
        @mousedown="editor.showPage(group.page.filename)"
      >
        <span class="min-w-0 truncate text-xs font-medium">{{ group.page.filename }}</span>
        <span class="ml-auto shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">
          {{ group.page.count }}
        </span>
      </div>

      <!--
        Two columns that are not two subtrees pretending to line up: both the
        gutter and the list disappear from the layout, so their children become
        cells of this one grid and the nth number shares a row with the nth
        translation. Row height then follows the translation, as it must, and
        nothing has to be measured for the two to agree.
      -->
      <div class="page-body">
        <div class="gutter">
          <div
            v-for="row in group.rows"
            :key="row.key"
            class="gutter-cell border-b border-border/40 pt-1 pr-1 text-right text-xs text-muted-foreground tabular-nums select-none"
            :class="isSelected(row) && 'bg-accent/50'"
          >{{ row.index }}</div>
        </div>

        <Draggable
          :model-value="group.rows"
          item-key="key"
          :group="LABEL_GROUP"
          :disabled="filtering"
          :class="group.rows.length === 0 ? 'rows-empty' : 'rows'"
          @change="onChanged(group, $event)"
        >
          <template #item="{ element }">
            <div
              tabindex="0"
              :data-row-id="(element as LabelRow).label.id"
              class="row-content flex min-w-0 items-start gap-1.5 border-b border-border/40 py-1 pr-2 pl-1.5 focus:ring-1 focus:ring-inset focus:ring-primary focus:outline-none"
              :class="[
                isSelected(element as LabelRow) ? 'bg-accent/50' : 'hover:bg-secondary/40',
                !isEditing(element as LabelRow) && 'select-none',
                !isEditing(element as LabelRow) && !filtering && 'cursor-grab',
              ]"
              @mousedown="onPick(element as LabelRow, $event)"
              @dblclick="onEdit(element as LabelRow)"
              @keydown="onRowKey(element as LabelRow, $event)"
            >
              <!--
                Unlike visibility, a lock is worth showing on a flat list: it
                says this row will refuse, which is otherwise only discoverable
                by trying to type into it. Where the lock was put on is the
                tree's to answer.
              -->
              <Lock
                v-if="isRowLocked(element as LabelRow)"
                :size="11"
                class="mt-1 shrink-0 text-muted-foreground/60"
                aria-label="已鎖定"
              />

              <!--
                The translation keeps the full width and what the object means
                goes underneath it. A tag is a string of the user's own length,
                and a column that shared a line with one would give the row's
                whole point away to a name.
              -->
              <div class="flex min-w-0 flex-1 flex-col">
                <textarea
                  v-if="isEditing(element as LabelRow)"
                  :ref="takeFocus"
                  rows="1"
                  spellcheck="false"
                  placeholder="(未翻譯)"
                  class="label-input w-full resize-none bg-transparent text-sm leading-snug focus:outline-none placeholder:text-muted-foreground/50"
                  :value="textOf((element as LabelRow).label)"
                  @input="onInput(element as LabelRow, $event)"
                  @keydown="onInputKey($event)"
                  @blur="onInputBlur(element as LabelRow)"
                />
                <span
                  v-else
                  class="text-sm leading-snug whitespace-pre-wrap"
                  :class="isBlank(element as LabelRow) && 'text-muted-foreground/50'"
                >{{ preview(element as LabelRow) }}</span>

                <div
                  v-if="(element as LabelRow).label.tags.length > 0"
                  class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground"
                >
                  <span
                    v-for="tag in orderedTags((element as LabelRow).label.tags)"
                    :key="tag"
                    class="flex min-w-0 items-center gap-1"
                  >
                    <span
                      class="h-1.5 w-1.5 shrink-0 rounded-full"
                      :style="{ backgroundColor: tagColor(tag, project.header.tags) }"
                    />
                    <span class="min-w-0 truncate">{{ tag }}</span>
                  </span>
                </div>
              </div>
            </div>
          </template>
        </Draggable>
      </div>
    </template>
  </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Lock, Search, X } from '@lucide/vue'
import Draggable from 'vuedraggable'
import { textOf } from '@shared/page/text'
import { tagColor, tagsInRegistryOrder } from '@shared/tags/set'
import {
  buildLabelRows,
  dropAt,
  type ChapterRow,
  type LabelRow,
  type PageRow,
} from '@/lib/labelRows'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useEventListener } from '@vueuse/core'
import { ownsKeyboard } from '@/lib/editContext'

const project = useProjectStore()
const editor = useEditorStore()

/**
 * The whole chapter, not the open page. Translating and proofreading are read
 * at that scale — which is also what makes selecting across pages fall out of
 * this list rather than needing anything of its own.
 */
const rows = computed(() => buildLabelRows(project.files, editor.labelQuery))

/**
 * Narrowing lives in the store because moving up and down walks what is on
 * screen, and only the store is asked to do that.
 */
const query = computed({
  get: () => editor.labelQuery,
  set: (value: string) => {
    editor.labelQuery = value
  },
})
const filtering = computed(() => query.value.trim().length > 0)

const emptyNote = computed(() => {
  if (!project.isOpen) return '尚未開啟專案'
  return filtering.value ? '沒有符合的譯文' : '本章沒有頁面'
})

/**
 * The chapter folded into pages, since each page's translations are one another's
 * siblings and a drag rearranges siblings. A heading is no longer one of them —
 * it stands outside the lists entirely, which is why nothing has to be told to
 * leave it alone any more.
 */
const pageGroups = computed(() => {
  const out: { page: PageRow; rows: LabelRow[] }[] = []
  for (const row of rows.value) {
    if (row.kind === 'page') out.push({ page: row, rows: [] })
    else out[out.length - 1]?.rows.push(row)
  }
  return out
})

/** What a range reaches over, in the order the panel is showing it. */
const sequence = computed(() =>
  rows.value.filter((r): r is LabelRow => r.kind === 'label').map((r) => r.label.id),
)

const scrollEl = ref<HTMLElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)

/** Its own lock or a folder's above it, which this list has no way to tell apart. */
function isRowLocked(row: LabelRow): boolean {
  return editor.isLayerLocked(row.label.id)
}

function isSelected(row: LabelRow): boolean {
  return editor.isSelected(row.label.id)
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

/**
 * One list per page, all sharing this — which is what lets a translation be
 * dragged out of one page and into another.
 */
const LABEL_GROUP = { name: 'labels' }

/**
 * Where a translation came to rest, read off the page that received it.
 *
 * Both a move inside a page and an arrival from another one are the same
 * question once the receiving page's list is rebuilt: what ends up above it.
 * Nothing above means the head of the page — which is also the answer for a
 * page with nothing on it, since its heading is what stands there instead.
 *
 * Only the arrival is listened to. The page it left fires its own event for the
 * same gesture, and acting on both would put two entries on the undo stack for
 * one move.
 *
 * One row at a time, as in the layer tree. Carrying a whole selection is a
 * capability neither panel has, and having it here alone would make the same
 * gesture mean different things in two lists side by side.
 */
function onChanged(
  group: { page: PageRow; rows: LabelRow[] },
  evt: {
    moved?: { element: LabelRow; oldIndex: number; newIndex: number }
    added?: { element: LabelRow; newIndex: number }
  },
) {
  const change = evt.moved ?? evt.added
  if (!change) return

  const next = [...group.rows]
  if (evt.moved) next.splice(evt.moved.oldIndex, 1)
  next.splice(change.newIndex, 0, change.element)

  const target = dropAt(next[change.newIndex - 1] ?? group.page, true)
  editor.moveObjectsTo([change.element.label.id], target.page, target.index)
}

/**
 * Escape hands the list back rather than undoing the search. Narrowing is
 * something looked at, not a layer to back out of — the cross is what ends it,
 * and it is on screen the whole time it is in force.
 */
function onSearchKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.preventDefault()
  const first = rows.value.find((r): r is LabelRow => r.kind === 'label')
  if (first === undefined) return
  editor.revealLabel(first.filename, first.label.id)
  void nextTick(() => focusIn(`[data-row-id="${CSS.escape(first.label.id)}"]`))
}

useEventListener(window, 'keydown', (e) => {
  const wants = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f'
  if (!wants && !(e.key === '/' && !ownsKeyboard(document.activeElement))) return
  e.preventDefault()
  searchEl.value?.focus()
  searchEl.value?.select()
})

/**
 * A blur ends the visit only while the visit is still this row's.
 *
 * Carrying the caret to the next row closes this session and opens that one,
 * which unmounts this input — and unmounting something focused blurs it. Left
 * unguarded, that blur would close the session just opened for the row being
 * moved to, and the caret would arrive with nothing to type into.
 */
function onInputBlur(row: LabelRow) {
  if (!isEditing(row)) return
  editor.commitTextEdit()
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
  if (editor.isLayerLocked(row.label.id)) return
  project.updateLabelText(row.filename, row.label.id, (e.target as HTMLTextAreaElement).value)
}

/**
 * Selecting on the canvas has to bring the list to the object, or the two stop
 * being about the same thing. A row already on screen is left where it is,
 * which is what keeps clicking a row from scrolling under the pointer.
 *
 * It runs on arrival as well as on every move, because the list shares its
 * column with the tree now and is built afresh each time it is switched back
 * to — a list that only caught later moves would come back scrolled to the top
 * with the cursor pages away.
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

    await nextTick()
    scrollEl.value
      ?.querySelector<HTMLElement>(selector)
      ?.scrollIntoView({ block: 'nearest' })
    if (held && editor.pendingTextEdit === null) {
      await nextTick()
      focusIn(selector)
    }
  },
  { immediate: true },
)

function orderedTags(tags: readonly string[]): string[] {
  return tagsInRegistryOrder(tags, project.header.tags)
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

/*
 * The gutter and the list both vanish from the layout, so their children are
 * cells of this grid rather than of two separate boxes — which is what makes a
 * number and a translation share a row without either being measured.
 *
 * Dense packing because every number is laid down before the first translation:
 * the sparse cursor only ever moves forward, so each translation would land
 * below the last number instead of beside the first.
 */
.page-body {
  display: grid;
  grid-template-columns: 1.5rem 1fr;
  grid-auto-flow: row dense;
}
.gutter,
.page-body :deep(.rows) {
  display: contents;
}
.gutter-cell {
  grid-column: 1;
}
.row-content {
  grid-column: 2;
}

/*
 * A page with nothing on it has no children to hand Sortable a shape to aim at,
 * so this one keeps a box of its own.
 */
.page-body :deep(.rows-empty) {
  grid-column: 2;
  min-height: 1.5rem;
}
</style>
