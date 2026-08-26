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
    @pointerdown.stop="cards$.touch(card.key)"
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
      title="拖動這張清單"
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
          <!--
            ⭐ The row being corrected is a plain box, and the markings are off
            for as long as it is. What they answer is "which of these do I
            want", which is a question somebody has finished with by the time
            they are fixing a character in one — and a caret dragged through
            coloured text reads the colour as a selection.
          -->
          <textarea
            v-if="editing === row.reading.hash"
            v-auto-grow
            v-caret="caret"
            rows="1"
            spellcheck="false"
            :placeholder="EMPTY_READING"
            class="source-text source-input"
            :value="row.reading.text"
            @pointerdown.stop
            @focus="opened(row.reading)"
            @input="write(row.reading.hash, $event)"
            @blur="closed(row.reading.hash)"
          />
          <!--
            Marked character by character against the other readings this card
            is still offering, so what stands out is the one place they part
            company — which on these pages is a single character far more often
            than it is a word.

            ⚠️ The characters are written without a break between them. This
            column wraps with `pre-wrap`, so a newline left between two spans by
            the template would be a space the reading does not have.
          -->
          <p
            v-else-if="row.marks.length > 0"
            class="source-text"
            @pointerdown.stop.prevent="row.live && open(row.reading.hash, $event)"
          ><span
            v-for="(mark, at) in row.marks"
            :key="at"
            :class="standingOf(mark)"
          >{{ mark.ch }}</span></p>
          <!--
            Plain, for the two cases with nothing to mark: a place offering a
            single reading, which has nothing to be compared against, and a
            reading with no characters in it at all.
          -->
          <p
            v-else
            class="source-text"
            @pointerdown.stop.prevent="row.live && open(row.reading.hash, $event)"
          >{{ row.reading.text || EMPTY_READING }}</p>
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
      reaches for this is "none of these" — the unit being dismissed is the
      place, not the row. It is here even with one row left: one vocabulary of
      gestures is better than two.

      ⭐ And the card goes, rather than standing somewhere else. What somebody
      has said is that they are finished with this balloon, and a page that
      answered by lining the finished lists up along the edge would spend the
      margin on exactly the work already done — the reason to press this is to
      stop seeing them.

      ⚠️ Dismissed is not deleted. The readings stay in the pool, where a rerun
      still finds them and the page's own decision still weighs them; what has
      been recorded is only that nobody wants them shown again. Ctrl+Z takes
      the whole list back, and clearing the page's readings outright is what
      offers them afresh.
    -->
    <button
      type="button"
      class="source-foot source-foot-dismiss"
      @pointerdown.stop
      @click="dismiss(card.plan)"
    >
      整批刪掉
    </button>
  </div>

  <!--
    Every object, outlined while the hand is carrying something.

    ⭐ Up only during a drag, and it is what makes replacing possible at all:
    what a hand needs told before it lets go is that this thing can be landed
    on. Without it a drop on an object read as a drop on the balloon, and put a
    second object on top of the first — which looks like a replacement and is a
    duplicate.
  -->
  <template v-if="carrying">
    <div
      v-for="hit in droppableObjects"
      :key="hit.id"
      class="source-object"
      :style="frameStyle(hit.box)"
    />
  </template>

  <!--
    What a drop would land on, lit while the hand is carrying something. The
    highlight and the drop are the same answer read twice, so what lights up is
    what will be written.
  -->
  <div v-if="target" class="source-target" :style="frameStyle(target.box)" />

  <!-- And what the hand is carrying, following it. -->
  <div v-if="carrying" class="source-ghost" :style="ghostStyle">
    {{ carrying.reading.text || EMPTY_READING }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, watchEffect, type Directive } from 'vue'
import type { OcrCandidatePersisted } from '@shared/page/types'
import type { Box, Place } from '@shared/ocr/places'
import { placesIn } from '@shared/ocr/places'
import { offeredReadings } from '@shared/ocr/offer'
import { claimsOf } from '@shared/ocr/vote'
import { isLocked, textObjects } from '@shared/page/tree'
import { pageStack, stackedTextNodes } from '@shared/page/stack'
import { textOfBody } from '@shared/page/text'
import { screenToContentPx } from '@/lib/coords'
import { vAutoGrow } from '@/lib/autoGrow'
import { drawnLabel } from '@/lib/labelRaster'
import { markDisagreements, type Mark } from '@/lib/readingDiff'
import { sourceLook } from '@/lib/sourceLook'
import { obbHoldsPoint, type Obb } from '@/lib/selection/obb'
import {
  cardSize,
  EMPTY_READING,
  CROWDED,
  crowding,
  keyOf,
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
 * Every object as it is drawn, in drawing order — what a card must not cover,
 * and what a carried reading can be dropped on.
 *
 * ⚠️ Read off the stack rather than the tree, so an object inside a folder that
 * is switched off is neither. A frame lit around something invisible would be a
 * target aimed at by guesswork, and a list is not covering what is not there.
 *
 * The source body, which here is simply the drawn one: these cards only stand
 * while the source is the side being worked on.
 */
const objectTargets = computed(() =>
  stackedTextNodes(pageStack(file.value?.page.layers ?? [])).map(({ entry }) => {
    const body = entry.source
    // The reference treatment the canvas draws these with, halo included: the
    // frame a drop lands on has to be the frame a reader can see.
    const look = sourceLook(body.style)
    const drawn = drawnLabel(
      textOfBody(body),
      look.style,
      look.effects,
      { x: body.x, y: body.y },
      body.rotation,
    )
    return {
      id: entry.id,
      locked: isLocked(file.value?.page.layers ?? [], entry.id),
      box: { center: drawn.center, w: drawn.box.w, h: drawn.box.h, rotation: body.rotation },
    }
  }),
)

/**
 * The ones a drop can be landed on.
 *
 * ⚠️ A locked object is not among them, and so is never outlined either. An
 * outline is a promise that letting go here writes something, and locking is
 * exactly the statement that it will not.
 */
const droppableObjects = computed(() => objectTargets.value.filter((t) => !t.locked))

/** The same frames as upright bounds, which is all the placement needs. */
const objectBoxes = computed<Box[]>(() =>
  objectTargets.value.map(({ box }) => ({
    x: box.center.x - box.w / 2,
    y: box.center.y - box.h / 2,
    w: box.w,
    h: box.h,
  })),
)

const offeredHashes = computed(
  () =>
    new Set(
      offeredReadings(pool.value, objects.value, OWN_CONFIDENCE_SCALE).map((r) => r.hash),
    ),
)

/** Every place, with whatever it is still offering. */
const byPlace = computed(() =>
  placesIn(pool.value).map((place) => ({
    place,
    offering: place.readings.filter((r) => offeredHashes.value.has(r.hash)),
  })),
)

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
  for (const { place, offering } of byPlace.value) {
    if (offering.length === 0) continue
    cards$.noteShown(pinKey(keyOf(place)), offering.map((r) => r.hash))
  }
})

/** Everything with a list to show, sized against what that list has held. */
const listed = computed<Listed[]>(() => {
  const held = new Map(pool.value.map((r) => [r.hash, r]))
  const out: Listed[] = []
  for (const { place, offering } of byPlace.value) {
    if (offering.length === 0) continue
    const ever = cards$.rowsShown(pinKey(keyOf(place)))
    const full = ever.map((hash) => held.get(hash)).filter((r): r is OcrCandidatePersisted => !!r)
    out.push({ ...place, full: full.length > 0 ? full : offering, readings: offering })
  }
  return out
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
  if (cards$.boxesUnder(prefix).length === 0 && listed.value.length > 0) {
    const trial = planCards(listed.value, obstacles.value, base, page)
    cards$.settleCrowding(prefix, crowding(trial, obstacles.value, page) > CROWDED)
  }

  const tight = cards$.isCrowded(prefix)
  const fresh = listed.value.filter((p) => !cards$.boxOf(pinKey(keyOf(p))))
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

  // A rerun can bring a place something new after its card was placed. It grows
  // downward from where it stands, so its top does not move.
  for (const list of listed.value) {
    cards$.grow(pinKey(keyOf(list)), cardSize(textsOf(list.full), base))
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
  rows: { reading: OcrCandidatePersisted; live: boolean; marks: Mark[] }[]
  style: Record<string, string>
}

const drawn = computed<DrawnCard[]>(() => {
  const base = basePx.value
  const out: DrawnCard[] = []
  for (const list of listed.value) {
    const name = keyOf(list)
    const key = pinKey(name)
    const box = cards$.boxOf(key)
    if (!box) continue
    const live = new Set(list.readings.map((r) => r.hash))
    // ⚠️ Against what is still standing, not against everything the place ever
    // offered. A reading already taken up is invisible in the card, and letting
    // it decide a column would mark the rows still being judged over a
    // disagreement with something nobody can see.
    const marked = markDisagreements(list.readings.map((r) => r.text))
    const marksOf = new Map(list.readings.map((r, at) => [r.hash, marked[at]]))
    out.push({
      key,
      plan: {
        key: name,
        full: list.full,
        readings: list.readings,
        from: { x: list.x, y: list.y, w: list.w, h: list.h },
        ...box,
      },
      rows: list.full.map((reading) => ({
        reading,
        live: live.has(reading.hash),
        marks: marksOf.get(reading.hash) ?? [],
      })),
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
  return out
})

/** How many factions past the first get a treatment of their own. */
const NAMED_FACTIONS = 3

/**
 * How a character is drawn, given the company it keeps.
 *
 * ⭐ Colour carries the standing and nothing else; what tells two factions
 * apart is an underline and then a weight. Three colours a reader has to hold
 * apart is two more than the ones with colour vision deficiency can rely on,
 * and green against blue against the plain text colour is a distinction that
 * survives every common form of it.
 *
 * ⚠️ No italic among them. The type here falls back to a Japanese face for
 * everything but the digits, and those faces have no italic to reach for — the
 * browser shears the glyphs instead, at a size where the sheared and the
 * upright are exactly what somebody is being asked to tell apart.
 */
function standingOf(mark: Mark): string {
  if (mark.unanimous) return 'source-agreed'
  if (mark.faction === null) return 'source-alone'
  return `source-faction source-faction-${Math.min(mark.faction, NAMED_FACTIONS - 1)}`
}

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

// ── Correcting a reading in place ──────────────────────────────────────────

/**
 * Which row is open for typing, if any.
 *
 * ⭐ Opened by a single press on the words, because the words are the only part
 * of a row that could mean anything else. Everything a hand does to a row —
 * carrying it to a balloon, moving the card — is aimed at the name underneath
 * or the card's own grip, so the text is free to mean "put the caret here" with
 * nothing to disambiguate it against. No second click, and no mode.
 */
const editing = ref<string | null>(null)

/** Where in the row the press landed, for the box that replaces it. */
const caret = ref(0)

/**
 * A box that opens with the caret where the pointer went down.
 *
 * ⭐ Where it landed rather than at either end. The press *is* the statement —
 * somebody puts their finger on the character that is wrong — and a caret that
 * jumped to the end would make every correction a journey back.
 */
const vCaret: Directive<HTMLTextAreaElement, number> = {
  mounted(el, binding) {
    el.focus()
    const at = Math.min(binding.value, el.value.length)
    el.setSelectionRange(at, at)
  },
}

/**
 * Which character of a row the pointer is on.
 *
 * ⚠️ Measured with a range over the whole row rather than from the node the hit
 * test names. The marking cuts the text into a span per character, so what
 * comes back is an offset into one span and says nothing about where that span
 * stands in the sentence.
 */
function offsetAt(e: PointerEvent): number {
  const el = e.currentTarget as HTMLElement
  const spot = document.caretPositionFromPoint?.(e.clientX, e.clientY)
  if (!spot || !el.contains(spot.offsetNode)) return el.textContent?.length ?? 0
  const range = document.createRange()
  range.selectNodeContents(el)
  range.setEnd(spot.offsetNode, spot.offset)
  return range.toString().length
}

function open(hash: string, e: PointerEvent) {
  if (e.button !== 0) return
  caret.value = offsetAt(e)
  editing.value = hash
}

/**
 * ⚠️ The session opens on focus rather than on the press, so that a box the
 * caret reaches any other way still records where it started from.
 */
function opened(reading: OcrCandidatePersisted) {
  const pageId = editor.currentPageId
  if (pageId === null) return
  editor.beginReadingEdit(pageId, reading.hash, reading.text)
}

/** Every keystroke writes through, so the card and its markings keep up. */
function write(hash: string, e: Event) {
  const pageId = editor.currentPageId
  if (pageId === null) return
  project.setReadingText(pageId, hash, (e.target as HTMLTextAreaElement).value)
}

/**
 * ⚠️ Only the row that is still the open one closes anything.
 *
 * Pressing straight into another row opens that one before this box comes
 * down, and taking down a box that still holds the caret fires blur — so this
 * arrives *after* the next row is already open. Closing unconditionally would
 * undo the press that just landed, and worse, commit the session that press had
 * only just begun: what followed would write through and never reach the undo
 * stack.
 *
 * The visit this box was making is closed all the same, by the one that
 * replaced it — `beginReadingEdit` ends whatever was open before it starts.
 */
function closed(hash: string) {
  if (editing.value !== hash) return
  editor.commitTextEdit()
  editing.value = null
}

/**
 * ⚠️ A page turned under an open box closes it. The rows on the next page are
 * another page's readings, and one of them holding this hash would open with a
 * caret nobody put there.
 */
watch(
  () => editor.currentPageId,
  () => {
    editing.value = null
  },
)

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
 * What a drop would land on, and what it would mean there.
 *
 * ⭐ The object wins where both are under the pointer. It is the more particular
 * of the two answers — a balloon is a region, an object is a sentence somebody
 * already put there — and it is the one visibly lit while the hand is over it,
 * so what happens is what was aimed at.
 *
 * ⚠️ A card beats either, and lands nothing. That is the region a drag is
 * thought better of in, which is what makes picking a row up safe to try.
 */
type Landing =
  | { kind: 'object'; id: string; box: Obb }
  | { kind: 'place'; place: Place; box: Obb }

const target = computed<Landing | null>(() => {
  const held = carrying.value
  if (!held) return null
  if (cardBoxes.value.some((box) => holds(box, held.at))) return null
  // Backwards, so the object drawn over the others is the one taken — the same
  // rule the canvas picks an object by.
  for (let i = droppableObjects.value.length - 1; i >= 0; i -= 1) {
    const hit = droppableObjects.value[i]
    if (obbHoldsPoint(hit.box, held.at)) return { kind: 'object', id: hit.id, box: hit.box }
  }
  const place = placesIn(pool.value).find((p) => holds(p, held.at))
  return place ? { kind: 'place', place, box: uprightBox(place) } : null
})

function uprightBox(box: Box): Obb {
  return {
    center: { x: box.x + box.w / 2, y: box.y + box.h / 2 },
    w: box.w,
    h: box.h,
    rotation: 0,
  }
}

/** A frame drawn where its box stands, turned the way its box is turned. */
function frameStyle(box: Obb): Record<string, string> {
  return {
    left: `${box.center.x - box.w / 2}px`,
    top: `${box.center.y - box.h / 2}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
    transform: `rotate(${box.rotation}rad)`,
  }
}

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
 * ⭐ On an object, the words change and nothing else does — that object is
 * already standing where it belongs, set the way the artwork was measured, so
 * what a drop on it says is "the contents are wrong", never "the position is".
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
  landing: Landing | null,
) {
  const pageId = editor.currentPageId
  const page = file.value?.page
  if (pageId === null || !page) return
  if (landing?.kind === 'object') {
    editor.cmdReplaceLabelSource(pageId, landing.id, reading)
    return
  }
  // A drag that ended in the gutter is a drag somebody thought better of.
  // Refusing beats creating an object where nothing can be seen.
  if (at.x < 0 || at.y < 0 || at.x > page.width || at.y > page.height) return
  const measured = landing ? claimsOf(landing.place.readings)[0]?.spokesman : undefined
  editor.cmdAddLabelFromReading(pageId, at, reading, {
    vertical: (measured ?? reading).vertical,
    fontSizePx: (measured ?? reading).fontSizePx,
    leadingPercent: (measured ?? reading).leadingPercent,
  })
}

function dismiss(plan: CardPlan) {
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

  /* Named once and read in both places a card uses them — the score at the end
     of a row, and the characters the readings disagree over. */
  --settled: oklch(0.46 0.16 150);
  --wavering: oklch(0.48 0.13 75);
  --contested: oklch(0.48 0.21 25);
  /* ⚠️ Blue rather than a third warm colour, and dark enough to read as body
     text rather than as a chart key. Blue against green is the one hue pair
     that survives every common colour vision deficiency; two warm colours are
     the pair that survives none of them. */
  --divided: oklch(0.5 0.15 245);
}

/* This project switches theme with a class rather than the system setting, so
   a `prefers-color-scheme` query here would follow the wrong thing entirely. */
:global(.dark) .source-card {
  --settled: oklch(0.7 0.2 150);
  --wavering: oklch(0.74 0.17 85);
  --contested: oklch(0.66 0.22 25);
  --divided: oklch(0.74 0.13 240);
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

/*
 * A caret on the words and a hand everywhere else on the row: pressing the text
 * is the one gesture here that does not move something.
 *
 * ⚠️ And the words are selectable where the rest of the card is not. The card
 * turns selection off so that dragging a row never sweeps up text, but a run
 * with `user-select: none` has no caret positions in it at all — a hit test
 * against one returns nothing, and the box that opens cannot know which
 * character was pressed. Only the rows that can be corrected get it back.
 */
.source-row-live .source-text {
  cursor: text;
  user-select: text;
}

/*
 * ⚠️ Only what a textarea brings of its own is reset — the size, the leading and
 * the wrapping stay with `.source-text`, which the box carries as well. Setting
 * them again here is how the line under the caret ends up a hair off the line
 * beside it, and every row below shifts as one is opened.
 */
.source-input {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  font-family: inherit;
  color: inherit;
  resize: none;
  outline: none;
  /* The directive keeps it exactly as tall as its text, so a scrollbar here
     would only ever be a rounding error made visible — and a scrollbar under
     the pointer is a field that eats the canvas's wheel. */
  overflow: hidden;
}
.source-input::placeholder {
  color: color-mix(in oklch, var(--muted-foreground) 60%, transparent);
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
  color: var(--settled);
}
.unsure {
  color: var(--wavering);
}
.doubtful {
  color: var(--contested);
}

/*
 * Where the readings on a card part company, character by character.
 *
 * ⚠️ Green here is the same green as a high score and means something else: one
 * is how sure a model was, the other whether the models agreed. They share the
 * palette because they lean the same way, and a card carrying two different
 * greens would ask a reader to hold two colour languages at once.
 */
.source-agreed {
  color: var(--settled);
}

/*
 * ⭐ Claimed by one reading alone, and drawn in the plain text colour with no
 * emphasis whatever. Standing alone is not being wrong — the reader asked
 * about hand-drawn lettering is regularly the only one that gets a balloon
 * right — so a warning colour here would be an accusation the card is in no
 * position to make. What the marking says is who has support; the plain
 * characters are the ones that have none.
 */
.source-alone {
  color: var(--foreground);
}

/*
 * Readings that back each other without carrying the column. The colour says
 * "somebody agrees with this"; the underline and the weight say which side.
 *
 * ⚠️ Only the second and third factions are decorated, and the first — much the
 * commonest, since three readings splitting two against one is the ordinary
 * shape of a disagreement — is left plain blue. A decoration on the case that
 * happens constantly is a decoration on most of the card.
 */
.source-faction {
  color: var(--divided);
}
.source-faction-1 {
  text-decoration: underline;
  text-underline-offset: 0.15em;
}
.source-faction-2 {
  font-weight: 700;
}

.source-foot {
  flex-shrink: 0;
  border-top: calc(1px * var(--px)) solid var(--border);
  padding: 0.2em 0;
  font-size: 0.8em;
  line-height: 1.4;
  cursor: pointer;
}
.source-foot-dismiss {
  color: var(--destructive);
}
.source-foot-dismiss:hover {
  background: color-mix(in oklch, var(--destructive) 12%, transparent);
}

/* Every object that can be landed on. Outlined and not filled: these are up all
   at once and the artwork under them still has to be read, so they say "here"
   without saying "this one". */
.source-object {
  position: absolute;
  z-index: 9997;
  border: calc(1px * var(--px)) dashed color-mix(in oklch, var(--primary) 55%, transparent);
  pointer-events: none;
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
