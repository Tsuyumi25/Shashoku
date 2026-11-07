<template>
  <div class="rail-cell border-b border-border/40 text-primary" :class="selected && 'bg-accent/50'">
    <span
      v-for="x in mark.through"
      :key="`through/${x}`"
      class="rail-line"
      :style="strokeAt(x, { top: '0', bottom: RAIL_OVERHANG })"
    />
    <span
      v-if="mark.arrives !== undefined"
      class="rail-line"
      :style="strokeAt(mark.arrives, { top: '0', height: '50%' })"
    />
    <span
      v-if="mark.leaves !== undefined"
      class="rail-line"
      :style="strokeAt(mark.leaves, { top: '50%', bottom: RAIL_OVERHANG })"
    />
    <svg
      v-if="mark.joins.length > 0"
      class="rail-join"
      :viewBox="`0 0 ${rail} 100`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        v-for="[from, to] in mark.joins"
        :key="`join/${from}/${to}`"
        :d="`M ${from} 0 C ${from} 50, ${to} 50, ${to} 100`"
        vector-effect="non-scaling-stroke"
        fill="none"
        stroke="currentColor"
        :stroke-width="RAIL_STROKE"
      />
    </svg>
    <span v-if="mark.stops !== undefined" class="rail-stop" :style="{ left: `${mark.stops - 4.5}px` }" />
    <span v-if="mark.dot !== undefined" class="rail-dot" :style="{ left: `${mark.dot - 3.5}px` }" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { rowSelected, type ListRow } from '@/lib/labelRows'
import { RAIL_STROKE, type RailMark } from '@/lib/readingRail'
import { useEditorStore } from '@/stores/editorStore'

const props = defineProps<{ row: ListRow; mark: RailMark; rail: number }>()

const editor = useEditorStore()

const selected = computed(() => rowSelected(props.row, editor.selectedIds))

/**
 * How far a line hangs below its row, so that it runs over the rule between
 * rows rather than stopping short of it.
 *
 * An absolutely placed child is offset from the padding box, which ends where
 * the bottom border begins — so `0` leaves the rail cut once per row. Painting
 * order already puts the child above the parent's border; it only has to reach
 * it. The reading is one line down the page, and a rule breaking it every row
 * makes it read as a column of unconnected marks.
 */
const RAIL_OVERHANG = '-1px'

/**
 * A vertical stroke standing on an offset, which names the middle of it rather
 * than its left edge — the same thing the dot and the curve are placed on, so
 * that all three agree.
 */
function strokeAt(offset: number, span: Record<string, string>): Record<string, string> {
  return { left: `${offset - RAIL_STROKE / 2}px`, width: `${RAIL_STROKE}px`, ...span }
}
</script>

<style scoped>
.rail-cell {
  grid-column: 1;
  position: relative;
}

/*
 * The rail is drawn out of the row it belongs to rather than over the column as
 * one picture: a translation sets its own height, and a picture that spanned
 * them all would have to be told what those heights came out as.
 */
.rail-line {
  position: absolute;
  background: currentColor;
}
/*
 * Stretched to the dot rather than drawn at a fixed height, since the dot sits
 * halfway down a row only the translation knows the height of. The stroke is
 * held out of that stretch, or a tall row would draw a fat curve and a short one
 * a thin one.
 */
.rail-join {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 50%;
  overflow: visible;
}
.rail-dot {
  position: absolute;
  top: 50%;
  margin-top: -3.5px;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: currentColor;
}
.rail-stop {
  position: absolute;
  top: 50%;
  margin-top: 5px;
  width: 9px;
  height: 1.5px;
  background: currentColor;
}
</style>
