<template>
  <!--
    ⚠️ A probe, not a feature. It is here to find out how a panel holding every
    action feels when it is toggled over the canvas and always comes back to
    the same place, the way Photoshop's brushes panel does — the source the
    action boxes would be filled from. Its list is written out by hand and
    nothing in it can be pinned yet.
  -->
  <Teleport to="body">
    <div
      v-if="open && ui.view === 'editor'"
      ref="panelEl"
      class="probe-panel"
      :style="{ left: `${at.x}px`, top: `${at.y}px`, width: `${size.w}px`, height: `${size.h}px` }"
    >
      <div class="probe-head" @pointerdown="beginMove">
        <span class="font-medium">動作</span>
        <span class="ml-2 text-muted-foreground">拖這裡移動，位置會留著</span>
        <button type="button" class="probe-close" title="關閉（`）" @pointerdown.stop @click="close">×</button>
      </div>

      <div class="probe-search">
        <span class="text-muted-foreground">⌕</span>
        <input
          ref="inputEl"
          v-model="query"
          class="probe-input"
          placeholder="搜尋動作"
          @keydown="onKey"
        />
      </div>


      <div class="probe-body">
        <p v-if="groups.length === 0" class="probe-empty">沒有符合的動作</p>
        <section v-for="group in groups" :key="group.kind">
          <button type="button" class="probe-group" @click="toggleGroup(group.kind)">
            <span class="probe-caret" :class="folded.has(group.kind) && 'probe-caret-shut'">›</span>
            {{ group.kind }}
            <span class="ml-auto text-muted-foreground tabular-nums">{{ group.items.length }}</span>
          </button>
          <div v-if="!folded.has(group.kind) || query" class="probe-grid" :style="{ '--tile': `${tile}px` }">
            <div
              v-for="item in group.items"
              :key="item.id"
              class="probe-tile"
              :class="[item.lit?.() && 'probe-on', !item.can() && 'probe-off', item.id === highlighted?.id && 'probe-at']"
              :title="item.label"
              @click="run(item)"
            >
              <div class="probe-face">
                <template v-if="item.param">
                  <span>{{ item.param.prefix }}</span>
                  <input
                    v-model.number="params[item.id]"
                    type="number"
                    class="probe-param"
                    :step="item.param.step"
                    @click.stop
                    @keydown.enter.stop="run(item)"
                  />
                  <span class="probe-unit">{{ item.param.unit }}</span>
                </template>
                <template v-else>{{ item.face }}</template>
              </div>
              <div class="probe-caption">{{ item.label }}</div>
            </div>
          </div>
        </section>
      </div>

      <div class="probe-foot">
        <span>磚塊</span>
        <input v-model.number="tile" type="range" min="72" max="200" step="4" class="probe-range" />
        <span class="ml-auto">` 開關 · Enter 執行最上面那個</span>
      </div>
      <div class="probe-grip" title="拖這裡改大小" @pointerdown.stop="beginResize" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, useTemplateRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import { everyEntry } from '@shared/page/trees'
import { useInpaint } from '@/composables/useInpaint'
import { shelfScope } from '@/lib/objectShelf'
import { isEmptyRect } from '@/lib/selection/rect'
import { isTypingSurface } from '@/lib/typingSurface'
import { useEditorStore } from '@/stores/editorStore'
import { useOcrStore } from '@/stores/ocrStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'

const editor = useEditorStore()
const project = useProjectStore()
const selection = useSelectionStore()
const ocr = useOcrStore()
const preferences = usePreferencesStore()
const ui = useUiStore()
const inpaint = useInpaint()

interface Action {
  id: string
  /** What the tile shows large, as a brush's stroke would be. */
  face: string
  label: string
  /** The folder it sits in. */
  kind: string
  words?: string
  can: () => boolean
  lit?: () => boolean
  param?: { initial: number; step: number; unit: string; prefix: string }
  act: (value: number) => void
}

const hasSelection = () => selection.bounds !== null && !isEmptyRect(selection.bounds)
const hasText = () => editor.selectedTextObjects().length > 0

function grow(px: number) {
  const target = editor.maskTarget
  if (target !== null) selection.grow(target, px)
}

/** Every selected text object one size up or down from its own: one step a page. */
function bumpSize(by: number) {
  const targets = editor.selectedTextObjects()
  if (targets.length === 0 || by === 0) return
  for (const page of new Set(targets.map((t) => t.pageId))) {
    editor.cmdReshape(`probe-size ${by}`, page, () => {
      for (const { pageId, entry } of targets) {
        if (pageId !== page) continue
        const style = entry.body.style
        project.setLabelStyle(pageId, entry.id, { ...style, fontSizePx: Math.max(1, style.fontSizePx + by) })
      }
    })
  }
}

const retouch = computed(() => preferences.prefs.retouchOpacity)
const retouchDimmed = computed(() => {
  const file = editor.currentPageId ? project.pageById(editor.currentPageId) : undefined
  if (!file) return false
  const names = new Set(project.retouchLayerNames)
  const values = new Set(everyEntry(file.page).filter((e) => e.kind === 'raster' && names.has(e.name)).map((e) => e.opacity))
  return values.size === 1 && [...values][0] === retouch.value.low
})

function toggleRetouch() {
  const { low, high, wholeBook, undoable } = retouch.value
  const pages = wholeBook ? project.files.map((f) => f.pageId) : editor.currentPageId ? [editor.currentPageId] : []
  editor.cmdSetRetouchOpacity(pages, retouchDimmed.value ? high : low, { undoable })
}

function readPage() {
  const file = editor.currentPageId ? project.pageById(editor.currentPageId) : undefined
  if (file) void ocr.readPage(file.pageId, file.pageDir, file.page.pageTree)
}

const ACTIONS: Action[] = [
  { id: 'grow1', face: '+1px', label: '選區 +1px', kind: '選區', words: 'grow 外擴', can: hasSelection, act: () => grow(1) },
  { id: 'grow5', face: '+5px', label: '選區 +5px', kind: '選區', words: 'grow 外擴', can: hasSelection, act: () => grow(5) },
  { id: 'grow', face: '', label: '選區外擴（模版）', kind: '選區', words: 'grow', can: hasSelection, param: { initial: 3, step: 1, unit: 'px', prefix: '+' }, act: grow },
  { id: 'lama', face: 'LaMa', label: 'LaMa 修補', kind: '修圖', words: 'inpaint 去字 擦', can: () => inpaint.canEraseSelection.value, act: () => void inpaint.eraseSelection() },
  { id: 'retouch', face: '修圖 ◐', label: '修圖不透明度切換', kind: '修圖', words: 'opacity 透明', can: () => true, lit: () => retouchDimmed.value, act: toggleRetouch },
  { id: 'original', face: '原圖', label: '看原圖', kind: '檢視', words: 'original 原圖 對照', can: () => true, lit: () => editor.showingOriginal, act: () => (editor.showingOriginal = !editor.showingOriginal) },
  { id: 'hide-text', face: '藏字', label: '隱藏文字', kind: '檢視', words: 'hide text', can: () => true, lit: () => editor.textsHidden, act: () => (editor.textsHidden = !editor.textsHidden) },
  { id: 'size+2', face: '字 +2', label: '字級 +2', kind: '文字', words: 'size font 大', can: hasText, act: () => bumpSize(2) },
  { id: 'size-2', face: '字 −2', label: '字級 −2', kind: '文字', words: 'size font 小', can: hasText, act: () => bumpSize(-2) },
  { id: 'size', face: '', label: '字級調整（模版）', kind: '文字', words: 'size font', can: hasText, param: { initial: 2, step: 1, unit: 'px', prefix: '字' }, act: bumpSize },
  { id: 'ocr', face: 'OCR', label: '讀這一頁', kind: '辨識', words: 'ocr 辨識 讀', can: () => editor.currentPageId !== null, act: readPage },
  { id: 'shelf-scope', face: '全域', label: '素材架：此書／全域', kind: '素材', words: 'global 全域 此書 shelf', can: () => true, lit: () => shelfScope.value === 'global', act: () => (shelfScope.value = shelfScope.value === 'global' ? 'book' : 'global') },
]

const KINDS = [...new Set(ACTIONS.map((a) => a.kind))]

// Held across openings, as the panel's own state is in Photoshop.
const open = ref(false)
const query = ref('')
const tile = ref(104)
const folded = reactive(new Set<string>())
const params = reactive<Record<string, number>>(
  Object.fromEntries(ACTIONS.filter((a) => a.param).map((a) => [a.id, a.param!.initial])),
)
const at = ref({ x: 0, y: 0 })
/** Whether it has stood anywhere yet; before that it opens at the canvas's top left. */
let placed = false
const size = ref({ w: 380, h: 440 })
const inputEl = useTemplateRef<HTMLInputElement>('inputEl')

const matching = computed(() => {
  const words = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return ACTIONS.filter((a) => {
    const hay = `${a.face} ${a.label} ${a.kind} ${a.words ?? ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
})

const groups = computed(() =>
  KINDS.map((kind) => ({ kind, items: matching.value.filter((a) => a.kind === kind) })).filter((g) => g.items.length > 0),
)

/** What Enter in the search runs: the first match that can run, while something is typed. */
const highlighted = computed(() => (query.value ? matching.value.find((a) => a.can()) : undefined))

function toggleGroup(kind: string) {
  if (folded.has(kind)) folded.delete(kind)
  else folded.add(kind)
}

function run(item: Action) {
  if (!item.can()) return
  item.act(item.param ? Number(params[item.id]) || 0 : 0)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' || e.key === '`') {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape' && query.value) query.value = ''
    else close()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    if (highlighted.value) run(highlighted.value)
  }
}

// ── Where it stands: one place, kept ────────────────────────────────────────

function defaultPlace(): { x: number; y: number } {
  const canvas = document.querySelector('[data-region="canvas"]')?.getBoundingClientRect()
  return canvas ? { x: canvas.left + 16, y: canvas.top + 16 } : { x: 80, y: 80 }
}

function clampIn(p: { x: number; y: number }) {
  return {
    x: Math.min(Math.max(0, p.x), window.innerWidth - 120),
    y: Math.min(Math.max(0, p.y), window.innerHeight - 40),
  }
}

let drag: { kind: 'move' | 'resize'; x: number; y: number; from: { x: number; y: number } } | null = null

function beginMove(e: PointerEvent) {
  if (e.button !== 0) return
  drag = { kind: 'move', x: e.clientX, y: e.clientY, from: { ...at.value } }
}

function beginResize(e: PointerEvent) {
  if (e.button !== 0) return
  drag = { kind: 'resize', x: e.clientX, y: e.clientY, from: { x: size.value.w, y: size.value.h } }
}

useEventListener(window, 'pointermove', (e: PointerEvent) => {
  if (drag === null) return
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  if (drag.kind === 'move') at.value = clampIn({ x: drag.from.x + dx, y: drag.from.y + dy })
  else size.value = { w: Math.max(240, drag.from.x + dx), h: Math.max(200, drag.from.y + dy) }
})
useEventListener(window, 'pointerup', () => (drag = null))

// ── Opening and closing ─────────────────────────────────────────────────────

async function show() {
  at.value = clampIn(placed ? at.value : defaultPlace())
  placed = true
  open.value = true
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
}

function close() {
  open.value = false
  if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.probe-panel')) {
    document.activeElement.blur()
  }
}

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.code !== 'Backquote' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
  if (ui.view !== 'editor' || ui.settingsOpen || !project.isOpen) return
  if (isTypingSurface(document.activeElement)) return
  e.preventDefault()
  if (open.value) close()
  else void show()
})
</script>

<style scoped>
.probe-panel {
  position: fixed;
  z-index: 60;
  display: flex;
  flex-direction: column;
  min-width: 240px;
  min-height: 200px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--card, var(--background));
  box-shadow: 0 8px 28px rgb(0 0 0 / 0.28);
  font-size: 12px;
  overflow: hidden;
}
.probe-head {
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 4px 0 10px;
  border-bottom: 1px solid var(--border);
  cursor: move;
  user-select: none;
}
.probe-close {
  margin-left: auto;
  width: 22px;
  height: 20px;
  border-radius: 3px;
  color: var(--muted-foreground);
}
.probe-close:hover {
  background: var(--accent);
  color: var(--foreground);
}
.probe-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 8px 4px;
  padding: 0 8px;
  height: 26px;
  border: 1px solid var(--input);
  border-radius: 4px;
  background: var(--background);
}
.probe-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  outline: none;
}
.probe-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.probe-group {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 26px;
  padding: 0 10px;
  background: var(--muted, transparent);
  font-weight: 500;
  text-align: left;
}
.probe-caret {
  display: inline-block;
  transform: rotate(90deg);
  transition: transform 80ms;
}
.probe-caret-shut {
  transform: none;
}
.probe-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--tile), 1fr));
  gap: 2px;
  padding: 2px 2px 2px 18px;
}
.probe-tile {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 6px 8px 5px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: var(--background);
  cursor: default;
}
.probe-tile:hover {
  border-color: var(--border);
}
.probe-face {
  display: flex;
  align-items: baseline;
  gap: 2px;
  min-height: 24px;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
}
.probe-caption {
  margin-top: 2px;
  color: var(--muted-foreground);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.probe-param {
  width: 44px;
  height: 22px;
  padding: 0 3px;
  border: 1px solid var(--input);
  border-radius: 3px;
  background: var(--card, var(--background));
  font-size: 14px;
}
.probe-unit {
  font-size: 12px;
  font-weight: 400;
  color: var(--muted-foreground);
}
.probe-on {
  border-color: var(--primary) !important;
  box-shadow: inset 0 0 0 1px var(--primary);
}
.probe-off {
  opacity: 0.4;
}
.probe-at {
  border-color: var(--ring, var(--primary));
  background: var(--accent);
}
.probe-empty {
  padding: 10px;
  color: var(--muted-foreground);
}
.probe-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-top: 1px solid var(--border);
  color: var(--muted-foreground);
  font-size: 11px;
}
.probe-range {
  width: 110px;
}
.probe-grip {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 12px;
  height: 12px;
  cursor: nwse-resize;
}
</style>
