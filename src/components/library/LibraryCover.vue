<template>
  <!--
    A fixed box, unlike a page in the grid. A shelf of covers is read by
    scanning down it, and rows that each set their own height turn that into
    following a ragged edge. Cropped rather than letterboxed, so no cell has to
    show padding where another shows artwork — a cover's subject is its middle,
    and the missing sliver is the page's margin.
  -->
  <div class="aspect-[3/4] w-full overflow-hidden">
    <!-- Something to click, never something to drag out of the app. -->
    <img v-if="src" :src="src" class="h-full w-full object-cover" alt="" draggable="false" />
    <div v-else class="flex h-full w-full items-center justify-center bg-muted/40">
      <component :is="empty ?? ImageOff" :size="14" class="text-muted-foreground" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch, type Component } from 'vue'
import { ImageOff } from '@lucide/vue'
import type { ScannedCover } from '@shared/project/workspace'
import { inRenderSlot, renderFitted, sourceKey } from '@/lib/pageThumbnail'

// No default through withDefaults: the value here is itself a component, and a
// function-valued default is taken for a factory and called.
const props = defineProps<{ cover: ScannedCover | null; empty?: Component }>()

const src = ref<string | null>(null)
let url: string | null = null
/** Which load the pending work belongs to, so a stale one cannot land. */
let generation = 0

function revoke() {
  if (url) {
    URL.revokeObjectURL(url)
    url = null
  }
}

async function bytesFor(cover: ScannedCover): Promise<Uint8Array> {
  const key = await sourceKey(cover.dir, {
    name: cover.file,
    modified: cover.modified,
    size: cover.size,
  })
  const cached = await window.api.readThumbnail(key)
  if (cached) return cached

  return inRenderSlot(async () => {
    const bytes = await window.api.readImage(cover.dir, cover.file)
    const png = await renderFitted(bytes)
    // Failing to cache costs the next draw, not this one.
    void window.api.writeThumbnail(key, png).catch(() => {})
    return png
  })
}

watch(
  () => props.cover,
  async (cover) => {
    const mine = ++generation
    revoke()
    src.value = null
    if (!cover) return
    try {
      const bytes = await bytesFor(cover)
      if (mine !== generation) return
      url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
      src.value = url
    } catch {
      // A cover that will not read is a missing cover, not a failure worth
      // interrupting a shelf of books for.
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  generation++
  revoke()
})
</script>
