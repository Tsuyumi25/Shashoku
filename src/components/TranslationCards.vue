<template>
  <!--
    Every object's translation candidates, standing in the margin beside the
    page.

    ⭐ All of them at once, because comparing is the whole reason a list exists
    and a list you have to summon is one you compare against memory. Which
    object each belongs to is drawn rather than arranged: a line appears for the
    one being pointed at or selected, so nothing has to move to say so and the
    page is not laced with lines.
  -->
  <svg v-if="tether" class="tether-field">
    <line :x1="tether.a.x" :y1="tether.a.y" :x2="tether.b.x" :y2="tether.b.y" class="tether" />
  </svg>

  <div
    v-for="card in drawn"
    :key="card.key"
    class="trans-card"
    :class="card.objectId === linked && 'trans-card-linked'"
    :style="card.style"
    :data-object="card.objectId"
    @pointerdown.stop="cards$.touch(card.key)"
    @pointerenter="pointedCard = card.objectId"
    @pointerleave="pointedCard = null"
  >
    <!-- The grip, and the whole of what moves the card — as on a reading's list. -->
    <div
      class="trans-grip"
      title="拖動這張清單"
      @pointerdown.stop="onGripDown(card.key, $event)"
      @pointermove="onGripMove"
      @pointerup="onGripUp"
      @pointercancel="onGripUp"
    />

    <div
      v-for="row in card.rows"
      :key="row.id"
      class="trans-row"
      :class="row.id === card.chosen && 'trans-row-on'"
      @pointerdown="pick(card.objectId, row.id)"
    >
      <div class="trans-row-text">
        <!--
          Editable where it is picked and nowhere else: typing into the row the
          object is reading is the same act as typing into the object, so that
          is the row with a caret — and the only one whose words are anywhere a
          reader can see them.
        -->
        <textarea
          v-if="row.id === card.chosen"
          v-auto-grow
          rows="1"
          spellcheck="false"
          placeholder="（未翻譯）"
          class="trans-text trans-input"
          :value="row.text"
          @pointerdown.stop
          @focus="beginEdit(card.objectId, row.text)"
          @input="write(card.objectId, $event)"
          @blur="editor.commitTextEdit()"
        />
        <p v-else class="trans-text" :class="!row.text && 'trans-blank'">
          {{ row.text || '（未翻譯）' }}
        </p>
        <p class="trans-who">{{ whoWrote(row) }}</p>
      </div>

      <!--
        ⚠️ A button and never a right-click. Throwing a proposal away is a
        destructive act, and destructive acts are aimed at rather than swept
        for — the readings' cards have no right-click at all, so growing one
        here would put the only gesture that bites on the one of two nearly
        identical cards nobody expects it on.
      -->
      <button
        v-if="row.id !== OWN"
        type="button"
        class="trans-drop"
        title="刪掉這則候選"
        @pointerdown.stop
        @click="remove(card.objectId, row.id)"
      >
        ✕
      </button>
      <span v-else class="trans-drop-gap" />
    </div>

    <!--
      Where "I want another one" is pressed, with the hand already here. The
      right-click on the object stays what it was, for the object that has no
      card yet to press.
    -->
    <button type="button" class="trans-foot" @pointerdown.stop @click="propose(card.objectId)">
      ＋ 新增候選
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect, watchPostEffect } from 'vue'
import type { Box } from '@shared/ocr/places'
import type { TextLayerEntry } from '@shared/page/types'
import { findTextObject } from '@shared/page/tree'
import { pageStack, stackedTextNodes } from '@shared/page/stack'
import { generateId } from '@shared/page/schema'
import { shownLinesOf } from '@shared/page/units'
import { drawnLabel } from '@/lib/labelRaster'
import { screenToContentPx } from '@/lib/coords'
import { vAutoGrow } from '@/lib/autoGrow'
import { useViewportOrigin } from '@/composables/useCanvasStage'
import { typeSizeFor } from '@/lib/sourceCards'
import {
  OWN,
  offersAChoice,
  planTranslations,
  rowsOf,
  tetherBetween,
  translationCardSize,
  type TranslationList,
  type TranslationRow,
} from '@/lib/translationCards'
import { useCardStore } from '@/stores/cardStore'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const props = defineProps<{
  /**
   * Which object's line to draw.
   *
   * ⚠️ Passed in rather than read off a store: what the pointer is over is the
   * canvas's own business, and the line is the one thing here that has to keep
   * up with a drag — the lists themselves stand still.
   */
  linked: string | null
}>()

/**
 * The list under the pointer, which asks the same question from the other end:
 * a card in the margin is no more self-explanatory than an object with several
 * ways to read it, and the line is the answer either way.
 */
const pointedCard = ref<string | null>(null)

/**
 * Whose line to draw. Pointing at a list beats pointing at an object, which
 * beats having selected one — nearest the hand wins, and the two of them are
 * never under the pointer at once.
 */
const linked = computed(() => pointedCard.value ?? props.linked)

const editor = useEditorStore()
const project = useProjectStore()
const cards$ = useCardStore()
const viewportOrigin = useViewportOrigin()

const file = computed(() =>
  editor.currentPageId === null ? undefined : project.pageById(editor.currentPageId),
)

const basePx = computed(() => (file.value ? typeSizeFor(file.value.page) : 12))

/** A card's name has to be the page's as well as the object's. */
const pagePrefix = computed(() => `${editor.currentPageId ?? ''}|translation|`)

function pinKey(objectId: string): string {
  return `${pagePrefix.value}${objectId}`
}

/** Which objects are drawn at all, so a card never stands for a hidden one. */
const shown = computed(() => {
  const out = new Set<string>()
  for (const { entry } of stackedTextNodes(pageStack(file.value?.page.layers ?? [], 'translation'))) {
    out.add(entry.id)
  }
  return out
})

/**
 * Where an object stands, which is where its line has to reach back to.
 *
 * ⚠️ Measured from what the object *reads as*, slot resolved, and not from its
 * own typed lines. An object showing a proposal usually has nothing in those
 * lines at all, so measuring them gives a frame the size of an empty string
 * pinned to the anchor — and a line drawn to the edge of that ends in the middle
 * of the words a reader can see.
 *
 * ⚠️ Asked for one object at a time rather than computed for the page. This
 * measures text, and the two things that want it want one each: the line wants
 * the object in your hand, and the placement wants the card that has just
 * appeared. Held as a map of the whole page it would remeasure every object on
 * every frame of every drag.
 */
function frameOf(entry: TextLayerEntry): Box {
  const body = entry.body
  const page = file.value?.page
  const drawn = drawnLabel(
    page === undefined ? body.lines.join('\n') : shownLinesOf(page, entry).join('\n'),
    body.style,
    entry.effects,
    { x: body.x, y: body.y },
    body.rotation,
  )
  return {
    x: drawn.center.x - drawn.box.w / 2,
    y: drawn.center.y - drawn.box.h / 2,
    w: drawn.box.w,
    h: drawn.box.h,
  }
}

interface Listed {
  objectId: string
  rows: TranslationRow[]
  chosen: string
  entry: TextLayerEntry
}

/** Every object with a choice to offer, and no frame measured for any of them. */
const listed = computed<Listed[]>(() => {
  const out: Listed[] = []
  const page = file.value?.page
  if (page === undefined) return out
  // ⚠️ One card per translation, hung off its first block. The pool belongs to
  // the unit, so a card per block would offer the same choice twice and let two
  // of them disagree about which row is picked.
  for (const unit of page.translationUnits) {
    const first = unit.translation.members[0]
    const entry = first === undefined ? undefined : findTextObject(page.layers, first)
    if (entry === undefined || !shown.value.has(entry.id)) continue
    const rows = rowsOf(page.layers, unit)
    if (!offersAChoice(rows)) continue
    out.push({ objectId: entry.id, rows, chosen: unit.chosen ?? OWN, entry })
  }
  return out
})

const standing = (list: Listed): TranslationList => ({
  objectId: list.objectId,
  rows: list.rows,
  chosen: list.chosen,
  from: frameOf(list.entry),
})

/**
 * ⭐ The placement answers where a *new* card goes and nothing else. A card that
 * already has a box keeps it — a list that moved out from under somebody
 * mid-sentence would lose them their place, and the object's own frame moves
 * every time it is dragged.
 */
watchEffect(() => {
  const page = file.value?.page
  if (!page) return
  const fresh = listed.value.filter((list) => !cards$.boxOf(pinKey(list.objectId)))
  if (fresh.length === 0) return
  const already = cards$.boxesUnder(pagePrefix.value)
  for (const card of planTranslations(fresh.map(standing), basePx.value, page, already)) {
    cards$.place(pinKey(card.objectId), { x: card.x, y: card.y, w: card.w, h: card.h })
  }
})

/**
 * A card grows with what it holds rather than being replanned: a proposal added
 * to a list must not send the list somewhere else to be read.
 */
watchEffect(() => {
  for (const list of listed.value) {
    cards$.grow(pinKey(list.objectId), translationCardSize(list.rows, basePx.value))
  }
})

interface DrawnCard {
  key: string
  objectId: string
  rows: readonly TranslationRow[]
  chosen: string
  style: Record<string, string>
}

const drawn = computed<DrawnCard[]>(() => {
  const out: DrawnCard[] = []
  for (const list of listed.value) {
    const key = pinKey(list.objectId)
    const box = cards$.boxOf(key)
    if (!box) continue
    out.push({
      key,
      objectId: list.objectId,
      rows: list.rows,
      chosen: list.chosen,
      style: {
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.w}px`,
        minHeight: `${box.h}px`,
        fontSize: `${basePx.value}px`,
        zIndex: String(cards$.orderOf(key)),
      },
    })
  }
  return out
})

/**
 * The line, drawn between the facing edges of the object and its list.
 *
 * ⚠️ The object's frame is read live while the card's box is not. The card is
 * held still on purpose; the line is the one thing that must keep up, since what
 * it says is which list belongs to the object in your hand — and an end left
 * behind points at where that object was.
 */
const tether = computed(() => {
  if (linked.value === null) return null
  const list = listed.value.find((l) => l.objectId === linked.value)
  const box = cards$.boxOf(pinKey(linked.value))
  if (!list || !box) return null
  return tetherBetween(frameOf(list.entry), box)
})

function whoWrote(row: TranslationRow): string {
  if (row.by === 'own') return '自己打的'
  if (row.by === 'human') return '你寫的'
  return row.source ?? '模型'
}

function pick(objectId: string, rowId: string) {
  const pageId = editor.currentPageId
  if (pageId === null) return
  editor.cmdPickTranslation(pageId, objectId, rowId === OWN ? null : rowId)
}

/**
 * Typing goes through the editor's own session, exactly as typing on the canvas
 * does: written through so the object keeps up, and one entry on the stack for
 * the visit rather than one per keystroke.
 */
function beginEdit(objectId: string, from: string) {
  const pageId = editor.currentPageId
  if (pageId === null) return
  editor.beginTextEdit(pageId, objectId, from)
}

function write(objectId: string, event: Event) {
  const pageId = editor.currentPageId
  if (pageId === null) return
  const text = (event.target as HTMLTextAreaElement).value
  project.updateLabelText(pageId, objectId, text)
}

function remove(objectId: string, id: string) {
  const pageId = editor.currentPageId
  if (pageId === null) return
  editor.cmdRemoveTranslation(pageId, objectId, id)
}

function propose(objectId: string) {
  const pageId = editor.currentPageId
  if (pageId === null) return
  editor.cmdAddTranslationCandidate(pageId, objectId, generateId())
}

/**
 * The caret follows a blank proposal to wherever one appears.
 *
 * ⭐ A rule about the state rather than a step in the button that made it, so
 * the footer here and the right-click on the object both land the same way —
 * asking for a blank and then having to go and find it says the request meant
 * nothing, and the right-click is the one that has no card to look at yet.
 *
 * "Chosen, not the object's own, and empty" is only ever the blank somebody has
 * just asked for: creating one picks it, and nothing else on a card is empty.
 *
 * ⚠️ Post-flush, so the card is in the document, and remembered in a plain
 * variable — read from a render effect it would subscribe the render to itself.
 * ⚠️ `preventScroll`, or the browser hunts for a scroll container to reveal the
 * field in and finds the canvas's own overlay lying at the size of the canvas.
 */
let caretIn: string | null = null

watchPostEffect(() => {
  for (const card of drawn.value) {
    const row = card.rows.find((r) => r.id === card.chosen)
    if (!row || row.id === OWN || row.text !== '') continue
    const at = `${card.key}:${row.id}`
    if (caretIn === at) continue
    caretIn = at
    document
      .querySelector(`[data-object="${CSS.escape(card.objectId)}"]`)
      ?.querySelector<HTMLTextAreaElement>('.trans-row-on .trans-input')
      ?.focus({ preventScroll: true })
  }
})

// ── Moving a card by its grip ──────────────────────────────────────────────

let grip: { key: string; grab: { x: number; y: number }; from: { x: number; y: number } } | null =
  null
let moved: { x: number; y: number } | null = null

function onGripDown(key: string, e: PointerEvent) {
  if (e.button !== 0) return
  const box = cards$.boxOf(key)
  if (!box) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  const from = { x: box.x, y: box.y }
  grip = { key, grab: pageAt(e), from }
  moved = from
  cards$.touch(key)
}

function onGripMove(e: PointerEvent) {
  if (!grip) return
  const now = pageAt(e)
  moved = { x: grip.from.x + (now.x - grip.grab.x), y: grip.from.y + (now.y - grip.grab.y) }
  cards$.moveTo(grip.key, moved)
}

function onGripUp(e: PointerEvent) {
  const held = grip
  if (!held) return
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  grip = null
  if (moved) editor.cmdMoveCard(held.key, held.from, moved)
}

function pageAt(e: PointerEvent): { x: number; y: number } {
  return screenToContentPx(e.clientX, e.clientY, viewportOrigin(), editor.view)
}
</script>

<style scoped>
/*
 * The page's own pixels throughout — the stage carries the view — except the
 * hairlines, which are marks on the interface and stay one screen pixel through
 * `--px`.
 */
.trans-card {
  position: absolute;
  display: flex;
  flex-direction: column;
  border-radius: 0.35em;
  border: calc(1px * var(--px)) solid var(--border);
  background: var(--card);
  box-shadow: 0 calc(1px * var(--px)) calc(4px * var(--px)) rgb(0 0 0 / 0.25);
  pointer-events: auto;
  user-select: none;
}

/* The one whose line is drawn, so both ends of it agree. */
.trans-card-linked {
  border-color: var(--primary);
}

/* Hung off the corner and outside the card, as the readings' lists are, so the
   rows lose nothing to it. */
.trans-grip {
  position: absolute;
  top: 0;
  left: 100%;
  width: 1.4em;
  height: 1.4em;
  border-radius: 0 0.3em 0.3em 0;
  cursor: grab;
  background: color-mix(in oklch, var(--muted-foreground) 32%, transparent);
}
.trans-grip:hover {
  background: color-mix(in oklch, var(--muted-foreground) 58%, transparent);
}
.trans-grip:active {
  cursor: grabbing;
}

.trans-row {
  display: flex;
  align-items: flex-start;
  gap: 0.35em;
  padding: 0 0.35em;
  cursor: pointer;
}
.trans-row:hover {
  background: var(--secondary);
}
.trans-row-on,
.trans-row-on:hover {
  background: color-mix(in oklch, var(--primary) 14%, transparent);
}

.trans-row-text {
  min-width: 0;
  flex: 1;
}

.trans-text {
  font-size: 1em;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--foreground);
}
.trans-blank {
  color: color-mix(in oklch, var(--muted-foreground) 60%, transparent);
}

/* Sized and spaced exactly like the line it replaces, so picking a row does not
   shift the rows under it. */
.trans-input {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  line-height: inherit;
  color: inherit;
  resize: none;
  outline: none;
  /* The directive keeps it exactly as tall as its text, so a scrollbar here
     would only ever be a rounding error made visible — and a scrollbar under
     the pointer is a field that eats the canvas's wheel. */
  overflow: hidden;
}

/* Who wrote it, under the words rather than beside them — the same arrangement
   the readings' list uses, so two lists read the same way. */
.trans-who {
  font-size: 0.62em;
  line-height: 1.5;
  color: var(--muted-foreground);
}

/* Shown on hover, and holding its room the rest of the time: a column that
   appeared under the pointer would reflow every row it is in. */
.trans-drop,
.trans-drop-gap {
  flex-shrink: 0;
  width: 1.2em;
  font-size: 0.8em;
  line-height: 1.9;
  text-align: center;
}
.trans-drop {
  color: var(--muted-foreground);
  opacity: 0;
}
.trans-row:hover .trans-drop {
  opacity: 0.7;
}
.trans-drop:hover {
  color: var(--destructive);
  opacity: 1;
}

.trans-foot {
  flex-shrink: 0;
  border-top: calc(1px * var(--px)) solid var(--border);
  padding: 0.2em 0;
  font-size: 0.8em;
  line-height: 1.4;
  color: var(--muted-foreground);
  cursor: pointer;
}
.trans-foot:hover {
  background: var(--secondary);
  color: var(--foreground);
}

/* The line lives in the stage's coordinates like everything else here, and has
   to be allowed out of its own box: both ends are off the page. */
.tether-field {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}
.tether {
  stroke: var(--primary);
  stroke-width: calc(1.5px * var(--px));
  stroke-dasharray: calc(4px * var(--px)) calc(3px * var(--px));
  opacity: 0.8;
}
</style>
