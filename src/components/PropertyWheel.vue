<template>
  <!--
    Whole canvas while open, so a press anywhere is the wheel's: on an item it
    picks, anywhere else it closes. Held, the press that opened it is still
    down and nothing here is reached until it is let go.
  -->
  <div
    class="absolute inset-0 z-30"
    @pointerdown.stop="onPress"
    @pointermove="aim"
    @contextmenu.prevent
  >
    <div class="wheel-hub" :style="{ left: `${at.x}px`, top: `${at.y}px` }" />
    <div
      v-for="(item, i) in ITEMS"
      :key="item.kind"
      class="wheel-item"
      :class="aimed === i && 'wheel-item-on'"
      :style="placeOf(i)"
    >
      {{ item.label }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { ValueKind } from '@/composables/useValuePicker'

/**
 * The right button's ring of properties: which one's values the left column
 * should lay out. A way into the value picker from where the eye already is,
 * standing in for the trip across to the appearance panel's names.
 *
 * Press, drag toward one and let go; or click and the ring stays until a
 * second click picks or dismisses it. Let go at the hub and nothing happens.
 *
 * ⭐ Every property keeps its direction. A ring is fast because the hand
 * learns "size is up and right"; ordering it by use would unteach that the
 * first time the order changed.
 */
const props = defineProps<{
  /** Where the press was, in the canvas's own pixels. */
  at: { x: number; y: number }
  /** The client point the canvas's corner stands at, to place pointer events. */
  origin: { left: number; top: number }
}>()

const emit = defineEmits<{
  choose: [kind: ValueKind]
  close: []
}>()

/** Clockwise from the top. */
const ITEMS: { kind: ValueKind; label: string }[] = [
  { kind: 'font', label: '字型' },
  { kind: 'fontSizePx', label: '字級' },
  { kind: 'weightPx', label: '字粗' },
  { kind: 'leadingPercent', label: '行距' },
  { kind: 'stroke', label: '描邊' },
  { kind: 'color', label: '文字色' },
  { kind: 'scaleXPercent', label: '水平' },
  { kind: 'scaleYPercent', label: '垂直' },
]

const RADIUS_PX = 76
/** Inside this the pointer is at the hub, and letting go there is a cancel. */
const HUB_PX = 18
/** Past this a click is a click away, not a pick. A drag picks at any distance. */
const REACH_PX = RADIUS_PX + 36
/** A release this soon and this close to the press is a click, which keeps the ring up. */
const CLICK_MS = 250

const aimed = ref<number | null>(null)
let held = true
const opened = performance.now()

function placeOf(i: number) {
  const angle = (i / ITEMS.length) * Math.PI * 2 - Math.PI / 2
  return {
    left: `${props.at.x + Math.cos(angle) * RADIUS_PX}px`,
    top: `${props.at.y + Math.sin(angle) * RADIUS_PX}px`,
  }
}

function aim(e: PointerEvent): number {
  const dx = e.clientX - props.origin.left - props.at.x
  const dy = e.clientY - props.origin.top - props.at.y
  const distance = Math.hypot(dx, dy)
  if (distance < HUB_PX) {
    aimed.value = null
    return distance
  }
  // Each item owns the slice of directions nearest it.
  const turn = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)
  aimed.value = Math.round((turn / (Math.PI * 2)) * ITEMS.length) % ITEMS.length
  return distance
}

function finish() {
  const at = aimed.value
  if (at === null) emit('close')
  else emit('choose', ITEMS[at].kind)
}

// Read off the window: the press that opened the ring began on the canvas,
// which may have captured it, and its release is the gesture's end.
useEventListener(window, 'pointermove', (e: PointerEvent) => {
  if (held) aim(e)
})
useEventListener(window, 'pointerup', (e: PointerEvent) => {
  if (!held || e.button !== 2) return
  held = false
  if (aimed.value === null && performance.now() - opened < CLICK_MS) return
  finish()
})
// A stroke the system takes away ends with no release to pick on.
useEventListener(window, 'pointercancel', () => {
  if (!held) return
  held = false
  emit('close')
})
// Ahead of the canvas, whose own Escape would drop the selection the ring is for.
useEventListener(
  window,
  'keydown',
  (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    emit('close')
  },
  { capture: true },
)
useEventListener(window, 'blur', () => emit('close'))

function onPress(e: PointerEvent) {
  if (held) return
  if (e.button === 0 && aim(e) <= REACH_PX) finish()
  else emit('close')
}

onBeforeUnmount(() => {
  held = false
})
</script>

<style scoped>
.wheel-hub {
  position: absolute;
  width: 36px;
  height: 36px;
  margin: -18px 0 0 -18px;
  border-radius: 9999px;
  border: 1px solid var(--border);
  background: color-mix(in oklab, var(--popover) 70%, transparent);
  pointer-events: none;
}
.wheel-item {
  position: absolute;
  transform: translate(-50%, -50%);
  padding: 3px 9px;
  border-radius: 9999px;
  border: 1px solid var(--border);
  background: var(--popover);
  color: var(--popover-foreground);
  font-size: 13px;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.2);
  pointer-events: none;
}
.wheel-item-on {
  background: var(--primary);
  color: var(--primary-foreground);
  border-color: var(--primary);
}
</style>
