<template>
  <div class="flex h-full">
    <TranslateSidebar />

    <main class="flex min-h-0 min-w-0 flex-1 flex-col">
      <section class="relative min-h-0 min-w-0 flex-1 border-r border-border">
        <CanvasView />
      </section>
      <CanvasBottomBar />
    </main>

    <aside class="flex shrink-0 flex-col bg-card" style="width: var(--layout-panel-w)">
      <div class="h-[45%] min-h-0">
        <LabelTable />
      </div>
      <div class="min-h-0 flex-1">
        <TranslateEditor />
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import CanvasBottomBar from '@/components/CanvasBottomBar.vue'
import CanvasView from '@/components/CanvasView.vue'
import LabelTable from '@/components/LabelTable.vue'
import TranslateEditor from '@/components/TranslateEditor.vue'
import TranslateSidebar from '@/components/TranslateSidebar.vue'
</script>
