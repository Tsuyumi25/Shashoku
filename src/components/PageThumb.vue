<template>
  <button
    ref="cellRef"
    type="button"
    class="flex cursor-pointer flex-col gap-1 rounded-[5px] border p-1 text-left"
    :class="
      selected
        ? 'border-primary bg-primary/10'
        : 'border-transparent hover:border-border hover:bg-secondary'
    "
    @click="emit('pick', $event)"
  >
    <!--
      No frame of its own: a page is a rectangle of paper, and a rounded box
      with a fill behind it would read as a second object around it. What is
      drawn is the page, and the only thing framing it is the picking.
    -->
    <div class="relative">
      <!-- Dragging a page picks a run of them; a native image drag would take
           the gesture instead. -->
      <img v-if="src" :src="src" class="block w-full" alt="" draggable="false" />
      <div
        v-else
        class="flex aspect-[3/4] w-full items-center justify-center bg-muted/40 px-1 text-center"
      >
        <span v-if="problem" class="text-xs text-destructive">{{ problem }}</span>
        <ImageOff v-else-if="file.badge !== 'ok'" :size="16" class="text-muted-foreground" />
        <Loader v-else :size="14" class="animate-spin text-muted-foreground" />
      </div>

      <span
        v-if="badgeText"
        class="absolute inset-x-0 bottom-0 bg-destructive/90 px-1 py-0.5 text-center text-[10px] text-destructive-foreground"
      >
        {{ badgeText }}
      </span>

    </div>

    <!-- Beside the name rather than over the page, which is the one thing in
         this cell nothing should be covering. -->
    <div class="flex min-w-0 items-center gap-1.5">
      <span class="pick" :data-checked="String(selected)">
        <Check :size="12" :stroke-width="3" />
      </span>
      <span class="truncate text-xs" :class="selected ? '' : 'text-muted-foreground'">
        {{ file.filename }}
      </span>
    </div>
  </button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import { Check, ImageOff, Loader } from '@lucide/vue'
import type { ProjectFile } from '@/types/project'
import { inRenderSlot, renderThumbnail, thumbnailKey } from '@/lib/pageThumbnail'
import { rawsDirOf } from '@/stores/libraryStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * One finished page. Deliberately the composited result rather than the raw:
 * this grid is the last stop before delivery, and "did page 47 get its text"
 * is not a question the raw can answer.
 */
const props = defineProps<{ file: ProjectFile; selected: boolean }>()
const emit = defineEmits<{ pick: [MouseEvent] }>()

const project = useProjectStore()

const cellRef = useTemplateRef<HTMLElement>('cellRef')
const src = ref<string | null>(null)
const problem = ref<string | null>(null)
const seen = ref(false)

const badgeText = computed(() => {
  switch (props.file.badge) {
    case 'raw-missing':
      return '原圖不存在'
    case 'page-missing':
      return '尚未建頁'
    case 'damaged':
      return '頁面資料損毀'
    default:
      return null
  }
})

useIntersectionObserver(
  cellRef,
  ([entry]) => {
    if (entry.isIntersecting) seen.value = true
  },
  { rootMargin: '400px' },
)

let url: string | null = null
/** Which load the pending work belongs to, so a stale one cannot land. */
let generation = 0

function revoke() {
  if (url) {
    URL.revokeObjectURL(url)
    url = null
  }
}

async function bytesFor(): Promise<Uint8Array> {
  const key = await thumbnailKey(props.file, project.projectMeta)
  const cached = await window.api.readThumbnail(key)
  if (cached) return cached

  return inRenderSlot(async () => {
    const raw = await window.api.readImage(rawsDirOf(project.rootPath ?? ''), props.file.filename)
    const png = await renderThumbnail(raw, props.file, project.projectMeta)
    // Failing to cache costs the next draw, not this one.
    void window.api.writeThumbnail(key, png).catch(() => {})
    return png
  })
}

async function load() {
  const mine = ++generation
  revoke()
  src.value = null
  problem.value = null
  if (!seen.value || props.file.badge !== 'ok' || !project.rootPath) return
  try {
    const bytes = await bytesFor()
    if (mine !== generation) return
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
    src.value = url
  } catch (err) {
    if (mine !== generation) return
    problem.value = err instanceof Error ? err.message : String(err)
  }
}

// The grid is mounted only while it is on screen, so entering the project
// manager is what re-reads a page that was typeset since the last look.
watch(() => [seen.value, props.file.pageDir, project.rootPath] as const, () => void load(), {
  immediate: true,
})

onBeforeUnmount(() => {
  generation++
  revoke()
})
</script>
