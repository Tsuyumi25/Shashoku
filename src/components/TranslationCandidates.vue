<template>
  <FoldSection section="translation" title="譯文" :count="`${rows.length} 條`" last>
    <div v-if="!object" class="px-3 py-4 text-center select-none">
      <span class="text-xs text-muted-foreground">選一顆文字物件</span>
    </div>

    <template v-else>
      <!--
        Assigned rather than discovered, so nothing here was measured and the
        order is whatever somebody dragged it into — arrival order until then,
        which is the only fact a proposal comes with. Picking never moves a
        row: what makes a list of candidates worth having is comparing them
        twice, and a list that rearranges itself under that is unreadable.
      -->
      <div ref="listEl" class="py-0.5">
        <p v-if="!rows.length" class="list-empty">
          還沒有候選。<br />自己寫一句，或讓模型產一批。
        </p>

        <Draggable v-else :model-value="rows" item-key="id" handle=".grip" @change="onChanged">
          <template #item="{ element }">
            <div
              class="cand"
              :class="[(element as Row).id === held && 'cand-on']"
              @click="take((element as Row).id)"
            >
              <span class="pick"><i /></span>
              <div class="min-w-0 flex-1">
                <!--
                  Editable where it is picked and nowhere else. Typing into
                  the one the object is reading is the same act as typing into
                  the object, so it is the row that has a caret.
                -->
                <textarea
                  v-if="(element as Row).id === held"
                  v-auto-grow
                  rows="1"
                  spellcheck="false"
                  placeholder="(未翻譯)"
                  class="cand-text cand-input"
                  :value="(element as Row).text"
                  @input="write((element as Row).id, $event)"
                />
                <p
                  v-else
                  class="cand-text"
                  :class="!(element as Row).text && 'text-muted-foreground/50'"
                >
                  {{ (element as Row).text || '(未翻譯)' }}
                </p>

                <div class="cand-meta">
                  <span>{{ (element as Row).by }}</span>
                </div>
              </div>
              <button
                v-if="(element as Row).id !== 'own'"
                type="button"
                class="grip"
                title="拖曳排順序"
                @click.stop
              >
                <GripVertical :size="12" />
              </button>
            </div>
          </template>
        </Draggable>
      </div>

      <button type="button" class="addrow" @click="propose()">＋ 新增譯文候選</button>
    </template>
  </FoldSection>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { GripVertical } from '@lucide/vue'
import Draggable from 'vuedraggable'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import FoldSection from '@/components/FoldSection.vue'
import { vAutoGrow } from '@/lib/autoGrow'

/**
 * One row of the translation candidates.
 *
 * `own` is the object's own lines — what it was typed with before anybody
 * proposed anything, and what it falls back to when nothing is picked. It is a
 * row like the others so that text stays reachable; what it cannot do is move,
 * since it is not competing for a place in an order somebody arranged.
 */
interface Row {
  id: string | 'own'
  text: string
  by: string
}

const editor = useEditorStore()
const project = useProjectStore()

const listEl = ref<HTMLElement | null>(null)

const pageId = computed(() => editor.currentPageId)

const object = computed(() => {
  const id = editor.cursorId
  if (!pageId.value || !id) return null
  return project.labelById(pageId.value, id) ?? null
})

const held = computed(() => object.value?.translation ?? 'own')

const rows = computed<Row[]>(() => {
  const o = object.value
  if (!o) return []
  const own: Row[] =
    o.lines.join('').length > 0 || o.translation === null
      ? [{ id: 'own', text: o.lines.join('\n'), by: '自己打的' }]
      : []
  return [
    ...own,
    ...o.translations.map((c) => ({
      id: c.id,
      text: c.lines.join('\n'),
      by: c.human ? '你寫的' : (c.source ?? '模型'),
    })),
  ]
})

function take(id: string | 'own') {
  if (!pageId.value || !object.value) return
  project.setLabelTranslation(pageId.value, object.value.id, id === 'own' ? null : id)
}

function write(id: string | 'own', event: Event) {
  if (!pageId.value || !object.value) return
  const text = (event.target as HTMLTextAreaElement).value
  if (id === 'own') project.setLabelLines(pageId.value, object.value.id, text)
  else project.correctTranslation(pageId.value, object.value.id, id, text)
}

/**
 * The own row does not take part, so the indices the list reports are one out
 * whenever it is there — the pool is what is being reordered, not the view.
 */
function onChanged(event: { moved?: { oldIndex: number; newIndex: number } }) {
  const moved = event.moved
  if (!moved || !pageId.value || !object.value) return
  const offset = rows.value[0]?.id === 'own' ? 1 : 0
  project.moveTranslation(
    pageId.value,
    object.value.id,
    moved.oldIndex - offset,
    moved.newIndex - offset,
  )
}

/**
 * A new proposal starts empty rather than as a copy of what is showing.
 *
 * A copy arrives already saying something, and a row that says something
 * nobody wrote is one somebody has to read before they can dismiss it. It is
 * picked straight away, since asking for a blank and then having to find it
 * says the request meant nothing.
 */
function propose() {
  const o = object.value
  if (!pageId.value || !o) return
  const id = project.addTranslation(pageId.value, o.id, [''], 'human')
  if (!id) return
  project.setLabelTranslation(pageId.value, o.id, id)
  void nextTick(() => {
    // Asked for by scrolling the row into view rather than the list to its
    // end: the scroller is the section above this list now, and how far
    // down the new one sits depends on a height somebody dragged.
    const input = listEl.value?.querySelector<HTMLTextAreaElement>('.cand-on .cand-input')
    input?.scrollIntoView({ block: 'nearest' })
    input?.focus()
  })
}
</script>

<style scoped>
.list-empty {
  padding: 1rem 0.75rem;
  text-align: center;
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--muted-foreground);
}

.cand {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 0.4375rem;
  padding: 0.375rem 0.375rem 0.375rem 0.4375rem;
  text-align: left;
  cursor: pointer;
}
.cand:hover {
  background: var(--secondary);
}
.cand-on {
  background: color-mix(in oklch, var(--primary) 9%, transparent);
}

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

/* A handle rather than the whole row: the row's own press is picking it, and a
   list where pressing might mean either is one you cannot press confidently. */
.grip {
  margin-top: 0.125rem;
  flex-shrink: 0;
  align-self: flex-start;
  color: var(--muted-foreground);
  opacity: 0;
  cursor: grab;
}
.cand:hover .grip {
  opacity: 0.6;
}
.grip:hover {
  opacity: 1;
}

.addrow {
  display: flex;
  height: 1.75rem;
  width: 100%;
  flex-shrink: 0;
  align-items: center;
  gap: 0.3125rem;
  border-top: 1px solid var(--border);
  padding: 0 0.5rem;
  font-size: 0.6875rem;
  color: var(--muted-foreground);
}
.addrow:hover {
  background: var(--secondary);
  color: var(--foreground);
}
</style>
