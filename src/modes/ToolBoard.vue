<template>
  <!--
    The tools that belong to no one place: recognizing, retouching. Nothing here
    is armed by being pressed, which is what keeps all of it out of the rail.

    ⭐ Not a splitter any more. Two lists whose contents nobody could predict the
    height of used to be here, and the only way to reconcile them was to hand a
    reader the job of deciding which of them ate the column today — the divider
    was that problem's own confession. With the lists standing on the canvas,
    what is left has a height of its own again.
  -->
  <div class="flex min-h-0 flex-1 flex-col">
    <RecognizerBar />
    <RetouchProbe />
  </div>
</template>

<script setup lang="ts">
import RecognizerBar from '@/components/RecognizerBar.vue'
import RetouchProbe from '@/components/RetouchProbe.vue'
</script>
