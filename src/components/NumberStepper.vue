<template>
  <NumberFieldRoot
    class="stepper"
    :model-value="modelValue"
    :min="min"
    :max="max"
    :step="step"
    @update:model-value="onUpdate"
  >
    <NumberFieldDecrement class="stepper-step" :title="`${label} −`">
      <Minus :size="12" />
    </NumberFieldDecrement>
    <NumberFieldInput class="stepper-input" :aria-label="label" />
    <NumberFieldIncrement class="stepper-step" :title="`${label} +`">
      <Plus :size="12" />
    </NumberFieldIncrement>
  </NumberFieldRoot>
</template>

<script setup lang="ts">
import { Minus, Plus } from '@lucide/vue'
import {
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldRoot,
} from 'reka-ui'

defineProps<{
  modelValue: number
  label: string
  min?: number
  max?: number
  step?: number
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function onUpdate(value: number | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) emit('update:modelValue', value)
}
</script>

<style scoped>
.stepper {
  display: inline-flex;
  align-items: stretch;
  height: 1.5rem;
}
.stepper-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  border: 1px solid var(--input);
  background: var(--secondary);
  color: var(--muted-foreground);
}
.stepper-step:first-child {
  border-right: 0;
  border-radius: 0.25rem 0 0 0.25rem;
}
.stepper-step:last-child {
  border-left: 0;
  border-radius: 0 0.25rem 0.25rem 0;
}
.stepper-step:hover:not(:disabled) {
  background: var(--accent);
  color: var(--foreground);
}
.stepper-step:disabled {
  opacity: 0.35;
}
.stepper-input {
  width: 2.75rem;
  min-width: 0;
  border: 1px solid var(--input);
  background: var(--background);
  font-variant-numeric: tabular-nums;
  text-align: center;
  outline: none;
}
.stepper-input:focus-visible {
  border-color: var(--ring);
}
</style>
