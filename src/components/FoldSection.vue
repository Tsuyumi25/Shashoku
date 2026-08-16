<template>
  <div
    class="section"
    :class="[last ? 'section-last' : 'shrink-0 border-b border-border']"
    :style="last ? { minHeight: `${HEAD_PX + (open ? MIN_SECTION_HEIGHT : 0)}px` } : undefined"
  >
    <button type="button" class="section-head" @click="preferences.toggleSection(section)">
      <ChevronRight :size="14" class="chev" :class="[open && 'rotate-90']" />
      <span class="text-xs font-medium">{{ title }}</span>
      <span class="ml-auto pr-1 text-[11px] text-muted-foreground">{{ count }}</span>
    </button>

    <!--
      Folded by growing a grid row from nothing rather than by measuring a
      height in script: what it opens to is whatever the content turns out to
      be, so one whose list changed while it was folded still opens to the
      right size.
    -->
    <div class="fold" :class="[open && 'fold-open']">
      <div class="fold-clip">
        <div class="fold-body" :style="last || natural ? undefined : { height: `${height}px` }">
          <slot />
        </div>
      </div>
    </div>

    <!--
      ⚠️ No handle under the last section, and none is missing. A handle sets
      where two sections meet, so N sections have N-1 of them; one under the
      last would be setting where that section meets nothing. What decides its
      height is the bottom of the column, which is why it takes the space
      rather than a number — and why dragging the handle above it is the way to
      change it.
    -->
    <div
      v-if="open && !last && !natural"
      class="grip"
      :class="[dragging && 'grip-on']"
      @pointerdown="startResize"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight } from '@lucide/vue'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { MIN_SECTION_HEIGHT, type CandidateSection } from '@shared/preferences/types'

const props = defineProps<{
  section: CandidateSection
  title: string
  /** What the head says about how much is in there. Already formatted. */
  count: string
  /** Sits at the bottom of the column, so the column's own end is its end. */
  last?: boolean
  /** As tall as its content, with no handle — for a block nothing scrolls in. */
  natural?: boolean
}>()

/** The head's height, in the px this component's minimum is stated in. */
const HEAD_PX = 28

const preferences = usePreferencesStore()

const open = computed(() => preferences.prefs.sectionOpen[props.section])

/**
 * Kept for every section and read only by the ones with a handle: which
 * section is last is a fact about the column's arrangement, not about the
 * section, and an arrangement that changed would otherwise have thrown the
 * height away.
 */
const height = computed(() =>
  props.section === 'recognizers' ? 0 : preferences.prefs.sectionHeight[props.section],
)

const dragging = ref(false)

/**
 * Tracked on the window rather than on the handle, so a pointer that outruns
 * the drag — which it will, since the handle is five pixels tall — keeps
 * resizing instead of dropping the gesture wherever it happened to leave.
 */
function startResize(event: PointerEvent) {
  const section = props.section
  if (section === 'recognizers') return
  event.preventDefault()
  const from = event.clientY
  const was = height.value
  dragging.value = true

  const move = (e: PointerEvent) => preferences.setSectionHeight(section, was + e.clientY - from)
  const stop = () => {
    dragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}
</script>

<style scoped>
.section-head {
  display: flex;
  height: 1.75rem;
  width: 100%;
  flex-shrink: 0;
  align-items: center;
  gap: 0.375rem;
  border-bottom: 1px solid var(--border);
  padding-left: 0.375rem;
  text-align: left;
  user-select: none;
}
.section-head:hover {
  background: var(--secondary);
}
.chev {
  flex-shrink: 0;
  color: var(--muted-foreground);
  transition: transform 0.16s;
}

.fold {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}
.fold-open {
  grid-template-rows: 1fr;
}
/* Two wrappers and not one: the outer crops while the fold plays, the inner
   holds the height and scrolls. One element cannot both hide its overflow and
   scroll it. */
.fold-clip {
  min-height: 0;
  overflow: hidden;
}
.fold-body {
  overflow-y: auto;
}

/* The section keeps its full height whether it is open or shut, so folding it
   is the fold playing and nothing else moving. What is left below a shut one
   is the end of the column, which has nothing in it to move. */
.section-last {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}
.section-last .fold {
  min-height: 0;
  flex: 1 1 auto;
}
.section-last .fold-clip,
.section-last .fold-body {
  height: 100%;
}

.grip {
  height: 5px;
  width: 100%;
  flex-shrink: 0;
  cursor: row-resize;
  background: var(--border);
  transition: background 0.12s;
  -webkit-app-region: no-drag;
}
.grip:hover {
  background: color-mix(in srgb, var(--primary) 60%, transparent);
}
.grip-on,
.grip-on:hover {
  background: var(--primary);
}
</style>
