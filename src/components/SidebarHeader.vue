<template>
  <div
    class="flex h-9 shrink-0 items-center border-b border-border px-1 select-none"
    style="-webkit-app-region: drag"
  >
    <DropdownMenuRoot>
      <DropdownMenuTrigger
        class="sh-btn"
        title="更多"
        style="-webkit-app-region: no-drag"
      >
        <Menu :size="16" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent
          class="dropdown-content"
          :align="'start'"
          :side-offset="4"
        >
          <DropdownMenuItem
            class="dropdown-item"
            :disabled="!project.isOpen"
            @select="onSave"
          >
            <Save :size="14" />
            <span>儲存專案</span>
            <span class="ml-auto text-xs text-muted-foreground tracking-widest">Ctrl+S</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>

    <div class="flex-1" />

    <button
      class="sh-btn sh-btn-labeled"
      :class="{ 'sh-btn-active': ui.view === 'project-manager' }"
      style="-webkit-app-region: no-drag"
      :title="ui.view === 'project-manager' ? '返回翻譯' : '專案管理'"
      @click="onToggleView"
    >
      <FolderOpen :size="14" />
      <span>專案</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { FolderOpen, Menu, Save } from '@lucide/vue'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const project = useProjectStore()
const ui = useUiStore()

async function onSave() {
  try {
    await project.save()
  } catch (err) {
    console.error(err)
  }
}

function onToggleView() {
  if (ui.view === 'project-manager') {
    if (project.isOpen) ui.setView('translate')
  } else {
    ui.setView('project-manager')
  }
}
</script>

<style scoped>
.sh-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  height: 1.75rem;
  padding: 0 0.5rem;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
  outline: none;
}
.sh-btn:hover,
.sh-btn[data-state="open"] {
  background: var(--secondary);
  color: var(--foreground);
}
.sh-btn-labeled {
  font-size: 0.8125rem;
}
.sh-btn-active {
  background: var(--accent);
  color: var(--accent-foreground);
}
.sh-btn-active:hover {
  background: var(--accent);
}
</style>

<style>
.dropdown-content {
  z-index: 50;
  min-width: 12rem;
  overflow: hidden;
  border-radius: 0.375rem;
  border: 1px solid var(--border);
  background: var(--popover);
  color: var(--popover-foreground);
  padding: 0.25rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
  outline: none;
  user-select: none;
  cursor: default;
}
.dropdown-item[data-highlighted] {
  background: var(--accent);
  color: var(--accent-foreground);
}
.dropdown-item[data-disabled] {
  pointer-events: none;
  opacity: 0.5;
}
.dropdown-separator {
  height: 1px;
  background: var(--border);
  margin: 0.25rem -0.25rem;
}
</style>
