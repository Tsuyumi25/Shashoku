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
import { rawsDirOf } from '@/stores/libraryStore'

/**
 * A project's first page, read straight from its own copy of the raws rather
 * than the root folder — the same reason the copy exists at all: a project has
 * to keep looking like itself after someone tidies the folder it came from.
 *
 * Sized entirely by whoever places it, so the same component serves a row and
 * a grid cell without being told which it is in.
 */
const props = defineProps<{
  projectPath: string
  /** Filename inside the project's raws, or null when it holds no image. */
  cover: string | null
}>()

const src = ref<string | null>(null)
let url: string | null = null

function revoke() {
  if (url) {
    URL.revokeObjectURL(url)
    url = null
  }
}

watch(
  () => [props.projectPath, props.cover] as const,
  async ([projectPath, cover]) => {
    revoke()
    src.value = null
    if (!cover) return
    try {
      const bytes = await window.api.readImage(rawsDirOf(projectPath), cover)
      url = URL.createObjectURL(new Blob([bytes as BlobPart]))
      src.value = url
    } catch {
      // A cover that will not read is a missing cover, not a failure worth
      // interrupting a list of projects for.
    }
  },
  { immediate: true },
)

onBeforeUnmount(revoke)
</script>
