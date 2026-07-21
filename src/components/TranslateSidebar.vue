<template>
  <!-- 翻譯視圖左側 sidebar:分組列表(含預設樣式 pseudo-item + 新增按鈕)→
       顯示偏好 → 底部當前選中群組的樣式編輯區 → ModeSwitcher。
       選中「預設樣式」pseudo-item = activeGroupId = null(新增 label 走
       未分組 + fallback 到 defaultStyle);底部 StyleEditor 跟著切樣式來源。 -->
  <aside
    class="flex shrink-0 flex-col overflow-y-auto border-r border-border bg-card p-2 select-none"
    style="width: var(--layout-sidebar-w)"
  >
    <div>
      <div class="mb-1 flex items-center justify-between px-1 text-xs font-semibold text-muted-foreground">
        <span>分組</span>
      </div>
      <button
        v-for="group in project.header.groups"
        :key="group.id"
        class="flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-sm font-medium"
        :class="
          editor.activeGroupId === group.id
            ? 'border-current bg-secondary/60'
            : 'border-transparent hover:bg-secondary/40'
        "
        :style="{ color: group.color }"
        @click="editor.activeGroupId = group.id"
      >
        <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: group.color }" />
        <span class="min-w-0 truncate">{{ group.name }}</span>
      </button>
      <button
        class="flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-sm font-medium text-muted-foreground"
        :class="
          editor.activeGroupId === null
            ? 'border-current bg-secondary/60'
            : 'border-transparent hover:bg-secondary/40'
        "
        title="未分組 label 的樣式來源"
        @click="editor.activeGroupId = null"
      >
        <span class="h-2 w-2 shrink-0 rounded-full bg-gray-400" />
        <span class="min-w-0 truncate">預設樣式</span>
      </button>
      <button
        type="button"
        class="mt-1 flex w-full items-center gap-1.5 rounded border border-dashed border-border px-2 py-1 text-left text-xs text-muted-foreground hover:border-primary hover:text-foreground"
        @click="onAddGroup"
      >
        <Plus :size="12" />
        新增群組
      </button>
    </div>

    <div class="mt-3 border-t border-border pt-2">
      <div class="mb-1 px-1 text-xs font-semibold text-muted-foreground">顯示</div>
      <button
        class="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm"
        :class="
          editor.showGroups
            ? 'bg-primary text-primary-foreground'
            : 'bg-accent text-accent-foreground hover:bg-secondary'
        "
        title="marker 旁常駐顯示分組名(原檢查模式的顯示效果)"
        @click="editor.showGroups = !editor.showGroups"
      >
        <Eye :size="14" />
        分組名
      </button>
    </div>

    <!-- 底部:當前選中群組的樣式編輯區(activeGroupId = null 時編 defaultStyle) -->
    <div class="mt-3 border-t border-border pt-2">
      <div class="mb-1 flex items-center justify-between px-1 text-xs font-semibold text-muted-foreground">
        <span class="truncate">{{ activeEditorHeader }}</span>
        <span v-if="activeGroupIndex !== -1" class="text-[10px] font-normal text-muted-foreground/70">
          {{ boundLabelCount }}
        </span>
      </div>
      <!-- rename input:只在選中一般 group 時出現;預設樣式不能改名 -->
      <input
        v-if="activeGroupIndex !== -1"
        class="mb-1.5 h-6 w-full rounded border border-input bg-background px-1.5 text-xs"
        :value="project.header.groups[activeGroupIndex].name"
        @focus="nameBeforeEdit = project.header.groups[activeGroupIndex].name"
        @blur="onRename($event)"
      />
      <StyleEditor
        :value="activeStyle"
        @patch="onStylePatch"
        @open-font-picker="onOpenFontPicker"
      />
    </div>

    <ModeSwitcher class="mt-auto pt-2" />
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Eye, Plus } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { TextStyle } from '@shared/text-style/types'
import { RESERVED_GROUP_NAMES } from '@shared/ssk/constants'
import ModeSwitcher from '@/components/ModeSwitcher.vue'
import StyleEditor from '@/components/StyleEditor.vue'
import { useFontPicker } from '@/composables/useFontPicker'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

const nameBeforeEdit = ref('')

/** 當前編輯的 group 在 header.groups 的 index;-1 代表選中「預設樣式」 */
const activeGroupIndex = computed(() => {
  const id = editor.activeGroupId
  return id === null ? -1 : project.header.groups.findIndex((g) => g.id === id)
})

const activeStyle = computed<TextStyle>(() =>
  activeGroupIndex.value === -1
    ? project.header.defaultStyle
    : project.header.groups[activeGroupIndex.value].style,
)

const activeEditorHeader = computed(() => {
  if (activeGroupIndex.value === -1) return '預設樣式'
  return `樣式:${project.header.groups[activeGroupIndex.value].name}`
})

/** 綁定 label 數(當前選中 group);跨全部頁面 */
const boundLabelCount = computed(() => {
  const id = editor.activeGroupId
  if (id === null) return 0
  let n = 0
  for (const f of project.files) {
    for (const l of f.labels) if (l.groupId === id) n++
  }
  return n
})

function onStylePatch(patch: Partial<TextStyle>) {
  if (activeGroupIndex.value === -1) project.updateDefaultStyle(patch)
  else project.updateGroupStyle(activeGroupIndex.value, patch)
}

/** 打開字型 picker,選中結果套進當前 activeStyle 的 patch 通道 */
async function onOpenFontPicker() {
  const picker = useFontPicker()
  const name = await picker.open(activeStyle.value.fontFamily)
  if (name !== null) onStylePatch({ fontFamily: name })
}

function onAddGroup() {
  const name = `群組${project.header.groups.length + 1}`
  const before = project.header.groups.length
  const ok = editor.cmdAddGroup(name)
  if (!ok) {
    toast.error('無法新增群組(名稱重複)')
    return
  }
  const added = project.header.groups[before]
  if (added) editor.activeGroupId = added.id
}

function onRename(e: Event) {
  const idx = activeGroupIndex.value
  if (idx === -1) return
  const name = (e.target as HTMLInputElement).value.trim()
  if (name === '' || RESERVED_GROUP_NAMES.includes(name)) {
    ;(e.target as HTMLInputElement).value = nameBeforeEdit.value
    if (RESERVED_GROUP_NAMES.includes(name))
      toast.error(`「${name}」是保留名稱,請換一個`)
    return
  }
  if (name === nameBeforeEdit.value) return
  editor.cmdRenameGroup(idx, nameBeforeEdit.value, name)
}
</script>
