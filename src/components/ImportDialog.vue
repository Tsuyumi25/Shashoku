<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('cancel')">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>重新掃描資料夾</DialogTitle>
        <DialogDescription>
          比對 root 與 shashoku/raws/,勾選要匯入的新圖。
        </DialogDescription>
      </DialogHeader>

      <div class="max-h-[24rem] overflow-y-auto rounded border border-border">
        <ul class="divide-y divide-border text-sm">
          <!-- 新增候選:勾選狀態 -->
          <li
            v-for="name in diff?.toAdd ?? []"
            :key="`add-${name}`"
            class="flex items-center gap-2 px-3 py-1.5"
          >
            <input
              :id="`chk-${name}`"
              type="checkbox"
              :checked="selection.has(name)"
              @change="toggle(name)"
            />
            <label :for="`chk-${name}`" class="flex-1 cursor-pointer">
              <span class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 text-xs mr-2">新</span>
              {{ name }}
            </label>
          </li>

          <!-- 既有:disabled 灰色 -->
          <li
            v-for="name in diff?.existing ?? []"
            :key="`exist-${name}`"
            class="flex items-center gap-2 px-3 py-1.5 text-muted-foreground"
          >
            <input type="checkbox" checked disabled />
            <span class="flex-1">
              <span class="rounded bg-muted px-1.5 py-0.5 text-xs mr-2">既有</span>
              {{ name }}
            </span>
          </li>

          <!-- 孤兒 raws:資訊性顯示,不能操作 -->
          <li
            v-for="name in diff?.orphanRaws ?? []"
            :key="`orphan-${name}`"
            class="flex items-center gap-2 px-3 py-1.5 text-muted-foreground"
          >
            <input type="checkbox" disabled />
            <span class="flex-1">
              <span class="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-600 dark:text-amber-400 text-xs mr-2">
                孤兒
              </span>
              {{ name }} (root 已無此檔,副本仍保留)
            </span>
          </li>

          <li
            v-if="!hasAnything"
            class="px-3 py-6 text-center text-sm text-muted-foreground"
          >
            root 與 raws 已對齊,沒有可匯入的新頁
          </li>
        </ul>
      </div>

      <div class="flex justify-between text-xs text-muted-foreground">
        <span>共 {{ diff?.toAdd.length ?? 0 }} 張候選 · 已勾 {{ selection.size }} 張</span>
        <button
          v-if="(diff?.toAdd.length ?? 0) > 0"
          type="button"
          class="hover:text-foreground"
          @click="toggleAll"
        >
          {{ allSelected ? '全部取消' : '全部勾選' }}
        </button>
      </div>

      <div class="flex justify-end gap-2">
        <Button variant="ghost" @click="emit('cancel')">取消</Button>
        <Button :disabled="selection.size === 0" @click="onConfirm">
          匯入 {{ selection.size }} 張
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ImportDiff } from '@shared/project/import'

const props = defineProps<{
  open: boolean
  diff: ImportDiff | null
}>()

const emit = defineEmits<{
  cancel: []
  confirm: [filenames: string[]]
}>()

const selection = ref<Set<string>>(new Set())

// 每次 diff 改變:預設全選 toAdd(new 一個 Set 觸發 reactivity)
watch(
  () => props.diff,
  (d) => {
    selection.value = new Set(d?.toAdd ?? [])
  },
  { immediate: true },
)

const hasAnything = computed(() => {
  const d = props.diff
  return !!d && (d.toAdd.length + d.existing.length + d.orphanRaws.length > 0)
})

const allSelected = computed(() => {
  const total = props.diff?.toAdd.length ?? 0
  return total > 0 && selection.value.size === total
})

function toggle(name: string) {
  const next = new Set(selection.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  selection.value = next
}

function toggleAll() {
  if (allSelected.value) selection.value = new Set()
  else selection.value = new Set(props.diff?.toAdd ?? [])
}

function onConfirm() {
  emit('confirm', [...selection.value])
}
</script>
