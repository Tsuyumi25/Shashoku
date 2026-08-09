<template>
  <div ref="cellRef" class="flex flex-col gap-1 rounded-[5px] p-1 text-left">
    <div class="relative">
      <img v-if="src" :src="src" class="block w-full" alt="" draggable="false" />
      <div
        v-else
        class="flex aspect-[3/4] w-full items-center justify-center bg-muted/40 px-1 text-center"
      >
        <ImageOff v-if="problem" :size="16" class="text-muted-foreground" />
        <Loader v-else :size="14" class="animate-spin text-muted-foreground" />
      </div>
    </div>

    <span class="truncate text-xs text-muted-foreground" :title="source.name">
      {{ source.name }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import { ImageOff, Loader } from '@lucide/vue'
import type { SourceImage } from '@shared/ipc/channels'
import { inRenderSlot, renderFitted, sourceKey } from '@/lib/pageThumbnail'

/**
 * One image in the project folder, drawn as it sits on disk.
 *
 * Deliberately not composited and deliberately not a page: this cell answers
 * "what is in the folder", and the grid beside it answers "what have I made".
 * Reading it wrong in either direction is what the two of them being side by
 * side is meant to prevent.
 */
const props = defineProps<{ rootPath: string; source: SourceImage }>()

const cellRef = useTemplateRef<HTMLElement>('cellRef')
const src = ref<string | null>(null)
const problem = ref(false)
const seen = ref(false)

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
  const key = await sourceKey(props.rootPath, props.source)
  const cached = await window.api.readThumbnail(key)
  if (cached) return cached

  return inRenderSlot(async () => {
    const bytes = await window.api.readImage(props.rootPath, props.source.name)
    const png = await renderFitted(bytes)
    // Failing to cache costs the next draw, not this one.
    void window.api.writeThumbnail(key, png).catch(() => {})
    return png
  })
}

async function load() {
  const mine = ++generation
  revoke()
  src.value = null
  problem.value = false
  if (!seen.value || !props.rootPath) return
  try {
    const bytes = await bytesFor()
    if (mine !== generation) return
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
    src.value = url
  } catch {
    // A file that went away between the scan and the read is not a fault to
    // report — the next rescan is what takes it off the panel.
    if (mine !== generation) return
    problem.value = true
  }
}

watch(
  () => [seen.value, props.rootPath, props.source.name, props.source.modified] as const,
  () => void load(),
  { immediate: true },
)

onBeforeUnmount(() => {
  generation++
  revoke()
})
</script>
