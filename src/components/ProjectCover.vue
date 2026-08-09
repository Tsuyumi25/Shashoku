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
    <img
      v-if="src"
      :src="src"
      class="h-full w-full object-cover"
      alt=""
      draggable="false"
    />
    <div v-else class="flex h-full w-full items-center justify-center bg-muted/40">
      <ImageOff :size="12" class="text-muted-foreground" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ImageOff } from '@lucide/vue'
import { coverKey, inRenderSlot, renderCover } from '@/lib/pageThumbnail'

/**
 * The bottom raster of a project's first page, read from inside the project
 * itself rather than from the folder its images came from — the same reason the
 * pixels were copied in at all: a project has to keep looking like itself after
 * someone tidies that folder away.
 *
 * Sized entirely by whoever places it, so the same component serves a row and
 * a grid cell without being told which it is in.
 */
const props = defineProps<{
  projectPath: string
  /** Where the cover sits inside the project, or null when it has no page. */
  cover: string | null
}>()

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

async function bytesFor(projectPath: string, cover: string): Promise<Uint8Array> {
  const key = await coverKey(projectPath, cover)
  const cached = await window.api.readThumbnail(key)
  if (cached) return cached

  return inRenderSlot(async () => {
    const bytes = await window.api.readImage(projectPath, cover)
    const png = await renderCover(bytes)
    // Failing to cache costs the next draw, not this one.
    void window.api.writeThumbnail(key, png).catch(() => {})
    return png
  })
}

watch(
  () => [props.projectPath, props.cover] as const,
  async ([projectPath, cover]) => {
    const mine = ++generation
    revoke()
    src.value = null
    if (!cover) return
    try {
      const bytes = await bytesFor(projectPath, cover)
      if (mine !== generation) return
      url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
      src.value = url
    } catch {
      // A cover that will not read is a missing cover, not a failure worth
      // interrupting a list of projects for.
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  generation++
  revoke()
})
</script>
