<template>
  <div
    ref="containerRef"
    class="relative h-full min-h-0 w-full touch-none overflow-hidden bg-muted select-none"
    :class="[canvasCursor]"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @pointerleave="onPointerLeave"
    @dblclick="selectionTool.onDoubleClick()"
    @contextmenu.prevent
  >
    <template v-if="currentFile && pageReady">
      <!--
        Outside the transformed stage on purpose: these carry their own pixels
        and place themselves in screen coordinates. The layer itself is
        transparent to the pointer so a drag on bare page still reaches the
        canvas gestures, and the frames go over everything drawn because they
        are what the pointer is meant to find.
      -->
      <div v-if="pageReady && currentFile" class="pointer-events-none absolute inset-0">
        <PageStack
          :nodes="stack"
          :layers-dir="layersDirOf(currentFile.pageDir)"
          :container="editor.viewContainerSize"
          :view="view"
          :held="heldLayer"
        />
      </div>

      <!--
        Its own canvas rather than a mark on the ones the layers are drawn into:
        the ants crawl on their own clock, and the page has no reason to be
        redrawn for them.

        After the layers and never before them. Nothing on this canvas sets a
        z-index, so what is written later is painted later — and an overlay
        written above the page is an overlay drawn under the base map, which
        covers every page edge to edge. The ants would simply never be seen.
      -->
      <canvas ref="overlayCanvasRef" class="pointer-events-none absolute inset-0 h-full w-full" />

      <!--
        Where the reading being pointed at in the list was read. Nothing here
        is an object — it is a mark that lasts as long as the pointer rests.
      -->
      <OcrOverlay v-if="ocrPointedBox" :pointed-box="ocrPointedBox" :view="view" />

      <!--
        The boxes of whichever routes are switched on. Under the pointed mark
        above so that the one being pointed at still reads as the one.
      -->
      <OcrBoxes v-if="ocrBoxes.length" :boxes="ocrBoxes" :routes="OCR_ROUTES" :view="view" />

      <!--
        The lines, under the frames rather than over them: a frame is what says
        an object is there, and a line drawn across one would be covering the
        thing it points at. It takes no pointer of its own — which line a click
        landed on is worked out from the page point, the same way the objects
        are.
      -->
      <svg
        v-if="pageReady && connecting"
        class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        :style="{ '--line-stroke': `${LINE_STROKE_PX}px` }"
      >
        <defs>
          <marker
            v-for="head in ARROW_HEADS"
            :id="head.id"
            :key="head.id"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" :fill="head.fill" />
          </marker>
        </defs>
        <line
          v-for="line in drawnLines"
          :key="line.key"
          :x1="line.a.x"
          :y1="line.a.y"
          :x2="line.b.x"
          :y2="line.b.y"
          :class="line.chosen ? 'reading-line-chosen' : 'reading-line'"
          :marker-end="line.chosen ? 'url(#reading-arrow-chosen)' : 'url(#reading-arrow)'"
        />
        <line
          v-if="previewLine"
          :x1="previewLine.a.x"
          :y1="previewLine.a.y"
          :x2="previewLine.b.x"
          :y2="previewLine.b.y"
          :class="previewLine.refused ? 'reading-line-refused' : 'reading-line-preview'"
          :marker-end="previewLine.refused ? undefined : 'url(#reading-arrow)'"
        />
      </svg>

      <div v-if="pageReady" class="pointer-events-none absolute inset-0">
        <RasterFrame
          v-for="layer in rasterFrames"
          :key="layer.id"
          :entry="layer"
          :view="view"
          :selected="layer.id === editor.cursorId"
          :in-selection="editor.isSelected(layer.id)"
          :pointed="layer.id === pointedLayerId"
          :pointer="framesTakePointer ? 'handles' : 'none'"
          :place="placement.placementOf(layer.id)"
          @select="onSelectObject(layer.id, $event)"
          @scale="(ratio, pin) => placement.scaleTo(layer.id, ratio, pin)"
          @rotate="(radians, pivot) => placement.rotateTo(layer.id, radians, pivot)"
          @commit="onLayerCommit(layer)"
        />
        <LabelBox
          v-for="object in objects"
          :key="object.id"
          :pointer="framesTakePointer ? 'box' : 'none'"
          :framed="connecting"
          :handles="!connecting"
          :text="object.text"
          :text-style="object.style"
          :x="object.x"
          :y="object.y"
          :rotation="object.rotation"
          :accent="object.accent"
          :tags="object.tags"
          :natural="editor.viewContentSize"
          :view="view"
          :selected="object.id === editor.cursorId"
          :in-selection="editor.isSelected(object.id)"
          :locked="object.locked"
          @select="onSelectObject(object.id, $event)"
          @move="moveLabelTo(object.id, $event)"
          @move-end="(from, to) => commitLabelMove(object.id, from, to)"
          @scale-start="beginLabelScale(object.id)"
          @scale="(fontSizePx, at) => scaleLabelTo(object.id, fontSizePx, at)"
          @scale-end="commitLabelScale(object.id)"
          @rotate="(radians, at) => rotateLabelTo(object.id, radians, at)"
          @rotate-end="(from, to) => commitLabelRotate(object.id, from, to)"
        />
      </div>

      <div
        v-if="objectMarquee"
        class="pointer-events-none absolute border border-primary bg-primary/10"
        :style="objectMarqueeStyle"
      />

      <!--
        The brush, drawn in screen coordinates over everything else. Rotating
        the view cannot skew it, because a circle at the pointer has no
        orientation to lose.
      -->
      <div
        v-if="showBrushRing"
        class="brush-ring pointer-events-none absolute rounded-full"
        :style="brushRingStyle"
      />
      <template v-if="hudGesture && hudBrush">
        <div
          class="brush-ring pointer-events-none absolute rounded-full"
          :style="hudRingStyle"
        />
        <div
          class="pointer-events-none absolute rounded border border-border bg-card px-2 py-1 text-xs whitespace-nowrap"
          :style="hudLabelStyle"
        >
          直徑 {{ hudBrush.size }}px · 硬度 {{ Math.round(hudBrush.hardness * 100) }}%
        </div>
      </template>
    </template>

    <div v-else class="flex h-full items-center justify-center select-none">
      <span v-if="currentFile" class="text-xs text-muted-foreground">
        {{ currentFile.badge === 'missing' ? `頁面資料夾不存在：${currentFile.pageId}` : '頁面資料損毀' }}
      </span>
      <span v-else class="text-sm text-muted-foreground">開啟一個資料夾開始工作</span>
    </div>

    <!--
      Outside the page's branch: a refusal is worth saying whether or not there
      is a page ready to draw, and last in the box so nothing drawn covers it.
    -->
    <CanvasNotice />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import CanvasNotice from '@/components/CanvasNotice.vue'
import LabelBox from '@/components/LabelBox.vue'
import OcrBoxes from '@/components/OcrBoxes.vue'
import OcrOverlay from '@/components/OcrOverlay.vue'
import PageStack from '@/components/PageStack.vue'
import RasterFrame from '@/components/RasterFrame.vue'
import { useBrushHud } from '@/composables/useBrushHud'
import { useFontPicker } from '@/composables/useFontPicker'
import type { RasterLayerEntry, TextLayerEntry } from '@shared/page/types'
import type { TextStyle } from '@shared/text-style/types'
import { pageStack, stackedTextNodes } from '@shared/page/stack'
import { isLocked, textObjects } from '@shared/page/tree'
import type { ReadingEdge } from '@shared/page/readingGraph'
import { textOf } from '@shared/page/text'
import { layersDirOf } from '@shared/ssk/constants'
import { useLayerAlpha } from '@/composables/useLayerAlpha'
import { useLayerPlacement } from '@/composables/useLayerPlacement'
import { useSelectionOverlay } from '@/composables/useSelectionOverlay'
import { useSelectionTool } from '@/composables/useSelectionTool'
import { useToolChoice } from '@/composables/useToolChoice'
import { ownsKeyboard } from '@/lib/editContext'
import {
  centeredBoxOnScreen,
  contentToScreenPx,
  screenToContentPx,
  screenToPagePx,
  type Anchor,
} from '@/lib/coords'
import { drawnLabel } from '@/lib/labelRaster'
import { framedLayers, layerAt } from '@/lib/layerHit'
import { artworkSignature, compositeArtwork } from '@/lib/pageComposite'
import {
  distanceToSegment,
  nearestAnchor,
  readingLineBetween,
  type FrameBox,
} from '@/lib/readingLine'
import { marqueeRect } from '@/lib/selection/marquee'
import { obbHoldsPoint, obbIntersectsRect, type Obb } from '@/lib/selection/obb'
import { loadFontCatalog } from '@/lib/fontCatalog'
import {
  beginRotationDirection,
  resetRotationDirection,
  trackRotationDirection,
} from '@/lib/rotateDirection'
import { primaryTag, tagColor, tagsInRegistryOrder } from '@shared/tags/set'
import {
  isSelectionTool,
  maskBrushModeOf,
  useEditorStore,
  type ScaledLabel,
  type TurnedLabel,
} from '@/stores/editorStore'
import { useConnectStore } from '@/stores/connectStore'
import { OCR_ROUTES, useOcrStore } from '@/stores/ocrStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'

const project = useProjectStore()
const editor = useEditorStore()
const selection = useSelectionStore()
const connect = useConnectStore()
const ocr = useOcrStore()
const ui = useUiStore()
const preferences = usePreferencesStore()
const fontPicker = useFontPicker()
const placement = useLayerPlacement()
const { chooseTool } = useToolChoice()

const view = editor.view

const currentFile = computed(() =>
  editor.currentPageId ? (project.pageById(editor.currentPageId) ?? null) : null,
)

/** What this page draws and in what order — the same answer the export reads. */
const stack = computed(() => (currentFile.value ? pageStack(currentFile.value.page.layers) : []))

const ocrBoxes = computed(() => {
  if (!editor.currentPageId || ocr.shown.size === 0) return []
  return project.readingsOfPage(editor.currentPageId).filter((c) => ocr.shown.has(c.source))
})

const ocrPointedBox = computed(() => {
  const hash = ocr.pointedAt
  if (!hash || hash === 'own' || !editor.currentPageId) return null
  const found = project
    .readingsOfPage(editor.currentPageId)
    .find((c) => c.hash === hash)
  return found ? { x: found.x, y: found.y, width: found.w, height: found.h } : null
})

/**
 * Every label's frame, empty ones included: an object with no text still has a
 * frame, and the frame is what makes it findable.
 *
 * One flat layer over everything drawn, because a frame is a hit target rather
 * than part of the picture — a text object dimmed by the folder it sits in is
 * still grabbed the ordinary way. The number on each comes from the reading
 * order, while the frames themselves are listed in stacking order.
 *
 * Resolved here rather than in the template so that panning, which re-renders
 * this component on every frame, does not hand each label a new style object
 * and make it look like the text changed.
 */
/**
 * Trying a face on the page without writing it: while the picker's 預覽 is
 * held, the selection draws with that face and nothing else changes. Reading
 * the preview here keeps the swap inside the memoized style objects, so
 * letting go restores the page by mere recomputation.
 */
function previewedStyle(id: string, style: TextStyle): TextStyle {
  const face = fontPicker.previewFace.value
  if (face === null || !editor.isSelected(id)) return style
  return {
    ...style,
    fontFamily: face.family,
    fontFace: face.postscriptName,
    fontStyleName: face.style,
  }
}

const objects = computed(() => {
  const file = currentFile.value
  if (!file) return []
  // Under the connecting tool the hidden ones are here too. Compositing skips
  // what is switched off, but the reading order is this chapter's script and a
  // line of dialogue turned off for a moment has not left the script — the
  // label list has always read the page this way. Without them a line into a
  // hidden object would have nowhere to land and would go undrawn, which is the
  // one thing this tool must not do.
  const entries = connecting.value
    ? textObjects(file.page.layers)
    : stackedTextNodes(stack.value).map((node) => node.entry)
  return entries.map((label) => ({
    id: label.id,
    locked: isLocked(file.page.layers, label.id),
    text: textOf(label),
    x: label.x,
    y: label.y,
    rotation: label.rotation,
    accent: accentOf(label.tags),
    style: previewedStyle(label.id, label.style),
    tags: tagsInRegistryOrder(label.tags, project.header.tags).map((name) => ({
      name,
      color: tagColor(name, project.header.tags),
    })),
  }))
})

/**
 * The raster layers wearing a frame: every one that is drawn and can be taken
 * hold of, selected or not. Each draws its outline only while the pointer is
 * on it, so having one is what makes a layer reachable rather than what puts a
 * rectangle on the artwork.
 *
 * The same list the press is answered from, which is what makes the frame under
 * the pointer and the layer a press takes the same layer by construction rather
 * than by two rules kept in step.
 */
const rasterFrames = computed(() => {
  const file = currentFile.value
  if (!file) return []
  return framedLayers(stack.value, (id) => isLocked(file.page.layers, id))
})

/**
 * Which layer the stack keeps on a canvas of its own, and where a gesture has
 * taken it.
 *
 * The layer wearing the cursor rather than the one being handled, so the page
 * is cut the moment it is selected and not while a pointer is already moving.
 */
const heldLayer = computed(() => {
  const id = rasterFrames.value.find((entry) => entry.id === editor.cursorId)?.id
  return id === undefined ? null : { id, place: placement.placementOf(id) }
})

/**
 * The pixels of every layer a press could reach, kept ready.
 *
 * Only the framed ones, which is what keeps a locked full-page base map — the
 * one layer that would cost real memory — from ever being read back.
 */
const layerAlpha = useLayerAlpha(
  () => (currentFile.value ? layersDirOf(currentFile.value.pageDir) : null),
  () => rasterFrames.value,
)

/**
 * Which layer is under a page point, decided by the pixels rather than by whose
 * rectangle is on top — the frames are drawn over the page but take no pointer,
 * so this is what answers instead.
 */
function layerHitAt(p: Anchor): string | null {
  const file = currentFile.value
  if (!file) return null
  return layerAt(
    stack.value,
    p,
    (id) => isLocked(file.page.layers, id),
    layerAlpha.alphaAt,
  )
}

/** Which layer the pointer is on, so its frame can say so before the press. */
const pointedLayerId = ref<string | null>(null)

function onLayerCommit(entry: RasterLayerEntry) {
  void placement.commit(entry).catch((err: unknown) => console.error('place layer failed', err))
}

// The picker enumerates on its first opening, which is too late for text that
// is on screen before anyone asks to change a font.
onMounted(() => {
  loadFontCatalog(preferences.prefs.fontFolders).catch((err: unknown) => {
    console.error('font enumeration failed', err)
  })
})

/**
 * A drag writes straight through so the page keeps up with the pointer, and
 * only the release enters the undo stack — otherwise one drag would leave a
 * frame's worth of entries to undo one at a time.
 */
function moveLabelTo(labelId: string, to: Anchor) {
  if (!editor.currentPageId || editor.isLayerLocked(labelId)) return
  project.moveLabel(editor.currentPageId, labelId, to.x, to.y)
}

function commitLabelMove(labelId: string, from: Anchor, to: Anchor) {
  if (!editor.currentPageId) return
  editor.cmdMoveLabel(editor.currentPageId, labelId, from, to)
}

/**
 * Shift adds, as it does on any canvas. There is no Ctrl here: a page has no
 * order to reach a range over, so building one out of scattered objects is the
 * label list's job.
 */
function onSelectObject(id: string, additive: boolean) {
  if (additive) editor.toggleSelected(id)
  else editor.selectOnly(id)
}

function labelById(labelId: string): TextLayerEntry | undefined {
  return editor.currentPageId
    ? project.labelById(editor.currentPageId, labelId)
    : undefined
}

/**
 * The before is taken once at the start rather than reconstructed afterwards:
 * a drag writes every frame, so by the time it ends there is nothing left on
 * the object saying where it began.
 */
let scaledFrom: ScaledLabel | null = null

function scaledState(label: TextLayerEntry): ScaledLabel {
  return { style: { ...label.style }, x: label.x, y: label.y }
}

function beginLabelScale(labelId: string) {
  const label = labelById(labelId)
  scaledFrom = label ? scaledState(label) : null
}

/**
 * The size and the position are written together on every frame, because the
 * position is what holds the pinned corner still against the size that just
 * changed — writing one without the other would let the frame slip for a frame.
 */
function scaleLabelTo(labelId: string, fontSizePx: number, at: Anchor) {
  const label = labelById(labelId)
  if (!label || !editor.currentPageId || editor.isLayerLocked(labelId)) return
  project.setLabelStyle(editor.currentPageId, labelId, { ...label.style, fontSizePx })
  project.moveLabel(editor.currentPageId, labelId, at.x, at.y)
}

function commitLabelScale(labelId: string) {
  const label = labelById(labelId)
  if (!editor.currentPageId || !scaledFrom || !label) return
  editor.cmdScaleLabel(editor.currentPageId, labelId, scaledFrom, scaledState(label))
  scaledFrom = null
}

/** Both together, for the same reason a corner drag writes both. */
function rotateLabelTo(labelId: string, radians: number, at: Anchor) {
  if (!editor.currentPageId || editor.isLayerLocked(labelId)) return
  project.rotateLabel(editor.currentPageId, labelId, radians)
  project.moveLabel(editor.currentPageId, labelId, at.x, at.y)
}

function commitLabelRotate(labelId: string, from: TurnedLabel, to: TurnedLabel) {
  if (!editor.currentPageId) return
  editor.cmdRotateLabel(editor.currentPageId, labelId, from, to)
}

/**
 * Whichever registered tag sits highest in the project's order decides the
 * frame's colour. Nothing for an object no registered tag speaks for — the
 * frame then draws in `primary`, and drawing in the ordinary colour is what
 * "nobody has said what this is" looks like.
 */
function accentOf(tags: readonly string[]): string | undefined {
  return primaryTag(tags, project.header.tags)?.color
}

const containerRef = useTemplateRef('containerRef')
const overlayCanvasRef = useTemplateRef('overlayCanvasRef')


/** Whichever tool is up decides whether a drag on bare page builds a selection. */
const selecting = computed(() => isSelectionTool(editor.tool))

/**
 * A drag on bare page under the text move tool, in page pixels.
 *
 * Deliberately not the pixel-selection path: that one rasterizes into a mask,
 * and what this is after is a set of objects. They share `marqueeRect` and
 * nothing else.
 */
const objectMarquee = ref<{ origin: Anchor; current: Anchor; additive: boolean } | null>(null)

const objectMarqueeRect = computed(() =>
  objectMarquee.value === null
    ? null
    : marqueeRect({
        origin: objectMarquee.value.origin,
        current: objectMarquee.value.current,
        constrain: false,
        fromCenter: false,
      }),
)

const objectMarqueeStyle = computed(() => {
  const rect = objectMarqueeRect.value
  if (!rect) return {}
  const box = centeredBoxOnScreen(
    { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
    { w: rect.w, h: rect.h },
    view,
  )
  return {
    left: `${box.centerX}px`,
    top: `${box.centerY}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    transform: `translate(-50%, -50%) rotate(${view.rotate}rad)`,
  }
})

/**
 * Touch and it counts, rather than enclose and it counts. Sweeping a column of
 * dialogue means dragging down its middle, and the enclose rule would take
 * nothing at all unless the drag also reached past both ends of the widest
 * line — which is most of the page.
 *
 * The frames are measured exactly, turn included, rather than by their upright
 * bounds: a long label at 45° has bounds far bigger than the label, and a
 * marquee near one of those corners would sweep in an object it never touched.
 */
function sweepObjects() {
  const rect = objectMarqueeRect.value
  const drag = objectMarquee.value
  if (!rect || !drag || !currentFile.value) return
  const hit: string[] = []
  for (const object of objects.value) {
    if (object.locked) continue
    const drawn = drawnLabel(object.text, object.style, { x: object.x, y: object.y }, object.rotation)
    const box: Obb = {
      center: drawn.center,
      w: drawn.box.w,
      h: drawn.box.h,
      rotation: object.rotation,
    }
    if (obbIntersectsRect(box, rect)) hit.push(object.id)
  }
  editor.selectMany(hit, drag.additive)
}

/**
 * Drawing the reading onto the page.
 *
 * Everything below works in page pixels and converts to the screen only where
 * it draws, so nothing has to be redone when the view is panned, zoomed or
 * turned. A line holds two ids and no geometry — both ends are worked out
 * afresh from where the objects are standing — which is what makes moving an
 * object take its lines with it for free.
 */
const connecting = computed(() => editor.tool === 'connect')

const ARROW_HEADS = [
  { id: 'reading-arrow', fill: 'var(--primary)' },
  { id: 'reading-arrow-chosen', fill: 'var(--foreground)' },
]

/** Each object's frame on the page, which is where its lines begin and end. */
const objectBoxes = computed(() => {
  const out = new Map<string, FrameBox>()
  for (const object of objects.value) {
    const drawn = drawnLabel(
      object.text,
      object.style,
      { x: object.x, y: object.y },
      object.rotation,
    )
    out.set(object.id, {
      center: drawn.center,
      w: drawn.box.w,
      h: drawn.box.h,
      rotation: object.rotation,
    })
  }
  return out
})

/**
 * Which object a page point is on — the topmost, so the one drawn over the
 * others is the one taken hold of.
 *
 * The whole object is the target rather than a marker on one corner, which is
 * what makes aiming on a crowded page easy instead of fiddly, and what removed
 * the badge's worst problem: two 24-pixel markers overlap at low zoom, two
 * frames overlapping means two objects really do.
 */
function objectAt(p: Anchor): string | null {
  for (let i = objects.value.length - 1; i >= 0; i -= 1) {
    const object = objects.value[i]
    const box = objectBoxes.value.get(object.id)
    if (box === undefined) continue
    const hit: Obb = { center: box.center, w: box.w, h: box.h, rotation: box.rotation }
    if (obbHoldsPoint(hit, p)) return object.id
  }
  return null
}

const heldEdges = computed<readonly ReadingEdge[]>(
  () => currentFile.value?.page.readingEdges ?? [],
)

function toScreen(p: Anchor): Anchor {
  return contentToScreenPx(p.x, p.y, view)
}

/**
 * Every line there is to see: the ones the page holds, and the ones the chain
 * being drawn has already laid.
 *
 * The chain's own links are here because they are lines the person drew and can
 * see no other way — that they are still tool state and land in the manifest
 * only on commit is bookkeeping, and an interface that made someone track it
 * would be asking them to hold its implementation in their head.
 *
 * Nothing is filtered out on the way. A line that exists and is not drawn can
 * be neither found nor taken back; two frames that overlap get a line running
 * the wrong way rather than no line, because that at least says out loud that
 * they are sitting on top of each other.
 */
const drawnLines = computed(() => {
  const chosen = connect.selected
  const out: { key: string; a: Anchor; b: Anchor; chosen: boolean }[] = []
  const draw = (edge: ReadingEdge, keyPrefix: string) => {
    const from = objectBoxes.value.get(edge.from)
    const to = objectBoxes.value.get(edge.to)
    if (from === undefined || to === undefined) return
    const line = readingLineBetween(from, to)
    out.push({
      // Both ends quoted, so no pair of ids spells another pair's key.
      key: `${keyPrefix}${JSON.stringify([edge.from, edge.to])}`,
      a: toScreen(line.a),
      b: toScreen(line.b),
      chosen: chosen !== null && chosen.edge.from === edge.from && chosen.edge.to === edge.to,
    })
  }
  for (const edge of heldEdges.value) draw(edge, 'held/')
  for (const edge of connect.links) draw(edge, 'laid/')
  return out
})

/** What the pointer is over while a chain is being drawn. */
const hoverTargetId = ref<string | null>(null)

/**
 * The loose end of the chain, following the pointer between clicks — the one
 * thing on screen saying which object the next link will come from, which is
 * what this gesture's single layer of hidden state needs to stay readable.
 *
 * Drawn as refused when the object under it cannot be reached, so a target that
 * would close a ring says so before the click rather than after it.
 */
const previewLine = computed(() => {
  const g = connect.gesture
  if (g === null) return null
  const from = objectBoxes.value.get(g.source)
  if (from === undefined) return null
  const target = hoverTargetId.value
  const to = target === null ? undefined : objectBoxes.value.get(target)
  if (to === undefined) {
    return { a: toScreen(nearestAnchor(from, g.at)), b: toScreen(g.at), refused: false }
  }
  const line = readingLineBetween(from, to)
  return { a: toScreen(line.a), b: toScreen(line.b), refused: connect.refuses(target as string) }
})

/** How thick a line is drawn, in screen pixels. */
const LINE_STROKE_PX = 1.5

/**
 * How close a click has to come to a line to have landed on it. The stroke's
 * own half-width is added, so a thicker line is not harder to hit than the
 * space beside it.
 */
const LINE_HIT_PX = 8 + LINE_STROKE_PX / 2

function lineAt(p: Anchor): ReadingEdge | null {
  const at = toScreen(p)
  let nearest: { edge: ReadingEdge; away: number } | null = null
  for (const edge of heldEdges.value) {
    const from = objectBoxes.value.get(edge.from)
    const to = objectBoxes.value.get(edge.to)
    if (from === undefined || to === undefined) continue
    const line = readingLineBetween(from, to)
    const away = distanceToSegment(at, toScreen(line.a), toScreen(line.b))
    if (away > LINE_HIT_PX) continue
    if (nearest === null || away < nearest.away) nearest = { edge, away }
  }
  return nearest?.edge ?? null
}

/**
 * A click either carries the chain on or ends it.
 *
 * Landing on an object reaches it. Landing on bare page ends the chain and
 * banks it — the only way to leave holding something unfinished is to cancel,
 * and cancelling is meant to lose it. A refused target does nothing at all,
 * since the refusal is already drawn on the preview and saying it twice would
 * be saying it once too often.
 */
function onConnectDown(p: Anchor) {
  const page = editor.currentPageId
  if (page === null) return
  const hit = objectAt(p)
  if (connect.isDrawing) {
    if (hit !== null) connect.reach(hit)
    else connect.commit()
    return
  }
  if (hit !== null) {
    connect.begin(page, hit, p)
    return
  }
  connect.select(page, lineAt(p))
}

function onConnectMove(p: Anchor) {
  hoverTargetId.value = objectAt(p)
  connect.track(p)
}

const selectionOverlay = useSelectionOverlay(overlayCanvasRef, () => pageReady.value)
const selectionTool = useSelectionTool(containerRef, () => artwork.value, () => pageReady.value)

useResizeObserver(containerRef, (entries) => {
  const { width, height } = entries[0].contentRect
  // A hidden mode measures 0x0; keeping the last real size means coming back
  // to this view finds the transform it was left with.
  if (!width || !height) return
  editor.viewContainerSize = { w: width, h: height }
  fitUnfittedPage()
  selectionOverlay.schedulePaint()
})

/**
 * The page's own grid, which the manifest holds outright. Nothing has to decode
 * for this to be known, so a page is ready to be worked on the moment it is
 * turned to — the base map is a layer that arrives with the rest of them.
 */
const pageReady = computed(() => currentFile.value?.badge === 'ok')

watch(
  () => [pageReady.value, currentFile.value?.page.width, currentFile.value?.page.height] as const,
  ([ready, w, h]) => {
    editor.viewContentSize = ready && w && h ? { w, h } : { w: 0, h: 0 }
    fitUnfittedPage()
    selectionOverlay.schedulePaint()
  },
  { immediate: true },
)

/**
 * The page's rasters composited into one page-sized picture, kept for the wand
 * to read. Never drawn from here — the stack on screen draws those same layers
 * itself, and this would put them on the page twice.
 *
 * Composited rather than picked, because the base map has no type of its own:
 * it can be unlocked, reordered, dropped into a folder. "Which layer is the
 * artwork" therefore has no answer, while "what is at this point" always does.
 */
const artwork = ref<OffscreenCanvas | null>(null)
/** Which composite the result being awaited belongs to. */
let artworkRequest = 0

/** What the wand's picture is of, so a change that redraws the page drops it. */
const artworkKey = computed(() => {
  const file = currentFile.value
  return file ? artworkSignature(pageStack(file.page.layers)) : null
})

watch(
  () => [currentFile.value?.pageDir, artworkKey.value] as const,
  async ([pageDir]) => {
    artwork.value = null
    // Any gesture belonged to the picture being replaced, and so did the
    // wand's reading of it.
    selection.cancelGesture()
    selectionTool.dropPageSample()
    selectionOverlay.schedulePaint()
    const mine = ++artworkRequest
    const file = currentFile.value
    if (!pageDir || !file) return
    try {
      const composited = await compositeArtwork({
        page: file.page,
        loadLayer: (name) => window.api.readImage(layersDirOf(pageDir), name),
      })
      // Two edits close together each start one of these, and they can finish
      // in either order. Only the newest may land, or an older picture would
      // overwrite it and the wand would read the page as it was.
      if (mine === artworkRequest) artwork.value = composited
    } catch (err) {
      console.error(err)
    }
  },
  { immediate: true },
)

/**
 * Fitting is per page, not per decode: turning the page starts you fitted, but
 * a page you have already framed keeps its zoom when it is redrawn.
 */
function fitUnfittedPage() {
  if (!pageReady.value || editor.viewFittedPage === editor.currentPageId) return
  if (editor.fitToView()) editor.viewFittedPage = editor.currentPageId
}

// Switching tool abandons whatever the last one had half drawn, which is what
// makes the tool rail the mode: nothing carries over between them.
watch(
  () => editor.tool,
  () => {
    selection.cancelGesture()
    connect.reset()
  },
)

// A chain belongs to one page, and so does the line being looked at: both ends
// are ids that mean nothing anywhere else.
watch(() => editor.currentPageId, () => connect.reset())

const spaceDown = ref(false)
const rDown = ref(false)
const rotating = ref(false)
const panning = ref(false)

/** Where the pointer is in this box, so the brush can be drawn where it is. */
const cursorPos = ref<{ x: number; y: number } | null>(null)
const capsLock = ref(false)
const altDown = ref(false)

const {
  gesture: hudGesture,
  begin: beginBrushHud,
  trackTo: trackBrushHud,
  commit: commitBrushHud,
  cancel: cancelBrushHud,
} = useBrushHud()

/** The brush the display is editing, which is the live one rather than a copy. */
const hudBrush = computed(() =>
  hudGesture.value === null ? null : selection.brushes[hudGesture.value.mode],
)

/**
 * Below this the ring is too small to aim with, so it gives way to the
 * crosshair — which is what Photoshop does at the same end of the range.
 */
const BRUSH_RING_MIN_PX = 6

/** Zero unless a mask tool is up, which is what keeps the ring off otherwise. */
const brushRingDiameter = computed(() => {
  const mode = maskBrushModeOf(editor.tool)
  return mode === null ? 0 : selection.brushes[mode].size * view.scale
})

/**
 * The brush drawn at the size it will actually land at. It stands down for
 * anything that has taken over the pointer, and for Alt, which is the
 * eyedropper — a ring there would promise a stroke that is not coming.
 */
const showBrushRing = computed(
  () =>
    cursorPos.value !== null &&
    !capsLock.value &&
    !altDown.value &&
    hudGesture.value === null &&
    !panning.value &&
    !rotating.value &&
    !rDown.value &&
    !spaceDown.value &&
    brushRingDiameter.value >= BRUSH_RING_MIN_PX,
)

function ringStyle(x: number, y: number, diameter: number) {
  return {
    left: `${x - diameter / 2}px`,
    top: `${y - diameter / 2}px`,
    width: `${diameter}px`,
    height: `${diameter}px`,
  }
}

const brushRingStyle = computed(() =>
  cursorPos.value === null
    ? {}
    : ringStyle(cursorPos.value.x, cursorPos.value.y, brushRingDiameter.value),
)

/**
 * The display's own ring, anchored where the drag began rather than following
 * the pointer — the pointer is the control, so a ring under it would move for
 * reasons that have nothing to do with the brush.
 *
 * Its wash falls off where the brush's does, so hardness is read rather than
 * counted.
 */
const hudRingStyle = computed(() => {
  const g = hudGesture.value
  const brush = hudBrush.value
  if (g === null || brush === null) return {}
  const inner = Math.min(99.9, brush.hardness * 100)
  return {
    ...ringStyle(g.sx, g.sy, brush.size * view.scale),
    background: `radial-gradient(circle closest-side, color-mix(in srgb, var(--primary) 35%, transparent) ${inner}%, transparent 100%)`,
  }
})

/**
 * Beside the anchor, and flipped to whichever side has room. The canvas clips
 * what leaves it, so a readout that always sat above and to the right would go
 * missing exactly when the drag starts near an edge.
 */
const HUD_LABEL_GAP = 16
const HUD_LABEL_W = 150
const HUD_LABEL_H = 36

const hudLabelStyle = computed(() => {
  const g = hudGesture.value
  if (g === null) return {}
  const { w } = editor.viewContainerSize
  const right = g.sx + HUD_LABEL_GAP
  const above = g.sy - HUD_LABEL_H
  return {
    left: `${right + HUD_LABEL_W > w ? Math.max(0, g.sx - HUD_LABEL_GAP - HUD_LABEL_W) : right}px`,
    top: `${above < 0 ? g.sy + HUD_LABEL_GAP : above}px`,
  }
})
let rotatePivot = { x: 0, y: 0 }
let rotateStartAngle = 0
let rotateStartTheta = 0
let panLast = { x: 0, y: 0 }
let lastEscapeAt = 0

/** Which way the drag is currently turning, which is the cursor the R gesture shows. */
const rotateDirection = reactive(beginRotationDirection(1, 0))

// While a gesture is armed the markers let the pointer through, so a drag that
// starts on one still pans or rotates the page under it.
const gestureArmed = computed(() => spaceDown.value || rDown.value)

/**
 * Whether the objects on the page answer the pointer at all. Off for everything
 * whose drag means something else — panning, turning, drawing a selection,
 * running a line from one object to another.
 */
const framesTakePointer = computed(
  () => !gestureArmed.value && !selecting.value && !connecting.value,
)

/**
 * Whether a press on bare page picks a raster layer. The move tool alone: the
 * others each want the press for themselves, and a tool that places text has no
 * business selecting the patch under where the text is going.
 */
const picking = computed(() => framesTakePointer.value && editor.tool === 'select')

const canvasCursor = computed(() => {
  // Kept visible through the display's drag: the brush lands where the pointer
  // is when it is let go, so that has to stay in sight the whole way.
  if (hudGesture.value !== null) return 'cursor-default'
  if (panning.value) return 'cursor-grabbing'
  if (rotating.value || rDown.value) {
    return rotateDirection.sign === 1 ? 'cursor-rotate-cw' : 'cursor-rotate-ccw'
  }
  if (spaceDown.value) return 'cursor-grab'
  // The ring is the cursor while it is up; a second mark would only be one more
  // thing to aim with.
  if (showBrushRing.value) return 'cursor-none'
  if (
    editor.tool === 'text' ||
    editor.tool === 'select-text' ||
    connecting.value ||
    selecting.value
  )
    return 'cursor-crosshair'
  // The frames gave up the pointer, so what a layer can be done with has to be
  // said from here — otherwise finding one would say nothing about grabbing it.
  if (pointedLayerId.value !== null) return layerDrag.value ? 'cursor-grabbing' : 'cursor-grab'
  return 'cursor-default'
})

function onWheel(e: WheelEvent) {
  if (!pageReady.value) return
  editor.wheelZoom(e)
}

function onPointerDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  if (!pageReady.value || !containerRef.value) return
  if (rDown.value) {
    el.setPointerCapture(e.pointerId)
    rotating.value = true
    const rect = containerRef.value.getBoundingClientRect()
    rotatePivot = { x: rect.width / 2, y: rect.height / 2 }
    rotateStartAngle = Math.atan2(
      e.clientY - rect.top - rotatePivot.y,
      e.clientX - rect.left - rotatePivot.x,
    )
    rotateStartTheta = view.rotate
    resetRotationDirection(rotateDirection, rotateStartAngle)
    return
  }
  // Alt with the right button sizes the brush, as in Photoshop. It reaches the
  // canvas because the right button does nothing else here and the context
  // menu is already refused.
  const hudMode = maskBrushModeOf(editor.tool)
  if (e.button === 2 && e.altKey && hudMode !== null) {
    el.setPointerCapture(e.pointerId)
    const rect = containerRef.value.getBoundingClientRect()
    beginBrushHud(hudMode, e.clientX - rect.left, e.clientY - rect.top)
    return
  }
  if (e.button !== 0) return
  if (spaceDown.value) {
    el.setPointerCapture(e.pointerId)
    panning.value = true
    panLast = { x: e.clientX, y: e.clientY }
    return
  }
  // Reaching here means bare page: the markers and the text stop the event on
  // their way out, so anything left started on the page itself.
  if (selecting.value) {
    // Alt over a mask tool is the eyedropper, as in Photoshop: it takes a
    // colour off the page and deliberately starts no stroke.
    if (e.altKey && maskBrushModeOf(editor.tool) !== null) {
      const picked = selectionTool.colorAt(e)
      if (picked !== null) editor.foreground = picked
      return
    }
    if (selectionTool.onPointerDown(e)) return
  }
  if (editor.tool === 'text') {
    const rect = containerRef.value.getBoundingClientRect()
    const p = screenToPagePx(e.clientX, e.clientY, rect, view, editor.viewContentSize)
    editor.addLabelAt(p.x, p.y)
    return
  }
  if (editor.tool === 'select-text') {
    el.setPointerCapture(e.pointerId)
    const rect = containerRef.value.getBoundingClientRect()
    const p = screenToPagePx(e.clientX, e.clientY, rect, view, editor.viewContentSize)
    objectMarquee.value = { origin: p, current: p, additive: e.shiftKey }
    return
  }
  if (connecting.value) {
    const rect = containerRef.value.getBoundingClientRect()
    onConnectDown(screenToPagePx(e.clientX, e.clientY, rect, view, editor.viewContentSize))
    return
  }
  // Unclamped, unlike placing text: a press out in the gutter is a press on
  // nothing, and clamping it to the page edge would take whatever lies there.
  const rect = containerRef.value.getBoundingClientRect()
  const hit = layerHitAt(screenToContentPx(e.clientX, e.clientY, rect, view))
  if (hit === null) {
    // Bare page. The one deliberate way to be holding nothing.
    editor.selectOnly(null)
    return
  }
  onSelectObject(hit, e.shiftKey)
  el.setPointerCapture(e.pointerId)
  layerDrag.value = { id: hit, from: { x: e.clientX, y: e.clientY }, engaged: false }
}

/**
 * Moving a layer by its own body, which its frame no longer takes the pointer
 * for. Everything the gesture means still belongs to the placement — this is
 * only the press, the travel and the release, in the place where the press
 * already lands.
 */
const layerDrag = ref<{ id: string; from: Anchor; engaged: boolean } | null>(null)

/**
 * Under this the press was a click. Without a threshold a layer would creep by
 * a pixel every time it was selected, and the move would be resampled into the
 * pixels and land in the undo stack as if it had been asked for.
 */
const LAYER_DRAG_THRESHOLD_PX = 3

function trackLayerDrag(e: PointerEvent): void {
  const drag = layerDrag.value
  if (drag === null) return
  const dx = e.clientX - drag.from.x
  const dy = e.clientY - drag.from.y
  if (!drag.engaged) {
    if (Math.hypot(dx, dy) < LAYER_DRAG_THRESHOLD_PX) return
    drag.engaged = true
  }
  placement.moveBy(drag.id, { dx, dy }, view)
}

/**
 * A cancelled pointer arrives here too, and banks the move rather than snapping
 * the layer back — which is this canvas's standing convention for work the
 * system interrupts.
 */
function endLayerDrag(): void {
  const drag = layerDrag.value
  layerDrag.value = null
  if (drag === null || !drag.engaged) return
  const entry = project.entryById(drag.id)
  if (entry?.kind === 'raster') onLayerCommit(entry)
}

const ROTATE_SNAP = Math.PI / 12

function onPointerMove(e: PointerEvent) {
  trackModifiers(e)
  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    cursorPos.value = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    if (hudGesture.value !== null) {
      trackBrushHud(cursorPos.value.x, cursorPos.value.y)
      return
    }
  }
  if (rotating.value && containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    const angle = Math.atan2(
      e.clientY - rect.top - rotatePivot.y,
      e.clientX - rect.left - rotatePivot.x,
    )
    trackRotationDirection(rotateDirection, angle)
    let theta = rotateStartTheta + (angle - rotateStartAngle)
    if (e.shiftKey) theta = Math.round(theta / ROTATE_SNAP) * ROTATE_SNAP
    editor.rotateTo(theta, rotatePivot.x, rotatePivot.y)
    return
  }
  if (panning.value) {
    editor.panBy(e.clientX - panLast.x, e.clientY - panLast.y)
    panLast = { x: e.clientX, y: e.clientY }
    return
  }
  if (layerDrag.value !== null) {
    trackLayerDrag(e)
    return
  }
  if (objectMarquee.value !== null && containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    objectMarquee.value.current = screenToPagePx(
      e.clientX,
      e.clientY,
      rect,
      view,
      editor.viewContentSize,
    )
    return
  }
  if (connecting.value && containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    onConnectMove(screenToPagePx(e.clientX, e.clientY, rect, view, editor.viewContentSize))
    return
  }
  if (selecting.value) {
    selectionTool.onPointerMove(e)
    return
  }
  // What a press would take, worked out before there is one — the same answer
  // the press itself will get, since it is the same question.
  if (!picking.value || !containerRef.value) {
    pointedLayerId.value = null
    return
  }
  const rect = containerRef.value.getBoundingClientRect()
  pointedLayerId.value = layerHitAt(screenToContentPx(e.clientX, e.clientY, rect, view))
}

function onPointerLeave() {
  cursorPos.value = null
  pointedLayerId.value = null
  // The chain's loose end stays where the pointer left it rather than snapping
  // back to its source, so stepping off the canvas for the tool rail or a panel
  // does not look like the gesture broke.
  hoverTargetId.value = null
}

function onPointerUp(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  if (hudGesture.value !== null) {
    commitBrushHud()
    return
  }
  if (layerDrag.value !== null) {
    endLayerDrag()
    return
  }
  // Rotating and panning take the pointer for themselves, so a selection tool
  // only hears about a release that was not one of theirs.
  if (objectMarquee.value !== null) {
    sweepObjects()
    objectMarquee.value = null
    return
  }
  if (!rotating.value && !panning.value && selecting.value) selectionTool.onPointerUp(e)
  rotating.value = false
  panning.value = false
}

const ESCAPE_DOUBLE_MS = 400

useEventListener(window, 'keydown', (e) => {
  if (ui.view !== 'editor' || fontPicker.isOpen.value || ui.settingsOpen) return
  if (ownsKeyboard(document.activeElement)) return
  // The display's drag is held under Alt, so its way out has to be reached
  // before the guard below turns every other key off.
  if (e.key === 'Escape' && hudGesture.value !== null) {
    cancelBrushHud()
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  // Turning the page and moving the cursor act on the document, and are dealt
  // with there. What is left here acts on the view.
  if (e.defaultPrevented) return

  const key = e.key.toLowerCase()

  if (e.key === '0') {
    if (pageReady.value) editor.fitToView()
  } else if (e.code === 'Space') {
    spaceDown.value = true
    e.preventDefault()
  } else if (key === 'r') {
    rDown.value = true
  } else if (key === 't') {
    editor.setTool('text')
  } else if (key === 'v') {
    editor.setTool(e.shiftKey ? 'select-text' : 'select')
  } else if (key === 'c') {
    editor.setTool('connect')
  } else if (key === 'm') {
    // Shift on a tool key reaches the other tool behind it, as it does in
    // Photoshop, where one slot of the rail holds a pair.
    editor.setTool(e.shiftKey ? 'marquee-ellipse' : 'marquee-rect')
  } else if (key === 'l') {
    editor.setTool(e.shiftKey ? 'lasso-polygon' : 'lasso')
  } else if (key === 'w') {
    editor.setTool('wand')
  } else if (key === 'b') {
    chooseTool('brush')
  } else if (key === 'e') {
    chooseTool('eraser')
  } else if (key === 'q') {
    selection.toggleQuickMask()
  } else if (e.key === '[' || e.key === ']') {
    // Sizes whichever mask tool is up, and nothing otherwise: the two keep
    // their own sizes, so with neither of them up there is no one to size.
    const mode = maskBrushModeOf(editor.tool)
    if (mode !== null) selection.nudgeBrushSize(mode, e.key === ']' ? 1 : -1)
  } else if (e.key === 'Enter' && selection.isDrawing) {
    e.preventDefault()
    selection.commitGesture()
  } else if (e.key === 'Enter' && connect.isDrawing) {
    e.preventDefault()
    connect.commit()
  } else if (e.key === 'Escape') {
    const now = performance.now()
    const isDouble = now - lastEscapeAt < ESCAPE_DOUBLE_MS
    lastEscapeAt = isDouble ? 0 : now
    if (isDouble) {
      if (pageReady.value) editor.fitToView()
    } else if (rDown.value && containerRef.value) {
      const rect = containerRef.value.getBoundingClientRect()
      editor.rotateTo(0, rect.width / 2, rect.height / 2)
    }
  }
})

// Deliberately unguarded: a key held down while the mode changed still has to
// be able to release, or the canvas is stuck in pan or rotate.
useEventListener(window, 'keyup', (e) => {
  if (e.key.toLowerCase() === 'r') rDown.value = false
  if (e.code === 'Space') spaceDown.value = false
})

/**
 * Alt and Caps Lock are read off whatever event is to hand rather than counted,
 * and they need their own listener because the canvas's other keys stand down
 * the moment a modifier is held.
 *
 * Caps Lock especially: it can be turned over while another window has the
 * keyboard, and a tally kept here would then be inverted for the rest of the
 * session with no way for a person to work out why.
 */
function trackModifiers(e: KeyboardEvent | PointerEvent): void {
  capsLock.value = e.getModifierState('CapsLock')
  altDown.value = e.altKey
}

useEventListener(window, 'keydown', trackModifiers)
useEventListener(window, 'keyup', trackModifiers)
// Alt-Tab hands the window away without ever sending the release, which would
// otherwise leave the eyedropper armed for the rest of the session.
useEventListener(window, 'blur', () => {
  altDown.value = false
})
</script>

<style scoped>
/*
 * Straight, to begin with. A curve laid over a whiteboard's empty background
 * looks better and over a page of artwork covers more of it — but a straight
 * line through a speech bubble covers the words. Both cost something and which
 * costs less is not decidable on paper.
 *
 * A white glow under every stroke, so a line reads over black ink and over
 * white paper without either having to be sampled — the same trick the brush
 * ring uses, and the reason none of these can go unseen against the page.
 */
.reading-line,
.reading-line-chosen,
.reading-line-preview,
.reading-line-refused {
  stroke-linecap: round;
  filter: drop-shadow(0 0 1px rgb(255 255 255 / 0.9))
    drop-shadow(0 0 2px rgb(255 255 255 / 0.7));
}
.reading-line {
  stroke: var(--primary);
  stroke-width: var(--line-stroke);
}
.reading-line-chosen {
  stroke: var(--foreground);
  stroke-width: 2.5;
}
.reading-line-preview {
  stroke: var(--primary);
  stroke-width: var(--line-stroke);
  stroke-dasharray: 4 3;
}
/* Refused before the click rather than reported after it. */
.reading-line-refused {
  stroke: var(--destructive);
  stroke-width: var(--line-stroke);
  stroke-dasharray: 2 4;
}

/*
 * A black ring under a white halo, so it reads on a white page and on the dark
 * gutter around it without either colour having to be sampled.
 */
.brush-ring {
  border: 1px solid rgb(0 0 0 / 0.9);
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.6);
}

/*
 * CSS has no rotate keyword, so these are lucide's redo and undo arcs. An arc
 * is used rather than a full circle because a ring reads the same whichever
 * way it turns, while the arc's silhouette states a direction on sight. Each
 * is stroked twice, a white halo under black, so it survives both a white page
 * and the dark gutter around it.
 */
.cursor-rotate-cw {
  cursor:
    url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'%3e%3cg stroke='white' stroke-width='5'%3e%3cpath d='M21 7v6h-6'/%3e%3cpath d='M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7'/%3e%3c/g%3e%3cg stroke='black' stroke-width='2'%3e%3cpath d='M21 7v6h-6'/%3e%3cpath d='M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7'/%3e%3c/g%3e%3c/svg%3e")
      14 14,
    grab;
}
.cursor-rotate-ccw {
  cursor:
    url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'%3e%3cg stroke='white' stroke-width='5'%3e%3cpath d='M3 7v6h6'/%3e%3cpath d='M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'/%3e%3c/g%3e%3cg stroke='black' stroke-width='2'%3e%3cpath d='M3 7v6h6'/%3e%3cpath d='M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'/%3e%3c/g%3e%3c/svg%3e")
      14 14,
    grab;
}
</style>
