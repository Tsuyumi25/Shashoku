<template>
  <!--
    The tools that belong to no one place: recognizing, retouching, tagging.
    Nothing here is armed by being pressed, which is what keeps all of it out of
    the rail.

    ⭐ Not a splitter any more. Two lists whose contents nobody could predict the
    height of used to be here, and the only way to reconcile them was to hand a
    reader the job of deciding which of them ate the column today — the divider
    was that problem's own confession. With the lists standing on the canvas,
    what is left has a height of its own again.
  -->
  <div class="flex min-h-0 flex-1 flex-col">
    <RecognizerBar />
    <RetouchProbe />

    <div class="board-head border-t border-border">
      <span class="text-xs font-medium text-muted-foreground">標記</span>
      <button
        type="button"
        class="board-action"
        title="新增標記"
        :disabled="!project.isOpen"
        @click="onAddTag"
      >
        <Plus :size="14" />
      </button>
    </div>
    <TagList class="min-h-0 flex-1" />
  </div>
</template>

<script setup lang="ts">
import { Plus } from '@lucide/vue'
import RecognizerBar from '@/components/RecognizerBar.vue'
import RetouchProbe from '@/components/RetouchProbe.vue'
import TagList from '@/components/TagList.vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { nextAutoName } from '@/lib/autoName'

const project = useProjectStore()
const editor = useEditorStore()

function onAddTag() {
  const taken = new Set(project.header.tags.map((t) => t.name))
  editor.cmdAddTag(nextAutoName(taken, '標記'))
}
</script>

<style scoped>
.board-head {
  display: flex;
  height: 1.75rem;
  flex-shrink: 0;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding-right: 0.25rem;
  padding-left: 0.5rem;
  user-select: none;
}

.board-action {
  display: flex;
  height: 1.25rem;
  width: 1.25rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.board-action:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.board-action:disabled {
  opacity: 0.4;
}
</style>
