<template>
  <Dialog>
    <DialogTrigger as-child>
      <button
        class="flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
        :disabled="!project.isOpen"
        title="檔案設定：分組與注釋"
      >
        <Settings2 :size="13" />
        檔案設定
      </button>
    </DialogTrigger>
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>檔案設定</DialogTitle>
        <DialogDescription>
          分組編號是 .txt 格式的位置索引（1~9），僅支援改名與新增
        </DialogDescription>
      </DialogHeader>

      <ul class="flex flex-col gap-1.5">
        <li v-for="(group, i) in project.header.groups" :key="i" class="flex items-center gap-2">
          <span
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            :style="{ backgroundColor: CATEGORY_COLORS[i] }"
          >
            {{ i + 1 }}
          </span>
          <input
            class="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-sm"
            :value="group"
            @focus="nameBeforeEdit = group"
            @blur="onRename(i, $event)"
          />
        </li>
        <li v-if="project.header.groups.length < MAX_GROUPS">
          <Button variant="outline" size="sm" class="w-full" @click="onAddGroup">
            <Plus :size="14" />
            新增分組
          </Button>
        </li>
      </ul>

      <div class="mt-2 flex flex-col gap-1">
        <span class="text-xs text-muted-foreground">工程注釋（寫入 .txt header）</span>
        <textarea
          class="min-h-16 w-full resize-y rounded border border-input bg-background px-2 py-1 text-sm"
          :value="project.header.comment"
          @focus="commentBeforeEdit = project.header.comment"
          @blur="onCommentBlur"
        />
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Plus, Settings2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { CATEGORY_COLORS, MAX_GROUPS, RESERVED_GROUP_NAMES } from '@shared/ssk/constants'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

const nameBeforeEdit = ref('')
const commentBeforeEdit = ref('')

function onRename(index: number, e: Event) {
  const name = (e.target as HTMLInputElement).value.trim()
  // 空名擋掉;_Label/_start/_end 是 PS 腳本端的保留名(LayerSet 與 action 鉤子)
  if (name === '' || RESERVED_GROUP_NAMES.includes(name)) {
    ;(e.target as HTMLInputElement).value = nameBeforeEdit.value
    if (RESERVED_GROUP_NAMES.includes(name))
      toast.error(`「${name}」是保留名稱,請換一個分組名`)
    return
  }
  editor.cmdRenameGroup(index, nameBeforeEdit.value, name)
}

function onAddGroup() {
  editor.cmdAddGroup(`分組${project.header.groups.length + 1}`)
}

function onCommentBlur(e: Event) {
  const text = (e.target as HTMLTextAreaElement).value
  if (text !== commentBeforeEdit.value) {
    project.header.comment = text
    project.dirty = true
  }
}
</script>
