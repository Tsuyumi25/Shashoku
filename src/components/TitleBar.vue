<template>
  <!--
    One bar across the whole window, not a strip per column: a switch that
    lived in a column's strip would move and squeeze with that column's
    splitter. Laid out as VS Code's title bar is — left and right at 20% each
    growing into whatever the centre does not take, the centre at fit-content
    so it stays centred on the window until really squeezed.

    Dragging comes from an underlay that covers the bar; everything
    interactive opts out on top of it.
  -->
  <div class="relative flex h-9 shrink-0 items-center border-b border-border bg-card select-none">
    <div class="absolute inset-0" style="-webkit-app-region: drag" />

    <!--
      macOS draws its traffic lights over the top-left corner, so the menu
      steps aside by the 70px VS Code reserves for them. Left as plain drag
      surface rather than no-drag — clicks landing beside the lights should
      still move the window.
    -->
    <div class="tb-side justify-start pl-1">
      <div v-if="isMac" class="h-full w-[70px] shrink-0" />
      <DropdownMenuRoot>
        <DropdownMenuTrigger class="tb-btn no-drag" title="更多">
          <Menu :size="16" />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent class="dropdown-content" :align="'start'" :side-offset="4">
            <DropdownMenuItem class="dropdown-item" :disabled="!project.isOpen" @select="onSave">
              <Save :size="14" />
              <span>立即儲存</span>
              <span class="ml-auto text-xs tracking-widest text-muted-foreground">Ctrl+S</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator class="dropdown-separator" />
            <DropdownMenuItem class="dropdown-item" @select="ui.settingsOpen = true">
              <Settings :size="14" />
              <span>設定</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </div>

    <!--
      Where you are and how to move. The library button steps out to the
      shelf; the pill switches between the working views. All of it stands
      whether or not a project is open — a view opened without one is empty
      and says so, which beats a switch that comes and goes.

      The pill alone is the centred item; the library button rides in the
      flanking column rather than inside the centred group, so the window's
      optical centre falls on the symmetric switch and not on the midpoint
      of switch-plus-neighbour.
    -->
    <div class="tb-center">
      <div class="tb-center-side justify-end">
        <!--
          A lone capsule in the pill's own dress: the faces are three surfaces
          of the open project, the library leaves it to pick another — a
          different object, so it stands apart, but a peer view, so it wears
          the same weight and lights the same way. Ghost styling here read as
          an auxiliary control, and disabling it while open left the starting
          view as the only one without a you-are-here signal.
        -->
        <button
          class="tb-lib no-drag"
          :class="ui.view === 'library' && 'tb-lib-on'"
          title="切換到書庫"
          @click="ui.setView('library')"
        >
          <LibraryBig :size="14" />
          <span>書庫</span>
        </button>
      </div>

      <div class="tb-pill no-drag">
        <button
          v-for="face in FACES"
          :key="face.view"
          type="button"
          class="tb-face"
          :class="ui.view === face.view && 'tb-face-on'"
          @click="ui.setView(face.view)"
        >
          {{ face.title }}
        </button>
      </div>

      <div class="tb-center-side" />
    </div>

    <!--
      The bar ends where the system-drawn window buttons begin. The spacer
      reads their width from the environment, so it is zero wherever there is
      no overlay (macOS, plain browsers).
    -->
    <div class="tb-side justify-end">
      <div class="no-drag flex h-full items-center">
        <ThemeToggle />
      </div>
      <div class="tb-overlay-spacer" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { LibraryBig, Menu, Save, Settings } from '@lucide/vue'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore, type AppView } from '@/stores/uiStore'

const project = useProjectStore()
const ui = useUiStore()

const isMac = navigator.platform.startsWith('Mac')

const FACES: { view: AppView; title: string }[] = [
  { view: 'editor', title: '編輯器' },
  { view: 'pages', title: '頁面' },
  { view: 'export', title: '匯出' },
]

async function onSave() {
  try {
    await project.flush()
  } catch (err) {
    console.error(err)
  }
}
</script>

<style scoped>
/* Raised above the drag underlay, or it eats their clicks — the underlay is
   positioned and they are not, so DOM order alone paints them under it. */
.no-drag {
  -webkit-app-region: no-drag;
  position: relative;
  z-index: 10;
}
.tb-side {
  display: flex;
  height: 100%;
  width: 20%;
  min-width: min-content;
  flex-grow: 2;
  align-items: center;
}
.tb-overlay-spacer {
  width: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw));
}
.tb-center {
  display: grid;
  /* min-content floors: a flank gives ground once space runs out — the pill
     slides off-centre — rather than folding its button into a column of
     characters. */
  grid-template-columns: minmax(min-content, 1fr) auto minmax(min-content, 1fr);
  height: 100%;
  width: 60%;
  min-width: 0;
  align-items: center;
  margin: 0 0.625rem;
}
.tb-center-side {
  display: flex;
  height: 100%;
  min-width: 0;
  align-items: center;
  padding: 0 0.375rem;
}

.tb-btn {
  display: flex;
  align-items: center;
  gap: 0.3125rem;
  height: 1.75rem;
  padding: 0 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  white-space: nowrap;
  color: var(--muted-foreground);
  outline: none;
}
.tb-btn:hover:not(:disabled),
.tb-btn[data-state='open'] {
  background: var(--secondary);
  color: var(--foreground);
}
.tb-lib {
  display: flex;
  align-items: center;
  gap: 0.3125rem;
  height: 1.625rem;
  padding: 0 0.625rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  font-size: 0.75rem;
  white-space: nowrap;
  color: var(--muted-foreground);
  outline: none;
}
.tb-lib:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.tb-lib-on,
.tb-lib-on:hover {
  background: var(--primary);
  color: var(--primary-foreground);
}

.tb-pill {
  display: flex;
  height: 1.625rem;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
}
.tb-face {
  padding: 0 0.625rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}
.tb-face + .tb-face {
  border-left: 1px solid var(--border);
}
.tb-face:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.tb-face-on,
.tb-face-on:hover {
  background: var(--primary);
  color: var(--primary-foreground);
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
