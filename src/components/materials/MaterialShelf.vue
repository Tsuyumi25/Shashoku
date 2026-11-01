<template>
  <div ref="rootEl" class="flex h-full min-h-0 flex-col bg-background text-sm">
    <div class="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1.5 text-xs">
      <template v-for="g in groups" :key="g.id">
        <input
          v-if="renaming?.id === g.id"
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
          :title="`${g.name}：${g.materials.length} 筆素材。雙擊改名`"
          @click="column.openGroup(g.id)"
          @dblclick="startRename('group', g.id, g.name)"
        >
          {{ g.name }}
        </button>
      </template>
      <button type="button" class="shelf-tab" title="新群組" aria-label="新群組" @click="addGroup">
        <Plus :size="12" />
      </button>
      <span class="ml-auto flex items-center gap-1">
        <button
          type="button"
          class="shelf-tab"
          :class="recipesOpen && 'shelf-tab-on'"
          title="存成素材時，預先打勾哪些欄位（recipe）"
          @click="recipesOpen = !recipesOpen"
        >
          存法
        </button>
        <button
          v-if="group"
          type="button"
          class="rounded p-1 text-muted-foreground hover:text-destructive"
          :title="`刪除群組「${group.name}」`"
          :aria-label="`刪除群組「${group.name}」`"
          @click="removeGroup"
        >
          <Trash2 :size="12" />
        </button>
      </span>
    </div>

    <div v-if="recipesOpen" class="shrink-0 space-y-2 border-b border-border bg-card/60 p-2 text-xs">
      <p class="text-muted-foreground">右鍵一顆字「存成素材：…」時，照這裡預先打勾。之後存的才照新的勾。</p>
      <div v-for="r in recipes" :key="r.id" class="space-y-1">
        <div class="flex items-center gap-1">
          <input
            v-if="renaming?.id === r.id"
            ref="renameEl"
            v-model="draft"
            class="h-5 w-24 rounded border border-primary bg-background px-1"
            @keydown.enter.prevent="finishRename"
            @keydown.escape.prevent="renaming = null"
            @blur="finishRename"
          />
          <span v-else class="font-medium" title="雙擊改名" @dblclick="startRename('recipe', r.id, r.name)">{{ r.name }}</span>
          <button
            type="button"
            class="ml-auto rounded p-0.5 text-muted-foreground hover:text-destructive"
            :title="`刪除存法「${r.name}」`"
            :aria-label="`刪除存法「${r.name}」`"
            @click="preferences.deleteRecipe(r.id)"
          >
            <X :size="11" />
          </button>
        </div>
        <div class="picks">
          <button
            v-for="f in MATERIAL_FIELDS"
            :key="f"
            type="button"
            class="pick"
            :class="r.picks.includes(f) && 'pick-on'"
            @click="preferences.toggleRecipePick(r.id, f)"
          >
            {{ FIELD_NAMES[f] }}
          </button>
        </div>
      </div>
      <button type="button" class="shelf-tab" @click="addRecipe"><Plus :size="11" />&nbsp;新存法</button>
    </div>

    <div v-if="!group" class="p-3 text-xs leading-relaxed text-muted-foreground">
      還沒有群組。按 ＋ 建一個，或在畫布上對一顆字按右鍵「存成素材：…」，會自動建好。
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto p-2" @mouseleave="endPreview">
      <p class="mb-2 px-1 text-xs text-muted-foreground">
        全部都能拖到頁面上成為新的一句。沒勾文字的{{ targets.length ? '指著試、點一下套用到選中的物件' : '，選了物件之後指著試、點一下套用' }}。右鍵改打勾。
      </p>
      <p v-if="!group.materials.length" class="px-1 text-xs text-muted-foreground/70">右鍵一顆字「存成素材：…」。</p>
      <div v-for="m in group.materials" :key="m.id" class="group/item relative mb-1">
        <div
          class="material"
          :class="[editing === m.id && 'material-editing', carriesWords(m) && 'material-words']"
          :title="describe(m)"
          @pointerdown="press(m, $event)"
          @mouseenter="preview(m)"
          @mouseleave="endPreview"
          @contextmenu.prevent="editing = editing === m.id ? null : m.id"
        >
          <span class="material-sample" :class="needsGrey(m) && 'on-grey'">
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
        </div>
        <div v-if="editing === m.id" class="picks px-1 pt-1 pb-2">
          <button
            v-for="f in MATERIAL_FIELDS"
            :key="f"
            type="button"
            class="pick"
            :class="m.picks.includes(f) && 'pick-on'"
            :disabled="f === 'text' && !m.text"
            :title="f === 'text' && !m.text ? '存的時候沒有字' : ''"
            @click="preferences.toggleMaterialPick(group.id, m.id, f)"
          >
            {{ FIELD_NAMES[f] }}
          </button>
        </div>
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

    <Teleport to="body">
      <div v-if="carrying" class="carry-ghost" :style="{ left: `${carrying.x + 10}px`, top: `${carrying.y - 12}px` }">
        {{ carrying.label }}
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useTemplateRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import { Plus, Trash2, X } from '@lucide/vue'
import { cloneEffects } from '@shared/effects/clone'
import { visibleStrokeOf } from '@shared/effects/stroke'
import type { LayerEffect } from '@shared/effects/types'
import type { TextStyle } from '@shared/text-style/types'
import { escapeText } from '@shared/page/markup'
import {
  MATERIAL_FIELDS,
  effectsPatchOf,
  stylePatchOf,
  type Material,
  type MaterialField,
} from '@shared/preferences/materials'
import WallPiece from '@/components/wall/WallPiece.vue'
import { useLeftColumn } from '@/composables/useLeftColumn'
import { useSelectionSample } from '@/composables/useSelectionSample'
import { useTrialEnds } from '@/composables/useTrialEnds'
import { screenToContentPx } from '@/lib/coords'
import type { Sample } from '@/lib/fontSampleCache'
import { drawnLabel } from '@/lib/labelRaster'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * One shelf of saved materials at a time, the groups as tabs along its top. A
 * material is carried onto the page to become a sentence there, or pointed at
 * to try what it gives on the selection and pressed to give it. What it gives
 * is its ticked switches; a right press opens them.
 */
const editor = useEditorStore()
const project = useProjectStore()
const preferences = usePreferencesStore()
const column = useLeftColumn()
const { targets, source } = useSelectionSample()

const FIELD_NAMES: Record<MaterialField, string> = {
  text: '文字',
  font: '字型',
  fontSizePx: '字級',
  direction: '方向',
  align: '對齊',
  color: '文字色',
  leadingPercent: '行距',
  weightPx: '字粗',
  scaleXPercent: '水平',
  scaleYPercent: '垂直',
  stroke: '描邊',
}

const groups = computed(() => preferences.prefs.materialGroups)
const recipes = computed(() => preferences.prefs.materialRecipes)
const group = computed(() => groups.value.find((g) => g.id === column.openGroupId.value) ?? groups.value[0] ?? null)

const editing = ref<string | null>(null)
const recipesOpen = ref(false)

// ── Names ──────────────────────────────────────────────────────────────────

const renaming = ref<{ kind: 'group' | 'recipe'; id: string } | null>(null)
const draft = ref('')
const renameEl = useTemplateRef<HTMLInputElement[]>('renameEl')

async function startRename(kind: 'group' | 'recipe', id: string, name: string) {
  renaming.value = { kind, id }
  draft.value = name
  await nextTick()
  renameEl.value?.[0]?.select()
}

/** A name another one already goes by is refused, and the old one stays. */
function finishRename() {
  const at = renaming.value
  renaming.value = null
  const name = draft.value.trim()
  if (at === null || !name) return
  if (at.kind === 'group') preferences.renameMaterialGroup(at.id, name)
  else preferences.renameRecipe(at.id, name)
}

function addGroup() {
  const id = preferences.createMaterialGroup('新群組')
  column.openGroup(id)
  void startRename('group', id, preferences.prefs.materialGroups.find((g) => g.id === id)?.name ?? '')
}

function addRecipe() {
  const id = preferences.createRecipe('新存法')
  void startRename('recipe', id, preferences.prefs.materialRecipes.find((r) => r.id === id)?.name ?? '')
}

function removeGroup() {
  const g = group.value
  if (!g) return
  if (g.materials.length && !window.confirm(`刪除群組「${g.name}」和裡面的 ${g.materials.length} 筆素材？`)) return
  preferences.deleteMaterialGroup(g.id)
}

// ── Drawing ────────────────────────────────────────────────────────────────

/** Every material drawn at the same em, so what tells them apart is what it gives and not its size. */
const SAMPLE_EM = 22

/**
 * What the selection held before anything was tried on it. A trial writes into
 * the selection, and every look is drawn over the selection — read live, the
 * whole shelf would put on the colour being tried.
 */
const heldBase = shallowRef<{ style: TextStyle; effects: LayerEffect[] } | null>(null)

/**
 * Each drawn as it would come out. Words are only ever put down, so they are
 * drawn over the project's own style, which is what a new sentence starts in.
 * A look is drawn over the object it would be given to: the selection as it
 * stood before the trial, or the project's style when nothing is selected — so
 * one without its font ticked shows the face it would leave alone.
 */
const drawn = computed(() => {
  const out = new Map<string, { sample: Sample | null; scale: number; missing: boolean }>()
  const from = source.value
  const seed = project.header.seedStyle
  const lead = targets.value[0]?.entry
  const selection = heldBase.value ?? (lead ? { style: lead.body.style, effects: lead.effects } : null)
  for (const m of group.value?.materials ?? []) {
    const ownWords = carriesWords(m)
    const base = ownWords || !selection ? { style: seed, effects: [] } : selection
    const code = ownWords ? escapeText(m.text) : (from?.code ?? (escapeText(m.text) || '字'))
    const style = { ...base.style, ...stylePatchOf(m) }
    const label = drawnLabel(code, style, effectsPatchOf(m) ?? base.effects, { x: 0, y: 0 }, 0)
    out.set(m.id, { sample: label.sample, scale: SAMPLE_EM / style.fontSizePx, missing: label.missingFamily !== null })
  }
  return out
})

function describe(m: Material): string {
  const parts: string[] = []
  if (carriesWords(m)) parts.push(`「${m.text.replace(/\n/g, ' ')}」`)
  if (m.picks.includes('font')) parts.push(m.style.fontFamily || '預設字型')
  const stroke = m.picks.includes('stroke') ? visibleStrokeOf(m.effects) : null
  if (stroke) parts.push(`描邊 ${stroke.width}px`)
  const rest = m.picks.filter((f) => f !== 'text' && f !== 'font' && f !== 'stroke').map((f) => FIELD_NAMES[f])
  if (rest.length) parts.push(rest.join('、'))
  return parts.join(' · ') || '沒有打勾'
}

/** White letters and white strokes have to show against something. */
function needsGrey(m: Material): boolean {
  const white = (c: string) => c.toLowerCase().startsWith('#ffffff')
  return (
    (m.picks.includes('color') && white(m.style.color)) ||
    (m.picks.includes('stroke') && white(visibleStrokeOf(m.effects)?.color ?? ''))
  )
}

// ── Trying and giving ──────────────────────────────────────────────────────

function gives(m: Material) {
  return { patch: stylePatchOf(m), effects: effectsPatchOf(m) }
}

/**
 * Words ticked make a material something to put down, never something to give:
 * pressed onto a selection it would have to either replace what the selection
 * says or quietly drop its own words, and neither is what pressing a word means.
 */
function carriesWords(m: Material): boolean {
  return m.picks.includes('text') && m.text.length > 0
}

function preview(m: Material) {
  const lead = targets.value[0]?.entry
  if (!lead || carrying.value || carriesWords(m)) return
  heldBase.value ??= { style: { ...lead.body.style }, effects: cloneEffects(lead.effects) }
  const { patch, effects } = gives(m)
  editor.previewStyle(targets.value, patch)
  // A material with its stroke unticked shows the objects' own stroke, not
  // whatever the material hovered before it left behind.
  if (effects !== null) editor.previewEffects(targets.value, effects)
  else editor.endEffectsPreview()
}

function endPreview() {
  editor.endEffectsPreview()
  editor.endStylePreview()
  heldBase.value = null
}

useTrialEnds(useTemplateRef<HTMLElement>('rootEl'), endPreview)

function apply(m: Material) {
  if (!targets.value.length || carriesWords(m)) return
  const { patch, effects } = gives(m)
  editor.cmdApplyLook(targets.value, patch, effects)
  // What was given is now what the selection holds, and the next trial starts from it.
  heldBase.value = null
}

// ── Carrying onto the page ─────────────────────────────────────────────────

const CARRY_THRESHOLD_PX = 4
let pressed: { m: Material; x: number; y: number } | null = null
const carrying = ref<{ m: Material; label: string; x: number; y: number } | null>(null)

function press(m: Material, e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  pressed = { m, x: e.clientX, y: e.clientY }
}

useEventListener(window, 'pointermove', (e: PointerEvent) => {
  if (!pressed) return
  if (!carrying.value && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < CARRY_THRESHOLD_PX) return
  if (!carrying.value) endPreview()
  const m = pressed.m
  const label = carriesWords(m) ? m.text : '＋'
  carrying.value = { m, label, x: e.clientX, y: e.clientY }
})

/**
 * Let go over the canvas and the material becomes a sentence where it landed;
 * anywhere else the carry was thought better of. A press that never moved is a
 * press: what the material gives goes to the selection.
 */
useEventListener(window, 'pointerup', (e: PointerEvent) => {
  const was = pressed
  const held = carrying.value
  pressed = null
  carrying.value = null
  if (!held) {
    if (was && e.button === 0) apply(was.m)
    return
  }
  const canvas = document.querySelector('[data-region="canvas"]')
  const page = editor.currentPageId
  if (!canvas || page === null) return
  const rect = canvas.getBoundingClientRect()
  if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return
  const at = screenToContentPx(e.clientX, e.clientY, { left: rect.left, top: rect.top }, editor.view)
  const m = held.m
  editor.cmdAddLabelFromMaterial(
    page,
    at,
    { text: carriesWords(m) ? m.text : null, ...gives(m) },
    editor.textSide,
  )
})

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && (carrying.value || pressed)) {
    pressed = null
    carrying.value = null
  }
})
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
/* Every switch one cell of an even grid, so a row of them reads as a table of on and off. */
.picks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(3.25rem, 1fr));
  gap: 0.25rem;
}
.pick {
  width: 100%;
  height: 1.5rem;
  min-width: 0;
  border-radius: 0.25rem;
  border: 1px solid var(--border);
  padding: 0 0.25rem;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted-foreground);
}
.pick-on {
  border-color: var(--primary);
  background: color-mix(in oklch, var(--primary) 18%, transparent);
  color: var(--foreground);
}
.pick:disabled {
  opacity: 0.4;
}
.material {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
  border-radius: 0.25rem;
  padding: 0.25rem 0.5rem;
  cursor: grab;
  user-select: none;
}
.material:hover:not(.material-words),
.material-editing {
  background: var(--secondary);
  box-shadow: inset 0 0 0 2px var(--primary);
}
/* Words only go out by being carried, so they answer a hover the way a thing to pick up does. */
.material-words:hover {
  background: var(--secondary);
}
.material-sample {
  display: flex;
  min-width: 0;
  max-width: 9rem;
  overflow: hidden;
  border-radius: 4px;
  padding: 2px 4px;
}
.material-sample.on-grey {
  background: oklch(0.66 0 0);
}
.material-remove {
  position: absolute;
  top: 0.55rem;
  right: 4px;
  display: none;
  height: 16px;
  width: 16px;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: var(--muted-foreground);
  color: var(--background);
}
.group\/item:hover .material-remove {
  display: flex;
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
