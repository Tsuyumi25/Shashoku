<template>
  <div ref="rootEl" class="flex h-full min-h-0 flex-col bg-background text-sm">
    <div class="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1.5 text-xs">
      <template v-for="g in groups" :key="g.id">
        <input
          v-if="renaming === g.id"
          ref="renameEl"
          v-model="draft"
          class="h-6 w-24 rounded border border-primary bg-background px-1.5"
          @keydown.enter.prevent="finishRename"
          @keydown.escape.prevent="renaming = null"
          @blur="finishRename"
        />
        <button
          v-else
          type="button"
          class="shelf-tab"
          :class="g.id === group?.id && 'shelf-tab-on'"
          :title="`${g.name}：${g.texts.length} 段文字、${g.styles.length} 種樣式。雙擊改名`"
          @click="column.openGroup(g.id)"
          @dblclick="startRename(g.id, g.name)"
        >
          {{ g.name }}
        </button>
      </template>
      <button type="button" class="shelf-tab" title="新群組" aria-label="新群組" @click="addGroup">
        <Plus :size="12" />
      </button>
      <button
        v-if="group"
        type="button"
        class="ml-auto rounded p-1 text-muted-foreground hover:text-destructive"
        :title="`刪除群組「${group.name}」`"
        :aria-label="`刪除群組「${group.name}」`"
        @click="removeGroup"
      >
        <Trash2 :size="12" />
      </button>
    </div>

    <div v-if="!group" class="p-3 text-xs leading-relaxed text-muted-foreground">
      還沒有群組。按 ＋ 建一個，或在畫布上對一顆字按右鍵「將樣式存成素材」「將文字存成素材」，會自動建好。
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto p-3" @mouseleave="endPreview">
      <div class="mb-1 text-xs text-muted-foreground">文字 · 拖到頁面上成為一句</div>
      <p v-if="!group.texts.length" class="mb-3 text-xs text-muted-foreground/70">右鍵一顆字「將文字存成素材」。</p>
      <div class="mb-4 flex flex-wrap gap-1.5">
        <div v-for="m in group.texts" :key="m.id" class="group/item relative">
          <span class="material-text" :title="m.text" @pointerdown="startCarry(m.text, $event)">{{ m.text }}</span>
          <button
            type="button"
            class="material-remove"
            title="從群組移除"
            aria-label="從群組移除"
            @click="preferences.deleteMaterial(group.id, m.id)"
          >
            <X :size="10" />
          </button>
        </div>
      </div>

      <div class="mb-1 text-xs text-muted-foreground">
        樣式 · {{ targets.length ? '指著試、點一下套用' : '先選一個文字物件' }}
      </div>
      <p v-if="!group.styles.length" class="text-xs text-muted-foreground/70">
        右鍵一顆字「將樣式存成素材」。存字型、文字色、字粗、行距、縮放和描邊；字級和方向留在物件上。
      </p>
      <div class="flex flex-col">
        <div v-for="m in group.styles" :key="m.id" class="group/item relative">
          <button
            type="button"
            class="look"
            :title="describe(m)"
            :disabled="!targets.length"
            @mouseenter="preview(m)"
            @mouseleave="endPreview"
            @click="apply(m)"
          >
            <span class="look-sample" :class="needsGrey(m) && 'on-grey'">
              <WallPiece
                v-if="drawn.get(m.id)"
                class="pointer-events-none"
                :sample="drawn.get(m.id)!.sample"
                :scale="drawn.get(m.id)!.scale"
                :missing="drawn.get(m.id)!.missing"
                :selected="false"
                title=""
              />
            </span>
            <span class="min-w-0 truncate text-xs text-muted-foreground">{{ describe(m) }}</span>
          </button>
          <button
            type="button"
            class="material-remove look-remove"
            title="從群組移除"
            aria-label="從群組移除"
            @click="preferences.deleteMaterial(group.id, m.id)"
          >
            <X :size="10" />
          </button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="carrying" class="carry-ghost" :style="{ left: `${carrying.x + 10}px`, top: `${carrying.y - 12}px` }">
        {{ carrying.text }}
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import { Plus, Trash2, X } from '@lucide/vue'
import { visibleStrokeOf } from '@shared/effects/stroke'
import type { StyleMaterial } from '@shared/preferences/materials'
import WallPiece from '@/components/wall/WallPiece.vue'
import { useLeftColumn } from '@/composables/useLeftColumn'
import { useSelectionSample } from '@/composables/useSelectionSample'
import { useTrialEnds } from '@/composables/useTrialEnds'
import { screenToContentPx } from '@/lib/coords'
import type { Sample } from '@/lib/fontSampleCache'
import { drawnLabel } from '@/lib/labelRaster'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'

/**
 * One shelf of saved materials at a time, the groups as tabs along its top.
 * Words are carried onto the page and become a sentence there; looks are
 * pointed at to try on the selection and pressed to give it.
 */
const editor = useEditorStore()
const preferences = usePreferencesStore()
const column = useLeftColumn()
const { targets, source } = useSelectionSample()

const groups = computed(() => preferences.prefs.materialGroups)
const group = computed(() => groups.value.find((g) => g.id === column.openGroupId.value) ?? groups.value[0] ?? null)

// ── Groups ─────────────────────────────────────────────────────────────────

const renaming = ref<string | null>(null)
const draft = ref('')
const renameEl = useTemplateRef<HTMLInputElement[]>('renameEl')

function addGroup() {
  const id = preferences.createMaterialGroup('新群組')
  column.openGroup(id)
  void startRename(id, preferences.prefs.materialGroups.find((g) => g.id === id)?.name ?? '')
}

async function startRename(id: string, name: string) {
  renaming.value = id
  draft.value = name
  await nextTick()
  renameEl.value?.[0]?.select()
}

/** A name another group already goes by is refused, and the old one stays. */
function finishRename() {
  const id = renaming.value
  renaming.value = null
  const name = draft.value.trim()
  if (id !== null && name) preferences.renameMaterialGroup(id, name)
}

function removeGroup() {
  const g = group.value
  if (!g) return
  const held = g.texts.length + g.styles.length
  if (held && !window.confirm(`刪除群組「${g.name}」和裡面的 ${held} 筆素材？`)) return
  preferences.deleteMaterialGroup(g.id)
}

// ── Words, carried onto the page ───────────────────────────────────────────

const CARRY_THRESHOLD_PX = 4
let pressed: { text: string; x: number; y: number } | null = null
const carrying = ref<{ text: string; x: number; y: number } | null>(null)

function startCarry(text: string, e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  pressed = { text, x: e.clientX, y: e.clientY }
}

useEventListener(window, 'pointermove', (e: PointerEvent) => {
  if (!pressed) return
  if (!carrying.value && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < CARRY_THRESHOLD_PX) return
  carrying.value = { text: pressed.text, x: e.clientX, y: e.clientY }
})

/**
 * Let go over the canvas and the words become a sentence where they landed;
 * let go anywhere else and the carry was thought better of.
 */
useEventListener(window, 'pointerup', (e: PointerEvent) => {
  const held = carrying.value
  pressed = null
  carrying.value = null
  if (!held) return
  const canvas = document.querySelector('[data-region="canvas"]')
  const page = editor.currentPageId
  if (!canvas || page === null) return
  const rect = canvas.getBoundingClientRect()
  if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return
  const at = screenToContentPx(e.clientX, e.clientY, { left: rect.left, top: rect.top }, editor.view)
  editor.cmdAddLabelFromText(page, at, held.text, editor.textSide)
})

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && carrying.value) {
    pressed = null
    carrying.value = null
  }
})

// ── Looks, tried and given ─────────────────────────────────────────────────

/** Every look drawn at the same em, so what tells them apart is the look and not the size. */
const LOOK_EM = 22

const drawn = computed(() => {
  const out = new Map<string, { sample: Sample | null; scale: number; missing: boolean }>()
  const from = source.value
  if (!from || !group.value) return out
  for (const m of group.value.styles) {
    const style = { ...from.entry.body.style, ...m.style }
    const label = drawnLabel(from.code, style, m.effects, { x: 0, y: 0 }, 0)
    out.set(m.id, { sample: label.sample, scale: LOOK_EM / style.fontSizePx, missing: label.missingFamily !== null })
  }
  return out
})

function describe(m: StyleMaterial): string {
  const parts = [m.style.fontStyleName ? `${m.style.fontFamily} ${m.style.fontStyleName}` : m.style.fontFamily || '預設字型']
  const stroke = visibleStrokeOf(m.effects)
  if (stroke) parts.push(`描邊 ${stroke.width}px`)
  if (m.style.weightPx !== 0) parts.push(`字粗 ${m.style.weightPx > 0 ? '+' : ''}${m.style.weightPx}`)
  return parts.join(' · ')
}

/** White letters and white strokes have to show against something. */
function needsGrey(m: StyleMaterial): boolean {
  const white = (c: string) => c.toLowerCase().startsWith('#ffffff')
  return white(m.style.color) || white(visibleStrokeOf(m.effects)?.color ?? '')
}

function preview(m: StyleMaterial) {
  if (!targets.value.length) return
  editor.previewStyle(targets.value, m.style)
  editor.previewEffects(targets.value, m.effects)
}

function endPreview() {
  editor.endEffectsPreview()
  editor.endStylePreview()
}

useTrialEnds(useTemplateRef<HTMLElement>('rootEl'), endPreview)

function apply(m: StyleMaterial) {
  if (!targets.value.length) return
  editor.cmdApplyLook(targets.value, m.style, m.effects)
}
</script>

<style scoped>
.shelf-tab {
  display: inline-flex;
  height: 1.5rem;
  align-items: center;
  border-radius: 0.25rem;
  border: 1px solid var(--border);
  padding: 0 0.5rem;
  color: var(--muted-foreground);
}
.shelf-tab:hover {
  color: var(--foreground);
}
.shelf-tab-on {
  border-color: var(--primary);
  color: var(--foreground);
  font-weight: 500;
}
.material-text {
  display: inline-block;
  min-width: 2.25rem;
  max-width: 12rem;
  overflow: hidden;
  border-radius: 0.25rem;
  border: 1px solid var(--border);
  background: var(--card);
  padding: 0.25rem 0.6rem;
  text-align: center;
  text-overflow: ellipsis;
  white-space: pre;
  font-size: 15px;
  line-height: 1.3;
  cursor: grab;
  user-select: none;
}
.material-text:hover {
  box-shadow: inset 0 0 0 2px var(--primary);
}
.material-remove {
  position: absolute;
  top: -5px;
  right: -5px;
  display: none;
  height: 14px;
  width: 14px;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: var(--muted-foreground);
  color: var(--background);
}
.group\/item:hover .material-remove {
  display: flex;
}
.look {
  display: grid;
  width: 100%;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
  border-radius: 0.25rem;
  padding: 0.25rem 0.5rem;
  text-align: left;
}
.look-sample {
  display: flex;
  min-width: 0;
  max-width: 9rem;
  overflow: hidden;
  border-radius: 4px;
  padding: 2px 4px;
}
.look-sample.on-grey {
  background: oklch(0.66 0 0);
}
.look:hover:not(:disabled) {
  background: var(--secondary);
  box-shadow: inset 0 0 0 2px var(--primary);
}
.look:disabled {
  cursor: default;
}
.look-remove {
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
}
.carry-ghost {
  position: fixed;
  z-index: 100;
  pointer-events: none;
  border-radius: 0.25rem;
  background: var(--card);
  padding: 0 0.4rem;
  font-size: 18px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
  white-space: pre;
}
</style>
