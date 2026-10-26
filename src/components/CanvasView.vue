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
    @lostpointercapture="onLostPointerCapture"
    @pointerleave="onPointerLeave"
    @dblclick="selectionTool.onDoubleClick()"
    @contextmenu.prevent
  >
    <template v-if="currentFile && pageReady">
      <div :style="stageStyle">
        <div
          class="page-checker"
          :style="{ width: `${editor.viewContentSize.w}px`, height: `${editor.viewContentSize.h}px` }"
        />
      </div>

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
          :bitmaps="layerBitmaps"
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
        ⭐ Everything that follows the document, under one transform.

        Each of these used to multiply its own page coordinates by the view,
        build a style string and have the framework write it — so one turn of
        the wheel was that work done again for every element on screen. They are
        written in page pixels now and the stage carries the view once. It is
        also the more honest sentence: "these follow the document" is what the
        transform says, rather than every element saying it separately and
        everyone hoping they agree.
      -->
      <div :style="stageStyle">
        <!--
          Where the reading being pointed at in the list was read. Nothing here
          is an object — it is a mark that lasts as long as the pointer rests.
        -->
        <OcrOverlay v-if="ocrPointedBox" :pointed-box="ocrPointedBox" />

        <!--
          The boxes of whichever routes are switched on. Under the pointed mark
          above so that the one being pointed at still reads as the one.
        -->
        <OcrBoxes v-if="ocrBoxes.length" :boxes="ocrBoxes" />

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
        >
          <defs>
            <!--
              Sized in page units that come to a constant number of screen pixels,
              because `markerWidth` is an attribute rather than a property and
              cannot be written in `--px`. Two numbers per view change, against a
              marker that would otherwise grow to the size of a balloon at 8x.
            -->
            <marker
              v-for="head in ARROW_HEADS"
              :id="head.id"
              :key="head.id"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              :markerWidth="arrowSize"
              :markerHeight="arrowSize"
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

        <!--
          Its own stacking context, so the frame raised above its neighbours is
          raised among the frames only and stays under the cards drawn after.
        -->
        <div v-if="pageReady" class="pointer-events-none absolute inset-0 isolate">
          <!--
            The move tool alone, which is already the only one that can pick a
            raster layer. A rectangle drawn around what cannot be grabbed says
            nothing, and under a brush it says it right where the work is — the
            layer being painted is the whole page often enough that its frame
            lands across everything being drawn.
          -->
          <template v-if="framesShow">
            <RasterFrame
              v-for="layer in rasterFrames"
              :key="layer.id"
              :frame="frameOf(layer)"
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
          </template>
          <LabelBox
            v-for="object in objects"
            :key="object.id"
            :pointer="framesTakePointer ? 'box' : 'none'"
            :framed="connecting || painting"
            :handles="!connecting && !painting"
            :captioned="painting"
            :code="object.code"
            :text-style="object.style"
            :effects="object.effects"
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
            :editing="object.id === textEditingId"
            :selection="object.id === textEditingId ? markup.plainRange.value : null"
            :caret-key="object.id === textEditingId ? caretKey : 0"
            @edit-at="beginCanvasTextEdit(object.id, $event)"
            @select-text="(anchor, focus) => markup.selectPlain(anchor, focus)"
            @cut="cutEditedText(object.id)"
            @wrap="markup.apply({ kind: 'wrap', attrs: $event })"
            @clear="markup.apply({ kind: 'clear' })"
            @pointerenter="pointedObjectId = object.id"
            @pointerleave="pointedObjectId = null"
            @contextmenu="onObjectMenu(object.id, $event)"
            @select="onSelectObject(object.id, $event)"
            @move="moveLabelTo(object.id, $event)"
            @move-end="(from, to) => commitLabelMove(object.id, from, to)"
            @scale-start="beginLabelScale(object.id)"
            @scale="(fontSizePx, at) => scaleLabelTo(object.id, { fontSizePx }, at)"
            @scale-axes="
              (scaleXPercent, scaleYPercent, at) =>
                scaleLabelTo(object.id, { scaleXPercent, scaleYPercent }, at)
            "
            @scale-end="commitLabelScale(object.id)"
            @rotate="(radians, at) => rotateLabelTo(object.id, radians, at)"
            @rotate-end="(from, to) => commitLabelRotate(object.id, from, to)"
          />
        </div>

        <!--
          The readings still on offer, standing on the artwork. Only while the
          source is the side being worked on: they are evidence about what the
          artwork says, and there is nothing to judge from them once the work
          has moved on to what it should say instead.
        -->
        <SourceCards v-if="pageReady && editor.textSide === 'source'" />

        <!--
          The translations' own lists, off the document rather than on it: what
          a candidate is judged against is the source and the other candidates,
          none of which is anywhere on the artwork. Only while the translation
          is the side being worked on — under the source tool there is nothing
          here to choose between yet.
        -->
        <TranslationCards
          v-if="pageReady && editor.textSide === 'translation'"
          :linked="linkedObjectId"
        />

        <!--
          A rectangle drawn on the page, so it stands on the stage with the rest
          — only its border is held to screen pixels, being a mark on the
          interface rather than something the page holds.
        -->
        <div
          v-if="objectMarquee"
          class="pointer-events-none absolute border-solid border-primary bg-primary/10"
          :style="objectMarqueeStyle"
        />
      </div>

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
          直徑 {{ hudBrush.size }}px · 硬度 {{ Math.round(hudBrush.hardness * 100) }}% ·
          不透明度 {{ Math.round(hudBrush.opacity * 100) }}%
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
      ⚠️ Outside the stage for the same reason the menu is: it is placed in the
      window's own coordinates, and a transformed ancestor would resolve
      `position: fixed` against the page instead.

      The canvas's own box. It holds the words the engine is setting — no tags
      — so typing here reads as typing on the page, and the markup it belongs
      to is carried by the code underneath. Sized down to a sliver on the
      insertion point, which is where the IME has to open its candidates; what
      the reader sees is the engine's drawing, not this.
    -->
    <textarea
      v-if="textEditingId !== null"
      :ref="(el) => plainEditSurface.register(el as HTMLTextAreaElement | null)"
      class="canvas-input"
      spellcheck="false"
      :style="plainInputStyle"
      :value="markup.plain.value ?? ''"
      @input="markup.writePlain(($event.target as HTMLTextAreaElement).value)"
      @keydown="onCanvasInputKey"
      @blur="onCanvasInputBlur"
    />

    <!--
      ⚠️ Outside the stage, and it has to be. A menu stands at the point that
      raised it, in the window's own coordinates — and `position: fixed` is
      resolved against the nearest transformed ancestor rather than the window,
      so inside the stage it would be laid out from the page's top left corner
      and carry the view's pan and zoom with it. On a fitted page that is most of
      a page's width away from the pointer.
    -->
    <CanvasMenu
      :at="objectMenuAt"
      :items="OBJECT_MENU"
      @pick="onObjectMenuPick"
      @close="closeObjectMenu"
    />

    <!--
      Outside the page's branch: a refusal is worth saying whether or not there
      is a page ready to draw, and last in the box so nothing drawn covers it.
    -->
    <Notice />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import Notice from '@/components/Notice.vue'
import LabelBox from '@/components/LabelBox.vue'
import OcrBoxes from '@/components/OcrBoxes.vue'
import OcrOverlay from '@/components/OcrOverlay.vue'
import PageStack from '@/components/PageStack.vue'
import RasterFrame from '@/components/RasterFrame.vue'
import SourceCards from '@/components/SourceCards.vue'
import TranslationCards from '@/components/TranslationCards.vue'
import CanvasMenu from '@/components/CanvasMenu.vue'
import { useBrushHud } from '@/composables/useBrushHud'
import { useCanvasTextEdit } from '@/composables/useCanvasTextEdit'
import { useMarkupSession } from '@/composables/useMarkupSession'
import { plainEditSurface } from '@/composables/useTextEditSurface'
import { useCutText } from '@/composables/useCutText'
import { provideViewportOrigin, stageStyleFor } from '@/composables/useCanvasStage'
import { previewedStyle } from '@/composables/useFontPicker'
import type { RasterLayerEntry, TextLayerEntry } from '@shared/page/types'
import type { TextStyle } from '@shared/text-style/types'
import { pageStack, stackedRasterNodes, stackedTextNodes } from '@shared/page/stack'
import { isLocked } from '@shared/page/tree'
import type { ReadingEdge } from '@shared/page/readingGraph'
import { blocksOnSide, placeOfBlock, shownCodeOf, sideOf } from '@shared/page/units'
import { layersDirOf } from '@shared/ssk/constants'
import { useLayerAlpha } from '@/composables/useLayerAlpha'
import { useLayerBitmaps } from '@/composables/useLayerBitmaps'
import { useLayerBrush } from '@/composables/useLayerBrush'
import { useLayerPlacement } from '@/composables/useLayerPlacement'
import { useSelectionOverlay } from '@/composables/useSelectionOverlay'
import { useRasterTarget } from '@/composables/useRasterTarget'
import { useSelectionTool } from '@/composables/useSelectionTool'
import { ownsKeyboard } from '@/lib/typingSurface'
import {
  contentToScreenPx,
  screenToContentPx,
  screenToPagePx,
  travelSinceGrab,
  type Anchor,
} from '@/lib/coords'
import { drawnLabel } from '@/lib/labelRaster'
import { sourceLook } from '@/lib/sourceLook'
import { generateId } from '@shared/page/schema'
import { framedLayers, layerAt } from '@/lib/layerHit'
import { artworkSignature, compositeArtwork, compositeLayerAlone } from '@/lib/pageComposite'
import {
  distanceToSegment,
  nearestAnchor,
  readingLineBetween,
  type FrameBox,
} from '@/lib/readingLine'
import { marqueeRect } from '@/lib/selection/marquee'
import { cornersOf, obbHoldsPoint, obbIntersectsRect, type Obb } from '@/lib/selection/obb'
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
import { useOcrStore } from '@/stores/ocrStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useRasterStore } from '@/stores/rasterStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'

const project = useProjectStore()
const editor = useEditorStore()
const selection = useSelectionStore()
const connect = useConnectStore()
const ocr = useOcrStore()
const ui = useUiStore()
const raster = useRasterStore()
const preferences = usePreferencesStore()

const view = editor.view

const currentFile = computed(() =>
  editor.currentPageId ? (project.pageById(editor.currentPageId) ?? null) : null,
)

/** What this page draws and in what order — the same answer the export reads. */
const stack = computed(() => (currentFile.value ? pageStack(currentFile.value.page.layers, editor.textSide) : []))

/**
 * Every layer the page draws, decoded once and kept until the page turns.
 *
 * Above the stack rather than inside it: the elements the stack is cut into
 * come and go with a gesture, and pixels that came and went with them would be
 * read back from disk each time.
 */
const layerBitmaps = useLayerBitmaps(
  () => (currentFile.value ? layersDirOf(currentFile.value.pageDir) : null),
  () => [
    ...new Set(
      stackedRasterNodes(stack.value)
        .filter((node) => node.entry.w > 0 && node.entry.h > 0)
        .map((node) => node.entry.file),
    ),
  ],
)

const placement = useLayerPlacement(layerBitmaps)

/**
 * Every region the last trip read, drawn once.
 *
 * Once, because four readers now share one set of regions: four readings of a
 * balloon carry the same box, and drawing it four times is the same rectangle
 * four deep rather than four measurements.
 */
const ocrBoxes = computed(() => {
  const pageId = editor.currentPageId
  if (!pageId || !ocr.showing(pageId)) return []
  const seen = new Set<string>()
  return project.readingsOfPage(pageId).filter((c) => {
    const at = `${c.x},${c.y},${c.w},${c.h}`
    if (seen.has(at)) return false
    seen.add(at)
    return true
  })
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
    ? blocksOnSide(file.page.layers, editor.textSide)
    : stackedTextNodes(stack.value).map((node) => node.entry)
  // Every source drawn the same way, over a halo — a reference treatment for
  // reading them against un-lettered artwork, and the canvas's alone.
  const reference = editor.textSide === 'source'
  return entries.map((label) => {
    const body = label.body
    const tags = placeOfBlock(file.page, label.id)?.unit.tags ?? []
    const look = reference
      ? sourceLook(body.style)
      : { style: previewedStyle(body.style, editor.isSelected(label.id)), effects: label.effects }
    return {
    id: label.id,
    locked: isLocked(file.page.layers, label.id),
    code: shownCodeOf(file.page, label),
    x: body.x,
    y: body.y,
    rotation: body.rotation,
    accent: accentOf(tags),
    style: look.style,
    effects: look.effects,
    tags: tagsInRegistryOrder(tags, project.header.tags).map((name) => ({
      name,
      color: tagColor(name, project.header.tags),
    })),
    }
  })
})

/**
 * Which object's translation list is joined to it by a line.
 *
 * ⭐ Pointing at one wins over having selected one: the selection is where the
 * work is, and the pointer is what the reader is asking about right now.
 */
const pointedObjectId = ref<string | null>(null)

const linkedObjectId = computed(() => pointedObjectId.value ?? editor.cursorId)

/**
 * The menu a right-click on an object raises, and which object raised it.
 *
 * ⭐ On the object rather than on its list, because until a second candidate
 * exists there is no list to press — and a list only appears once there is a
 * choice to make. One gesture either way: the same item on an object that
 * already has a list adds another row to the list it has.
 */
const objectMenuAt = ref<{ x: number; y: number } | null>(null)
const objectMenuFor = ref<string | null>(null)

const OBJECT_MENU = [{ id: 'add-translation', label: '新增譯文候選' }] as const

function onObjectMenu(objectId: string, event: MouseEvent) {
  // Nothing here belongs to the source, whose candidates are the run's and not
  // anybody's to invent.
  if (editor.textSide !== 'translation') return
  event.preventDefault()
  event.stopPropagation()
  objectMenuFor.value = objectId
  objectMenuAt.value = { x: event.clientX, y: event.clientY }
}

function closeObjectMenu() {
  objectMenuAt.value = null
  objectMenuFor.value = null
}

function onObjectMenuPick(id: string) {
  const objectId = objectMenuFor.value
  const pageId = editor.currentPageId
  closeObjectMenu()
  if (id !== 'add-translation' || pageId === null || objectId === null) return
  editor.cmdAddTranslationCandidate(pageId, objectId, generateId())
}

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
/** Where a layer's pixels are, decided in one place for everything that draws or points at one. */
const frameOf = raster.frameOf

const rasterFrames = computed(() => {
  const file = currentFile.value
  if (!file) return []
  return framedLayers(stack.value, (id) => isLocked(file.page.layers, id), frameOf)
})

/**
 * Which layer the stack keeps on a canvas of its own, and where a gesture has
 * taken it.
 *
 * The layer actually being handled, so selecting one costs the page nothing:
 * the cut is what a gesture needs, and a page cut on selection is a page re-cut
 * every time the cursor moves down the tree.
 */
const heldLayer = computed(() => placement.held.value)

/**
 * The pixels of every layer a press could reach, kept ready.
 *
 * Only the framed ones, which is what keeps a locked full-page base map — the
 * one layer that would cost real memory — from ever being read back.
 */
const layerAlpha = useLayerAlpha(
  () => (currentFile.value ? layersDirOf(currentFile.value.pageDir) : null),
  () => rasterFrames.value,
  (entry) => {
    const live = raster.liveLayer(entry.id)
    // Keyed on what has been written rather than on what has been drawn. A
    // preview puts the same pixels on the same canvas, so a plane read before
    // one is as true as a plane read after — and building a plane reads a whole
    // canvas back, which at one per pointer event is most of a stroke's cost.
    return live === null
      ? null
      : { canvas: live.canvas, frame: live.frame, key: `${entry.id}@${raster.writesTo(entry.id)}` }
  },
  frameOf,
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
    frameOf,
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
    ? project.blockById(editor.currentPageId, labelId)
    : undefined
}

/**
 * Typing on the canvas: a double click opens the object, and the pointer goes
 * on working on the text from there.
 *
 * The canvas has a box of its own, holding the words rather than the code the
 * list's box holds. Both write to the one body — whichever has the keyboard is
 * the writer and the other follows — so the two are one edit rather than two
 * copies of the text.
 */
const {
  editingId: textEditingId,
  moved: caretKey,
  enterAt: enterTextEdit,
} = useCanvasTextEdit()

const markup = useMarkupSession()

function beginCanvasTextEdit(labelId: string, index: number) {
  const pageId = editor.currentPageId
  const label = labelById(labelId)
  if (pageId === null || label === undefined) return
  void enterTextEdit(pageId, label, index)
}

const { cutSelection } = useCutText()

function cutEditedText(labelId: string) {
  const pageId = editor.currentPageId
  if (pageId === null) return
  const { start, end } = markup.plainRange.value
  cutSelection(pageId, labelId, start, end)
}

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
const plainInputStyle = computed(() => {
  const box = plainEditSurface.pinnedBox.value
  if (box === null) return undefined
  return {
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

function onCanvasInputKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    editor.commitTextEdit()
    return
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    editor.editBy(e.shiftKey ? -1 : 1)
  }
}

/**
 * The keyboard leaving ends the visit — unless it only went to the other
 * notation of the same body, or to the bar standing over the selection.
 */
function onCanvasInputBlur(e: FocusEvent) {
  if (markup.keepsSession(e.relatedTarget)) return
  editor.commitTextEdit()
}

/**
 * The before is taken once at the start rather than reconstructed afterwards:
 * a drag writes every frame, so by the time it ends there is nothing left on
 * the object saying where it began.
 */
let scaledFrom: ScaledLabel | null = null

function scaledState(label: TextLayerEntry): ScaledLabel {
  const body = label.body
  return { style: { ...body.style }, x: body.x, y: body.y }
}

function beginLabelScale(labelId: string) {
  const label = labelById(labelId)
  scaledFrom = label ? scaledState(label) : null
}

/**
 * What the corner changed and the position are written together on every frame,
 * because the position is what holds the pinned corner still against the size
 * that just changed — writing one without the other would let the frame slip
 * for a frame.
 *
 * Laid over the style the drag started from rather than over the one on the
 * object, so a gesture that switches between the two readings mid-drag takes
 * back whichever of them it had been writing.
 */
function scaleLabelTo(labelId: string, patch: Partial<TextStyle>, at: Anchor) {
  const label = labelById(labelId)
  if (!label || !editor.currentPageId || editor.isLayerLocked(labelId)) return
  const style = { ...(scaledFrom?.style ?? label.body.style), ...patch }
  project.setLabelStyle(editor.currentPageId, labelId, style)
  project.moveLabel(editor.currentPageId, labelId, at.x, at.y)
}

function commitLabelScale(labelId: string) {
  const label = labelById(labelId)
  if (!editor.currentPageId || !scaledFrom || !label) return
  editor.cmdScaleLabel(
    editor.currentPageId,
    labelId,
    scaledFrom,
    scaledState(label),
  )
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

/**
 * The stage's whole transform, and the one number the overlays on it need to
 * keep a mark screen-sized.
 */
const stageStyle = computed(() => stageStyleFor(view))

/**
 * ⚠️ The viewport's corner, not the stage's — the stage travels with the view,
 * and a gesture measuring from it would be dividing by a ruler that had already
 * moved. See `useCanvasStage`.
 */
provideViewportOrigin(() => {
  const rect = containerRef.value?.getBoundingClientRect()
  return rect ? { left: rect.left, top: rect.top } : { left: 0, top: 0 }
})
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
  const box = {
    centerX: rect.x + rect.w / 2,
    centerY: rect.y + rect.h / 2,
    width: rect.w,
    height: rect.h,
  }
  return {
    borderWidth: 'calc(1px * var(--px))',
    left: `${box.centerX}px`,
    top: `${box.centerY}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    // No turn of its own: the stage already carries the view's.
    transform: 'translate(-50%, -50%)',
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
    const drawn = drawnLabel(
      object.code,
      object.style,
      object.effects,
      { x: object.x, y: object.y },
      object.rotation,
    )
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

/**
 * Spraying meaning onto objects, which takes a press on one the way `connect`
 * does: under this tool a press means paint that object, and taking hold of it
 * is what the move tool is for.
 */
const painting = computed(() => editor.tool === 'tag-paint')

/**
 * The objects one gesture has already crossed. Held so that sweeping back over
 * one does not ask twice, and so the whole sweep lands as a single command.
 *
 * ⭐ Whether this stroke restyles what it crosses is read once, at the press.
 * A modifier sampled all the way through would let one sweep write two
 * different things depending on where the finger was when it passed each
 * object, and a sweep is one act.
 */
const tagSpray = ref<{ ids: Set<string>; updateStyle: boolean } | null>(null)

function sprayAt(p: Anchor) {
  const spray = tagSpray.value
  if (spray === null) return
  const id = objectAt(p)
  if (id !== null) spray.ids.add(id)
}

const ARROW_HEADS = [
  { id: 'reading-arrow', fill: 'var(--primary)' },
  { id: 'reading-arrow-chosen', fill: 'var(--foreground)' },
]

/** Each object's frame on the page, which is where its lines begin and end. */
const objectBoxes = computed(() => {
  const out = new Map<string, FrameBox>()
  for (const object of objects.value) {
    const drawn = drawnLabel(
      object.code,
      object.style,
      object.effects,
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
 * Each translation's frame on the page, which is where its lines begin and end.
 *
 * ⭐ A unit has no place of its own, so its frame is worked out from the blocks
 * of the side being shown — one block's own frame, and the union where a sound
 * was lettered in several. Held apart from the blocks' frames because the two
 * answer different questions: a line joins two pieces of content, and a handle
 * takes hold of one piece of lettering.
 */
const unitBoxes = computed(() => {
  const out = new Map<string, FrameBox>()
  const page = currentFile.value?.page
  if (page === undefined) return out
  for (const unit of page.translationUnits) {
    const boxes = sideOf(unit, editor.textSide)
      .members.map((id) => objectBoxes.value.get(id))
      .filter((b): b is FrameBox => b !== undefined)
    if (boxes.length === 0) continue
    if (boxes.length === 1) {
      out.set(unit.id, boxes[0])
      continue
    }
    // The turn goes: two blocks set at different angles have no shared one, and
    // a line arriving at a tilted rectangle nobody drew reads as a mistake.
    const corners = boxes.flatMap((b) => cornersOf({ center: b.center, w: b.w, h: b.h, rotation: b.rotation }))
    const xs = corners.map((c) => c.x)
    const ys = corners.map((c) => c.y)
    const left = Math.min(...xs)
    const right = Math.max(...xs)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    out.set(unit.id, {
      center: { x: (left + right) / 2, y: (top + bottom) / 2 },
      w: right - left,
      h: bottom - top,
      rotation: 0,
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
    const from = unitBoxes.value.get(edge.from)
    const to = unitBoxes.value.get(edge.to)
    if (from === undefined || to === undefined) return
    const line = readingLineBetween(from, to)
    out.push({
      // Both ends quoted, so no pair of ids spells another pair's key.
      key: `${keyPrefix}${JSON.stringify([edge.from, edge.to])}`,
      a: line.a,
      b: line.b,
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
  const from = unitBoxes.value.get(g.source)
  if (from === undefined) return null
  const target = hoverTargetId.value
  const to = target === null ? undefined : unitBoxes.value.get(target)
  if (to === undefined) {
    return { a: nearestAnchor(from, g.at), b: g.at, refused: false }
  }
  const line = readingLineBetween(from, to)
  return { a: line.a, b: line.b, refused: connect.refuses(target as string) }
})

/** How thick a line is drawn, in screen pixels; the stylesheet holds the same. */
const LINE_STROKE_PX = 1.5

/**
 * How long an arrow head is, in the stage's own units, so it comes out the same
 * size on screen at any zoom.
 */
const ARROW_SCREEN_PX = 7
const arrowSize = computed(() =>
  view.scale === 0 ? ARROW_SCREEN_PX : ARROW_SCREEN_PX / view.scale,
)

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
    const from = unitBoxes.value.get(edge.from)
    const to = unitBoxes.value.get(edge.to)
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
/** The layer a pixel operation would land on, which is the one the wand reads. */
const { target: wandTarget } = useRasterTarget()
const selectionTool = useSelectionTool(
  containerRef,
  { wand: () => wandLayer.value, colour: () => artwork.value },
  () => pageReady.value,
)
const layerBrush = useLayerBrush(containerRef)

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
 * The page's rasters composited into one page-sized picture, kept for the
 * eyedropper to read. Never drawn from here — the stack on screen draws those
 * same layers itself, and this would put them on the page twice.
 *
 * Composited rather than picked, because a colour is picked by pointing at one:
 * whatever layer it happens to live on, and whatever is stacked over it, the
 * answer has to be what the eye sees. The base map has no type of its own
 * either — it can be unlocked, reordered, dropped into a folder — so "which
 * layer is the artwork" has no answer, while "what is at this point" always
 * does.
 *
 * Typesetting is left out of it, as it is out of the wand: a translation is
 * something written onto the page, not part of the page's colour.
 */
const artwork = ref<OffscreenCanvas | null>(null)
/** Which composite the result being awaited belongs to. */
let artworkRequest = 0

/**
 * The layer being worked on, alone, on the page's own grid — what the wand
 * reads.
 *
 * One layer rather than the page because a selection is made in order to be
 * filled, erased or handed to a model, and every one of those lands on this
 * layer. A wand that followed an edge belonging to some other layer would hand
 * back a shape that cannot be acted on where it was found.
 *
 * Page-sized, so nothing downstream has to know where the layer sits. Where it
 * does not reach the canvas stays transparent, which the wand reads as a value
 * of its own — the reason it compares alpha at all.
 */
const wandLayer = ref<OffscreenCanvas | null>(null)
/** Which layer the result being awaited belongs to. */
let wandRequest = 0

/**
 * What a layer being edited is drawn from, so the wand reads the page as it is
 * rather than as it was when its pixels last reached disk — which under the
 * pixel scheduler can be half a minute ago.
 */
function liveLayer(id: string) {
  const live = raster.liveLayer(id)
  return live === null ? null : { canvas: live.canvas, frame: live.frame }
}

/**
 * What the eyedropper's picture is of, so a change that redraws the page drops
 * it.
 *
 * What has been *written*, not what has been drawn. Rebuilding this composites
 * the whole page out of every layer, and keyed on a stroke being shown it would
 * do that once per pointer event — for a picture nothing reads until a key is
 * held and a button pressed.
 */
const artworkKey = computed(() => {
  const file = currentFile.value
  if (!file) return null
  return artworkSignature(pageStack(file.page.layers, 'translation'), (id) =>
    raster.holds(id) ? `${id}@${raster.writesTo(id)}` : null,
  )
})

watch(
  () => [currentFile.value?.pageDir, artworkKey.value] as const,
  async ([pageDir]) => {
    artwork.value = null
    selectionTool.dropSample('colour')
    const mine = ++artworkRequest
    const file = currentFile.value
    if (!pageDir || !file) return
    try {
      const composited = await compositeArtwork({
        page: file.page,
        loadLayer: (name) => window.api.readImage(layersDirOf(pageDir), name),
        liveLayer,
      })
      // Two edits close together each start one of these, and they can finish
      // in either order. Only the newest may land, or an older picture would
      // overwrite it and a colour would be picked off the page as it was.
      if (mine === artworkRequest) artwork.value = composited
    } catch (err) {
      console.error(err)
    }
  },
  { immediate: true },
)

/**
 * What the wand's picture is of, so anything that changes it drops it: another
 * layer selected, that layer painted on, or its frame moved out from under the
 * pixels already read.
 *
 * The write counter rather than the pixels themselves, for the same reason the
 * composite uses it — a stroke in progress redraws constantly and the wand
 * cannot read anything until the hand comes up.
 */
const wandKey = computed(() => {
  const entry = wandTarget.value
  if (entry === null) return null
  const { x, y, w, h } = raster.frameOf(entry)
  const written = raster.holds(entry.id) ? `live@${raster.writesTo(entry.id)}` : entry.file
  return `${entry.id}|${written}|${x},${y},${w},${h}`
})

watch(
  () => [currentFile.value?.pageDir, wandKey.value] as const,
  async ([pageDir]) => {
    wandLayer.value = null
    // Any gesture belonged to the picture being replaced, and so did the wand's
    // reading of it.
    selection.cancelGesture()
    selectionTool.dropSample('wand')
    selectionOverlay.schedulePaint()
    const mine = ++wandRequest
    const file = currentFile.value
    const entry = wandTarget.value
    if (!pageDir || !file || entry === null) return
    try {
      const drawn = await compositeLayerAlone({
        entry,
        page: { w: file.page.width, h: file.page.height },
        loadLayer: (name) => window.api.readImage(layersDirOf(pageDir), name),
        live: liveLayer(entry.id),
      })
      if (mine === wandRequest) wandLayer.value = drawn
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
  () => !gestureArmed.value && !selecting.value && !connecting.value && !painting.value,
)

/**
 * Whether a raster layer's own rectangle is drawn at all. The move tool alone,
 * which is the only one that can take hold of one — a frame around something
 * that cannot be grabbed is decoration, and over a brush it is decoration lying
 * across the work.
 */
const framesShow = computed(() => editor.tool === 'select')

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
    painting.value ||
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
  if (e.button !== 0) {
    // The pen's eraser end reaches only the brush — none of the gestures
    // below, which all stay button-0 only, and the brush decides for itself
    // whether this press is its own.
    if (e.button === 5) layerBrush.onPointerDown(e)
    return
  }
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
    // The two brushes are asked twice over: once as the layer's, once as the
    // mask's. Which of them answers is Quick Mask, and each declines what is
    // not its own rather than the canvas deciding for them.
    if (layerBrush.onPointerDown(e)) return
    if (selectionTool.onPointerDown(e)) return
  }
  if (editor.tool === 'text') {
    // Keeps the press from taking focus off the field the new object opens.
    e.preventDefault()
    const rect = containerRef.value.getBoundingClientRect()
    const p = screenToPagePx(e.clientX, e.clientY, rect, view, editor.viewContentSize)
    const id = editor.addLabelAt(p.x, p.y)
    if (id !== null) beginCanvasTextEdit(id, 0)
    return
  }
  if (editor.tool === 'select-text') {
    el.setPointerCapture(e.pointerId)
    const rect = containerRef.value.getBoundingClientRect()
    const p = screenToPagePx(e.clientX, e.clientY, rect, view, editor.viewContentSize)
    objectMarquee.value = { origin: p, current: p, additive: e.shiftKey }
    return
  }
  if (painting.value) {
    el.setPointerCapture(e.pointerId)
    const rect = containerRef.value.getBoundingClientRect()
    // The press is the last word on whether the key was down, and saying so
    // here also resyncs the switch the panel is drawing.
    editor.overrideHeld = e.ctrlKey || e.metaKey
    tagSpray.value = { ids: new Set(), updateStyle: editor.paintStrokeUpdatesStyle }
    sprayAt(screenToPagePx(e.clientX, e.clientY, rect, view, editor.viewContentSize))
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
  const at = screenToContentPx(e.clientX, e.clientY, rect, view)
  const hit = layerHitAt(at)
  if (hit === null) {
    // Bare page. The one deliberate way to be holding nothing.
    editor.selectOnly(null)
    return
  }
  onSelectObject(hit, e.shiftKey)
  el.setPointerCapture(e.pointerId)
  layerDrag.value = {
    id: hit,
    from: { x: e.clientX, y: e.clientY },
    client: { x: e.clientX, y: e.clientY },
    grab: at,
    engaged: false,
  }
}

/**
 * Moving a layer by its own body, which its frame no longer takes the pointer
 * for. Everything the gesture means still belongs to the placement — this is
 * only the press, the travel and the release, in the place where the press
 * already lands.
 */
const layerDrag = ref<{
  id: string
  /** The press and the pointer's latest, both in client coordinates. */
  from: Anchor
  client: Anchor
  /** The page point the press landed on, which no view change can move. */
  grab: Anchor
  engaged: boolean
} | null>(null)

/**
 * Under this the press was a click. Without a threshold a layer would creep by
 * a pixel every time it was selected, and the move would be resampled into the
 * pixels and land in the undo stack as if it had been asked for.
 */
const LAYER_DRAG_THRESHOLD_PX = 3

function reportLayerDrag(): void {
  const drag = layerDrag.value
  if (drag === null || !drag.engaged || containerRef.value === null) return
  const rect = containerRef.value.getBoundingClientRect()
  placement.moveBy(drag.id, travelSinceGrab(drag.grab, drag.client.x, drag.client.y, rect, view))
}

function trackLayerDrag(e: PointerEvent): void {
  const drag = layerDrag.value
  if (drag === null) return
  if (!drag.engaged) {
    const dx = e.clientX - drag.from.x
    const dy = e.clientY - drag.from.y
    if (Math.hypot(dx, dy) < LAYER_DRAG_THRESHOLD_PX) return
    drag.engaged = true
  }
  drag.client = { x: e.clientX, y: e.clientY }
  reportLayerDrag()
}

// The frames answer a view change themselves; a layer is dragged by its body,
// which has no frame taking the pointer, so this is where it is answered for.
watch(
  () => [view.scale, view.tx, view.ty, view.rotate],
  () => reportLayerDrag(),
)

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
  if (tagSpray.value !== null && containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    sprayAt(screenToPagePx(e.clientX, e.clientY, rect, view, editor.viewContentSize))
    return
  }
  if (connecting.value && containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    onConnectMove(screenToPagePx(e.clientX, e.clientY, rect, view, editor.viewContentSize))
    return
  }
  if (layerBrush.onPointerMove(e)) return
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
  if (tagSpray.value !== null) {
    const { ids, updateStyle } = tagSpray.value
    editor.cmdPaintTags([...ids], editor.paintTags, updateStyle)
    tagSpray.value = null
    return
  }
  if (!rotating.value && !panning.value) {
    const brushEnded =
      e.type === 'pointercancel' ? layerBrush.onPointerCancel(e) : layerBrush.onPointerUp(e)
    if (!brushEnded && selecting.value) selectionTool.onPointerUp(e)
  }
  rotating.value = false
  panning.value = false
}

function onLostPointerCapture(e: PointerEvent) {
  layerBrush.onLostPointerCapture(e)
}

const ESCAPE_DOUBLE_MS = 400

useEventListener(window, 'keydown', (e) => {
  if (ui.view !== 'editor' || ui.settingsOpen) return
  if (ownsKeyboard(document.activeElement)) return
  // The display's drag is held under Alt, so its way out has to be reached
  // before the guard below turns every other key off.
  if (e.key === 'Escape' && hudGesture.value !== null) {
    cancelBrushHud()
    return
  }
  // Zoom to fit needs a way in that a painting tool cannot take from it: with
  // one up the bare digit is an opacity, so the modified one is what is always
  // the view's. It has to be read before the guard below stands every key down.
  if (e.key === '0' && (e.ctrlKey || e.metaKey) && !e.altKey) {
    if (pageReady.value) editor.fitToView()
    e.preventDefault()
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  // Turning the page and moving the cursor act on the document, and are dealt
  // with there. What is left here acts on the view.
  if (e.defaultPrevented) return

  const key = e.key.toLowerCase()
  const brushMode = maskBrushModeOf(editor.tool)

  if (brushMode !== null && e.key >= '0' && e.key <= '9') {
    // The row read left to right: 1 through 9 are tenths and 0 closes it at the
    // whole, which is where every editor with an opacity has put them.
    selection.setBrushOpacity(brushMode, e.key === '0' ? 1 : Number(e.key) / 10)
  } else if (e.key === '0') {
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
  } else if (key === 'k') {
    editor.setTool('tag-paint')
  } else if (key === 'm') {
    // Shift on a tool key reaches the other tool behind it, as it does in
    // Photoshop, where one slot of the rail holds a pair.
    editor.setTool(e.shiftKey ? 'marquee-ellipse' : 'marquee-rect')
  } else if (key === 'l') {
    editor.setTool(e.shiftKey ? 'lasso-polygon' : 'lasso')
  } else if (key === 'w') {
    editor.setTool('wand')
  } else if (key === 'b') {
    editor.setTool('brush')
  } else if (key === 'e') {
    editor.setTool('eraser')
  } else if (key === 's' && e.shiftKey) {
    editor.setTextSide(editor.textSide === 'source' ? 'translation' : 'source')
  } else if (key === 'q') {
    selection.toggleQuickMask()
  } else if (e.key === '[' || e.key === ']') {
    // Sizes whichever mask tool is up, and nothing otherwise: the two keep
    // their own sizes, so with neither of them up there is no one to size.
    if (brushMode !== null) selection.nudgeBrushSize(brushMode, e.key === ']' ? 1 : -1)
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
.page-checker {
  background: repeating-conic-gradient(#ffffff 0 25%, #cccccc 0 50%) 0 0 /
    calc(var(--px) * 16px) calc(var(--px) * 16px);
}

/*
 * Pinned to the insertion point on the page: a real control, holding the real
 * words and the real caret, sized down to a sliver. What the reader sees is
 * the engine's own drawing; this is only what the platform's input needs to
 * exist and to be somewhere.
 *
 * Not hidden, faint. A control that is `visibility: hidden`, `display: none`
 * or fully transparent stops being an IME target in some environments, and
 * being one is its entire job.
 */
.canvas-input {
  position: fixed;
  z-index: 50;
  field-sizing: fixed;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  resize: none;
  overflow: hidden;
  white-space: pre;
  opacity: 0.01;
  pointer-events: none;
}
.canvas-input:focus {
  outline: none;
}

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
  /* Screen pixels whatever the stage is scaled to — a line is a mark on the
     interface, not something the page holds. The dashes follow it. */
  vector-effect: non-scaling-stroke;
}
.reading-line {
  stroke: var(--primary);
  stroke-width: 1.5;
}
.reading-line-chosen {
  stroke: var(--foreground);
  stroke-width: 2.5;
}
.reading-line-preview {
  stroke: var(--primary);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}
/* Refused before the click rather than reported after it. */
.reading-line-refused {
  stroke: var(--destructive);
  stroke-width: 1.5;
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
