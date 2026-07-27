<template>
  <div class="flex h-full w-full items-center justify-center p-8">
    <p v-if="!project.isOpen" class="max-w-xs text-center text-sm text-muted-foreground">
      左邊的清單就是你的專案櫃。用「新增」把一個裝著原圖的資料夾建成專案,或用「加入資料夾」把已經做過的一批列進來。
    </p>
    <p v-else class="text-sm text-muted-foreground">{{ project.files.length }} 頁</p>
  </div>
</template>

<script setup lang="ts">
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
</script>
