<template>
  <!--
    A fixed box by default, unlike a page in the grid. A shelf of covers is read
    by scanning down it, and rows that each set their own height turn that into
    following a ragged edge. Cropped rather than letterboxed, so no cell has to
    show padding where another shows artwork — a cover's subject is its middle,
    and the missing sliver is the page's margin.
  -->
  <div ref="root" class="w-full overflow-hidden" :class="!natural && 'aspect-[3/4]'">
    <!-- Something to click, never something to drag out of the app. -->
    <img
      v-if="src"
      :src="src"
      class="w-full"
      :class="natural ? 'block' : 'h-full object-cover'"
      alt=""
      draggable="false"
    />
    <div
      v-else
      class="flex w-full items-center justify-center bg-muted/40"
      :class="natural ? 'aspect-[3/4]' : 'h-full'"
    >
      <component :is="empty ?? ImageOff" :size="14" class="text-muted-foreground" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type Component } from 'vue'
import { useElementSize } from '@vueuse/core'
import { ImageOff } from '@lucide/vue'
import type { ScannedCover } from '@shared/project/workspace'
import { inRenderSlot, renderFitted, sourceKey, THUMBNAIL_EDGE } from '@/lib/pageThumbnail'

// No default through withDefaults: the value here is itself a component, and a
// function-valued default is taken for a factory and called.
const props = defineProps<{
  cover: ScannedCover | null
  empty?: Component
  natural?: boolean
}>()

/**
 * Height over width past which a picture is a scrolling strip rather than a
 * page. No page format comes near it — the tallest tile a platform takes is
 * 800x1280 — while an episode's own segments measure 1:5 to 1:13.
 */
const STRIP_RATIO = 3

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

const root = ref<HTMLElement | null>(null)
const { width } = useElementSize(computed(() => (props.natural ? root.value : null)))

const thumbnail = ref<string | null>(null)
const whole = ref<string | null>(null)
const src = computed(() => whole.value ?? thumbnail.value)

let urls: string[] = []
/** Which load the pending work belongs to, so a stale one cannot land. */
let generation = 0
let loading: Source | null = null
let showing: ScannedCover | null = null

/**
 * Nothing loads while `unknown`. Drawing the cache and correcting it afterwards
 * is a picture that changes under the reader.
 */
type Source = 'unknown' | 'thumbnail' | 'whole'

const wanted = computed<Source>(() => {
  if (props.cover === null) return 'unknown'
  if (!props.natural) return 'thumbnail'
  if (width.value === 0) return 'unknown'
  return width.value * window.devicePixelRatio <= THUMBNAIL_EDGE ? 'thumbnail' : 'whole'
})

function revoke() {
  for (const each of urls) URL.revokeObjectURL(each)
  urls = []
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

interface Fetched {
  bytes: Uint8Array
  type: string
  kind: 'thumbnail' | 'whole'
}

async function fetchOne(cover: ScannedCover, source: 'thumbnail' | 'whole'): Promise<Fetched> {
  if (source === 'whole') {
    const type = TYPES[cover.file.slice(cover.file.lastIndexOf('.') + 1).toLowerCase()]
    if (type) {
      return { bytes: await window.api.readImage(cover.dir, cover.file), type, kind: 'whole' }
    }
  }
  return { bytes: await bytesFor(cover), type: 'image/png', kind: 'thumbnail' }
}

/** Out of the IHDR every PNG opens with, which is what the cache writes. */
function isStrip(png: Uint8Array): boolean {
  if (png.length < 24) return false
  const head = new DataView(png.buffer, png.byteOffset, png.byteLength)
  if (head.getUint32(0) !== 0x89504e47) return false
  const w = head.getUint32(16)
  return w > 0 && head.getUint32(20) / w > STRIP_RATIO
}

async function fetchInto(cover: ScannedCover, source: 'thumbnail' | 'whole'): Promise<void> {
  const mine = ++generation
  loading = source
  try {
    let got = await fetchOne(cover, source)
    if (mine !== generation) return
    // The cache bounds the long edge, so a strip is starved on its short one:
    // 1512x19999 comes back 48 across, unreadable at any panel width.
    if (got.kind === 'thumbnail' && props.natural && isStrip(got.bytes)) {
      loading = 'whole'
      got = await fetchOne(cover, 'whole')
      if (mine !== generation) return
    }
    const url = URL.createObjectURL(new Blob([got.bytes as BlobPart], { type: got.type }))
    urls.push(url)
    if (got.kind === 'whole') whole.value = url
    else thumbnail.value = url
  } catch {
    // A cover that will not read is a missing cover, not a failure worth
    // interrupting a shelf of books for.
  } finally {
    if (mine === generation) loading = null
  }
}

watch(
  [() => props.cover, wanted],
  ([cover, source]) => {
    if (cover !== showing) {
      generation++
      revoke()
      thumbnail.value = null
      whole.value = null
      loading = null
      showing = cover
    }
    if (!cover || source === 'unknown') return
    if (whole.value !== null || loading === 'whole') return
    if (source === 'thumbnail' && (thumbnail.value !== null || loading === 'thumbnail')) return
    void fetchInto(cover, source)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  generation++
  revoke()
})
</script>
