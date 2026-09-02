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
        :data-page-id="group.page.pageId"
        class="flex items-center gap-2 border-y border-border px-2 py-1 select-none focus:ring-1 focus:ring-inset focus:ring-primary focus:outline-none"
        :class="[
          group.page.pageId === editor.currentPageId && 'text-foreground',
          isHere(group.page) ? 'bg-accent/50' : 'bg-secondary/60 hover:bg-secondary',
        ]"
        @mousedown="editor.showPage(group.page.pageId)"
      >
        <PageRowThumb v-if="fileOf(group.page.pageId)" :file="fileOf(group.page.pageId)!" />
        <span class="min-w-0 truncate text-xs font-medium">{{ group.page.name }}</span>
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
          >{{ row.depth ?? '' }}</div>
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
          <template #item="{ element }">
            <div
              tabindex="0"
              :data-row-id="(element as LabelRow).blocks[0]?.id"
              class="row-content flex min-w-0 items-start gap-1.5 border-b border-border/40 py-1 pr-2 pl-1.5 focus:ring-1 focus:ring-inset focus:ring-primary focus:outline-none"
              :class="[
                isSelected(element as LabelRow) ? 'bg-accent/50' : 'hover:bg-secondary/40',
                !isEditing(element as LabelRow) && 'select-none',
                (element as LabelRow).lane !== undefined && 'rail-held',
                !isEditing(element as LabelRow) &&
                  !filtering &&
                  (element as LabelRow).lane === undefined &&
                  'cursor-grab',
              ]"
              :style="branchIndent(element as LabelRow)"
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
                  class="text-[10px] leading-snug whitespace-pre-wrap text-muted-foreground"
                  :class="!asideText(element as LabelRow) && 'opacity-50'"
                >{{ asideText(element as LabelRow) || '—' }}</span>

                <!--
                  One box per session wherever it is standing. Pinned to the
                  canvas it is the same element with the same text and the same
                  caret, which is what makes the two ways of editing one edit.
                -->
                <textarea
                  v-if="isEditing(element as LabelRow)"
                  :ref="takeFocus"
                  rows="1"
                  spellcheck="false"
                  :placeholder="blankLabel"
                  class="label-input w-full resize-none bg-transparent text-sm leading-snug focus:outline-none placeholder:text-muted-foreground/50"
                  :class="pinned && 'pinned'"
                  :style="pinnedStyle"
                  :value="mainText(element as LabelRow)"
                  @input="onInput(element as LabelRow, $event)"
                  @keydown="onInputKey($event)"
                  @blur="onInputBlur(element as LabelRow)"
                />
                <!--
                  The row goes on reading as a row while the box is away on the
                  canvas — a body being typed elsewhere is still the body this
                  row is about.
                -->
                <pre
                  v-if="!isEditing(element as LabelRow) || pinned"
                  class="reading text-sm leading-snug whitespace-pre-wrap"
                  :class="isMainBlank(element as LabelRow) && 'text-muted-foreground/50'"
                >{{ preview(element as LabelRow) }}<br v-if="endsOnABreak(element as LabelRow)" /></pre>

                <!--
                  ⭐ Only where the lettering was split, so an ordinary balloon
                  is one row exactly as it always was. Each block gets its own
                  line to be typed into, numbered in the order it is read.
                -->
                <div
                  v-if="(element as LabelRow).blocks.length > 1"
                  class="mt-0.5 flex flex-col gap-0.5"
                >
                  <div
                    v-for="(block, at) in (element as LabelRow).blocks"
                    :key="block.id"
                    tabindex="0"
                    :data-row-id="block.id"
                    class="flex min-w-0 items-start gap-1.5 rounded-sm px-1 focus:ring-1 focus:ring-inset focus:ring-primary focus:outline-none"
                    :class="
                      editor.isSelected(block.id) ? 'bg-accent/50' : 'hover:bg-secondary/40'
                    "
                    @mousedown.stop="onPickBlock(blockRowOf(element as LabelRow, at), $event)"
                    @dblclick.stop="onEditBlock(blockRowOf(element as LabelRow, at))"
                  >
                    <span class="mt-0.5 shrink-0 text-[10px] text-muted-foreground/70">{{
                      at + 1
                    }}</span>
                    <textarea
                      v-if="isEditingBlock(blockRowOf(element as LabelRow, at))"
                      :ref="takeFocus"
                      rows="1"
                      spellcheck="false"
                      class="label-input w-full resize-none bg-transparent text-sm leading-snug focus:outline-none"
                      :value="blockRowOf(element as LabelRow, at).text"
                      @input="onInputBlock(blockRowOf(element as LabelRow, at), $event)"
                      @keydown="onInputKey($event)"
                    />
                    <pre
                      v-else
                      class="reading min-w-0 flex-1 text-sm leading-snug whitespace-pre-wrap"
                    >{{ blockRowOf(element as LabelRow, at).text }}</pre>
                  </div>
                </div>

                <div
                  v-if="(element as LabelRow).unit.tags.length > 0"
                  class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground"
                >
                  <span
                    v-for="tag in orderedTags((element as LabelRow).unit.tags)"
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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Lock, Search, X } from '@lucide/vue'
import Draggable from 'vuedraggable'
import PageRowThumb from '@/components/PageRowThumb.vue'
import { tagColor, tagsInRegistryOrder } from '@shared/tags/set'
import {
  buildLabelRows,
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
import { useTextEditSurface } from '@/composables/useTextEditSurface'

const project = useProjectStore()
const editor = useEditorStore()
const surface = useTextEditSurface()

/**
 * The whole chapter, not the open page. Translating and proofreading are read
 * at that scale — which is also what makes selecting across pages fall out of
 * this list rather than needing anything of its own.
 */
const rows = computed(() => buildLabelRows(project.files, editor.textSide, editor.labelQuery))

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
  // ⚠️ Only the translations. A block row belongs to the row above it and is
  // drawn inside it, so putting one in this list would make it a sibling the
  // drag could carry off on its own.
  for (const row of rows.value) {
    if (row.kind === 'page') out.push({ page: row, rows: [] })
    else if (row.kind === 'label') out[out.length - 1]?.rows.push(row)
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

/** Its own lock or a folder's above it, which this list has no way to tell apart. */
function isRowLocked(row: LabelRow): boolean {
  return row.blocks.some((block) => editor.isLayerLocked(block.id))
}

function isSelected(row: LabelRow): boolean {
  return row.blocks.some((block) => editor.isSelected(block.id))
}

/**
 * A row's block, as the row the handlers take. Built here rather than emitted
 * as a sibling in the list, because a block belongs to the translation above it
 * — a sibling is something a drag could carry off on its own.
 */
function blockRowOf(row: LabelRow, at: number): BlockRow {
  const block = row.blocks[at]
  return {
    kind: 'block',
    key: `block/${row.pageId}/${block.id}`,
    pageId: row.pageId,
    unit: row.unit,
    block,
    at: at + 1,
    text: blockTexts.value.get(block.id) ?? block.body.lines.join('\n'),
    index: row.index,
  }
}

/** Every block's resolved words, keyed by id, off the same pass the rows came from. */
const blockTexts = computed(() => {
  const out = new Map<string, string>()
  for (const row of rows.value) if (row.kind === 'block') out.set(row.block.id, row.text)
  return out
})

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

/**
 * Focus follows the input into being, so Enter lands the caret without a click.
 *
 * The same call publishes the box, because this is the one control a
 * translation is typed into and the canvas projects what it says. Only
 * arrivals: a template ref reports its element leaving as a bare `null`, and
 * carrying the caret to the next row swaps two of them in an order that would
 * let the departure clear the arrival.
 */
function takeFocus(el: unknown) {
  if (!(el instanceof HTMLTextAreaElement)) return
  surface.register(el)
  if (document.activeElement !== el) el.focus()
}

/**
 * The box exists exactly as long as the session does, so the session is what
 * withdraws it — one fact rather than two that can disagree. The pin goes with
 * it: where the box belongs is decided per session by whoever opened it.
 */
watch(
  () => editor.pendingTextEdit,
  (pending) => {
    if (pending !== null) return
    surface.register(null)
    surface.pin(false)
    surface.showCaretAt(null)
  },
)

const pinned = surface.pinned

/**
 * What it takes to put a native control on the insertion point and leave it
 * reachable by the IME.
 *
 * Turned about its own corner, because the position names where the run starts
 * rather than where the box's middle would go. Faintly opaque rather than
 * transparent: `visibility` and `opacity: 0` cost the IME its target in some
 * environments, and the box is one or two pixels of a colour nothing is drawn
 * in — invisible in practice without ever claiming to be hidden.
 */
const pinnedStyle = computed(() => {
  const box = surface.pinnedBox.value
  if (box === null) return undefined
  return {
    position: 'fixed' as const,
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    transformOrigin: '0 0',
    transform: `rotate(${box.angle}rad)`,
    // The IME reads the control's direction, so a column of text gets a column
    // of a box and its candidates open along the same axis the reader is on.
    writingMode: box.vertical ? ('vertical-rl' as const) : ('horizontal-tb' as const),
  }
})

onBeforeUnmount(() => surface.register(null))

function focusIn(selector: string) {
  scrollEl.value?.querySelector<HTMLElement>(selector)?.focus()
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
 * Opened from the list, so the box stays in the list. Where it belongs follows
 * from where the work was started, which is the one thing that says where the
 * user is looking.
 */
function onEdit(row: LabelRow) {
  const sole = soleBlock(row)
  if (sole === null) return
  editor.revealLabel(row.pageId, sole)
  editor.beginTextEdit(row.pageId, sole, row.main)
  surface.pin(false)
}

function onEditBlock(row: BlockRow) {
  editor.revealLabel(row.pageId, row.block.id)
  editor.beginTextEdit(row.pageId, row.block.id, row.text)
  surface.pin(false)
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
  const sole = soleBlock(row)
  if (sole === null || editor.isLayerLocked(sole)) return
  project.updateLabelText(row.pageId, sole, (e.target as HTMLTextAreaElement).value)
}

function onInputBlock(row: BlockRow, e: Event) {
  if (editor.isLayerLocked(row.block.id)) return
  project.updateLabelText(row.pageId, row.block.id, (e.target as HTMLTextAreaElement).value)
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
  () => [editor.currentPageId, editor.cursorId] as const,
  async ([pageId, labelId]) => {
    if (pageId === null) return
    const index =
      labelId === null
        ? rows.value.findIndex((r) => r.kind === 'page' && r.pageId === pageId)
        : rows.value.findIndex(
            (r) =>
              r.kind === 'block'
                ? r.pageId === pageId && r.block.id === labelId
                : r.kind === 'label' &&
                  r.pageId === pageId &&
                  r.blocks.length === 1 &&
                  r.blocks[0].id === labelId,
          )
    if (index === -1) return
    const selector =
      labelId === null
        ? `[data-page-id="${CSS.escape(pageId)}"]`
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
 * Pinned to the insertion point on the canvas: a real control, holding the real
 * text and the real caret, sized down to a sliver. What the reader sees is the
 * engine's own drawing on the page; this is only what the platform's input
 * needs to exist and to be somewhere.
 *
 * Not hidden, faint. A control that is `visibility: hidden`, `display: none` or
 * fully transparent stops being an IME target in some environments, and being
 * one is its entire job.
 */
.label-input.pinned {
  field-sizing: fixed;
  z-index: 50;
  padding: 0;
  border: 0;
  resize: none;
  overflow: hidden;
  white-space: pre;
  opacity: 0.01;
  pointer-events: none;
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
