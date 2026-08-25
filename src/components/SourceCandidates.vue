<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="pane-head">
      <span class="text-xs font-medium text-muted-foreground">原文</span>
      <span class="ml-auto pr-2 text-xs text-muted-foreground">附近 {{ nearby }}</span>
    </div>

    <div v-if="!object" class="px-3 py-4 text-center select-none">
      <span class="text-xs text-muted-foreground">選一顆文字物件</span>
    </div>

    <!--
      One list and no box above it: what the object stands for is a marked
      row at the top — a box would be the same sentence written twice. The
      own row always leads, which is what lets there be no "write your own"
      button anywhere.
    -->
    <div
      v-else
      class="min-h-0 flex-1 overflow-y-auto py-0.5"
      :class="[!swapping && 'still']"
    >
      <TransitionGroup name="cand" tag="div">
        <div
          v-for="(row, index) in rows"
          :key="row.hash"
          class="cand"
          :class="[row.held && 'cand-on', index === pinCount - 1 && rows.length > pinCount && 'cand-pin']"
          @click="take(row.hash)"
          @mouseenter="ocr.pointAt(row.hash)"
          @mouseleave="ocr.pointAt(null)"
        >
          <span class="pick"><i /></span>
          <div class="min-w-0 flex-1">
            <!--
              Editable where it is picked and nowhere else: a correction is
              answering for the slot, so the row that takes typing is the
              row that has been answered for.
            -->
            <textarea
              v-if="row.held"
              v-auto-grow
              rows="1"
              spellcheck="false"
              :placeholder="row.hash === 'own' ? '自己寫一句' : ''"
              class="cand-text cand-input"
              :value="row.text"
              @input="write(row.hash, $event)"
            />
            <p
              v-else
              class="cand-text"
              :class="row.hash === 'own' && !row.text && 'text-muted-foreground/50'"
            >
              {{ row.hash === 'own' && !row.text ? '自己寫一句' : row.text }}
            </p>

            <div class="cand-meta">
              <span v-if="row.confidence !== null" :class="sureness(row.confidence)">
                {{ Math.round(row.confidence * 100) }}%
              </span>
              <span>{{ row.source === 'own' ? '自己寫的' : row.source }}</span>
              <span v-if="row.label && detectorOf(row.label)">{{ detectorOf(row.label) }}</span>
              <span v-if="row.distance !== null">{{ Math.round(row.distance) }}px</span>
            </div>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { candidatesFor } from '@shared/ocr/candidates'
import { detectorOf } from '@shared/ocr/types'
import { textOf } from '@shared/page/text'
import { drawnLabel } from '@/lib/labelRaster'
import { useEditorStore } from '@/stores/editorStore'
import { useOcrStore } from '@/stores/ocrStore'
import { useProjectStore } from '@/stores/projectStore'
import { vAutoGrow } from '@/lib/autoGrow'

const editor = useEditorStore()
const project = useProjectStore()
const ocr = useOcrStore()

const pageId = computed(() => editor.currentPageId)

const object = computed(() => {
  const id = editor.cursorId
  if (!pageId.value || !id) return null
  return project.labelById(pageId.value, id) ?? null
})

const pool = computed(() => (pageId.value ? project.readingsOfPage(pageId.value) : []))

const rows = computed(() => {
  const o = object.value
  if (!o) return []
  const centre = drawnLabel(textOf(o), o.style, o.effects, { x: o.x, y: o.y }, o.rotation).center
  return candidatesFor(o, centre, pool.value)
})

/** How many were read where this object stands, the slot's own row aside. */
const nearby = computed(() => rows.value.filter((r) => !r.held && r.hash !== 'own').length)

/**
 * How many leading rows sit outside the sort — the own row, plus the held
 * reading when there is one. The boundary line is drawn under the last of
 * them.
 */
const pinCount = computed(() => (rows.value[1]?.held ? 2 : 1))

/**
 * Which band a confidence falls in.
 *
 * Both lines come off a measured page rather than off round numbers: every
 * reading manga-ocr got right scored 0.97 or better, the band from 0.8 to 0.9
 * held two that were wrong, and 0.72 was a real sound effect while everything
 * from 0.69 down was the recognizer reading line art as characters.
 *
 * ⚠️ Green does not mean right, and cannot. A recognizer that skipped two
 * exclamation marks was 0.99 sure of what it did read, and one that read a
 * stroke of art as a digit was 1.00 sure. What the colour says is how sure the
 * model was — which is worth knowing and is not the same question.
 */
function sureness(confidence: number): string {
  if (confidence >= 0.9) return 'sure'
  if (confidence >= 0.7) return 'unsure'
  return 'doubtful'
}

/**
 * ⭐ Only a swap is worth animating. Selecting another object replaces the
 * list wholesale — the rows that "moved" are not the same rows, and animating
 * them would show a relationship that is not there, on every canvas click.
 */
const swapping = ref(false)

watch(object, () => {
  swapping.value = false
})

function take(hash: string) {
  if (!pageId.value || !object.value) return
  if (object.value.source.hash === hash) return
  swapping.value = true
  project.setLabelSource(pageId.value, object.value.id, { hash, by: 'human' })
  // Taking the own row is also asking to write it, since there is no other
  // way to make one.
  if (hash === 'own') {
    void nextTick(() => {
      document.querySelector<HTMLTextAreaElement>('.cand-on .cand-input')?.focus()
    })
  }
}

/**
 * Editing what is picked is also answering for the slot: left `auto`, a later
 * run could walk the object off the very words someone just typed. Nobody
 * corrects a sentence they are willing to have replaced.
 */
function write(hash: string, event: Event) {
  if (!pageId.value || !object.value) return
  const text = (event.target as HTMLTextAreaElement).value
  if (hash === 'own') {
    project.setLabelOwnSource(pageId.value, object.value.id, text)
    return
  }
  project.correctReading(pageId.value, hash, text)
  if (object.value.source.by !== 'human') {
    project.setLabelSource(pageId.value, object.value.id, { hash, by: 'human' })
  }
}
</script>

<style scoped>
.cand {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 0.4375rem;
  padding: 0.375rem 0.5rem 0.375rem 0.4375rem;
  text-align: left;
  cursor: pointer;
}
.cand:hover {
  background: var(--secondary);
}
.cand-on {
  background: color-mix(in oklch, var(--primary) 9%, transparent);
}
/* The line says the row above it has stopped taking part in the sort. It is a
   boundary and not a container — what is above it is still one of these rows,
   the same size as the rest: a row that grew when it was picked would be
   saying "picked" a third time, and would move the list under the pointer. */
.cand-pin {
  margin-bottom: 0.1875rem;
  border-bottom: 1px solid var(--border);
}

/* Round, because round is what people read as "one of these". */
.pick {
  display: inline-flex;
  height: 0.875rem;
  width: 0.875rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  margin-top: 0.1875rem;
  border: 1.5px solid var(--input);
  border-radius: 9999px;
  background: var(--background);
  transition:
    background 0.12s,
    border-color 0.12s;
}
.cand-on .pick {
  border-color: var(--primary);
  background: var(--primary);
}
.pick i {
  height: 0.3125rem;
  width: 0.3125rem;
  border-radius: 9999px;
  background: var(--primary-foreground);
  opacity: 0;
}
.cand-on .pick i {
  opacity: 1;
}

.cand-text {
  font-size: 0.8125rem;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
  color: var(--foreground);
}
.cand-input {
  width: 100%;
  resize: none;
  background: transparent;
}
.cand-input:focus {
  outline: none;
}
/* The directive keeps it exactly as tall as the text, so a scrollbar here
   would only ever be a rounding error made visible. */
.cand-input {
  overflow: hidden;
}

.cand-meta {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.125rem;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.625rem;
  color: var(--muted-foreground);
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
.dark .sure {
  color: oklch(0.7 0.2 150);
}
.dark .unsure {
  color: oklch(0.74 0.17 85);
}
.dark .doubtful {
  color: oklch(0.66 0.22 25);
}

/* Only the move, and only when a swap caused it. A row arriving or leaving is
   the list being rebuilt for another object, and animating that would be the
   whole column sliding about every time somebody clicks a balloon. */
.cand-move {
  transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1);
}
.cand-enter-active,
.cand-leave-active,
.still .cand-move {
  transition: none;
}

.pane-head {
  display: flex;
  height: 1.75rem;
  flex-shrink: 0;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding-left: 0.5rem;
  user-select: none;
}
</style>
