<template>
  <div data-region="list" class="flex h-full min-h-0 flex-col select-none">
    <div class="min-h-0 flex-1 overflow-y-auto" @dragover.prevent @drop.prevent="onDrop">
      <div v-if="rows.length === 0" class="px-2 py-4 text-center text-xs text-muted-foreground">
        {{ editor.currentPageId ? '本頁沒有圖層' : '尚未開啟頁面' }}
      </div>

      <div
        v-for="row in rows"
        :key="row.entry.id"
        :draggable="renaming?.id !== row.entry.id && !isEditingText(row) && !isRowLocked(row)"
        class="group/row relative flex min-h-7 items-center gap-1 border-b border-border/40 pr-1"
        :class="[
          isSelected(row.entry.id) ? 'bg-accent/50' : 'hover:bg-secondary/40',
          row.hiddenByAncestor && 'opacity-40',
          hover?.id === row.entry.id && hover.zone === 'inside' && 'ring-1 ring-inset ring-primary',
        ]"
        :style="{ paddingLeft: `${row.depth * 0.75 + 0.25}rem` }"
        @click="onPick(row, $event)"
        @dragstart="onDragStart(row, $event)"
        @dragover.prevent.stop="onDragOver(row, $event)"
        @drop.prevent.stop="onDrop"
        @dragend="clearDrag"
      >
        <span
          v-if="hover?.id === row.entry.id && hover.zone !== 'inside'"
          class="pointer-events-none absolute right-0 left-0 h-0.5 bg-primary"
          :class="hover.zone === 'above' ? 'top-0' : 'bottom-0'"
        />

        <button
          v-if="row.entry.kind === 'group'"
          type="button"
          class="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          :title="collapsed.has(row.entry.id) ? '展開' : '收合'"
          @click.stop="toggleCollapsed(row.entry.id)"
        >
          <ChevronRight v-if="collapsed.has(row.entry.id)" :size="12" />
          <ChevronDown v-else :size="12" />
        </button>
        <span v-else class="w-4 shrink-0" />

        <button
          type="button"
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
          :title="row.entry.visible ? '隱藏' : '顯示'"
          @click.stop="onToggleVisible(row.entry)"
        >
          <Eye v-if="row.entry.visible" :size="13" />
          <EyeOff v-else :size="13" />
        </button>

        <!--
          Locked by an ancestor reads differently from locked in its own right,
          and cannot be cleared here: the reason is written on a folder that may
          be collapsed out of sight, so a button that appeared to work and
          changed nothing would be worse than one that says where to go.
        -->
        <button
          type="button"
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded"
          :class="[
            row.lockedByAncestor
              ? 'cursor-not-allowed text-muted-foreground/40'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            !row.entry.locked && !row.lockedByAncestor && 'opacity-0 group-hover/row:opacity-100',
          ]"
          :title="lockTitle(row)"
          :disabled="row.lockedByAncestor"
          @click.stop="onToggleLocked(row.entry)"
        >
          <Lock v-if="row.entry.locked || row.lockedByAncestor" :size="12" />
          <LockOpen v-else :size="12" />
        </button>

        <!--
          Rasters only: the artwork's words are the page's and lettering is its
          face's, by what they are. On the source side every raster is the page's
          and there is no face to take one into, so the column stands empty there.
        -->
        <button
          v-if="row.entry.kind === 'raster' && editor.textSide === 'translation'"
          type="button"
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
          :class="!isLinked(row.entry) && 'opacity-0 group-hover/row:opacity-100'"
          :title="isLinked(row.entry) ? '共用素材：每個翻譯面都有它。點一下只留在這一面' : '只屬於這一面。點一下變成每個翻譯面共用的素材'"
          @click.stop="onToggleLinked(row.entry)"
        >
          <Link2 v-if="isLinked(row.entry)" :size="12" />
          <Link2Off v-else :size="12" />
        </button>
        <span v-else class="w-5 shrink-0" />

        <!--
          A checkerboard, which is what transparency looks like everywhere: the
          switch says the empty squares are spoken for. Only a raster has any,
          and the column is held open on the rows without one so the names below
          it stay in a line.
        -->
        <button
          v-if="row.entry.kind === 'raster'"
          type="button"
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded"
          :class="[
            isRowLocked(row)
              ? 'cursor-not-allowed text-muted-foreground/40'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            !row.entry.alphaLocked && !isRowLocked(row) && 'opacity-0 group-hover/row:opacity-100',
          ]"
          :title="alphaLockTitle(row)"
          :disabled="isRowLocked(row)"
          @click.stop="onToggleAlphaLocked(row.entry)"
        >
          <Grid2x2Check v-if="row.entry.alphaLocked" :size="12" />
          <Grid2x2 v-else :size="12" />
        </button>
        <span v-else class="w-5 shrink-0" />

        <LayerThumb
          v-if="row.entry.kind === 'raster' && layersDir"
          :entry="row.entry"
          :layers-dir="layersDir"
        />
        <component
          v-else
          :is="iconFor(row.entry)"
          :size="12"
          class="shrink-0 text-muted-foreground"
        />

        <input
          v-if="renaming?.id === row.entry.id"
          ref="renameEl"
          v-model="renaming.draft"
          type="text"
          class="min-w-0 flex-1 rounded border border-input bg-background px-1 text-xs"
          @click.stop
          @dblclick.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="renaming = null"
          @blur="commitRename"
        />
        <!--
          A text object's name is its words, so opening it here opens the same
          edit the label list and the canvas share.
        -->
        <CodeEditField
          v-else-if="isEditingText(row)"
          class="min-w-0 flex-1 py-1 text-xs"
          :value="textCode(row)"
          :placeholder="editor.textSide === 'source' ? '(沒有原文)' : '(未翻譯)'"
          @click.stop
          @dblclick.stop
          @key="onTextKey"
          @blur="onTextBlur(row, $event)"
        />
        <!--
          A text object says all of its words, line breaks included, as the
          label list does: a first line cut short hides the part being checked.
        -->
        <span
          v-else
          class="min-w-0 flex-1 text-xs"
          :class="[
            row.entry.kind === 'text' ? 'py-1 leading-snug whitespace-pre-wrap' : 'truncate',
            isUntitled(row.entry) && 'text-muted-foreground/60 italic',
          ]"
          :title="isRowLocked(row) ? undefined : canRename(row.entry) ? '雙擊改名' : '雙擊編輯文字'"
          @dblclick.stop="onNameOpen(row)"
        >{{ nameFor(row.entry) }}</span>

        <!--
          The same box the canvas is drawing in place of each of this object's
          characters. A state rather than an error, so it sits with the lock
          and the eye: the object is intact and exports as itself, and it is
          this machine that is missing something.
        -->
        <span
          v-if="row.missingFamily !== null"
          class="flex shrink-0 items-center text-muted-foreground"
          :title="missingFamilyLabel(row.missingFamily)"
        >
          <SquareX :size="12" />
        </span>

        <button
          v-if="row.entry.kind !== 'text'"
          type="button"
          class="h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-secondary hover:text-foreground"
          :class="isPinned(row.entry) ? 'flex text-primary' : 'hidden text-muted-foreground group-hover/row:flex'"
          :title="isPinned(row.entry) ? `「${row.entry.name}」不再顯示在標籤清單的頁列` : `把叫「${row.entry.name}」的圖層顯示在標籤清單的頁列（這本書的每一頁）`"
          @click.stop="project.togglePinnedLayerName(row.entry.name)"
        >
          <Pin :size="12" :class="isPinned(row.entry) && 'fill-current'" />
        </button>

        <button
          v-if="row.entry.kind === 'raster'"
          type="button"
          class="h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-secondary hover:text-foreground"
          :class="isRetouchLayer(row.entry) ? 'flex text-primary' : 'hidden text-muted-foreground group-hover/row:flex'"
          :title="isRetouchLayer(row.entry) ? `修圖按鈕不再改叫「${row.entry.name}」的圖層` : `修圖按鈕也改叫「${row.entry.name}」的圖層的不透明度（這本書的每一頁）`"
          @click.stop="project.toggleRetouchLayerName(row.entry.name)"
        >
          <Sun :size="12" :class="isRetouchLayer(row.entry) && 'fill-current'" />
        </button>

        <button
          v-if="row.entry.kind === 'group' && !isRowLocked(row)"
          type="button"
          class="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground group-hover/row:flex hover:bg-secondary hover:text-foreground"
          title="解散資料夾（內容留在原地）"
          @click.stop="onDissolve(row.entry.id)"
        >
          <Ungroup :size="13" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { entryOnPage, treeOf } from '@shared/page/trees'
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  Grid2x2,
  Grid2x2Check,
  Image,
  Link2,
  Link2Off,
  Lock,
  LockOpen,
  Pin,
  SquareX,
  Sun,
  Type,
  Ungroup,
} from '@lucide/vue'
import type {
  GroupLayerEntry,
  LayerEntry,
  RasterLayerEntry,
  TextLayerEntry,
} from '@shared/page/types'
import { shownCodeOf, shownLinesOf } from '@shared/page/units'
import { plainOf } from '@shared/page/markup'
import { layersDirOf } from '@shared/ssk/constants'
import CodeEditField from '@/components/CodeEditField.vue'
import LayerThumb from '@/components/LayerThumb.vue'
import { useMarkupSession } from '@/composables/useMarkupSession'
import { textWriter } from '@/composables/useTextEditSurface'
import { familyIsMissing, missingFamilyLabel } from '@/lib/labelRaster'
import { dropTargetFor, flattenLayerRows, type LayerTreeRow } from '@/lib/layerRows'
import { zoneAt, type DropZone } from '@/lib/rowDrop'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()
const markup = useMarkupSession()

/**
 * The open page only. The tree is about how this page stacks, which is a
 * question the next page has its own answer to.
 */
const currentFile = computed(() =>
  editor.currentPageId ? (project.pageById(editor.currentPageId) ?? null) : null,
)

// Ids belong to one page, so a folder left collapsed here cannot be mistaken
// for one on another page.
const collapsed = computed(() => editor.collapsedLayerIds)

/**
 * The family a text row asked for and this machine does not have, or null.
 *
 * The family is the object's own, so what a row reports missing is what that
 * row would draw with and nothing inherited from elsewhere.
 */
function missingFamilyOf(entry: LayerEntry): string | null {
  if (entry.kind !== 'text') return null
  const { fontFamily } = entry.body.style
  return familyIsMissing(fontFamily) ? fontFamily : null
}

const rows = computed(() =>
  (currentFile.value
    ? flattenLayerRows(
        treeOf(currentFile.value.page, editor.textSide, project.activeFace),
        collapsed.value,
        editor.textSide,
        project.activeFace,
      )
    : []
  ).map((row) => ({ ...row, missingFamily: missingFamilyOf(row.entry) })),
)

const layersDir = computed(() =>
  currentFile.value ? layersDirOf(currentFile.value.pageDir) : null,
)

/** What a range reaches over, in the order the panel is showing it. */
const sequence = computed(() => rows.value.map((r) => r.entry.id))

function toggleCollapsed(id: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(id)) next.add(id)
  editor.collapsedLayerIds = next
}

function isSelected(id: string): boolean {
  return editor.isSelected(id)
}

function onPick(row: LayerTreeRow, e: MouseEvent) {
  if (e.shiftKey) editor.extendSelectionTo(row.entry.id, sequence.value)
  else if (e.ctrlKey || e.metaKey) editor.toggleSelected(row.entry.id)
  else editor.selectOnly(row.entry.id)
}

function isPinned(entry: LayerEntry): boolean {
  return entry.kind !== 'text' && project.pinnedLayerNames.includes(entry.name)
}

function isRetouchLayer(entry: LayerEntry): boolean {
  return entry.kind === 'raster' && project.retouchLayerNames.includes(entry.name)
}

function onToggleVisible(entry: LayerEntry) {
  if (!editor.currentPageId) return
  editor.cmdSetLayerVisible(editor.currentPageId, entry.id, !entry.visible)
}

function lockTitle(row: LayerTreeRow): string {
  if (row.lockedByAncestor) return '由上層資料夾鎖定'
  return row.entry.locked ? '解鎖' : '鎖定（連同裡面的內容）'
}

function onToggleLocked(entry: LayerEntry) {
  if (!editor.currentPageId) return
  editor.cmdSetLayerLocked(editor.currentPageId, entry.id, !entry.locked)
}

function isLinked(entry: LayerEntry): boolean {
  return editor.currentPageId !== null && project.isLinked(editor.currentPageId, entry.id)
}

function onToggleLinked(entry: LayerEntry) {
  if (!editor.currentPageId) return
  editor.cmdSetLayerLinked(editor.currentPageId, entry.id, !isLinked(entry))
}

function alphaLockTitle(row: LayerTreeRow): string {
  if (isRowLocked(row)) return '圖層已鎖定'
  return row.entry.kind === 'raster' && row.entry.alphaLocked
    ? '解除鎖住透明像素'
    : '鎖住透明像素（只畫在已經有像素的地方）'
}

function onToggleAlphaLocked(entry: LayerEntry) {
  if (!editor.currentPageId || entry.kind !== 'raster') return
  editor.cmdSetLayerAlphaLocked(editor.currentPageId, entry.id, !entry.alphaLocked)
}

function onDissolve(folderId: string) {
  if (!editor.currentPageId) return
  editor.cmdDissolveFolder(editor.currentPageId, folderId)
}


const dragging = ref<{ id: string; path: number[] } | null>(null)
const hover = ref<{ id: string; zone: DropZone } | null>(null)

function onDragStart(row: LayerTreeRow, e: DragEvent) {
  dragging.value = { id: row.entry.id, path: row.path }
  // Without a payload Chromium refuses to start the drag at all, even though
  // the drop is resolved from component state rather than from what is carried.
  e.dataTransfer?.setData('text/plain', row.entry.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(row: LayerTreeRow, e: DragEvent) {
  if (dragging.value === null || dragging.value.id === row.entry.id) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  hover.value = { id: row.entry.id, zone: zoneAt(rect, e.clientY, row.entry.kind === 'group') }
}

function onDrop() {
  const from = dragging.value
  const over = hover.value
  clearDrag()
  if (from === null || over === null || !editor.currentPageId) return
  const row = rows.value.find((r) => r.entry.id === over.id)
  if (row === undefined) return
  const target = dropTargetFor(row, over.zone)
  if (target === null) return
  editor.cmdMoveLayer(editor.currentPageId, from.id, from.path, target)
}

function clearDrag() {
  dragging.value = null
  hover.value = null
}


/**
 * A text object is the one row that cannot be renamed: its translation is its
 * identity, so a name of its own would only be a second one that can drift.
 */
function canRename(entry: LayerEntry): entry is GroupLayerEntry | RasterLayerEntry {
  return entry.kind !== 'text'
}

/** Its own lock or an ancestor's — either one refuses, so the row offers nothing. */
function isRowLocked(row: LayerTreeRow): boolean {
  return row.entry.locked || row.lockedByAncestor
}

const renaming = ref<{ id: string; draft: string } | null>(null)
const renameEls = useTemplateRef<HTMLInputElement[]>('renameEl')

function isEditingText(row: LayerTreeRow): boolean {
  const pending = editor.pendingTextEdit
  return row.entry.kind === 'text' && pending?.pageId === editor.currentPageId && pending?.labelId === row.entry.id
}

function textCode(row: LayerTreeRow): string {
  const pageId = editor.currentPageId
  const block = pageId === null ? undefined : project.blockById(pageId, row.entry.id)
  return block === undefined ? '' : shownCodeOf(block)
}

function onNameOpen(row: LayerTreeRow) {
  const pageId = editor.currentPageId
  if (row.entry.kind !== 'text') {
    void beginRename(row)
    return
  }
  if (pageId === null || isRowLocked(row)) return
  editor.revealLabel(pageId, row.entry.id)
  editor.beginTextEdit(pageId, row.entry.id, textCode(row))
  textWriter.value = 'code'
}

function onTextKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    editor.commitTextEdit()
  }
}

/** The canvas's box and the bar over the selection are the same edit, so leaving to them is not leaving. */
function onTextBlur(row: LayerTreeRow, e: FocusEvent) {
  if (!isEditingText(row)) return
  if (markup.keepsSession(e.relatedTarget)) return
  editor.commitTextEdit()
}

async function beginRename(row: LayerTreeRow) {
  const entry = row.entry
  if (!canRename(entry) || isRowLocked(row)) return
  renaming.value = { id: entry.id, draft: entry.name }
  await nextTick()
  // Selected rather than merely focused: an auto-named 資料夾3 is there to be
  // replaced, not appended to.
  const field = renameEls.value?.[0]
  field?.focus()
  field?.select()
}

/**
 * Enter and losing focus both land the name, as they do in any tree; Escape
 * clears the draft first, so the blur that follows it finds nothing to commit.
 *
 * An empty name is refused rather than stored — a row with nothing on it could
 * not be told from its neighbours, and the name it had is the better answer.
 */
function commitRename() {
  const editing = renaming.value
  renaming.value = null
  if (editing === null || !editor.currentPageId) return
  const entry = currentFile.value
    ? entryOnPage(currentFile.value.page, editing.id)
    : undefined
  if (entry === undefined || !canRename(entry)) return
  const name = editing.draft.trim()
  if (name.length === 0) return
  editor.cmdRenameLayer(editor.currentPageId, editing.id, entry.name, name)
}

function iconFor(entry: LayerEntry) {
  if (entry.kind === 'group') return Folder
  if (entry.kind === 'raster') return Image
  return Type
}

function isUntitled(entry: LayerEntry): boolean {
  return entry.kind === 'text' && wordsOf(entry).every((line) => line.length === 0)
}

/**
 * ⚠️ Goes up to the page: a block standing in for a chosen candidate says what
 * the candidate says, and a tree reading only the block's own words would keep
 * showing what was typed before somebody picked something else.
 */
function wordsOf(entry: TextLayerEntry): readonly string[] {
  const page = project.pageById(editor.currentPageId ?? '')?.page
  if (page !== undefined) return shownLinesOf(entry)
  // Off-page there is no unit to resolve, and the body is still code — a tree
  // row is a name, so it says the words rather than the tags around them.
  return entry.body.lines.map(plainOf)
}

/**
 * A text object shows its translation rather than a name of its own. The tree
 * and the label list are two views of the same objects, and a name anyone could
 * edit would let one object read differently in each.
 */
function nameFor(entry: LayerEntry): string {
  if (entry.kind !== 'text') return entry.name
  return isUntitled(entry) ? '(未翻譯)' : wordsOf(entry).join('\n')
}
</script>
