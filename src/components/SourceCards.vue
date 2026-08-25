<template>
  <!--
    The readings a page is still offering, standing on the artwork they were
    read off.

    ⭐ Beside the balloon rather than in a panel. What somebody is judging here
    is "which balloon does this sentence belong to", which is a question about
    where things are — so the evidence stands where the answer is, and the
    answer is given by pointing at it. A list in the sidebar made that one
    judgement into a walk: read the row, look back at the artwork to see where
    it came from, look back at the row.
  -->
  <div
    v-for="card in drawn"
    :key="card.key"
    class="source-card"
    :style="card.style"
    @pointerdown="cards$.touch(card.key)"
  >
    <!--
      The grip, and the whole of what moves the card: a press anywhere else is a
      press on a row, and a card that moved from anywhere would make taking a
      row a coin toss.

      A square in the corner rather than a bar along the top. A bar wide enough
      to grab is a bar deep enough to be worth reading, and a shallow one is a
      target nobody can hit; a square is aimed at rather than swept for, and it
      costs the rows nothing but their first corner.
    -->
    <div
      class="source-grip"
      :class="card.plan.aside && 'source-grip-aside'"
      :title="card.plan.aside ? '挪走的清單——拖著它換位置' : '拖動這張清單'"
      @pointerdown.stop="onGripDown(card.key, $event)"
      @pointermove="onGripMove"
      @pointerup="onGripUp"
      @pointercancel="onGripUp"
    />

    <div class="source-rows">
      <!--
        Every row this card has offered at any point, so one that has been taken
        leaves its space behind. ⚠️ Rows that closed up would slide the next one
        under the pointer between two presses, which is exactly how this list is
        worked through.
      -->
      <div
        v-for="row in card.rows"
        :key="row.reading.hash"
        class="source-row"
        :class="[row.live ? 'source-row-live' : 'source-row-taken']"
        @pointerenter="row.live && ocr.pointAt(row.reading.hash)"
        @pointerleave="ocr.pointAt(null)"
        @pointerdown.stop="row.live && onRowDown(row.reading, $event)"
        @pointermove="onRowMove"
        @pointerup="onRowUp"
        @pointercancel="onRowCancel"
      >
        <div class="source-row-text">
          <p class="source-text">{{ row.reading.text || EMPTY_READING }}</p>
          <p class="source-who">{{ row.reading.source }}</p>
        </div>
        <span class="source-score" :class="sureness(row.reading.confidence)">
          {{ Math.round(row.reading.confidence * 100) }}
        </span>
      </div>
    </div>

    <!--
      ⭐ The one destructive gesture on this side, and it is a button. Taking a
      reading up already removes it from the list, so what is left when somebody
      reaches for this is "none of these" — the unit being rejected is the
      place, not the row. It is here even with one row left: one vocabulary of
      gestures is better than two.
    -->
    <button
      v-if="!card.plan.aside"
      type="button"
      class="source-foot source-foot-aside"
      @pointerdown.stop
      @click="setAside(card.plan)"
    >
      整批挪走
    </button>
    <!--
      ⚠️ And no way back on a parked list, deliberately. Putting a reading back
      on the page is not something anybody wants for its own sake — finding that
      one of them was right means dragging it onto the balloon, which the rows
      here already do. A list turned down by mistake is what Ctrl+Z is for.
    -->
    <p v-else class="source-foot source-foot-shelf">挪走的</p>
  </div>

  <!--
    What a drop would land on, lit while the hand is carrying something. The
    highlight and the drop are the same answer read twice, so what lights up is
    what will be written.
  -->
  <div v-if="target" class="source-target" :style="targetStyle" />

  <!-- And what the hand is carrying, following it. -->
  <div v-if="carrying" class="source-ghost" :style="ghostStyle">
    {{ carrying.reading.text || EMPTY_READING }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import type { OcrCandidatePersisted } from '@shared/page/types'
import type { Box, Place } from '@shared/ocr/places'
import { placesIn } from '@shared/ocr/places'
import { answeredBy, offeredReadings } from '@shared/ocr/offer'
import { claimsOf } from '@shared/ocr/vote'
import { textObjects } from '@shared/page/tree'
import { textOfBody } from '@shared/page/text'
import { screenToContentPx } from '@/lib/coords'
import { drawnLabel } from '@/lib/labelRaster'
import {
  asideKeyOf,
  cardSize,
  EMPTY_READING,
  CROWDED,
  crowding,
  keyOf,
  marginCards,
  outsideCards,
  planCards,
  slideClear,
  textsOf,
  typeSizeFor,
  type CardPlan,
  type Listed,
} from '@/lib/sourceCards'
import { useViewportOrigin } from '@/composables/useCanvasStage'
import { useCardStore } from '@/stores/cardStore'
import { useEditorStore } from '@/stores/editorStore'
import { OWN_CONFIDENCE_SCALE, useOcrStore } from '@/stores/ocrStore'
import { useProjectStore } from '@/stores/projectStore'

const editor = useEditorStore()
const project = useProjectStore()
const ocr = useOcrStore()
const cards$ = useCardStore()
const viewportOrigin = useViewportOrigin()

const file = computed(() =>
  editor.currentPageId === null ? undefined : project.pageById(editor.currentPageId),
)

const pool = computed<readonly OcrCandidatePersisted[]>(() => file.value?.ocr.candidates ?? [])

const objects = computed(() => (file.value ? textObjects(file.value.page.layers) : []))

/** How big the type on a card is, taken from the page rather than the project. */
const basePx = computed(() => (file.value ? typeSizeFor(file.value.page) : 12))

/**
 * Where each object's source stands, which is what a card must not cover.
 *
 * The source and not the translation: a card is evidence about the artwork, and
 * so is the body that stands for the artwork.
 */
const objectBoxes = computed<Box[]>(() =>
  objects.value.map((entry) => {
    const body = entry.source
    const drawn = drawnLabel(
      textOfBody(body),
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
  }),
)

const offeredHashes = computed(
  () =>
    new Set(
      offeredReadings(pool.value, objects.value, OWN_CONFIDENCE_SCALE).map((r) => r.hash),
    ),
)

/** Every place, with what it is offering now and what it has been turned down over. */
const byPlace = computed(() => {
  const answered = answeredBy(objects.value)
  return placesIn(pool.value).map((place) => ({
    place,
    offering: place.readings.filter((r) => offeredHashes.value.has(r.hash)),
    parked: place.readings.filter((r) => r.setAside === true && !answered.has(r.hash)),
  }))
})

/** Everything on this page that a card must not cover. */
const obstacles = computed<Box[]>(() => [
  ...placesIn(pool.value).map(({ x, y, w, h }) => ({ x, y, w, h })),
  ...objectBoxes.value,
])

/** A card's name has to be the page's as well as the place's. */
const pagePrefix = computed(() => `${editor.currentPageId ?? ''}|source|`)

function pinKey(key: string): string {
  return `${pagePrefix.value}${key}`
}

/**
 * The rows each card is holding space for: everything it has offered at any
 * point this session, in the order it first offered them.
 *
 * ⚠️ Recorded rather than derived from the place. A reading the automatic pass
 * already answered for was never on this card, and reserving space for it would
 * open a hole in a card nobody had touched.
 */
watchEffect(() => {
  for (const { place, offering, parked } of byPlace.value) {
    if (offering.length > 0) {
      cards$.noteShown(pinKey(keyOf(place)), offering.map((r) => r.hash))
    }
    if (parked.length > 0) {
      cards$.noteShown(pinKey(asideKeyOf(place)), parked.map((r) => r.hash))
    }
  }
})

/** Everything with a list to show, sized against what that list has held. */
const listed = computed(() => {
  const held = new Map(pool.value.map((r) => [r.hash, r]))
  const rowsOf = (key: string, now: readonly OcrCandidatePersisted[]) => {
    const ever = cards$.rowsShown(pinKey(key))
    const full = ever.map((hash) => held.get(hash)).filter((r): r is OcrCandidatePersisted => !!r)
    return full.length > 0 ? full : now
  }
  const onPage: Listed[] = []
  const parked: Listed[] = []
  for (const { place, offering, parked: aside } of byPlace.value) {
    if (offering.length > 0) {
      onPage.push({ ...place, full: rowsOf(keyOf(place), offering), readings: offering })
    }
    if (aside.length > 0) {
      parked.push({ ...place, full: rowsOf(asideKeyOf(place), aside), readings: aside })
    }
  }
  return { onPage, parked }
})

/**
 * ⭐ The placement answers where a *new* card goes and nothing else. A card that
 * already has a box keeps it: recomputing the whole page every time an object
 * was made or a row was taken would send every card wandering, and a reader who
 * had just found one would have to find it again.
 */
watchEffect(() => {
  const page = file.value?.page
  if (!page) return
  const base = basePx.value
  const prefix = pagePrefix.value

  // ⭐ Whether the page has room at all is settled here, on the first placement,
  // and never asked again. A verdict that could flip as objects were made would
  // move every list on the page at once — the one thing somebody working down
  // them must not have happen.
  if (cards$.boxesUnder(prefix).length === 0 && listed.value.onPage.length > 0) {
    const trial = planCards(listed.value.onPage, obstacles.value, base, page)
    cards$.settleCrowding(prefix, crowding(trial, obstacles.value, page) > CROWDED)
  }

  const tight = cards$.isCrowded(prefix)
  const fresh = listed.value.onPage.filter((p) => !cards$.boxOf(pinKey(keyOf(p))))
  if (fresh.length > 0) {
    // ⚠️ Out through the nearest edge, not into one pile: a list still belongs
    // to its own balloon, and what moved it was the page rather than any
    // decision about it.
    const planned = tight
      ? outsideCards(fresh, base, page)
      : planCards(fresh, [...obstacles.value, ...cards$.boxesUnder(prefix)], base, page)
    for (const plan of planned) {
      const key = pinKey(plan.key)
      if (cards$.boxOf(key)) continue
      cards$.place(key, clearOfTheRest(plan, prefix, base, page))
    }
  }

  for (const plan of marginCards(listed.value.parked, base, page)) {
    const key = pinKey(plan.key)
    if (cards$.boxOf(key)) continue
    cards$.place(key, clearOfTheRest(plan, prefix, base, page))
  }

  // A rerun can bring a place something new after its card was placed. It grows
  // downward from where it stands, so its top does not move.
  for (const list of listed.value.onPage) {
    cards$.grow(pinKey(keyOf(list)), cardSize(textsOf(list.full), base))
  }
  for (const list of listed.value.parked) {
    cards$.grow(pinKey(asideKeyOf(list)), cardSize(textsOf(list.full), base))
  }
})

/**
 * ⭐ Each batch is laid out against itself and knows nothing of what is already
 * standing, so a card arriving later is handed a spot something else has. It
 * gives way rather than the other, which is the only order that leaves what a
 * reader has already found where they found it.
 *
 * On the page it needs nothing: the placement there is given every standing box
 * to avoid.
 */
function clearOfTheRest(
  box: { x: number; y: number; w: number; h: number },
  prefix: string,
  base: number,
  page: { width: number; height: number },
): { x: number; y: number; w: number; h: number } {
  const outside = box.x < 0 || box.y < 0 || box.x + box.w > page.width || box.y + box.h > page.height
  if (!outside) return box
  const standing = cards$
    .boxesUnder(prefix)
    .filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > page.width || b.y + b.h > page.height)
  // Along the edge it is standing on, so it stays as near its own balloon as
  // giving way allows.
  const axis = box.x + box.w <= 0 || box.x >= page.width ? 'y' : 'x'
  return slideClear(box, standing, axis, base * 0.5)
}

interface DrawnCard {
  key: string
  plan: CardPlan
  rows: { reading: OcrCandidatePersisted; live: boolean }[]
  style: Record<string, string>
}

const drawn = computed<DrawnCard[]>(() => {
  const base = basePx.value
  const out: DrawnCard[] = []
  const take = (list: Listed, name: string, aside: boolean) => {
    const key = pinKey(name)
    const box = cards$.boxOf(key)
    if (!box) return
    const live = new Set(list.readings.map((r) => r.hash))
    out.push({
      key,
      plan: {
        key: name,
        full: list.full,
        readings: list.readings,
        from: { x: list.x, y: list.y, w: list.w, h: list.h },
        ...(aside ? { aside: true } : {}),
        ...box,
      },
      rows: list.full.map((reading) => ({ reading, live: live.has(reading.hash) })),
      style: {
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.w}px`,
        minHeight: `${box.h}px`,
        fontSize: `${base}px`,
        // Touched beats untouched and the more recent of two touched ones wins
        // — one rule, and it is the one a hand expects.
        zIndex: String(cards$.orderOf(key)),
      },
    })
  }
  for (const list of listed.value.onPage) take(list, keyOf(list), false)
  for (const list of listed.value.parked) take(list, asideKeyOf(list), true)
  return out
})

/** Where every card stands, for refusing a drop that landed on one. */
const cardBoxes = computed<Box[]>(() => drawn.value.map((c) => c.plan))

/**
 * Which band a confidence falls in.
 *
 * Both lines come off a measured page rather than off round numbers: every
 * reading manga-ocr got right scored 0.97 or better, the band from 0.8 to 0.9
 * held two that were wrong, and 0.72 was a real sound effect while everything
 * from 0.69 down was the recognizer reading line art as characters.
 *
 * ⚠️ Green does not mean right, and cannot. What the colour says is how sure
 * the model was — which is worth knowing and is not the same question.
 */
function sureness(confidence: number): string {
  if (confidence >= 0.9) return 'sure'
  if (confidence >= 0.7) return 'unsure'
  return 'doubtful'
}

function pageAt(e: PointerEvent): { x: number; y: number } {
  return screenToContentPx(e.clientX, e.clientY, viewportOrigin(), editor.view)
}

function holds(box: Box, at: { x: number; y: number }): boolean {
  return at.x >= box.x && at.x <= box.x + box.w && at.y >= box.y && at.y <= box.y + box.h
}

// ── Moving a card by its grip ──────────────────────────────────────────────

const grip = ref<{
  key: string
  grab: { x: number; y: number }
  from: { x: number; y: number }
  to: { x: number; y: number }
} | null>(null)

function onGripDown(key: string, e: PointerEvent) {
  if (e.button !== 0) return
  const box = cards$.boxOf(key)
  if (!box) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  const from = { x: box.x, y: box.y }
  grip.value = { key, grab: pageAt(e), from, to: from }
  cards$.touch(key)
}

/** Written through so the card keeps up with the pointer; the release records. */
function onGripMove(e: PointerEvent) {
  const held = grip.value
  if (!held) return
  const now = pageAt(e)
  held.to = {
    x: held.from.x + (now.x - held.grab.x),
    y: held.from.y + (now.y - held.grab.y),
  }
  cards$.moveTo(held.key, held.to)
}

function onGripUp(e: PointerEvent) {
  const held = grip.value
  if (!held) return
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  grip.value = null
  editor.cmdMoveCard(held.key, held.from, held.to)
}

// ── Carrying a row to a balloon ────────────────────────────────────────────

/** Under this the press was a press and nothing was carried anywhere. */
const CARRY_THRESHOLD_PX = 4

const carrying = ref<{ reading: OcrCandidatePersisted; at: { x: number; y: number } } | null>(null)
let pressed: { reading: OcrCandidatePersisted; from: { x: number; y: number } } | null = null

/**
 * What a drop would land on: the place under the pointer, unless the pointer is
 * over a card, which is a region a drag can be thought better of in.
 */
const target = computed<Place | null>(() => {
  const held = carrying.value
  if (!held) return null
  if (cardBoxes.value.some((box) => holds(box, held.at))) return null
  return placesIn(pool.value).find((place) => holds(place, held.at)) ?? null
})

const targetStyle = computed(() => {
  const box = target.value
  if (!box) return {}
  return {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
  }
})

const ghostStyle = computed(() => {
  const held = carrying.value
  if (!held) return {}
  return {
    left: `${held.at.x}px`,
    top: `${held.at.y}px`,
    fontSize: `${basePx.value}px`,
  }
})

function onRowDown(reading: OcrCandidatePersisted, e: PointerEvent) {
  if (e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  pressed = { reading, from: { x: e.clientX, y: e.clientY } }
}

function onRowMove(e: PointerEvent) {
  if (!pressed) return
  if (
    carrying.value === null &&
    Math.hypot(e.clientX - pressed.from.x, e.clientY - pressed.from.y) < CARRY_THRESHOLD_PX
  )
    return
  carrying.value = { reading: pressed.reading, at: pageAt(e) }
}

function onRowUp(e: PointerEvent) {
  const held = carrying.value
  const landing = target.value
  const onCard = held !== null && cardBoxes.value.some((box) => holds(box, held.at))
  onRowCancel(e)
  if (!held || onCard) return
  drop(held.reading, pageAt(e), landing)
}

function onRowCancel(e: PointerEvent) {
  pressed = null
  carrying.value = null
  ocr.pointAt(null)
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
}

/**
 * What a drop means, decided by where it landed.
 *
 * ⭐ The type comes from the place it was dropped on, not from the place the
 * words were read off. Somebody dropping a row onto a balloon is saying "this
 * sentence belongs here", and how *that* balloon is set is a fact about it —
 * taking the type from where the words came would set a caption vertically
 * because the balloon it was misread from happened to be.
 *
 * On bare artwork the object lands where it was let go, set the way the reading
 * itself was measured. Nothing is snapped back to where it was read: the drop
 * is the statement.
 *
 * ⚠️ A drop on a card writes nothing. A card is the region a drag is thought
 * better of in, which is what makes picking a row up safe to try.
 */
function drop(
  reading: OcrCandidatePersisted,
  at: { x: number; y: number },
  landing: Place | null,
) {
  const pageId = editor.currentPageId
  const page = file.value?.page
  if (pageId === null || !page) return
  // A drag that ended in the gutter is a drag somebody thought better of.
  // Refusing beats creating an object where nothing can be seen.
  if (at.x < 0 || at.y < 0 || at.x > page.width || at.y > page.height) return
  const measured = landing ? claimsOf(landing.readings)[0]?.spokesman : undefined
  editor.cmdAddLabelFromReading(pageId, at, reading, {
    vertical: (measured ?? reading).vertical,
    fontSizePx: (measured ?? reading).fontSizePx,
    leadingPercent: (measured ?? reading).leadingPercent,
  })
}

function setAside(plan: CardPlan) {
  const pageId = editor.currentPageId
  if (pageId === null) return
  editor.cmdSetReadingsAside(
    pageId,
    plan.readings.map((r) => r.hash),
    true,
  )
}
</script>

<style scoped>
/*
 * Everything below is in the page's own pixels — the stage carries the view —
 * except the hairlines, which are marks on the interface and stay one screen
 * pixel through `--px`.
 */
/*
 * ⚠️ The height the placement worked out is a floor, never a ceiling. What that
 * arithmetic cannot know is where the typesetter will break a line, so a card
 * held to it clips its own last rows — and what a row is for is being read
 * whole. It grows downward from a top that does not move, which is the property
 * the placement is actually protecting.
 */
.source-card {
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

/*
 * Square, hung off the card's top right corner and outside it — so it costs the
 * rows nothing at all, not even the end of a first line. Its top is the card's
 * top: a grip standing above the card would be the thing a reader hits when
 * they are aiming at whatever is above it.
 *
 * A bar wide enough to grab is a bar deep enough to be worth reading, and a
 * shallow one is a target nobody can hit; a square is aimed at rather than
 * swept for.
 */
.source-grip {
  position: absolute;
  top: 0;
  left: 100%;
  width: 1.4em;
  height: 1.4em;
  border-radius: 0 0.3em 0.3em 0;
  cursor: grab;
  background: color-mix(in oklch, var(--muted-foreground) 32%, transparent);
}
.source-grip:hover {
  background: color-mix(in oklch, var(--muted-foreground) 58%, transparent);
}
.source-grip-aside {
  background: color-mix(in oklch, var(--destructive) 35%, transparent);
}
.source-grip-aside:hover {
  background: color-mix(in oklch, var(--destructive) 60%, transparent);
}
.source-grip:active {
  cursor: grabbing;
}

.source-rows {
  min-height: 0;
  flex: 1;
}

.source-row {
  display: flex;
  align-items: flex-start;
  gap: 0.35em;
  padding: 0 0.35em;
}
.source-row-live {
  cursor: grab;
}
.source-row-live:hover {
  background: var(--secondary);
}
.source-row-live:active {
  cursor: grabbing;
}
/* Its space is kept and its words are not: the row above and the row below have
   to stay where they were, and this one has been dealt with. */
.source-row-taken {
  visibility: hidden;
}

.source-row-text {
  min-width: 0;
  flex: 1;
}

.source-text {
  font-size: 1em;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--foreground);
}

/* Which model said it, under the words rather than beside them — the same
   arrangement the translation card uses, so two lists read the same way. */
.source-who {
  font-size: 0.62em;
  line-height: 1.5;
  color: var(--muted-foreground);
}

.source-score {
  flex-shrink: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.7em;
  line-height: 2.1;
}
.sure {
  color: oklch(0.46 0.16 150);
}
.unsure {
  color: oklch(0.48 0.13 75);
}
.doubtful {
  color: oklch(0.48 0.21 25);
}
/* This project switches theme with a class rather than the system setting, so
   a `prefers-color-scheme` query here would follow the wrong thing entirely. */
:global(.dark) .sure {
  color: oklch(0.7 0.2 150);
}
:global(.dark) .unsure {
  color: oklch(0.74 0.17 85);
}
:global(.dark) .doubtful {
  color: oklch(0.66 0.22 25);
}

.source-foot {
  flex-shrink: 0;
  border-top: calc(1px * var(--px)) solid var(--border);
  padding: 0.2em 0;
  font-size: 0.8em;
  line-height: 1.4;
  cursor: pointer;
}
.source-foot-aside {
  color: var(--destructive);
}
.source-foot-aside:hover {
  background: color-mix(in oklch, var(--destructive) 12%, transparent);
}
.source-foot-shelf {
  color: var(--muted-foreground);
  cursor: default;
  text-align: center;
}

/* What a drop would land on. Filled as well as outlined: it has to be findable
   at a glance on a page of line art, and it is up only while something is
   being carried. */
.source-target {
  position: absolute;
  z-index: 9998;
  border: calc(2px * var(--px)) solid var(--primary);
  background: color-mix(in oklch, var(--primary) 16%, transparent);
  pointer-events: none;
}

/* What the hand is carrying. It takes no pointer: what is under it is what the
   drop is being aimed at. */
.source-ghost {
  position: absolute;
  z-index: 9999;
  transform: translate(0.5em, 0.5em);
  border-radius: 0.3em;
  border: calc(1px * var(--px)) solid var(--primary);
  background: var(--card);
  padding: 0.1em 0.35em;
  font-size: 1em;
  line-height: 1.5;
  white-space: pre-wrap;
  pointer-events: none;
  opacity: 0.92;
}
</style>
