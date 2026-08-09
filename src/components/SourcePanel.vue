<template>
  <div class="flex h-full w-full flex-col">
    <div class="flex h-7 shrink-0 items-center gap-2 border-b border-border px-2 select-none">
      <span class="truncate text-xs text-muted-foreground">
        {{ countText }}
      </span>
      <!-- One control, because pressing it again is what "none" means. -->
      <button
        v-if="sources.length > 0"
        class="panel-action ml-auto flex items-center gap-1.5"
        @click="toggleAll"
      >
        <span class="pick" :data-checked="String(allPicked)">
          <Check :size="11" :stroke-width="3" />
        </span>
        <span>全選</span>
      </button>
      <button
        class="panel-action flex items-center gap-1.5"
        :class="sources.length === 0 && 'ml-auto'"
        title="重新讀取資料夾"
        :disabled="!project.rootPath"
        @click="refresh"
      >
        <RefreshCw :size="12" :class="loading && 'animate-spin'" />
        <span>重整</span>
      </button>
    </div>

    <!--
      The one irreversible step in the whole program, and it waits here to be
      pressed. Permanent rather than a dialog at project creation: images arrive
      later too, and a prompt that only ever appears once cannot serve the
      second time.
    -->
    <div
      v-if="project.creating"
      class="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-secondary px-2 select-none"
    >
      <Loader :size="13" class="animate-spin text-muted-foreground" />
      <span class="text-xs">建立中 {{ project.creating.done }} / {{ project.creating.total }}</span>
      <button class="panel-action ml-auto" @click="project.abandonCreating()">停止</button>
    </div>
    <div
      v-else-if="problem"
      class="flex shrink-0 items-start gap-2 border-b border-border bg-destructive/10 px-2 py-1 select-none"
    >
      <span class="min-w-0 flex-1 text-xs break-words text-destructive">建立中止 — {{ problem }}</span>
      <button class="panel-action shrink-0" @click="problem = null">知道了</button>
    </div>
    <div
      v-else-if="pickedNames.length > 0"
      class="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-secondary px-2 select-none"
    >
      <span class="min-w-0 truncate text-xs">這 {{ pickedNames.length }} 張圖還不是頁面</span>
      <button class="panel-cta ml-auto shrink-0" @click="create">
        建立 {{ pickedNames.length }} 頁
      </button>
    </div>

    <div v-if="!project.rootPath" class="flex flex-1 items-center justify-center p-6">
      <p class="max-w-[16rem] text-center text-sm text-muted-foreground">
        開啟一個專案,這裡就是它那個資料夾的鏡子。
      </p>
    </div>

    <div v-else-if="sources.length === 0" class="flex flex-1 items-center justify-center p-6">
      <p class="max-w-[16rem] text-center text-sm text-muted-foreground">
        這個資料夾裡沒有圖。子資料夾不算——只讀最上層,才不會把做好的成品當成新素材。
      </p>
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto p-2">
      <!--
        Keyed by name so that a rescan only animates what actually changed. A
        file that is no longer in the folder fades out rather than blinking off:
        this panel is a mirror, and something leaving it should look like
        something leaving.
      -->
      <TransitionGroup
        name="source"
        tag="div"
        class="grid items-start gap-2"
        :style="{ gridTemplateColumns: 'repeat(auto-fill, minmax(7rem, 1fr))' }"
      >
        <SourceThumb
          v-for="source in sources"
          :key="source.name"
          :root-path="project.rootPath"
          :source="source"
          :picked="!unpicked.has(source.name)"
          @toggle="toggle(source.name)"
        />
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { Check, Loader, RefreshCw } from '@lucide/vue'
import type { SourceImage } from '@shared/ipc/channels'
import SourceThumb from '@/components/SourceThumb.vue'
import { useProjectStore } from '@/stores/projectStore'

/**
 * The project folder, mirrored.
 *
 * Nothing is kept: no list, no snapshot, no watcher. Showing this means reading
 * the directory again, which costs a fifth of a millisecond for a real chapter
 * because it never touches file contents — cheap enough that maintaining a copy
 * would be more machinery than it saves.
 *
 * No filesystem watcher, and not to save effort: the operating system is
 * allowed to drop file events on all three platforms, so a watcher would still
 * need a rescan behind it. Three moments do the whole job — arriving here,
 * coming back to the window, and asking. What that misses is a folder changing
 * while Shashoku never lost focus, which is what the button is for.
 */
const project = useProjectStore()

const sources = ref<SourceImage[]>([])
const loading = ref(false)

/**
 * Which images are *not* wanted, rather than which are.
 *
 * Everything in the folder is offered by default, and holding the exceptions is
 * what makes that survive a rescan: an image that arrives while you are looking
 * joins already picked, with nothing having to notice it did.
 */
const unpicked = ref(new Set<string>())

/** Why the last run stopped short, cleared by starting another. */
const problem = ref<string | null>(null)

const pickedNames = computed(() =>
  sources.value.map((s) => s.name).filter((name) => !unpicked.value.has(name)),
)

const allPicked = computed(
  () => sources.value.length > 0 && pickedNames.value.length === sources.value.length,
)

function toggle(name: string): void {
  const next = new Set(unpicked.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  unpicked.value = next
}

function toggleAll(): void {
  unpicked.value = allPicked.value ? new Set(sources.value.map((s) => s.name)) : new Set()
}

async function create(): Promise<void> {
  problem.value = null
  const { made, problem: stopped } = await project.createPages(pickedNames.value)
  problem.value = stopped
  // What became a page stops being offered; whatever a stop or a failure left
  // behind stays picked, which is what makes pressing again finish the job.
  unpicked.value = new Set([...unpicked.value, ...made])
  await refresh()
}

const countText = computed(() => {
  if (!project.rootPath) return '素材'
  return loading.value ? '讀取中…' : `${sources.value.length} 張圖`
})

/** Which read the pending work belongs to, so a slow one cannot land last. */
let generation = 0

async function refresh(): Promise<void> {
  const root = project.rootPath
  const mine = ++generation
  if (!root) {
    sources.value = []
    return
  }
  loading.value = true
  try {
    const found = await window.api.listSources(root)
    if (mine !== generation) return
    sources.value = found
  } catch (err) {
    if (mine !== generation) return
    // A folder that cannot be read shows as empty rather than as an error: the
    // panel says what is there, and nothing being there is a thing it can say.
    console.error('source scan failed', err)
    sources.value = []
  } finally {
    if (mine === generation) loading.value = false
  }
}

// Arriving here — this panel is mounted only while its tab is up — and turning
// to another project both mean reading the folder afresh.
watch(() => project.rootPath, () => void refresh(), { immediate: true })

// Coming back to the window. Borrowed from web front ends rather than from
// desktop tools, and only because the cost structure differs: their rescan is
// seconds, ours is a fraction of a millisecond.
useEventListener(window, 'focus', () => void refresh())
</script>

<style scoped>
.panel-action {
  cursor: pointer;
  height: 1.375rem;
  padding: 0 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}
.panel-action:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.panel-action:disabled {
  opacity: 0.5;
  cursor: default;
}

/* The one button in this panel that does something irreversible, and the only
   one drawn as though it were the point of being here. */
.panel-cta {
  cursor: pointer;
  height: 1.5rem;
  padding: 0 0.625rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  background: var(--primary);
  color: var(--primary-foreground);
}
.panel-cta:hover {
  filter: brightness(1.08);
}

/* A file that is no longer in the folder fades rather than blinking off, and
   the ones behind it slide up rather than jumping — the two together are what
   make a removal read as one thing leaving instead of the panel redrawing. */
.source-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}
.source-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
.source-move {
  transition: transform 180ms ease;
}
</style>
