<template>
  <Menubar>
    <MenubarMenu>
      <MenubarTrigger>檔案(F)</MenubarTrigger>
      <MenubarContent>
        <MenubarItem @select="emit('new')">新建(N)…</MenubarItem>
        <MenubarItem @select="emit('open')">開啟(O)…</MenubarItem>
        <MenubarItem :disabled="!project.isOpen" @select="emit('save')">
          儲存(S)
          <MenubarShortcut>Ctrl+S</MenubarShortcut>
        </MenubarItem>
        <MenubarItem :disabled="!project.isOpen" @select="emit('save-as')">另存新檔(S)…</MenubarItem>
        <MenubarSeparator />
        <MenubarItem @select="emit('exit')">結束(E)</MenubarItem>
      </MenubarContent>
    </MenubarMenu>

    <MenubarMenu>
      <MenubarTrigger>輸出(P)</MenubarTrigger>
      <MenubarContent>
        <!-- 原版 OutputAllImage：把標號烤進圖片輸出。功能未實作，先佔位 -->
        <MenubarItem disabled>輸出所有圖片(O)…</MenubarItem>
      </MenubarContent>
    </MenubarMenu>

    <!-- 原版是頂層項，點擊直接開管理視窗。功能未實作，先佔位 -->
    <MenubarMenu>
      <MenubarTrigger disabled>圖片管理(I)</MenubarTrigger>
    </MenubarMenu>

    <MenubarMenu>
      <MenubarTrigger>說明(H)</MenubarTrigger>
      <MenubarContent>
        <MenubarItem @select="emit('help')">檢視說明(H)</MenubarItem>
        <MenubarItem @select="emit('about')">關於(A)</MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  </Menubar>
</template>

<script setup lang="ts">
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@/components/ui/menubar'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()

const emit = defineEmits<{
  new: []
  open: []
  save: []
  'save-as': []
  exit: []
  help: []
  about: []
}>()
</script>
