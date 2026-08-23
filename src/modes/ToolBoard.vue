<template>
  <!--
    Actions that produce something, and what they produce. Nothing here is
    armed by being pressed, which is what keeps all of it out of the rail.

    The recognizers stand directly above the source list they fill: that
    pairing is the one order in this column that has to hold, since pressing a
    button whose answer lands out of sight reads as nothing happening.
  -->
  <div class="flex min-h-0 flex-1 flex-col">
    <RecognizerBar />
    <RetouchProbe />

    <SplitterGroup
      direction="vertical"
      class="min-h-0 flex-1"
      auto-save-id="board:panes"
      :storage="preferences.panelStorage"
    >
      <SplitterPanel :order="1" :default-size="30" :min-size="12" class="flex min-h-0 flex-col">
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
      </SplitterPanel>

      <ResizeHandle vertical />

      <SplitterPanel :order="2" :default-size="45" :min-size="15" class="flex min-h-0 flex-col">
        <SourceCandidates />
      </SplitterPanel>

      <ResizeHandle vertical />

      <SplitterPanel :order="3" :default-size="25" :min-size="10" class="flex min-h-0 flex-col">
        <TranslationCandidates />
      </SplitterPanel>
    </SplitterGroup>
  </div>
</template>

<script setup lang="ts">
import { Plus } from '@lucide/vue'
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import RecognizerBar from '@/components/RecognizerBar.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import RetouchProbe from '@/components/RetouchProbe.vue'
import SourceCandidates from '@/components/SourceCandidates.vue'
import TagList from '@/components/TagList.vue'
import TranslationCandidates from '@/components/TranslationCandidates.vue'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { nextAutoName } from '@/lib/autoName'

const project = useProjectStore()
const editor = useEditorStore()
const preferences = usePreferencesStore()

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
