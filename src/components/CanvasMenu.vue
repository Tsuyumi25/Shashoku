<template>
  <!--
    A menu at a point, for a gesture whose answer is a choice rather than a
    place. It closes on the next press anywhere and on Escape, both caught on
    the window during capture — a menu that only closed when something inside it
    was pressed is one a reader has to dismiss before they can do anything else.
  -->
  <!--
    Out to the body, because a menu placed where it was asked for would
    otherwise answer to whichever ancestor happens to clip or transform: fixed
    coordinates stop being the viewport's the moment one of those is overhead,
    and a panel that scrolls its own content is one of them.
  -->
  <Teleport to="body">
  <div v-if="at" ref="menuEl" class="menu" :style="{ left: `${x}px`, top: `${y}px` }">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="menu-item"
      :class="item.checked !== undefined && 'menu-item-state'"
      @click="emit('pick', item.id)"
    >
      <span
        v-if="item.checked !== undefined"
        class="menu-mark"
        :class="item.checked && 'menu-mark-on'"
        :style="item.color ? { color: item.color } : undefined"
      />
      {{ item.label }}
    </button>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'

export interface MenuItem {
  id: string
  label: string
  /**
   * A state rather than an act, drawn with a mark that is there or not. Absent
   * on an item that does something, which is what keeps a menu of acts from
   * reserving room for marks none of them will ever wear.
   */
  checked?: boolean
  /** Drawn beside the label — a tag's own colour, where an item names one. */
  color?: string
}

const props = defineProps<{
  /** Where it stands, in client coordinates, or null when it is not up. */
  at: { x: number; y: number } | null
  items: readonly MenuItem[]
}>()

const emit = defineEmits<{ pick: [id: string]; close: [] }>()

const menuEl = useTemplateRef<HTMLElement>('menuEl')

/** How close to an edge it is allowed to stand. */
const EDGE = 8

const x = ref(0)
const y = ref(0)

/**
 * Where it actually stands, which is where it was asked for until that would
 * put an edge off screen.
 *
 * ⚠️ Measured rather than worked out from the item count: the width is the
 * longest label's and a tag can be named anything, so neither side is known
 * before it is drawn. It is placed once unclamped and read back on the same
 * tick, so nothing is painted at the asking point.
 */
async function place() {
  const at = props.at
  if (at === null) return
  x.value = at.x
  y.value = at.y
  await nextTick()
  const box = menuEl.value?.getBoundingClientRect()
  if (box === undefined) return
  x.value = Math.max(EDGE, Math.min(at.x, window.innerWidth - box.width - EDGE))
  y.value = Math.max(EDGE, Math.min(at.y, window.innerHeight - box.height - EDGE))
}

watch(() => props.at, place, { immediate: true })

/**
 * ⚠️ A press inside the menu is not a press away, and saying so is what makes
 * the items work at all. The listener below runs during capture, so it reaches
 * the window before the button the press is on — closing here would take the
 * item out of the document before the release could land on it, and a click
 * whose target has gone is a click that never happens.
 */
function onAway(event: Event) {
  if (menuEl.value?.contains(event.target as Node)) return
  emit('close')
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

// ⚠️ Capture, so a press some surface stops from bubbling still closes this —
// and the cards on the canvas all stop theirs.
function listen(on: boolean) {
  const how = on ? window.addEventListener : window.removeEventListener
  how('pointerdown', onAway, true)
  how('keydown', onKey, true)
}

watch(
  () => props.at !== null,
  (up) => listen(up),
)

onBeforeUnmount(() => listen(false))
</script>

<style scoped>
/* Client coordinates, so it stands outside the stage and does not travel with
   the view — a menu is a question being asked of the reader, not something the
   page holds. */
.menu {
  position: fixed;
  z-index: 50;
  min-width: 9rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--popover);
  padding: 0.25rem;
  box-shadow: 0 0.25rem 1rem oklch(0 0 0 / 0.3);
}

.menu-item {
  display: block;
  width: 100%;
  border-radius: 0.25rem;
  padding: 0.3rem 0.5rem;
  text-align: start;
  font-size: 0.875rem;
  color: var(--foreground);
}
.menu-item:hover {
  background: var(--secondary);
}

.menu-item-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.menu-mark {
  height: 0.75rem;
  width: 0.75rem;
  flex-shrink: 0;
  border-radius: 9999px;
  border: 2px solid currentColor;
  color: var(--muted-foreground);
}
.menu-mark-on {
  background: currentColor;
}
</style>
