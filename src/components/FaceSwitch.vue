<template>
  <!--
    Which side and face is being worked on, where the project's name used to
    stand: pointing opens the list, a click keeps it open, and clicking a row
    goes there. The list is also where faces are named, added and removed.
  -->
  <PopoverRoot :open="open" @update:open="(v) => !v && close()">
    <PopoverAnchor as-child>
      <button
        ref="button"
        type="button"
        class="face-switch"
        :aria-expanded="open"
        :aria-pressed="pinned"
        :disabled="!project.isOpen"
        :title="project.dirty ? '尚未存檔' : undefined"
        @pointerenter="hover(true)"
        @pointerleave="hover(false)"
        @click="onClick"
      >
        <span v-if="project.dirty" class="face-switch-dirty">●</span>
        <Languages :size="13" />
        <span class="truncate">{{ current }}</span>
        <ChevronUp :size="13" class="face-switch-chevron" />
      </button>
    </PopoverAnchor>
    <PopoverPortal>
      <PopoverContent
        class="face-options"
        side="top"
        :side-offset="4"
        @pointerenter="hover(true)"
        @pointerleave="hover(false)"
        @open-auto-focus.prevent
        @interact-outside="onOutside"
      >
        <div class="face-head">
          <span>工作面</span>
          <button type="button" class="face-btn" title="關閉" @click="close()"><X :size="13" /></button>
        </div>
        <button
          type="button"
          class="face-pick"
          :class="editor.textSide === 'source' && 'face-pick-on'"
          title="原文就是這一頁本身（Shift+S 在原文和譯文之間切換）"
          @click="go(null)"
        >
          原文
        </button>
        <div v-for="face in project.faces" :key="face.id" class="face-row">
          <button
            type="button"
            class="face-pick face-pick-no"
            :class="editor.textSide === 'translation' && face.id === project.activeFace && 'face-pick-on'"
            title="切到這個譯文面"
            @click="go(face.id)"
          >
            f{{ face.no }}
          </button>
          <input
            class="face-name"
            :value="face.name"
            @change="onRename(face.id, $event)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
          <button
            type="button"
            class="face-btn"
            title="刪除這個譯文面"
            :disabled="project.faces.length <= 1"
            @click="onDelete(face.id, face.name)"
          >
            <Trash2 :size="13" />
          </button>
        </div>
        <button type="button" class="face-add" title="照目前的譯文面排版，開一個空白的新譯文面" @click="onAdd">
          <Plus :size="13" /> 新增譯文面
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui'
import { ChevronUp, Languages, Plus, Trash2, X } from '@lucide/vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const editor = useEditorStore()
const project = useProjectStore()

const current = computed(() => {
  if (!project.isOpen) return ''
  if (editor.textSide === 'source') return '原文'
  return project.faces.find((f) => f.id === project.activeFace)?.name ?? '譯文'
})

const hovered = ref(false)
const pinned = ref(false)
const open = computed(() => hovered.value || pinned.value)

/**
 * The pointer crosses the gap between the button and the list on its way in,
 * so leaving one waits a moment for it to arrive at the other.
 */
const LEAVE_GRACE_MS = 150
let leaving: ReturnType<typeof setTimeout> | null = null

function hover(on: boolean): void {
  if (leaving !== null) clearTimeout(leaving)
  leaving = null
  if (on) hovered.value = true
  else leaving = setTimeout(() => (hovered.value = false), LEAVE_GRACE_MS)
}

/**
 * A second click takes the list away even with the pointer still on the
 * button: it stays shut until the pointer leaves and comes back.
 */
function onClick(): void {
  if (pinned.value) close()
  else pinned.value = true
}

const button = useTemplateRef<HTMLButtonElement>('button')

/**
 * The button is the popover's anchor, not its trigger, so the popover counts a
 * press on it as a press outside and shuts before the click arrives — which
 * then opened it again. The button answers for itself.
 */
function onOutside(e: Event): void {
  if (e.target instanceof Node && button.value?.contains(e.target)) e.preventDefault()
}

function close(): void {
  if (leaving !== null) clearTimeout(leaving)
  leaving = null
  pinned.value = false
  hovered.value = false
}

onBeforeUnmount(() => {
  if (leaving !== null) clearTimeout(leaving)
})

function go(face: string | null): void {
  if (face === null) editor.setTextSide('source')
  else {
    editor.setActiveFace(face)
    editor.setTextSide('translation')
  }
}

function onRename(id: string, e: Event): void {
  const input = e.target as HTMLInputElement
  const name = input.value.trim()
  if (name === '') {
    input.value = project.faces.find((f) => f.id === id)?.name ?? ''
    return
  }
  editor.cmdRenameFace(id, name)
}

function onDelete(id: string, name: string): void {
  if (!window.confirm(`刪除譯文面「${name}」？這一面每一頁的譯文、候選和閱讀順序都會一起刪掉。`)) return
  editor.cmdDeleteFace(id)
}

function onAdd(): void {
  editor.cmdAddFace(freeFaceName())
}

function freeFaceName(): string {
  const taken = new Set(project.faces.map((f) => f.name))
  for (let n = project.faces.length + 1; ; n++) {
    const name = `譯文 ${n}`
    if (!taken.has(name)) return name
  }
}
</script>

<style scoped>
.face-switch {
  display: flex;
  height: 1.25rem;
  max-width: 100%;
  min-width: 0;
  align-items: center;
  gap: 4px;
  border-radius: 0.25rem;
  padding: 0 6px;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}
.face-switch:hover:not(:disabled),
.face-switch[aria-expanded='true'] {
  background: var(--secondary);
  color: var(--foreground);
}
.face-switch[aria-pressed='true'] {
  box-shadow: inset 0 -1px 0 var(--foreground);
}
.face-switch-chevron {
  flex-shrink: 0;
  transition: transform 0.15s;
}
.face-switch[aria-expanded='true'] .face-switch-chevron {
  transform: rotate(180deg);
}
.face-switch-dirty {
  color: var(--muted-foreground);
}
</style>

<style>
/* Portalled out of the component, so a scoped block would not reach it. */
.face-options {
  z-index: 50;
  display: flex;
  width: 15rem;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--popover);
  color: var(--popover-foreground);
  font-size: 0.8125rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.face-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted-foreground);
}
.face-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.face-pick {
  border-radius: 0.25rem;
  padding: 1px 6px;
  text-align: left;
  color: var(--muted-foreground);
}
.face-pick-no {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.face-pick:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.face-pick-on,
.face-pick-on:hover {
  background: var(--accent);
  color: var(--accent-foreground);
}
.face-name {
  min-width: 0;
  flex: 1;
  border: 1px solid var(--input);
  border-radius: 0.25rem;
  background: var(--background);
  padding: 1px 4px;
}
.face-btn {
  border-radius: 0.25rem;
  padding: 2px;
  color: var(--muted-foreground);
}
.face-btn:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.face-btn:disabled {
  opacity: 0.4;
}
.face-add {
  display: flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  border-radius: 0.25rem;
  padding: 2px 6px;
  color: var(--muted-foreground);
}
.face-add:hover {
  background: var(--secondary);
  color: var(--foreground);
}
</style>
