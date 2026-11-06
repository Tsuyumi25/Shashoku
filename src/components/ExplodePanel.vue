<template>
  <!--
    What each number means is written beside it rather than hidden in a
    tooltip: both are the sort of knob nobody can predict from its name, and a
    hint that has to be hovered for is a hint nobody reads.
  -->
  <div class="flex flex-col gap-1 text-xs select-none">
    <!--
      Shown as how finely the page is cut rather than as the largest piece it
      may keep, so that both numbers read 0 on the page as it is and grow as it
      comes apart.
    -->
    <label class="flex items-center gap-1 text-foreground">
      <span>切細</span>
      <span class="truncate text-[0.9em] text-muted-foreground">越大切得越碎</span>
      <NumberStepper
        class="ml-auto shrink-0"
        :model-value="Math.round((1 - explode.cap) * 100)"
        label="切細"
        :min="0"
        :max="Math.round((1 - MIN_CAP) * 100)"
        :step="CUT_STEP"
        @update:model-value="explode.setCap(1 - $event / 100)"
      />
      <span>%</span>
      <button
        type="button"
        class="reset"
        title="切細回到 0%（整頁一塊）"
        :disabled="explode.cap === 1"
        @click="explode.setCap(1)"
      >
        <RotateCcw :size="12" />
      </button>
    </label>
    <label class="flex items-center gap-1 text-foreground">
      <span>間隔</span>
      <span class="truncate text-[0.9em] text-muted-foreground">離中心越遠推越遠</span>
      <NumberStepper
        class="ml-auto shrink-0"
        :model-value="Math.round(explode.factor * 100)"
        label="間隔"
        :min="0"
        :max="Math.round(MAX_FACTOR * 100)"
        :step="GAP_STEP"
        @update:model-value="explode.setFactor($event / 100)"
      />
      <span>%</span>
      <button
        type="button"
        class="reset"
        :title="`間隔回到 ${Math.round(DEFAULT_FACTOR * 100)}%`"
        :disabled="explode.factor === DEFAULT_FACTOR"
        @click="explode.setFactor(DEFAULT_FACTOR)"
      >
        <RotateCcw :size="12" />
      </button>
    </label>
  </div>
</template>

<script setup lang="ts">
import { RotateCcw } from '@lucide/vue'
import NumberStepper from '@/components/NumberStepper.vue'
import { DEFAULT_FACTOR, MAX_FACTOR, MIN_CAP, useExplodeStore } from '@/stores/explodeStore'

const CUT_STEP = 10
const GAP_STEP = 5

const explode = useExplodeStore()
</script>

<style scoped>
.reset {
  display: inline-flex;
  height: 1.5rem;
  width: 1.5rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.reset:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.reset:disabled {
  opacity: 0.35;
}
</style>
