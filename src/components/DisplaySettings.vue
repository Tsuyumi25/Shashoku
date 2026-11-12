<template>
  <div>
    <h3 class="mb-3 text-sm font-medium">顯示</h3>

    <section class="rounded border border-border p-3">
      <label class="flex cursor-pointer items-start gap-2 text-xs">
        <input
          type="checkbox"
          class="mt-0.5"
          :checked="preferences.prefs.snapping"
          @change="preferences.prefs.snapping = ($event.target as HTMLInputElement).checked"
        />
        <span>
          對齊
          <span class="block text-muted-foreground">
            拖曳物件時吸到參考線、頁面的邊與中線、其他文字的頂中下左右；拖參考線時吸到頁面與物件。
            拖曳時按住 Ctrl 反過來：關著時按住才吸，開著時按住就不吸。預設關著。
          </span>
        </span>
      </label>
    </section>

    <!--
      Beside snapping rather than beneath it: Ctrl snaps with snapping off, and
      the line is what says a held snap took hold, whichever way it came on.
    -->
    <section class="mt-3 rounded border border-border p-3">
      <label class="flex cursor-pointer items-start gap-2 text-xs">
        <input
          type="checkbox"
          class="mt-0.5"
          :checked="preferences.prefs.smartGuides"
          @change="preferences.prefs.smartGuides = ($event.target as HTMLInputElement).checked"
        />
        <span>
          智慧型參考線
          <span class="block text-muted-foreground">
            吸住其他文字或頁面時畫出的那段洋紅色線，不管是對齊開著，還是關著時按住 Ctrl 吸的。關掉之後照樣會吸，只是不畫線。
          </span>
        </span>
      </label>
    </section>
  </div>
</template>

<script setup lang="ts">
import { usePreferencesStore } from '@/stores/preferencesStore'

const preferences = usePreferencesStore()
</script>
