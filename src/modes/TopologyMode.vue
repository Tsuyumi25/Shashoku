<template>
  <div v-if="!project.isOpen" class="flex h-full items-center justify-center text-sm text-muted-foreground">
    尚未開啟專案
  </div>
  <div v-else class="flex h-full min-h-0">
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 select-none">
        <span class="min-w-0 truncate text-sm">{{ heading }}</span>
        <div class="ml-auto flex shrink-0 rounded border border-border p-px text-xs">
          <button
            v-for="m in MODES"
            :key="m.id"
            type="button"
            class="rounded-sm px-2 py-0.5"
            :class="mode === m.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="mode = m.id"
          >
            {{ m.label }}
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-4">
        <p v-if="charts.length === 0" class="text-sm text-muted-foreground">{{ emptyReason }}</p>
        <section v-for="chart in charts" :key="chart.key" class="mb-8">
          <h3 class="mb-2 text-xs font-medium text-muted-foreground">{{ chart.title }}</h3>
          <pre
            v-if="mode === 'code'"
            class="overflow-auto rounded border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed select-text"
          >{{ chart.code }}</pre>
          <template v-else>
            <p v-if="drawn.get(chart.key)?.error" class="text-xs text-destructive">
              mermaid 畫不出來：{{ drawn.get(chart.key)!.error }}
            </p>
            <!-- mermaid's own SVG, drawn under its strict security level, which sanitizes the labels. -->
            <div v-else class="topology-chart" v-html="drawn.get(chart.key)?.svg ?? ''" />
          </template>
        </section>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs select-none">
        <label v-for="p in PARTS" :key="p.id" class="flex items-center gap-1">
          <input v-model="parts[p.id]" type="checkbox" class="h-3.5 w-3.5 accent-primary" />
          {{ p.label }}
        </label>
        <span class="h-4 w-px bg-border" />
        <label v-for="f in project.faces" :key="f.id" class="flex items-center gap-1">
          <input
            type="checkbox"
            class="h-3.5 w-3.5 accent-primary"
            :checked="faceShown(f.id)"
            @change="toggleFace(f.id)"
          />
          f{{ f.no }} {{ f.name }}
        </label>
        <div class="ml-auto flex gap-1">
          <button type="button" class="topology-btn" :disabled="charts.length === 0" @click="copyPage">
            <Copy :size="12" />複製此頁 mermaid
          </button>
          <button type="button" class="topology-btn" @click="copyBook">
            <Copy :size="12" />複製整本 mermaid
          </button>
        </div>
      </div>
    </div>

    <aside class="flex w-36 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-card p-2">
      <button
        v-for="(file, at) in project.files"
        :key="file.pageId"
        type="button"
        class="flex flex-col gap-1 rounded p-1 text-left text-[11px]"
        :class="file.pageId === pageId ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-secondary/50'"
        @click="pageId = file.pageId"
      >
        <PageRowThumb :file="file" fill />
        <span class="truncate tabular-nums">第 {{ at + 1 }} 頁 · {{ file.pageId }}</span>
      </button>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { useDark } from '@vueuse/core'
import { Copy } from '@lucide/vue'
import type { PageTexts } from '@shared/mcp/types'
import { mermaidDocument, mermaidOf, type MermaidParts } from '@shared/mcp/render'
import PageRowThumb from '@/components/PageRowThumb.vue'
import { collectTexts } from '@/mcp/collect'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()
const isDark = useDark()

const MODES = [
  { id: 'preview', label: '預覽' },
  { id: 'code', label: 'code' },
] as const
type Mode = (typeof MODES)[number]['id']
const mode = ref<Mode>('preview')

const PARTS: { id: keyof MermaidParts; label: string }[] = [
  { id: 'translation', label: '譯文' },
  { id: 'source', label: '原文' },
  { id: 'tags', label: '標記' },
]
/** Everything on, which is exactly what get_texts hands an agent. */
const parts = reactive<MermaidParts>({ translation: true, source: true, tags: true })

/** Faces left out; a face added to the project since shows up rather than hiding until ticked. */
const hiddenFaces = ref(new Set<string>())
const faceShown = (id: string) => !hiddenFaces.value.has(id)
function toggleFace(id: string) {
  const next = new Set(hiddenFaces.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  hiddenFaces.value = next
}

const pageId = ref<string | null>(editor.currentPageId ?? project.files[0]?.pageId ?? null)
watch(
  () => project.files.map((f) => f.pageId),
  (ids) => {
    if (pageId.value === null || !ids.includes(pageId.value)) pageId.value = ids[0] ?? null
  },
)

function shownFaces(pages: PageTexts[]): PageTexts[] {
  return pages.map((page) => ({ ...page, faces: page.faces.filter((f) => faceShown(f.faceId)) }))
}

const page = computed(() =>
  pageId.value === null ? null : (shownFaces(collectTexts(project.files, project.faces, [pageId.value]))[0] ?? null),
)

const heading = computed(() => (page.value ? `第 ${page.value.no} 頁 · ${page.value.pageId} · ${page.value.name}` : ''))

const charts = computed(() =>
  (page.value?.faces ?? [])
    .filter((face) => face.sentences.length > 0)
    .map((face) => ({
      key: `${page.value!.pageId}/${face.faceId}`,
      title: `f${face.faceNo} ${face.name} · ${face.sentences.length} 句 · ${face.edges.length} 條線`,
      code: mermaidOf(face, parts),
    })),
)

const emptyReason = computed(() => {
  if (page.value === null) return '這個專案沒有頁面'
  if (page.value.badge !== 'ok') return `這一頁讀不出來（${page.value.badge}）`
  if (page.value.faces.length === 0) return '沒有勾選任何翻譯面'
  return '這一頁還沒有句子'
})

/** What mermaid drew for each chart, or why it could not. */
const drawn = shallowRef(new Map<string, { svg?: string; error?: string }>())
let drawing = 0

/**
 * Loaded on first use: it is the bulk of a megabyte, and nothing outside this
 * view draws with it.
 */
async function draw() {
  if (mode.value !== 'preview') return
  const ticket = ++drawing
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark.value ? 'dark' : 'default' })
  const out = new Map<string, { svg?: string; error?: string }>()
  for (const [at, chart] of charts.value.entries()) {
    try {
      const { svg } = await mermaid.render(`topology-${ticket}-${at}`, chart.code)
      out.set(chart.key, { svg })
    } catch (err) {
      out.set(chart.key, { error: err instanceof Error ? err.message : String(err) })
    }
    if (ticket !== drawing) return
  }
  if (ticket === drawing) drawn.value = out
}
watch([charts, mode, isDark], draw, { immediate: true })

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    useNoticeStore().say(`已複製${what}`)
  } catch (err) {
    console.error('copy failed', err)
  }
}

function copyPage() {
  if (page.value) void copy(mermaidDocument([page.value], parts), '此頁 mermaid')
}

function copyBook() {
  void copy(mermaidDocument(shownFaces(collectTexts(project.files, project.faces)), parts), '整本 mermaid')
}
</script>

<style scoped>
.topology-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  padding: 0.125rem 0.5rem;
}
.topology-btn:hover:not(:disabled) {
  background: var(--secondary);
}
.topology-btn:disabled {
  opacity: 0.5;
}
.topology-chart :deep(svg) {
  max-width: 100%;
  height: auto;
}
</style>
