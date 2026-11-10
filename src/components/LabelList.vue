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
      <LabelPageHeading
        :page="group.page"
        :file="fileOf(group.page.pageId)"
        @turn="turnFromHeading(group.page.pageId)"
      />

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
          <LabelRailCell
            v-for="(row, at) in group.rows"
            :key="row.key"
            :row="row"
            :mark="group.marks[at]"
            :rail="group.rail"
          />
        </div>

        <div class="gutter">
          <LabelGutterCell v-for="row in group.rows" :key="row.key" :row="row" />
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
            exist. What a row is made of is said in `LabelRowBody`, whose own
            root is that one element.
          -->
          <template #item="{ element }">
            <LabelRowBody
              :row="element as ListRow"
              :locked="isRowLocked(element as ListRow)"
              :filtering="filtering"
              @pick="onRowDown(element as ListRow, $event)"
              @menu="onRowMenu(element as ListRow, $event)"
              @input-key="onInputKey"
            />
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
import { Search, X } from '@lucide/vue'
import Draggable from 'vuedraggable'
import CanvasMenu, { type MenuItem } from '@/components/CanvasMenu.vue'
import { LAYER_ORDER_MENU, restackOf } from '@/lib/layerOrderMenu'
import { useUnitMenu } from '@/composables/useUnitMenu'
import LabelGutterCell from '@/components/labelList/LabelGutterCell.vue'
import LabelPageHeading from '@/components/labelList/LabelPageHeading.vue'
import LabelRailCell from '@/components/labelList/LabelRailCell.vue'
import LabelRowBody from '@/components/labelList/LabelRowBody.vue'
import { generateId } from '@shared/page/schema'
import {
  dropAt,
  rowId,
  type BlockRow,
  type LabelRow,
  type ListRow,
  type PageRow,
} from '@/lib/labelRows'
import { railMarks, railWidth } from '@/lib/readingRail'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useEventListener } from '@vueuse/core'
import { ownsKeyboard } from '@/lib/typingSurface'
import { lockedEntries } from '@shared/page/tree'
import { treeOf } from '@shared/page/trees'

const project = useProjectStore()
const editor = useEditorStore()

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
  const out: { page: PageRow; rows: ListRow[] }[] = []
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
 * Every locked block in the chapter, worked out once per tree rather than once
 * per row.
 */
const lockedIds = computed(() => {
  const out = new Set<string>()
  for (const file of project.files) {
    for (const id of lockedEntries(treeOf(file.page, editor.textSide, project.activeFace))) out.add(id)
  }
  return out
})

/** Its own lock or a folder's above it, which this list has no way to tell apart. */
function isRowLocked(row: ListRow): boolean {
  return row.kind === 'block'
    ? lockedIds.value.has(row.block.id)
    : row.blocks.some((block) => lockedIds.value.has(block.id))
}

const unitMenu = useUnitMenu()

/**
 * What a right-click on a row offers. A first translation candidate is rare
 * enough to live here rather than on the canvas, whose right button is the
 * style fan's; once an object has a list, the list carries its own button.
 */
const ROW_MENU = computed<MenuItem[]>(() => [
  ...(editor.textSide === 'translation' ? [{ id: 'add-translation', label: '新增譯文候選' }] : []),
  ...unitMenu.items.value,
  LAYER_ORDER_MENU,
])
const rowMenuAt = ref<{ x: number; y: number } | null>(null)
const rowMenuFor = ref<string | null>(null)

function onRowMenu(row: ListRow, e: MouseEvent) {
  // The source's candidates are the run's, and not anybody's to invent.
  const id = rowId(row)
  if (id === undefined) return
  // The order acts on the selection, so the row pointed at joins it, as on the canvas.
  if (!editor.isSelected(id)) onRowDown(row, e)
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
  if (unitMenu.pick(id)) return
  const how = restackOf(id)
  if (how !== null) {
    editor.cmdRestackSelection(how)
    return
  }
  if (id !== 'add-translation' || pageId === null || objectId === null) return
  editor.cmdAddTranslationCandidate(pageId, objectId, generateId())
}

function onRowDown(row: ListRow, e: MouseEvent) {
  if (row.kind === 'block') onPickBlock(row, e)
  else onPick(row, e)
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
  if (e.shiftKey) editor.extendSelectionTo(row.block.id, sequence.value)
  else if (e.ctrlKey || e.metaKey) editor.toggleSelected(row.block.id)
  else editor.revealLabel(row.pageId, row.block.id)
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
  group: { page: PageRow; rows: ListRow[] },
  evt: {
    moved?: { element: ListRow; oldIndex: number; newIndex: number }
    added?: { element: ListRow; newIndex: number }
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
 * otherwise the page itself, but only when the page is what moved — a
 * selection reaches across pages and adding to it does not turn the page, so a
 * cursor gone to another page by itself is a row the person just pointed at,
 * already in view, and pulling the list to the page showing would yank it away.
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
    if (!onPage && previous !== undefined && previous[0] === pageId) return
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
</script>

<style scoped>
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

/*
 * A page with nothing on it has no children to hand Sortable a shape to aim at,
 * so this one keeps a box of its own.
 */
.page-body :deep(.rows-empty) {
  grid-column: 3;
  min-height: 1.5rem;
}
</style>
