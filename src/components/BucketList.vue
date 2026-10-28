<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 flex-col gap-1 border-b border-border px-1.5 py-1 text-xs">
      <div class="flex items-center gap-1">
        <button
          v-for="choice in SCOPES"
          :key="choice.scope"
          type="button"
          class="rounded px-1.5 py-0.5"
          :class="wallScope === choice.scope ? on : off"
          :title="choice.title"
          @click="wallScope = choice.scope"
        >
          {{ choice.label }}
        </button>
        <span class="ml-auto text-muted-foreground">大小</span>
        <button
          v-for="choice in SIZES"
          :key="choice.size"
          type="button"
          class="rounded px-1.5 py-0.5"
          :class="wallSize === choice.size ? on : off"
          :title="choice.title"
          @click="wallSize = choice.size"
        >
          {{ choice.label }}
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-1">
        <span class="text-muted-foreground">依</span>
        <button
          v-for="a in WALL_ATTRIBUTES"
          :key="a.id"
          type="button"
          class="rounded px-1.5 py-0.5"
          :class="wallAttribute === a.id ? on : off"
          @click="wallAttribute = a.id"
        >
          {{ a.label }}
        </button>
      </div>
    </div>
    <WallView
      class="min-h-0 flex-1"
      dense
      :scene="scene"
      :selected="editor.selectedIds"
      @reveal="revealPiece"
      @select="selectPieces"
      @brush="brushMeaning"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import WallView from '@/components/wall/WallView.vue'
import { wallAttribute, wallScope, wallSize, type WallScope, type WallSize } from '@/lib/wall'
import { WALL_ATTRIBUTES } from '@/lib/wallAttributes'
import { brushMeaning, revealPiece, selectPieces } from '@/lib/wallActions'
import { wallSceneOf } from '@/lib/wallScene'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * The semantic buckets drawn as the wall draws them: gathered by what each
 * translation means and then by face, every piece shown as it is set. Picking
 * a bucket or a meaning still selects its objects, as the list did.
 */
const project = useProjectStore()
const editor = useEditorStore()

const SCOPES = [
  { scope: 'page', label: '本頁', title: '只看目前這一頁' },
  { scope: 'chapter', label: '本話', title: '整個開啟的專案' },
] as const satisfies readonly { scope: WallScope; label: string; title: string }[]

const SIZES = [
  { size: 'uniform', label: '統一', title: '每句一樣大，只比字型' },
  { size: 'eased', label: '緩和', title: '大的還是大，但差距拉近，一屏裝得下' },
  { size: 'proportional', label: '等比', title: '照字級的比例縮小' },
] as const satisfies readonly { size: WallSize; label: string; title: string }[]

const on = 'bg-accent text-accent-foreground'
const off = 'text-muted-foreground hover:bg-secondary hover:text-foreground'

const scene = computed(() => wallSceneOf(project.files, project.header.tags, editor.currentPageId))

</script>
