<template>
  <div class="flex h-full flex-col">
    <!-- Titlebar：選單 + mode 頁籤 + 標題 + 主題/視窗控制（frameless 自畫殼，YALP 血統） -->
    <header
      class="flex h-9 shrink-0 items-center border-b border-border select-none"
      style="-webkit-app-region: drag"
    >
      <div class="flex h-full items-center px-1" style="-webkit-app-region: no-drag">
        <AppMenuBar
          @new="onNew"
          @open="onOpen"
          @save="onSave"
          @save-as="onSaveAs"
          @exit="onExit"
          @help="api.openHelp()"
          @about="aboutOpen = true"
        />
      </div>

      <!-- mode 切換在各視圖 sidebar 底部(ModeSwitcher),titlebar 只留標題 -->
      <span class="flex-1 truncate px-3 text-center text-sm text-muted-foreground">
        {{ titleText }}
      </span>
      <div class="flex h-full" style="-webkit-app-region: no-drag">
        <button
          class="win-btn hover:bg-secondary"
          :title="isDark ? '切換亮色主題' : '切換暗色主題'"
          @click="toggleTheme($event)"
        >
          <Sun v-if="isDark" :size="14" />
          <Moon v-else :size="14" />
        </button>
        <button class="win-btn hover:bg-secondary" @click="api.windowMinimize()">
          <Minus :size="14" />
        </button>
        <button class="win-btn hover:bg-secondary" @click="api.windowMaximize()">
          <Square :size="12" />
        </button>
        <button class="win-btn hover:bg-destructive" @click="api.windowClose()">
          <X :size="14" />
        </button>
      </div>
    </header>

    <!-- 兩個 mode 以 v-show 常駐：切換不丟狀態（翻譯在 pinia、嵌字在 useEditor 單例） -->
    <main class="min-h-0 flex-1">
      <TranslateMode v-show="appMode === 'translate'" />
      <LetterMode v-show="appMode === 'letter'" />
    </main>

    <!-- dirty 時的確認（原版 是/否/取消 對話框），新建/開啟/關窗共用 -->
    <Dialog
      :open="confirmSaveOpen"
      @update:open="(open) => { if (!open) resolveSaveChoice('cancel') }"
    >
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>儲存變更？</DialogTitle>
          <DialogDescription>目前的翻譯有未儲存的變更</DialogDescription>
        </DialogHeader>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" @click="resolveSaveChoice('cancel')">取消</Button>
          <Button variant="outline" @click="resolveSaveChoice('discard')">不儲存</Button>
          <Button @click="resolveSaveChoice('save')">儲存</Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- 關於 -->
    <Dialog v-model:open="aboutOpen">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>Shashoku 写植</DialogTitle>
          <DialogDescription>v0.1.0 — 漫畫翻譯嵌字工具</DialogDescription>
        </DialogHeader>
        <p class="text-sm text-muted-foreground">
          靈感與致敬:LabelPlus——漫畫翻譯標記工具的開創者。
        </p>
      </DialogContent>
    </Dialog>

    <Toaster position="bottom-right" :theme="isDark ? 'dark' : 'light'" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useDark, useEventListener } from '@vueuse/core'
import { Minus, Moon, Square, Sun, X } from '@lucide/vue'
import { toast, Toaster } from 'vue-sonner'
import AppMenuBar from '@/components/AppMenuBar.vue'
import LetterMode from '@/modes/LetterMode.vue'
import TranslateMode from '@/modes/TranslateMode.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SSK_FILE_SUFFIX } from '@shared/ssk/constants'
import { appMode } from '@/lib/appMode'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const api = window.api
const project = useProjectStore()
const editor = useEditorStore()

// 亮/暗主題：寫入 <html> 的 .dark class，記憶在 localStorage
const isDark = useDark({ initialValue: 'dark' })

/** 主題切換的 circular mask 過場：新主題以按鈕為圓心擴散（View Transitions API） */
function toggleTheme(e: MouseEvent) {
  if (!document.startViewTransition) {
    isDark.value = !isDark.value
    return
  }
  const x = e.clientX
  const y = e.clientY
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )
  const transition = document.startViewTransition(async () => {
    isDark.value = !isDark.value
    await nextTick()
  })
  transition.ready.then(() => {
    document.documentElement.animate(
      {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
      },
      {
        duration: 450,
        easing: 'ease-in-out',
        pseudoElement: '::view-transition-new(root)',
      },
    )
  })
}

const aboutOpen = ref(false)

const titleText = computed(() => {
  if (!project.isOpen) return 'Shashoku 写植'
  const dir = project.folderPath?.split('/').pop() ?? ''
  return `${project.dirty ? '● ' : ''}${dir}`
})

// ── dirty 確認（原版 alter_and_save 的 是/否/取消）──
type SaveChoice = 'save' | 'discard' | 'cancel'

const confirmSaveOpen = ref(false)
let saveChoiceResolve: ((choice: SaveChoice) => void) | null = null

function askSaveChoice(): Promise<SaveChoice> {
  confirmSaveOpen.value = true
  return new Promise((resolve) => {
    saveChoiceResolve = resolve
  })
}

function resolveSaveChoice(choice: SaveChoice) {
  const resolve = saveChoiceResolve
  saveChoiceResolve = null
  confirmSaveOpen.value = false
  resolve?.(choice)
}

/** dirty 時先問要不要存。回傳 true = 呼叫端可以繼續（已存或用戶選不儲存） */
async function ensureSaved(): Promise<boolean> {
  if (!project.dirty) return true
  if (confirmSaveOpen.value) return false
  const choice = await askSaveChoice()
  if (choice === 'cancel') return false
  if (choice === 'discard') return true
  await flushPendingEdit()
  try {
    return (await project.save()) === 'saved'
  } catch (err) {
    toast.error('存檔失敗', {
      description: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

async function onNew() {
  if (!(await ensureSaved())) return
  try {
    const created = await project.createNewProject()
    if (created === null) return
    editor.clearHistory()
    editor.selectFile(project.files[0]?.filename ?? null)
    toast.success(`已建立 ${created}`)
  } catch (err) {
    toast.error('建立新翻譯失敗', {
      description: err instanceof Error ? err.message : String(err),
    })
  }
}

async function onOpen() {
  if (!(await ensureSaved())) return
  try {
    const opened = await project.openExisting()
    if (opened === null) return
    editor.clearHistory()
    editor.selectFile(project.files[0]?.filename ?? null)
  } catch (err) {
    toast.error('開啟檔案失敗', {
      description: err instanceof Error ? err.message : String(err),
    })
  }
}

async function onExit() {
  if (!(await ensureSaved())) return
  api.windowForceClose()
}

// 視窗 X、Alt+F4、選單「結束」統一走 main 的 close 攔截 → 這裡跑 dirty 確認
api.onCloseRequested(() => {
  void onExit()
})

/** textarea 編輯中：先 blur 讓 pending 文字提交 */
async function flushPendingEdit() {
  const active = document.activeElement
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    active.blur()
    await nextTick()
  }
}

async function onSave() {
  await flushPendingEdit()
  try {
    const result = await project.save()
    if (result === 'saved') toast.success('已存檔')
  } catch (err) {
    toast.error('存檔失敗', {
      description: err instanceof Error ? err.message : String(err),
    })
  }
}

async function onSaveAs() {
  await flushPendingEdit()
  if (!project.folderPath) return
  try {
    const folderBasename = project.folderPath.split(/[\\/]/).pop() || 'project'
    const saved = await api.saveSskAs(
      project.folderPath,
      `${folderBasename}${SSK_FILE_SUFFIX}`,
      project.serialize(),
    )
    if (saved !== null) {
      project.projectFilePath = saved
      project.dirty = false
      toast.success('已另存新檔')
    }
  } catch (err) {
    toast.error('另存失敗', {
      description: err instanceof Error ? err.message : String(err),
    })
  }
}

// Ctrl+S 全 mode 通用：SSOT 是 ssk 工程檔，嵌字 mode 按下也是存翻譯資料
useEventListener(window, 'keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    if (project.isOpen) onSave()
  }
})
</script>

<style scoped>
.win-btn {
  display: flex;
  height: 100%;
  width: 2.75rem;
  align-items: center;
  justify-content: center;
  color: var(--muted-foreground);
}
.win-btn:hover {
  color: var(--foreground);
}
</style>
