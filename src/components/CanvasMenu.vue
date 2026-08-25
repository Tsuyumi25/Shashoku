<template>
  <!--
    A menu at a point, for a gesture whose answer is a choice rather than a
    place. It closes on the next press anywhere and on Escape, both caught on
    the window during capture — a menu that only closed when something inside it
    was pressed is one a reader has to dismiss before they can do anything else.
  -->
  <div v-if="at" ref="menuEl" class="menu" :style="{ left: `${at.x}px`, top: `${at.y}px` }">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="menu-item"
      @click="emit('pick', item.id)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, useTemplateRef, watch } from 'vue'

export interface MenuItem {
  id: string
  label: string
}

const props = defineProps<{
  /** Where it stands, in client coordinates, or null when it is not up. */
  at: { x: number; y: number } | null
  items: readonly MenuItem[]
}>()

const emit = defineEmits<{ pick: [id: string]; close: [] }>()

const menuEl = useTemplateRef<HTMLElement>('menuEl')

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
  font-size: 0.8125rem;
  color: var(--foreground);
}
.menu-item:hover {
  background: var(--secondary);
}
</style>
