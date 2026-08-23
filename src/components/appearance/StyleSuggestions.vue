<template>
  <div v-if="candidates.length > 0" class="col-start-2 -mt-1 flex min-w-0 flex-wrap gap-1">
    <button
      v-for="(candidate, i) in candidates"
      :key="i"
      type="button"
      class="chip"
      :class="isCurrent(candidate) ? 'chip-on' : 'chip-off'"
      :title="hint(candidate)"
      @click="emit('pick', candidate.patch)"
    >
      <span class="min-w-0 truncate">{{ text(candidate) }}</span>
      <span class="tabular-nums text-muted-foreground/70">{{ candidate.count }}</span>
      <span v-if="station(candidate)" class="text-[10px] text-muted-foreground/70">
        {{ station(candidate) }}
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TextStyle } from '@shared/text-style/types'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { sameTagSet } from '@shared/tags/set'
import type { StyleCandidate } from '@/lib/styleRecommendation'
import type { StyleSuggestionSet } from '@/composables/useStyleRecommendations'
import { styleFieldText, TEXT_STYLE_FIELD_NAMES } from '@/lib/textStyleFields'

/**
 * What the project already sets for one field, under the control that sets it.
 *
 * A strip and not a row of its own: it is answering the control above it, and a
 * label beside it would make it a second field with the same name. Nothing to
 * offer draws nothing at all — an empty strip would be a row of dead space
 * repeated eight times down a column that is short of room.
 */
const props = defineProps<{
  field: keyof TextStyle
  /** Null when the selection means more than one thing, and there is nothing to count under. */
  set: StyleSuggestionSet | null
}>()

const emit = defineEmits<{ pick: [patch: Partial<TextStyle>] }>()

const candidates = computed<readonly StyleCandidate[]>(
  () => props.set?.byField.get(props.field) ?? [],
)

function isCurrent(candidate: StyleCandidate): boolean {
  const current = props.set?.current
  if (!current) return false
  return Object.entries(candidate.patch).every(
    ([field, value]) => current.get(field as keyof TextStyle) === JSON.stringify(value),
  )
}

function text(candidate: StyleCandidate): string {
  if (props.field === 'fontFamily') {
    const family = candidate.patch.fontFamily || '未指定'
    return candidate.patch.fontStyleName ? `${family} ${candidate.patch.fontStyleName}` : family
  }
  return styleFieldText({ ...DEFAULT_TEXT_STYLE, ...candidate.patch } as TextStyle, props.field)
}

/**
 * Which station of the chain a candidate came from, shown only where it is not
 * the selection's own tag set. The rest of a strip is what this meaning looks
 * like; these are what the meaning one tag shorter looks like, which is the
 * only thing there is to offer the first object of a new kind.
 */
function station(candidate: StyleCandidate): string {
  if (candidate.from.length === 0) return ''
  if (props.set && sameTagSet(candidate.from, props.set.tags)) return ''
  return candidate.from.join('、')
}

function hint(candidate: StyleCandidate): string {
  const where = station(candidate)
  const field = TEXT_STYLE_FIELD_NAMES[props.field]
  const source = where === '' ? '' : `（來自「${where}」）`
  return `把${field}套成 ${text(candidate)}${source}`
}
</script>

<style scoped>
.chip {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.25rem;
  border: 1px solid;
  background: var(--background);
  padding: 0.0625rem 0.375rem;
  font-size: 0.6875rem;
}
.chip-off {
  border-color: var(--input);
  color: var(--muted-foreground);
}
.chip-off:hover {
  border-color: var(--primary);
  color: var(--foreground);
}
.chip-on {
  border-color: var(--primary);
  color: var(--foreground);
}
</style>
