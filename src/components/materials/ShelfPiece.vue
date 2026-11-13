<template>
  <button
    ref="rootEl"
    type="button"
    class="piece"
    :class="[item.missing && 'piece-missing', selected && 'piece-selected']"
    :style="{ width: `${w}px`, height: `${h}px` }"
    :title="title"
  >
    <img v-if="url" :src="url" alt="" draggable="false" class="block" :style="{ width: `${w}px`, height: `${h}px` }" />
    <span v-if="item.missing" class="badge">缺</span>
  </button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { sampleSource } from '@/lib/fontSampleCache'
import { shelfDrawingOf, type ShelfItem } from '@/lib/objectShelf'
import { whenSeen } from '@/lib/whenSeen'

/**
 * One text object as the page draws it, at whatever size the shelf shows it.
 * The bitmap is the typesetter's own, so what is on the shelf is what is on the
 * page — a missing face shows as the same boxes it does there.
 *
 * Laid out from the measured size at once and drawn only once it comes near the
 * view, so a chapter of pieces costs its first screenful to open.
 *
 * ⚠️ Shown as an image rather than a canvas. A drawn canvas can be given a
 * compositor layer of its own, and a scrolled-through chapter left hundreds of
 * them standing: every pan of the page then laid out the whole window's layers
 * again, a tenth of a second a frame in a virtual machine. An image is painted
 * into the shelf's own layer however many there are.
 */
const props = defineProps<{
  item: ShelfItem
  /** Screen pixels per page pixel. */
  scale: number
  selected: boolean
  title: string
}>()

const rootEl = useTemplateRef<HTMLElement>('rootEl')
const dpr = window.devicePixelRatio || 1
const seen = ref(false)
const url = shallowRef<string | null>(null)

const w = computed(() => Math.max(8, props.item.width * props.scale))
const h = computed(() => Math.max(8, props.item.height * props.scale))
const cw = computed(() => Math.ceil(w.value * dpr))
const ch = computed(() => Math.ceil(h.value * dpr))

/** Bumped by every draw, so an encoding that finishes after a newer one began is thrown away. */
let drawing = 0
let gone = false

function show(next: string | null) {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = next
}

async function paint() {
  if (!seen.value) return
  const turn = ++drawing
  const sample = shelfDrawingOf(props.item)
  if (!sample) {
    show(null)
    return
  }
  const off = new OffscreenCanvas(cw.value, ch.value)
  const ctx = off.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(sampleSource(sample), 0, 0, off.width, off.height)
  const blob = await off.convertToBlob()
  if (gone || turn !== drawing) return
  show(URL.createObjectURL(blob))
}

let stopWatching: (() => void) | null = null
onMounted(() => {
  stopWatching = whenSeen(rootEl.value!, () => {
    seen.value = true
  })
})
onBeforeUnmount(() => {
  gone = true
  stopWatching?.()
  show(null)
})
watch([seen, () => props.item, cw, ch], () => void paint().catch((err: unknown) => console.error('shelf piece draw failed', err)))
</script>

<style scoped>
.piece {
  position: relative;
  display: block;
  border-radius: 3px;
  outline: 1px solid transparent;
}
.piece:hover {
  outline-color: var(--primary);
  background: color-mix(in oklch, var(--primary) 8%, transparent);
}
.piece-selected,
.piece-selected:hover {
  outline: 2px solid var(--primary);
  background: color-mix(in oklch, var(--primary) 18%, transparent);
}
.piece-missing {
  outline: 2px solid oklch(0.6 0.2 25);
}
.badge {
  position: absolute;
  top: -6px;
  right: -6px;
  border-radius: 9999px;
  background: oklch(0.6 0.2 25);
  padding: 0 4px;
  font-size: 10px;
  line-height: 14px;
  color: white;
}
</style>
