<template>
  <div data-region="list" class="flex h-full min-h-0 flex-col">
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

    <!--
      Each page is wrapped so its heading sticks only while the page is under
      it: pinned to the top of the list while its rows scroll past, then carried
      off by its own page's end as the next heading arrives. The pinned layers
      ride in the heading, and this is what keeps them in reach without
      scrolling back up to them. Opaque, since rows pass underneath.
    -->
    <div v-for="group in pageGroups" :key="group.page.key" data-page-group>
      <div
        tabindex="0"
        :data-page-id="group.page.pageId"
        data-page-heading
        class="sticky top-0 z-10 flex items-center gap-2 border-y border-border px-2 py-1 select-none focus:ring-1 focus:ring-inset focus:ring-primary focus:outline-none"
        :class="[
          group.page.pageId === editor.currentPageId && 'text-foreground',
          isHere(group.page) ? 'heading-here' : 'heading-away',
        ]"
        @mousedown="turnFromHeading(group.page.pageId)"
      >
        <PageRowThumb v-if="fileOf(group.page.pageId)" :file="fileOf(group.page.pageId)!" />
        <div class="flex min-w-0 flex-1 flex-col gap-1 self-stretch overflow-hidden">
          <div class="flex min-w-0 items-center gap-2">
            <span class="shrink-0 text-xs text-muted-foreground tabular-nums"
              >第 {{ group.page.position }} 頁 · {{ group.page.pageId }}</span
            >
            <span class="min-w-0 truncate text-xs font-medium">{{ group.page.name }}</span>
            <span class="ml-auto shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">
              {{ group.page.count }}
            </span>
          </div>
          <PagePinnedLayers :page-id="group.page.pageId" />
        </div>
      </div>

      <!--
        Two columns that are not two subtrees pretending to line up: both the
        gutter and the list disappear from the layout, so their children become
        cells of this one grid and the nth number shares a row with the nth
        translation. Row height then follows the translation, as it must, and
        nothing has to be measured for the two to agree.
      -->
      <div class="page-body" :style="{ '--rail': `${group.rail}px` }">
        <!--
          The rail is where the reading is said out loud: a row it holds was put
          in its place by a line somebody drew, and a row below where it stops is
          only sitting where it was typed. Nothing marks that boundary, because
          the rail stopping is the boundary.
        -->
        <div v-if="group.rail > 0" class="rail">
          <div
            v-for="(row, at) in group.rows"
            :key="row.key"
            class="rail-cell border-b border-border/40 text-primary"
            :class="isSelected(row) && 'bg-accent/50'"
          >
            <span
              v-for="x in group.marks[at].through"
              :key="`through/${x}`"
              class="rail-line"
              :style="strokeAt(x, { top: '0', bottom: RAIL_OVERHANG })"
            />
            <span
              v-if="group.marks[at].arrives !== undefined"
              class="rail-line"
              :style="strokeAt(group.marks[at].arrives!, { top: '0', height: '50%' })"
            />
            <span
              v-if="group.marks[at].leaves !== undefined"
              class="rail-line"
              :style="strokeAt(group.marks[at].leaves!, { top: '50%', bottom: RAIL_OVERHANG })"
            />
            <svg
              v-if="group.marks[at].joins.length > 0"
              class="rail-join"
              :viewBox="`0 0 ${group.rail} 100`"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                v-for="[from, to] in group.marks[at].joins"
                :key="`join/${from}/${to}`"
                :d="`M ${from} 0 C ${from} 50, ${to} 50, ${to} 100`"
                vector-effect="non-scaling-stroke"
                fill="none"
                stroke="currentColor"
                :stroke-width="RAIL_STROKE"
              />
            </svg>
            <span
              v-if="group.marks[at].stops !== undefined"
              class="rail-stop"
              :style="{ left: `${group.marks[at].stops - 4.5}px` }"
            />
            <span
              v-if="group.marks[at].dot !== undefined"
              class="rail-dot"
              :style="{ left: `${group.marks[at].dot - 3.5}px` }"
            />
          </div>
        </div>

        <div class="gutter">
          <div
            v-for="row in group.rows"
            :key="row.key"
            class="gutter-cell border-b border-border/40 pt-1 pr-1 text-right text-xs text-muted-foreground tabular-nums select-none"
            :class="isSelected(row) && 'bg-accent/50'"
          >{{ row.kind === 'block' ? '' : (row.depth ?? '') }}</div>
        </div>

        <!--
          A row the rail holds refuses to be dragged: its place was said by a
          line, and a drag carries one position where the graph needs more than
          one — an object with two ways into it cannot say which of them a drop
          meant to keep, so it would quietly drop one. Rearranging is done by
          drawing and rubbing out lines. Rows below the rail have said nothing,
          so they stay free.
        -->
        <Draggable
          :model-value="group.rows"
          item-key="key"
          :group="LABEL_GROUP"
          :disabled="filtering"
          filter=".rail-held"
          :prevent-on-filter="false"
          :class="group.rows.length === 0 ? 'rows-empty' : 'rows'"
          @change="onChanged(group, $event)"
        >
          <!--
            ⚠️ The item slot below holds one element and nothing else — no
            sibling, no `v-if` at the top of it, and not even a comment. Every
            one of those is a child node, and vuedraggable refuses a slot with
            more than one. Which row was dragged is worked out by counting the
            children it was handed, so a second node is a row that does not
            exist. Anything that has to be said about a row is said in the
            dispatchers in the script, or here.
          -->
          <template #item="{ element }">
            <div
              tabindex="0"
              :data-row-id="rowId(element as Row)"
              class="row-content flex min-w-0 items-start gap-1.5 border-b border-border/40 py-1 pr-2 pl-1.5 focus:ring-1 focus:ring-inset focus:ring-primary focus:outline-none"
              :class="rowClass(element as Row)"
              :style="rowStyle(element as Row)"
              @mousedown="onRowDown(element as Row, $event)"
              @dblclick="onRowOpen(element as Row)"
              @contextmenu.prevent="onRowMenu(element as Row, $event)"
              @keydown="onRowKeys(element as Row, $event)"
            >
              <!--
                Unlike visibility, a lock is worth showing on a flat list: it
                says this row will refuse, which is otherwise only discoverable
                by trying to type into it. Where the lock was put on is the
                tree's to answer.
              -->
              <Lock
                v-if="isRowLocked(element as Row)"
                :size="11"
                class="mt-1 shrink-0 text-muted-foreground/60"
                aria-label="已鎖定"
              />

              <!--
                ⭐ A block of a split translation is a row like any other — same
                rule, same padding, same type. What tells it apart is one step of
                indent and its permanent name. A sentence row wears its own
                number the same way: the names an agent writes are the ones on
                screen.
              -->
              <span
                v-if="(element as Row).kind === 'block'"
                class="shrink-0 text-sm leading-snug text-muted-foreground/60 tabular-nums"
                >{{ (element as BlockRow).label }}</span
              >
              <span
                v-else-if="(element as Row).kind === 'label'"
                class="shrink-0 text-sm leading-snug text-muted-foreground/60 tabular-nums"
                >{{ (element as LabelRow).no }}</span
              >

              <!--
                The translation keeps the full width and what the object means
                goes underneath it. A tag is a string of the user's own length,
                and a column that shared a line with one would give the row's
                whole point away to a name.
              -->
              <div class="flex min-w-0 flex-1 flex-col">
                <!--
                  ⭐ The side being worked on is the row's main line, and the
                  other is the footnote above it — so switching sides swaps
                  which body is underneath, not merely which one takes the
                  caret. A row whose translation stayed on the bottom would go
                  on saying the translation is the point while every keystroke
                  went into the source.

                  A dash rather than nothing when the line above says nothing,
                  so every row keeps the same two-line rhythm and an empty body
                  is visible instead of merely absent.
                -->
                <span
                  v-if="(element as Row).kind === 'label'"
                  class="text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground"
                  :class="!asideText(element as LabelRow) && 'opacity-50'"
                >{{ asideText(element as LabelRow) || '—' }}</span>

                <CodeEditField
                  v-if="isRowEditing(element as Row)"
                  class="text-sm"
                  :value="rowCode(element as Row)"
                  :placeholder="blankLabel"
                  @key="onInputKey"
                  @blur="onRowBlur(element as Row, $event)"
                />

                <!--
                  ⭐ A translation set in several blocks draws none of it here:
                  the block rows below say the whole of it, and saying it twice
                  would cost the row a line of height for a line nobody needs.
                -->
                <pre
                  v-if="showsReading(element as Row)"
                  class="reading text-sm leading-snug whitespace-pre-wrap"
                  :class="isRowBlank(element as Row) && 'text-muted-foreground/50'"
                >{{ rowPreview(element as Row) }}<br v-if="rowEndsOnABreak(element as Row)" /></pre>

                <div
                  v-if="(element as Row).kind === 'label' && unitTags(element as LabelRow).length > 0"
                  class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground"
                >
                  <span
                    v-for="tag in orderedTags(unitTags(element as LabelRow))"
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
    </div>
  </div>
  <CanvasMenu :at="rowMenuAt" :items="ROW_MENU" @pick="onRowMenuPick" @close="closeRowMenu" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Lock, Search, X } from '@lucide/vue'
import Draggable from 'vuedraggable'
import CodeEditField from '@/components/CodeEditField.vue'
import CanvasMenu from '@/components/CanvasMenu.vue'
import { generateId } from '@shared/page/schema'
import PagePinnedLayers from '@/components/PagePinnedLayers.vue'
import PageRowThumb from '@/components/PageRowThumb.vue'
import { tagColor, tagsInRegistryOrder } from '@shared/tags/set'
import {
  dropAt,
  type BlockRow,
  type ChapterRow,
  type LabelRow,
  type PageRow,
} from '@/lib/labelRows'
import { RAIL_STROKE, railMarks, railWidth } from '@/lib/readingRail'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useEventListener } from '@vueuse/core'
import { ownsKeyboard } from '@/lib/typingSurface'
import { textWriter } from '@/composables/useTextEditSurface'
import { useMarkupSession } from '@/composables/useMarkupSession'
import { shownCodeOf } from '@shared/page/units'
import { lockedEntries } from '@shared/page/tree'
import { treeOf } from '@shared/page/trees'

const project = useProjectStore()
const editor = useEditorStore()
const markup = useMarkupSession()

/**
 * The whole chapter, not the open page. Translating and proofreading are read
 * at that scale — which is also what makes selecting across pages fall out of
 * this list rather than needing anything of its own.
 */
const rows = computed(() => editor.chapterRows)

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
  const out: { page: PageRow; rows: Array<LabelRow | BlockRow> }[] = []
  // ⭐ Blocks are rows like any other. A translation set in two is two things to
  // take hold of, and a row drawn inside another row is a row nothing can drag.
  for (const row of rows.value) {
    if (row.kind === 'page') out.push({ page: row, rows: [] })
    else out[out.length - 1]?.rows.push(row)
  }
  /*
   * Narrowing puts the rail away rather than drawing it with holes in. A line
   * with one end filtered out has nowhere to land, and a rail missing pieces
   * reads as a structure missing pieces — which is worse than no rail at all.
   * Sortable is already switched off for the same stretch.
   */
  return out.map((group) => ({
    ...group,
    marks: filtering.value ? [] : railMarks(group.rows),
    rail: filtering.value ? 0 : railWidth(group.rows),
  }))
})

const filesById = computed(() => new Map(project.files.map((file) => [file.pageId, file])))

function fileOf(pageId: string) {
  return filesById.value.get(pageId)
}

/** What a range reaches over, in the order the panel is showing it. */
const sequence = computed(() =>
  rows.value.flatMap((r) => (r.kind === 'label' ? r.blocks.map((b) => b.id) : [])),
)

const scrollEl = ref<HTMLElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)

/**
 * How far a line hangs below its row, so that it runs over the rule between
 * rows rather than stopping short of it.
 *
 * An absolutely placed child is offset from the padding box, which ends where
 * the bottom border begins — so `0` leaves the rail cut once per row. Painting
 * order already puts the child above the parent's border; it only has to reach
 * it. The reading is one line down the page, and a rule breaking it every row
 * makes it read as a column of unconnected marks.
 */
const RAIL_OVERHANG = '-1px'

/**
 * A vertical stroke standing on an offset, which names the middle of it rather
 * than its left edge — the same thing the dot and the curve are placed on, so
 * that all three agree.
 */
function strokeAt(offset: number, span: Record<string, string>): Record<string, string> {
  return { left: `${offset - RAIL_STROKE / 2}px`, width: `${RAIL_STROKE}px`, ...span }
}

/**
 * A branch is set in from the reading it hangs off — one step, and no deeper
 * however many lanes the rail needs. The lanes past the first are room for
 * branches that are alive at the same time, not another level of nesting, so
 * indenting per lane would say a depth that is not there.
 */
function branchIndent(row: LabelRow): Record<string, string> | undefined {
  return row.lane !== undefined && row.lane > 0 ? { paddingLeft: '1.5rem' } : undefined
}

/**
 * Every locked block in the chapter, worked out once per tree rather than once
 * per row: a change of selection redraws every row in the list.
 */
const lockedIds = computed(() => {
  const out = new Set<string>()
  for (const file of project.files) {
    for (const id of lockedEntries(treeOf(file.page, editor.textSide, project.activeFace))) out.add(id)
  }
  return out
})

/** Its own lock or a folder's above it, which this list has no way to tell apart. */
function isRowLocked(row: LabelRow | BlockRow): boolean {
  return row.kind === 'block'
    ? lockedIds.value.has(row.block.id)
    : row.blocks.some((block) => lockedIds.value.has(block.id))
}

/**
 * ⭐ One row, two kinds. Every one of these answers for both, so the template
 * has a single root: a `v-if` at the top of the drag slot leaves a comment node
 * behind, and Sortable maps a dragged node back to its row by counting.
 */
type Row = LabelRow | BlockRow

/** What the canvas selects when this row is picked — its first block. */
/**
 * What a right-click on a row offers. A first translation candidate is rare
 * enough to live here rather than on the canvas, whose right button is the
 * style fan's; once an object has a list, the list carries its own button.
 */
const ROW_MENU = [{ id: 'add-translation', label: '新增譯文候選' }] as const
const rowMenuAt = ref<{ x: number; y: number } | null>(null)
const rowMenuFor = ref<string | null>(null)

function onRowMenu(row: Row, e: MouseEvent) {
  // The source's candidates are the run's, and not anybody's to invent.
  const id = rowId(row)
  if (editor.textSide !== 'translation' || id === undefined) return
  rowMenuFor.value = id
  rowMenuAt.value = { x: e.clientX, y: e.clientY }
}

function closeRowMenu() {
  rowMenuAt.value = null
  rowMenuFor.value = null
}

function onRowMenuPick(id: string) {
  const objectId = rowMenuFor.value
  const pageId = objectId === null ? null : project.pageOfEntry(objectId)
  closeRowMenu()
  if (id !== 'add-translation' || pageId === null || objectId === null) return
  editor.cmdAddTranslationCandidate(pageId, objectId, generateId())
}

function rowId(row: Row): string | undefined {
  return row.kind === 'block' ? row.block.id : row.blocks[0]?.id
}

function rowClass(row: Row): Array<string | false | undefined> {
  const editing = isRowEditing(row)
  if (row.kind === 'block') {
    return [
      isSelected(row) ? 'bg-accent/50' : 'hover:bg-secondary/40',
      !editing && 'select-none',
      !editing && !filtering.value && 'cursor-grab',
    ]
  }
  return [
    isSelected(row) ? 'bg-accent/50' : 'hover:bg-secondary/40',
    !editing && 'select-none',
    row.lane !== undefined && 'rail-held',
    !editing && !filtering.value && row.lane === undefined && 'cursor-grab',
  ]
}

/** One step in for a block, so the column of them reads as belonging above. */
function rowStyle(row: Row): Record<string, string> | undefined {
  return row.kind === 'block' ? { paddingLeft: '1.5rem' } : branchIndent(row)
}

function onRowDown(row: Row, e: MouseEvent) {
  if (row.kind === 'block') onPickBlock(row, e)
  else onPick(row, e)
}

function onRowOpen(row: Row) {
  if (row.kind === 'block') onEditBlock(row)
  else onEdit(row)
}

function onRowKeys(row: Row, e: KeyboardEvent) {
  if (row.kind === 'block') onBlockKey(row, e)
  else onRowKey(row, e)
}

function isRowEditing(row: Row): boolean {
  return row.kind === 'block' ? isEditingBlock(row) : isEditing(row)
}

/**
 * The stored string of the block this row is typed into. Read off the page
 * rather than off the row: a row of a split translation carries every block
 * joined, and the box writes into one of them.
 */
function rowCode(row: Row): string {
  const id = row.kind === 'block' ? row.block.id : soleBlock(row)
  const page = fileOf(row.pageId)?.page
  const block = id === null ? undefined : project.blockById(row.pageId, id)
  return page === undefined || block === undefined ? '' : shownCodeOf(block)
}

function unitTags(row: LabelRow): readonly string[] {
  return row.tags
}

/**
 * A blur ends the visit only while the visit is still this row's, and only
 * when the keyboard really left: the canvas's box and the bar over the
 * selection are the same edit.
 *
 * Carrying the caret to the next row closes this session and opens that one,
 * which unmounts this input — and unmounting something focused blurs it. Left
 * unguarded, that blur would close the session just opened for the row being
 * moved to, and the caret would arrive with nothing to type into.
 */
function onRowBlur(row: Row, e: FocusEvent) {
  if (!isRowEditing(row)) return
  if (markup.keepsSession(e.relatedTarget)) return
  editor.commitTextEdit()
}

/**
 * ⚠️ A translation set in several blocks draws none of its own reading: the
 * block rows under it say the whole of it, and saying it twice would cost the
 * row a line of height for a line nobody needs.
 */
function showsReading(row: Row): boolean {
  if (row.kind === 'block') return !isEditingBlock(row)
  return row.blocks.length < 2 && !isEditing(row)
}

function isRowBlank(row: Row): boolean {
  return row.kind === 'block' ? row.text.length === 0 : isMainBlank(row)
}

function rowPreview(row: Row): string {
  return row.kind === 'block' ? row.text : preview(row)
}

function rowEndsOnABreak(row: Row): boolean {
  return row.kind === 'block' ? row.text.endsWith('\n') : endsOnABreak(row)
}

function isSelected(row: LabelRow | BlockRow): boolean {
  return row.kind === 'block'
    ? editor.isSelected(row.block.id)
    : row.blocks.some((block) => editor.isSelected(block.id))
}

/**
 * The one block a row is typed into. A translation set in several is typed into
 * one block at a time, on the rows below — there is no caret that spans them,
 * and pretending otherwise would be a box writing into somewhere it is not.
 */
function soleBlock(row: LabelRow): string | null {
  return row.blocks.length === 1 ? row.blocks[0].id : null
}

/**
 * A page with nothing on it is still somewhere the cursor can be. Walking onto
 * one leaves no object to stand on, so its heading takes the position instead —
 * otherwise the highlight stays behind on the page just left, pointing at an
 * object that is no longer where anyone is.
 */
function isHere(row: ChapterRow): boolean {
  return row.pageId === editor.currentPageId && editor.cursorId === null
}

/**
 * A row is being typed into when the editing session names it. There is no
 * second flag for "this row is in the input layer" — the session is that state,
 * and holding it in two places is how the two drift apart.
 */
function isEditing(row: LabelRow): boolean {
  const pending = editor.pendingTextEdit
  const sole = soleBlock(row)
  return sole !== null && pending?.pageId === row.pageId && pending?.labelId === sole
}

function isEditingBlock(row: BlockRow): boolean {
  const pending = editor.pendingTextEdit
  return pending?.pageId === row.pageId && pending?.labelId === row.block.id
}

/** The other side, on the small line above. */
function asideText(row: LabelRow): string {
  return row.opposite
}

/** And the one being worked on, which is the line the caret opens in. */
function mainText(row: LabelRow): string {
  return row.main
}

/**
 * Whether the main line says nothing at all — which on the translation side is
 * not the same as having typed nothing into it, so it reads the projection
 * rather than any one block's own words.
 */
function isMainBlank(row: LabelRow): boolean {
  return row.main.length === 0
}

const blankLabel = computed(() => (editor.textSide === 'source' ? '(沒有原文)' : '(未翻譯)'))

function preview(row: LabelRow): string {
  return isMainBlank(row) ? blankLabel.value : mainText(row)
}

/**
 * A last line with nothing on it is not a line box — CSS treats one that holds
 * no content and does not itself end in a break as not existing at all. So a
 * translation the typesetter ended on a break would stand a line shorter here
 * than the engine draws it, and copy a line shorter than the object reads.
 *
 * A `<br>` is what puts that boundary back, and it is only ever asked for when
 * the text really does end on one, so it never claims a break that was not
 * typed. Blink builds DOM out of plain text the same way.
 */
function endsOnABreak(row: LabelRow): boolean {
  return preview(row).endsWith('\n')
}


function focusIn(selector: string) {
  const el = scrollEl.value?.querySelector<HTMLElement>(selector)
  if (!el) return
  // Focusing scrolls on its own, and would leave the row under the pinned heading.
  el.focus({ preventScroll: true })
  reveal(el)
}

/**
 * ⭐ Picking a translation picks every block that says it, which is the same
 * thing framing them on the canvas does. What a row stands for is one piece of
 * content, and taking hold of half the lettering of it was never the offer.
 */
function onPick(row: LabelRow, e: MouseEvent) {
  if (isEditing(row)) return
  const first = row.blocks[0]?.id
  if (first === undefined) return
  if (e.shiftKey) editor.extendSelectionTo(first, sequence.value)
  else if (e.ctrlKey || e.metaKey) for (const block of row.blocks) editor.toggleSelected(block.id)
  else {
    editor.revealLabel(row.pageId, first)
    for (const block of row.blocks.slice(1)) editor.toggleSelected(block.id)
  }
}

function onPickBlock(row: BlockRow, e: MouseEvent) {
  if (isEditingBlock(row)) return
  if (e.shiftKey) editor.extendSelectionTo(row.block.id, sequence.value)
  else if (e.ctrlKey || e.metaKey) editor.toggleSelected(row.block.id)
  else editor.revealLabel(row.pageId, row.block.id)
}

/**
 * Opened from the list, so the list takes the keyboard. Which box is writing
 * follows from where the work was started, which is the one thing that says
 * where the user is looking.
 */
function onEdit(row: LabelRow) {
  const sole = soleBlock(row)
  if (sole === null) return
  editor.revealLabel(row.pageId, sole)
  editor.beginTextEdit(row.pageId, sole, rowCode(row))
  textWriter.value = 'code'
}

function onEditBlock(row: BlockRow) {
  editor.revealLabel(row.pageId, row.block.id)
  editor.beginTextEdit(row.pageId, row.block.id, rowCode(row))
  textWriter.value = 'code'
}

/**
 * The keys a row answers to itself. Everything else — moving between rows,
 * deleting, turning the page — acts on the document and is handled once, above.
 */
function onRowKey(row: LabelRow, e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  // The box is a descendant of the row, so every key typed into it bubbles
  // through here on its way out. Enter would be taken for "open the editor" and
  // never reach the text as a newline; `i` would never be typed at all.
  if (ownsKeyboard(document.activeElement)) return
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
/**
 * ⭐ Two drags, told apart by what was picked up. A translation dragged says
 * where it is read on the page; a block of one dragged says where it is read
 * inside that translation — which changes the words, and is why only one of
 * them touches the reading order.
 *
 * ⚠️ A block dropped outside its own translation's run is refused: what that
 * would mean — joining another translation, leaving this one — is a decision
 * with a command of its own, and a drag cannot say which was intended.
 */
function onChanged(
  group: { page: PageRow; rows: Array<LabelRow | BlockRow> },
  evt: {
    moved?: { element: LabelRow | BlockRow; oldIndex: number; newIndex: number }
    added?: { element: LabelRow | BlockRow; newIndex: number }
  },
) {
  const change = evt.moved ?? evt.added
  if (!change) return

  const next = [...group.rows]
  if (evt.moved) next.splice(evt.moved.oldIndex, 1)
  next.splice(change.newIndex, 0, change.element)

  if (change.element.kind === 'block') {
    const unit = change.element.unit
    const above = next
      .slice(0, change.newIndex)
      .reverse()
      .find((r) => r.kind === 'label' || r.unit.id !== unit.id)
    if (above?.kind !== 'label' || above.unit.id !== unit.id) return
    const members = next.flatMap((r) =>
      r.kind === 'block' && r.unit.id === unit.id ? [r.block.id] : [],
    )
    editor.cmdReorderMembers(change.element.pageId, unit.id, editor.textSide, members)
    return
  }

  const target = dropAt(next[change.newIndex - 1] ?? group.page, true)
  editor.moveObjectsTo([change.element.unit.id], target.page, target.index)
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
  const block = first.blocks[0]
  if (block === undefined) return
  editor.revealLabel(first.pageId, block.id)
  void nextTick(() => focusIn(`[data-row-id="${CSS.escape(block.id)}"]`))
}

useEventListener(window, 'keydown', (e) => {
  const wants = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f'
  if (!wants && !(e.key === '/' && !ownsKeyboard(document.activeElement))) return
  e.preventDefault()
  searchEl.value?.focus()
  searchEl.value?.select()
})

/** The same two keys open a block as open the row it stands under. */
function onBlockKey(row: BlockRow, e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (ownsKeyboard(document.activeElement)) return
  if (e.key !== 'Enter' && e.key !== 'i') return
  if (editor.selectedIds.size > 1) return
  e.preventDefault()
  onEditBlock(row)
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
 * Set by a press on a heading, for the turn it causes. Focus would say the
 * list is in use only once the press is over, after the turn has been followed.
 */
let turnedHere = false

function turnFromHeading(pageId: string): void {
  turnedHere = pageId !== editor.currentPageId
  editor.showPage(pageId)
}

/**
 * Selecting on the canvas has to bring the list to the object, and turning the
 * page has to bring it to the page, or the two stop being about the same
 * thing. The cursor's row is the target when it is on the page now showing;
 * otherwise the page itself — a selection reaches across pages and survives a
 * turn, so a cursor left on page 3 says nothing about where page 7 is.
 *
 * A row is only brought as far as it takes to be seen. A page just turned to
 * from elsewhere is brought to the top, its heading pinned and its rows below it:
 * `nearest` would stop a page further down at the bottom edge, showing the
 * heading and none of what is under it. A page turned from the list itself is
 * left where it is, so pressing a heading does not pull it out from under the
 * pointer.
 *
 * It runs on arrival as well as on every move, because the list shares its
 * column with the tree now and is built afresh each time it is switched back
 * to — a list that only caught later moves would come back scrolled to the top
 * with the cursor pages away.
 */
watch(
  () => [editor.currentPageId, editor.cursorId] as const,
  async ([pageId, labelId], previous) => {
    if (pageId === null) return
    const turned = previous?.[0] !== pageId && !turnedHere
    turnedHere = false
    const onPage =
      labelId !== null &&
      rows.value.some((r) =>
        r.kind === 'block'
          ? r.pageId === pageId && r.block.id === labelId
          : r.kind === 'label' &&
            r.pageId === pageId &&
            r.blocks.length === 1 &&
            r.blocks[0].id === labelId,
      )
    if (!onPage && !rows.value.some((r) => r.kind === 'page' && r.pageId === pageId)) return
    const selector = onPage
      ? `[data-row-id="${CSS.escape(labelId)}"]`
      : `[data-page-id="${CSS.escape(pageId)}"]`

    // Focus goes where the cursor went, but only while the list is the thing
    // being used: keys are dispatched by what they act on, so moving the cursor
    // from here would otherwise leave focus on the row left behind, and the
    // next Enter would open a row nobody is looking at.
    const held = scrollEl.value?.contains(document.activeElement) ?? false

    await nextTick()
    const target = scrollEl.value?.querySelector<HTMLElement>(selector)
    if (target) {
      if (onPage || !turned) reveal(target)
      else bringPageToTop(target)
    }
    if (held && editor.pendingTextEdit === null) {
      await nextTick()
      focusIn(selector)
    }
  },
  { immediate: true },
)

/** The page under `heading` scrolled to the top of the list, its first rows right under the pinned heading. */
function bringPageToTop(heading: HTMLElement): void {
  const list = scrollEl.value
  const group = heading.closest('[data-page-group]')
  if (!list || !group) return
  list.scrollTop += group.getBoundingClientRect().top - list.getBoundingClientRect().top
}

/**
 * `scrollIntoView` with the pinned heading taken into account. `nearest` stops
 * a row going up at the top edge, which is where its page's heading is pinned,
 * so the row would come to rest underneath it; it is nudged down to just below.
 */
function reveal(el: HTMLElement): void {
  el.scrollIntoView({ block: 'nearest' })
  const list = scrollEl.value
  if (!list || el.hasAttribute('data-page-heading')) return
  const heading = el.closest('[data-page-group]')?.querySelector<HTMLElement>('[data-page-heading]')
  if (!heading) return
  const covered = heading.getBoundingClientRect().bottom - el.getBoundingClientRect().top
  if (covered > 0) list.scrollTop -= covered
}

function orderedTags(tags: readonly string[]): string[] {
  return tagsInRegistryOrder(tags, project.header.tags)
}
</script>

<style scoped>
/*
 * The tints the headings always had, mixed onto the panel's card instead of
 * laid over it: a pinned heading has rows passing underneath, and a
 * translucent one would show them through its page name.
 */
.heading-here {
  background-color: color-mix(in oklab, var(--color-accent) 50%, var(--color-card));
}
.heading-away {
  background-color: color-mix(in oklab, var(--color-secondary) 60%, var(--color-card));
}
.heading-away:hover {
  background-color: var(--color-secondary);
}


/*
 * `<pre>`, because where a translation breaks is a decision the typesetter made
 * and the element for structure carried by the breaks themselves rather than by
 * markup is this one. Its monospace stack is not part of that and is handed
 * back to the panel.
 */
.reading {
  font-family: inherit;
  font-feature-settings: inherit;
  font-variation-settings: inherit;
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
  grid-template-columns: var(--rail, 0px) 1.5rem 1fr;
  grid-auto-flow: row dense;
}
.rail,
.gutter,
.page-body :deep(.rows) {
  display: contents;
}
.rail-cell {
  grid-column: 1;
  position: relative;
}
.gutter-cell {
  grid-column: 2;
}
.row-content {
  grid-column: 3;
}

/*
 * The rail is drawn out of the row it belongs to rather than over the column as
 * one picture: a translation sets its own height, and a picture that spanned
 * them all would have to be told what those heights came out as.
 */
.rail-line {
  position: absolute;
  background: currentColor;
}
/*
 * Stretched to the dot rather than drawn at a fixed height, since the dot sits
 * halfway down a row only the translation knows the height of. The stroke is
 * held out of that stretch, or a tall row would draw a fat curve and a short one
 * a thin one.
 */
.rail-join {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 50%;
  overflow: visible;
}
.rail-dot {
  position: absolute;
  top: 50%;
  margin-top: -3.5px;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: currentColor;
}
.rail-stop {
  position: absolute;
  top: 50%;
  margin-top: 5px;
  width: 9px;
  height: 1.5px;
  background: currentColor;
}

/*
 * A page with nothing on it has no children to hand Sortable a shape to aim at,
 * so this one keeps a box of its own.
 */
.page-body :deep(.rows-empty) {
  grid-column: 3;
  min-height: 1.5rem;
}
</style>
