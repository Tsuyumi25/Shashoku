<template>
  <div class="flex flex-col gap-2 p-2">
    <label class="field">
      <span>編碼格式</span>
      <select :value="profile.format" @change="onFormat">
        <option v-for="f in FORMATS" :key="f.value" :value="f.value">{{ f.label }}</option>
      </select>
    </label>

    <label class="field">
      <span>色彩模式</span>
      <select :value="profile.colorMode" @change="onColorMode">
        <option v-for="mode in availableColorModes" :key="mode" :value="mode">
          {{ COLOR_LABEL[mode] }}
        </option>
      </select>
    </label>

    <label class="field">
      <span>影像尺寸</span>
      <select :value="profile.size.kind" @change="onSizeKind">
        <option value="original">原始尺寸</option>
        <option value="width">指定寬度</option>
        <option value="longest-edge">最長邊上限</option>
      </select>
    </label>
    <label v-if="profile.size.kind !== 'original'" class="field">
      <span />
      <input type="number" min="1" :value="profile.size.px" @change="onSizePx" />
    </label>

    <label class="field">
      <span>檔案大小上限</span>
      <input
        type="number"
        min="0"
        placeholder="不限"
        :disabled="!chasesCap"
        :title="chasesCap ? '' : `${FORMAT_LABEL[profile.format]} 沒有可以往上限逼近的品質參數`"
        :value="profile.maxBytes === null ? '' : Math.round(profile.maxBytes / 1024)"
        @change="onMaxBytes"
      />
      <span class="unit">KB</span>
    </label>

    <label class="field">
      <span>命名規則</span>
      <select :value="profile.naming.kind" @change="onNamingKind">
        <option value="sequence">補零遞增</option>
        <option value="keep">沿用原檔名</option>
      </select>
    </label>
    <template v-if="profile.naming.kind === 'sequence'">
      <label class="field">
        <span>前綴 / 後綴</span>
        <input :value="profile.naming.prefix" placeholder="前綴" @change="onPrefix" />
        <input :value="profile.naming.suffix" placeholder="後綴" @change="onSuffix" />
      </label>
      <label class="field">
        <span>位數 / 起始</span>
        <input type="number" min="0" max="12" :value="profile.naming.padding" @change="onPadding" />
        <input type="number" min="0" :value="profile.naming.start" @change="onStart" />
      </label>
    </template>

    <p class="text-xs text-muted-foreground">
      輸出到 <code>export/{{ folder }}/</code>,例如 <code>{{ sampleName }}</code>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  COLOR_MODES_FOR,
  CHASES_SIZE_CAP,
  type ColorMode,
  type ExportFormat,
  type ExportProfile,
} from '@shared/export/types'
import { outputFilename, profileFolderName, withFormat } from '@shared/export/profile'

const props = defineProps<{ profile: ExportProfile }>()
const emit = defineEmits<{ change: [ExportProfile] }>()

const FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'png', label: 'PNG' },
  { value: 'png-8', label: 'PNG-8(調色盤)' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
]
const FORMAT_LABEL: Record<ExportFormat, string> = {
  png: 'PNG',
  'png-8': 'PNG-8',
  jpeg: 'JPEG',
  webp: 'WebP',
}
const COLOR_LABEL: Record<ColorMode, string> = {
  color: '全彩',
  grayscale: '灰階',
  bilevel: '黑白二值',
}

const availableColorModes = computed(() => COLOR_MODES_FOR[props.profile.format])
const chasesCap = computed(() => CHASES_SIZE_CAP[props.profile.format])
const folder = computed(() => profileFolderName(props.profile))
const sampleName = computed(() => outputFilename(props.profile, '001.png', 0))

/**
 * Every edit goes out as a whole profile rather than a patch, so the parent
 * gets one thing to accept or refuse — and refusing is real here, since two
 * profiles are not allowed to deliver into one folder.
 */
function push(next: ExportProfile) {
  emit('change', next)
}

function valueOf(e: Event): string {
  return (e.target as HTMLInputElement | HTMLSelectElement).value
}

function onFormat(e: Event) {
  push(withFormat(props.profile, valueOf(e) as ExportFormat))
}

function onColorMode(e: Event) {
  push({ ...props.profile, colorMode: valueOf(e) as ColorMode })
}

function onSizeKind(e: Event) {
  const kind = valueOf(e) as ExportProfile['size']['kind']
  if (kind === 'original') return push({ ...props.profile, size: { kind: 'original' } })
  const px = props.profile.size.kind === 'original' ? 1280 : props.profile.size.px
  push({ ...props.profile, size: { kind, px } })
}

function onSizePx(e: Event) {
  if (props.profile.size.kind === 'original') return
  const px = Math.max(1, Math.round(Number(valueOf(e))))
  if (!Number.isFinite(px)) return
  push({ ...props.profile, size: { kind: props.profile.size.kind, px } })
}

function onMaxBytes(e: Event) {
  const kb = Number(valueOf(e))
  const maxBytes = !valueOf(e) || !Number.isFinite(kb) || kb <= 0 ? null : Math.round(kb * 1024)
  push({ ...props.profile, maxBytes })
}

function onNamingKind(e: Event) {
  if (valueOf(e) === 'keep') return push({ ...props.profile, naming: { kind: 'keep' } })
  push({
    ...props.profile,
    naming: { kind: 'sequence', prefix: '', suffix: '', padding: 3, start: 1 },
  })
}

function patchNaming(patch: Partial<Extract<ExportProfile['naming'], { kind: 'sequence' }>>) {
  if (props.profile.naming.kind !== 'sequence') return
  push({ ...props.profile, naming: { ...props.profile.naming, ...patch } })
}

const onPrefix = (e: Event) => patchNaming({ prefix: valueOf(e).replace(/[\\/]/g, '') })
const onSuffix = (e: Event) => patchNaming({ suffix: valueOf(e).replace(/[\\/]/g, '') })
const onPadding = (e: Event) =>
  patchNaming({ padding: Math.min(12, Math.max(0, Math.round(Number(valueOf(e))) || 0)) })
const onStart = (e: Event) =>
  patchNaming({ start: Math.max(0, Math.round(Number(valueOf(e))) || 0) })
</script>

<style scoped>
.field {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}
.field > span:first-child {
  width: 5.5rem;
  flex-shrink: 0;
}
.field select,
.field input {
  min-width: 0;
  flex: 1;
  height: 1.625rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border);
  background: var(--background);
  color: var(--foreground);
}
.field input:disabled {
  opacity: 0.5;
}
.unit {
  flex-shrink: 0;
}
</style>
