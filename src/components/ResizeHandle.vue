<template>
  <SplitterResizeHandle
    class="shrink-0 bg-border transition-colors data-[state=drag]:bg-primary data-[state=hover]:bg-primary/60"
    :class="vertical ? 'h-[5px] w-full cursor-row-resize' : 'w-[5px] cursor-col-resize'"
    style="-webkit-app-region: no-drag"
  />
</template>

<script setup lang="ts">
import { SplitterResizeHandle } from 'reka-ui'

defineProps<{
  vertical?: boolean
}>()
</script>
