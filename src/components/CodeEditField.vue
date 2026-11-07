<template>
  <!--
    ⭐ The box holds the stored string itself — the markup code, tags and all.
    This is where a tag is read and corrected by hand; the canvas shows the
    words it sets. One session either way, so whichever of the two has the
    keyboard is writing and the other is drawn standing on the same text.
  -->
  <div class="relative">
    <textarea
      :ref="takeFocus"
      rows="1"
      spellcheck="false"
      :placeholder="placeholder"
      class="code-input w-full resize-none bg-transparent leading-snug focus:outline-none placeholder:text-muted-foreground/50"
      :value="value"
      @input="markup.writeCode(($event.target as HTMLTextAreaElement).value)"
      @keydown="emit('key', $event)"
      @blur="emit('blur', $event)"
    />
    <!--
      What the code's caret is doing while the keyboard is on the canvas. A
      native caret is only drawn in a focused box, so the field would otherwise
      sit there saying nothing about where the typing is landing in the string
      it is showing.
    -->
    <template v-if="projecting">
      <div v-for="(box, i) in codeSelectionBoxes" :key="i" class="code-selection" :style="box" />
      <div :key="codeCaretKey" class="code-caret" :style="codeCaretBox" />
    </template>
    <MarkupToolbar
      v-if="barAt"
      :placement="barAt"
      :color="editingColor"
      :vertical="editingIsVertical"
      @wrap="markup.apply({ kind: 'wrap', attrs: $event })"
      @step="(field, dir) => markup.apply({ kind: 'step', field, dir })"
      @clear="markup.apply({ kind: 'clear' })"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import MarkupToolbar from '@/components/MarkupToolbar.vue'
import { codeEditSurface, plainEditSurface, textWriter } from '@/composables/useTextEditSurface'
import { useMarkupSession } from '@/composables/useMarkupSession'
import { textareaCaret, textareaSelection } from '@/lib/textareaMirror'
import { isCollapsed, spanOf } from '@/lib/textSelection'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

defineProps<{
  value: string
  placeholder: string
}>()

const emit = defineEmits<{ key: [e: KeyboardEvent]; blur: [e: FocusEvent] }>()

const editor = useEditorStore()
const project = useProjectStore()
const markup = useMarkupSession()

let own: HTMLTextAreaElement | null = null

/**
 * Focus follows the input into being, so Enter lands the caret without a
 * click — unless the keyboard is already on the canvas, which is the other
 * half of the same session and the half the user is looking at.
 *
 * The same call publishes the box, because this is the control the code is
 * typed into and the canvas projects what it says. Only arrivals: a template
 * ref reports its element leaving as a bare `null`, and carrying the caret to
 * the next row swaps two of them in an order that would let the departure
 * clear the arrival.
 */
function takeFocus(el: unknown) {
  if (!(el instanceof HTMLTextAreaElement)) return
  own = el
  codeEditSurface.register(el)
  if (textWriter.value === 'code' && document.activeElement !== el) el.focus()
}

/**
 * The box exists exactly as long as the session does, so the session is what
 * withdraws it — one fact rather than two that can disagree.
 */
watch(
  () => editor.pendingTextEdit,
  (pending) => {
    if (pending === null) codeEditSurface.register(null)
  },
)

// Only its own box: the next field may already have taken over.
onBeforeUnmount(() => {
  if (codeEditSurface.field.value === own) codeEditSurface.register(null)
})

/** Whether the caret this field is showing belongs to the canvas's box. */
const projecting = computed(() => textWriter.value === 'plain' && markup.editing.value !== null)

/**
 * Bumped whenever the canvas's caret moves, so the drawn one restarts its
 * blink from the bright half — a caret that lands mid-blink reads as a
 * keystroke that did not register.
 */
const codeCaretKey = plainEditSurface.moved

const codeCaretBox = ref<Record<string, string>>({})
const codeSelectionBoxes = ref<Record<string, string>[]>([])
const barAt = ref<Record<string, string> | null>(null)

/** A gap between the selection and the bar standing under it, in pixels. */
const BAR_GAP_PX = 4

/**
 * ⚠️ Measured after the patch, never during it. A textarea lays its own text
 * out, so the only way to a rectangle is to set the same string in the same
 * font somewhere else — and the string to set is the one the box is showing
 * now, which during a render is still the one it was showing before.
 */
watch(
  () => [projecting.value, markup.code.value, markup.codeRange.value] as const,
  () => {
    const el = codeEditSurface.field.value
    const at = markup.codeRange.value
    if (el === null || el !== own || markup.editing.value === null) {
      barAt.value = null
      return
    }
    if (projecting.value) {
      const caret = textareaCaret(el, at.focus)
      codeCaretBox.value = {
        left: `${caret.x}px`,
        top: `${caret.y}px`,
        height: `${caret.height}px`,
      }
      const span = spanOf(at)
      codeSelectionBoxes.value = textareaSelection(el, span.from, span.to).map((r) => ({
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      }))
    }
    // The bar belongs to whichever box owns the selection: a menu over a
    // projection would act on a stretch the user picked somewhere else.
    const span = spanOf(at)
    const last = projecting.value || isCollapsed(at)
      ? undefined
      : textareaSelection(el, span.from, span.to).at(-1)
    barAt.value =
      last === undefined
        ? null
        : { left: `${last.x}px`, top: `${last.y + last.height + BAR_GAP_PX}px` }
  },
  { flush: 'post', immediate: true },
)

/** The object being typed into, for what the bar has to offer about it. */
const editingBlock = computed(() => {
  const at = markup.editing.value
  return at === null ? null : (project.blockById(at.pageId, at.labelId) ?? null)
})

const editingColor = computed(() => editingBlock.value?.body.style.color ?? '#000000')

const editingIsVertical = computed(() => editingBlock.value?.body.style.direction === 'vertical')
</script>

<style scoped>
/*
 * The field grows with the text instead of scrolling inside a fixed box: a
 * line the writer cannot see is a line they cannot check.
 */
.code-input {
  field-sizing: content;
}

/*
 * The code's own caret and selection, drawn rather than native: while the
 * keyboard is on the canvas this box is not focused, and an unfocused control
 * draws neither. They stand over the text in the same box, measured off a copy
 * of it, so what they mark is the string the field is showing.
 */
.code-caret,
.code-selection {
  position: absolute;
  pointer-events: none;
}
.code-caret {
  width: 2px;
  background: var(--primary);
  animation: code-caret-blink 1.1s steps(1) infinite;
}
.code-selection {
  background: var(--primary);
  opacity: 0.25;
}
@keyframes code-caret-blink {
  50% {
    opacity: 0;
  }
}
</style>
