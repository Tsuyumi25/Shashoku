<template>
  <div class="border-t border-border p-2">
    <template v-if="exportRun.progress">
      <div class="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span>匯出中 {{ exportRun.progress.done }} / {{ exportRun.progress.total }}</span>
        <button class="ml-auto run-btn" @click="exportRun.cancel()">取消</button>
      </div>
      <div class="h-1 overflow-hidden rounded-full bg-secondary">
        <div class="h-full bg-primary transition-[width]" :style="{ width: `${percent}%` }" />
      </div>
    </template>

    <template v-else>
      <button class="run-btn run-btn-primary w-full" :disabled="!ready" @click="exportRun.run()">
        <Download :size="15" />
        <span>匯出 {{ exportRun.pagesToRun.length }} 頁</span>
      </button>

      <p
        v-if="exportRun.outcome"
        class="mt-1 text-xs"
        :class="exportRun.outcome.kind === 'done' ? 'text-muted-foreground' : 'text-destructive'"
      >
        <template v-if="exportRun.outcome.kind === 'done'">
          已寫出 {{ exportRun.outcome.written }} 個檔案。
        </template>
        <template v-else>
          在寫出 {{ exportRun.outcome.written }} 個檔案後停下:{{ exportRun.outcome.why }}。已寫出的留在原處。
        </template>
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Download } from '@lucide/vue'
import { useExportStore } from '@/stores/exportStore'

const exportRun = useExportStore()

const ready = computed(
  () => exportRun.pagesToRun.length > 0 && exportRun.profilesToRun.length > 0,
)

const percent = computed(() => {
  const p = exportRun.progress
  if (!p || p.total === 0) return 0
  return Math.round((p.done / p.total) * 100)
})
</script>

<style scoped>
.run-btn {
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  height: 1.75rem;
  padding: 0 0.625rem;
  border-radius: 0.3125rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}
.run-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.run-btn-primary {
  height: 2.25rem;
  font-size: 0.8125rem;
  background: var(--primary);
  color: var(--primary-foreground);
}
.run-btn-primary:hover {
  background: color-mix(in oklch, var(--primary), black 8%);
  color: var(--primary-foreground);
}
.run-btn-primary:disabled {
  opacity: 0.4;
  background: var(--secondary);
  color: var(--muted-foreground);
}
</style>
