<template>
  <main
    ref="boardEl"
    class="relative h-full w-full overflow-hidden bg-muted select-none"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <p
      v-if="items.length === 0"
      class="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground"
    >
      將主編輯器的文字拖到這裡
    </p>

    <div
      v-for="item in items"
      :key="item.id"
      class="absolute cursor-grab select-none active:cursor-grabbing"
      :class="[
        item.text === '' && 'h-[18px] w-[18px] rounded-full shadow-sm',
        item.id === hiddenNativeMoveId && 'opacity-0',
      ]"
      :style="itemStyle(item)"
      draggable="true"
      @dragstart="onDragStart(item, $event)"
      @dragend="onDragEnd(item, $event)"
      @contextmenu.prevent="remove(item.id)"
    >
      {{ item.text }}
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { useDark } from '@vueuse/core'
import {
  LABEL_DRAG_TYPE,
  parseLabelDrag,
  serializeLabelDrag,
  type LabelDragPayload,
} from '@/lib/labelDrag'
import { labelTextCss } from '@/lib/labelTextStyle'
import { setLabelDragPreview } from '@/lib/labelDragPreview'
import { useTextBoardStyle } from '@/lib/textBoardAppearance'

// TextBoard 是獨立 renderer,沒有 pinia projectStore 訪問——所以只保留
// 從 drag payload 帶進來的最小資訊(groupId + groupName,用於再拖回主視窗
// 時對齊語意)。空 label 的圓點色無法反查 group.color,一律 fallback 灰。
interface BoardItem {
  id: string
  x: number
  y: number
  text: string
  groupId: string | null
  groupName: string | null
}

const boardEl = useTemplateRef('boardEl')
const items = ref<BoardItem[]>([])
let activeDrag: {
  payload: LabelDragPayload
  localCommitted: boolean
} | null = null
const hiddenNativeMoveId = ref<string | null>(null)

// 主視窗與草稿紙共用同一個 theme storage，亮/暗色切換會即時同步。
useDark({ initialValue: 'dark' })
const textStyle = useTextBoardStyle()
const textCss = computed(() => labelTextCss(textStyle.value))

function itemStyle(item: BoardItem): Record<string, string> {
  const position = {
    left: `${item.x}px`,
    top: `${item.y}px`,
  }
  if (item.text !== '') return { ...position, ...textCss.value }
  return {
    ...position,
    backgroundColor: 'rgb(128, 128, 128)',
  }
}

function addItem(input: Omit<BoardItem, 'id'>): BoardItem {
  const item = { id: crypto.randomUUID(), ...input }
  items.value.push(item)
  return item
}

function remove(id: string): void {
  const index = items.value.findIndex((item) => item.id === id)
  if (index !== -1) items.value.splice(index, 1)
}

function onDragStart(item: BoardItem, e: DragEvent): void {
  if (!e.dataTransfer) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const payload: LabelDragPayload = {
    version: 2,
    kind: 'label',
    source: 'text-board',
    operation: e.altKey ? 'copy' : 'move',
    token: crypto.randomUUID(),
    sourceId: item.id,
    label: {
      text: item.text,
      groupId: item.groupId,
      groupName: item.groupName,
    },
    grabOffset: {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    },
  }
  activeDrag = {
    payload,
    localCommitted: false,
  }
  const preview = setLabelDragPreview(e.dataTransfer, item, textStyle.value, {
    scale: 1,
    rotation: 0,
    sourceRect: rect,
    hotspot: payload.grabOffset,
  })
  payload.grabOffset = preview.grabOffset
  e.dataTransfer.clearData()
  e.dataTransfer.setData(
    LABEL_DRAG_TYPE,
    serializeLabelDrag(payload),
  )
  e.dataTransfer.effectAllowed = payload.operation
  if (payload.operation === 'move') hiddenNativeMoveId.value = item.id
}

function onDragEnd(item: BoardItem, e: DragEvent): void {
  const drag = activeDrag
  activeDrag = null
  hiddenNativeMoveId.value = null
  if (
    !drag ||
    drag.payload.sourceId !== item.id ||
    drag.payload.operation !== 'move' ||
    drag.localCommitted
  ) return
  if (e.dataTransfer?.dropEffect === 'move') remove(item.id)
}

function onDragOver(e: DragEvent): void {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes(LABEL_DRAG_TYPE)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy'
}

function onDrop(e: DragEvent): void {
  if (!e.dataTransfer || !boardEl.value) return
  const payload = parseLabelDrag(e.dataTransfer.getData(LABEL_DRAG_TYPE))
  if (!payload) return
  e.preventDefault()
  e.dataTransfer.dropEffect = payload.operation
  const rect = boardEl.value.getBoundingClientRect()
  const x = Math.max(0, e.clientX - rect.left - payload.grabOffset.x)
  const y = Math.max(0, e.clientY - rect.top - payload.grabOffset.y)

  if (payload.source === 'text-board' && payload.operation === 'move') {
    const item = items.value.find((candidate) => candidate.id === payload.sourceId)
    if (item) {
      item.x = x
      item.y = y
      if (activeDrag?.payload.token === payload.token) activeDrag.localCommitted = true
      return
    }
  }

  addItem({
    x,
    y,
    text: payload.label.text,
    groupId: payload.label.groupId,
    groupName: payload.label.groupName,
  })
}
</script>
