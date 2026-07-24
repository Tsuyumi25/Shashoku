<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2 select-none">
      <span class="text-xs text-muted-foreground">標籤</span>
      <span class="ml-auto text-xs text-muted-foreground">{{ rows.length }} 條</span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto select-none">
      <table class="w-full border-collapse">
        <thead class="sticky top-0 bg-card text-xs text-muted-foreground">
          <tr class="border-b border-border text-left">
            <th class="w-10 px-2 py-1 font-normal">ID</th>
            <th class="w-24 px-2 py-1 font-normal">分組</th>
            <th class="px-2 py-1 font-normal">文字</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in rows"
            :key="row.id"
            class="cursor-default border-b border-border/40 hover:bg-secondary/40"
            :class="[i === 1 && 'bg-accent/50']"
          >
            <td class="px-2 py-1 tabular-nums">{{ row.id }}</td>
            <td class="px-2 py-1">
              <span class="inline-flex items-center gap-1.5">
                <span
                  class="inline-block h-2.5 w-2.5 rounded-full"
                  :style="{ backgroundColor: row.color }"
                />
                <span class="text-xs">{{ row.group }}</span>
              </span>
            </td>
            <td class="h-7 max-w-0 truncate px-2 py-1 text-sm">{{ row.text }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
const rows = [
  { id: 1, group: '對白', color: '#e26a3b', text: 'そんな…！' },
  { id: 2, group: '對白', color: '#3b7fe2', text: 'なにを言ってるんだ、お前は。' },
  { id: 3, group: '對白', color: '#e26a3b', text: 'だって、これは——' },
  { id: 4, group: '對白', color: '#3b7fe2', text: 'もういい。次に行こう。' },
  { id: 5, group: '音效', color: '#7a7a7a', text: 'ガタン' },
  { id: 6, group: '對白', color: '#e26a3b', text: 'ま、待って！' },
]
</script>
