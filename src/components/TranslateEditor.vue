<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-7 shrink-0 items-center border-t border-b border-border px-2 select-none">
      <span class="text-xs text-muted-foreground">標號 2</span>
      <span class="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
        <span class="inline-block h-2.5 w-2.5 rounded-full" style="background-color: #3b7fe2" />
        對白
      </span>
    </div>

    <textarea
      class="min-h-0 w-full flex-1 resize-none bg-card px-3 py-2 text-sm leading-relaxed focus:outline-none"
      placeholder="輸入翻譯…"
      value="你在說什麼啊。"
    />

    <div class="flex h-6 shrink-0 items-center border-t border-border px-2 select-none">
      <span class="text-xs text-muted-foreground">Ctrl+Enter = 下一個標籤</span>
    </div>
  </div>
</template>
