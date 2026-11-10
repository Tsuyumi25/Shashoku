<template>
  <div
    tabindex="0"
    :data-row-id="rowId(row)"
    class="row-content flex min-w-0 items-start gap-1.5 border-b border-border/40 py-1 pr-2 pl-1.5 focus:ring-1 focus:ring-inset focus:ring-primary focus:outline-none"
    :class="tone"
    :style="indent"
    @mousedown="onDown"
    @dblclick="open"
    @contextmenu.prevent="emit('menu', $event)"
    @keydown="onKeys"
  >
    <!--
      Unlike visibility, a lock is worth showing on a flat list: it says this
      row will refuse, which is otherwise only discoverable by trying to type
      into it. Where the lock was put on is the tree's to answer.
    -->
    <Lock v-if="locked" :size="11" class="mt-1 shrink-0 text-muted-foreground/60" aria-label="已鎖定" />

    <!--
      ⭐ A block of a split translation is a row like any other — same rule, same
      padding, same type. What tells it apart is one step of indent and its
      permanent name. A sentence row wears its own number the same way: the names
      an agent writes are the ones on screen.
    -->
    <span
      v-if="row.kind === 'block'"
      class="shrink-0 text-sm leading-snug text-muted-foreground/60 tabular-nums"
      >{{ row.label }}</span
    >
    <span v-else class="shrink-0 text-sm leading-snug text-muted-foreground/60 tabular-nums"
      >{{ row.no }}</span
    >

    <!--
      The translation keeps the full width and what the object means goes
      underneath it. A tag is a string of the user's own length, and a column
      that shared a line with one would give the row's whole point away to a
      name.
    -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!--
        ⭐ The side being worked on is the row's main line, and the other is the
        footnote above it — so switching sides swaps which body is underneath,
        not merely which one takes the caret. A row whose translation stayed on
        the bottom would go on saying the translation is the point while every
        keystroke went into the source.

        A dash rather than nothing when the line above says nothing, so every
        row keeps the same two-line rhythm and an empty body is visible instead
        of merely absent.
      -->
      <span
        v-if="row.kind === 'label'"
        class="text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground"
        :class="!row.opposite && 'opacity-50'"
      >{{ row.opposite || '—' }}</span>

      <CodeEditField
        v-if="editing"
        class="text-sm"
        :value="code"
        :placeholder="blankLabel"
        @key="emit('inputKey', $event)"
        @blur="onBlur"
      />

      <!--
        ⭐ A translation set in several blocks draws none of it here: the block
        rows below say the whole of it, and saying it twice would cost the row a
        line of height for a line nobody needs.
      -->
      <pre
        v-if="showsReading"
        class="reading text-sm leading-snug whitespace-pre-wrap"
        :class="blank && 'text-muted-foreground/50'"
      >{{ preview }}<br v-if="endsOnABreak" /></pre>

      <div
        v-if="tags.length > 0"
        class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground"
      >
        <span v-for="tag in tags" :key="tag" class="flex min-w-0 items-center gap-1">
          <span
            class="h-1.5 w-1.5 shrink-0 rounded-full"
            :style="{ backgroundColor: tagColor(tag, project.header.tags) }"
          />
          <span class="min-w-0 truncate">{{ tag }}</span>
        </span>
      </div>
    </div>

    <LabelTagPicker v-if="row.kind === 'label'" :row="row" :disabled="locked" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Lock } from '@lucide/vue'
import CodeEditField from '@/components/CodeEditField.vue'
import LabelTagPicker from '@/components/labelList/LabelTagPicker.vue'
import { rowId, rowSelected, type ListRow } from '@/lib/labelRows'
import { tagColor, tagsInRegistryOrder } from '@shared/tags/set'
import { shownCodeOf } from '@shared/page/units'
import { ownsKeyboard } from '@/lib/typingSurface'
import { textWriter } from '@/composables/useTextEditSurface'
import { useMarkupSession } from '@/composables/useMarkupSession'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * One row of the label list, drawn apart from the list.
 *
 * Everything that changes from keystroke to keystroke — whether the row is
 * selected, whether it is the one being typed into, what the box is showing —
 * is read here rather than in the list above. A list that read them would redraw
 * every row of the chapter each time the caret moved one row on.
 */
const props = defineProps<{
  row: ListRow
  /** Its own lock or a folder's above it, which this list has no way to tell apart. */
  locked: boolean
  filtering: boolean
}>()

const emit = defineEmits<{ pick: [MouseEvent]; menu: [MouseEvent]; inputKey: [KeyboardEvent] }>()

const project = useProjectStore()
const editor = useEditorStore()
const markup = useMarkupSession()

/**
 * The one block a row is typed into. A translation set in several is typed into
 * one block at a time, on the rows below — there is no caret that spans them,
 * and pretending otherwise would be a box writing into somewhere it is not.
 */
const typedBlock = computed(() => {
  const row = props.row
  if (row.kind === 'block') return row.block.id
  return row.blocks.length === 1 ? row.blocks[0].id : null
})

/**
 * A row is being typed into when the editing session names it. There is no
 * second flag for "this row is in the input layer" — the session is that state,
 * and holding it in two places is how the two drift apart.
 */
const editing = computed(() => {
  const pending = editor.pendingTextEdit
  const block = typedBlock.value
  return block !== null && pending?.pageId === props.row.pageId && pending.labelId === block
})

const selected = computed(() => rowSelected(props.row, editor.selectedIds))

const tone = computed(() => {
  const row = props.row
  const free = row.kind === 'block' || row.lane === undefined
  return [
    selected.value ? 'bg-accent/50' : 'hover:bg-secondary/40',
    !editing.value && 'select-none',
    row.kind === 'label' && row.lane !== undefined && 'rail-held',
    !editing.value && !props.filtering && free && 'cursor-grab',
  ]
})

/**
 * One step in for a block, so the column of them reads as belonging above.
 *
 * A branch is set in from the reading it hangs off by the same step, and no
 * deeper however many lanes the rail needs. The lanes past the first are room
 * for branches that are alive at the same time, not another level of nesting,
 * so indenting per lane would say a depth that is not there.
 */
const indent = computed(() => {
  const row = props.row
  const stepped = row.kind === 'block' || (row.lane !== undefined && row.lane > 0)
  return stepped ? { paddingLeft: '1.5rem' } : undefined
})

/**
 * The stored string of the block this row is typed into. Read off the page
 * rather than off the row: a row of a split translation carries every block
 * joined, and the box writes into one of them.
 */
const code = computed(() => {
  const block = typedBlock.value
  const entry = block === null ? undefined : project.blockById(props.row.pageId, block)
  return entry === undefined ? '' : shownCodeOf(entry)
})

const blankLabel = computed(() => (editor.textSide === 'source' ? '(沒有原文)' : '(未翻譯)'))

/**
 * Whether the main line says nothing at all — which on the translation side is
 * not the same as having typed nothing into it, so it reads the projection
 * rather than any one block's own words.
 */
const blank = computed(() =>
  props.row.kind === 'block' ? props.row.text.length === 0 : props.row.main.length === 0,
)

const preview = computed(() => {
  const row = props.row
  if (row.kind === 'block') return row.text
  return blank.value ? blankLabel.value : row.main
})

/**
 * A last line with nothing on it is not a line box — CSS treats one that holds
 * no content and does not itself end in a break as not existing at all. So a
 * translation the typesetter ended on a break would stand a line shorter here
 * than the engine draws it, and copy a line shorter than the object reads.
 *
 * A `<br>` is what puts that boundary back, and it is only ever asked for when
 * the text really does end on one, so it never claims a break that was not
 * typed. Blink builds DOM out of plain text the same way.
 */
const endsOnABreak = computed(() => preview.value.endsWith('\n'))

const showsReading = computed(() => {
  const row = props.row
  return !editing.value && (row.kind === 'block' || row.blocks.length < 2)
})

const tags = computed(() =>
  props.row.kind === 'label' ? tagsInRegistryOrder(props.row.tags, project.header.tags) : [],
)

function onDown(e: MouseEvent) {
  // The right button's pick is the menu's: picking here scrolls the row into
  // place before the menu opens, and the menu then opens on whatever slid under.
  if (editing.value || e.button === 2) return
  emit('pick', e)
}

/**
 * Opened from the list, so the list takes the keyboard. Which box is writing
 * follows from where the work was started, which is the one thing that says
 * where the user is looking.
 */
function open() {
  const block = typedBlock.value
  if (block === null) return
  editor.revealLabel(props.row.pageId, block)
  editor.beginTextEdit(props.row.pageId, block, code.value)
  textWriter.value = 'code'
}

/**
 * The keys a row answers to itself. Everything else — moving between rows,
 * deleting, turning the page — acts on the document and is handled once, above.
 */
function onKeys(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  // The box is a descendant of the row, so every key typed into it bubbles
  // through here on its way out. Enter would be taken for "open the editor" and
  // never reach the text as a newline; `i` would never be typed at all.
  if (ownsKeyboard(document.activeElement)) return
  if (e.key !== 'Enter' && e.key !== 'i') return
  // Opening the input layer is a single-object act. Rather than quietly
  // throwing away a selection someone built on purpose, it declines.
  if (editor.selectedIds.size > 1) return
  e.preventDefault()
  open()
}

/**
 * A blur ends the visit only while the visit is still this row's, and only
 * when the keyboard really left: the canvas's box and the bar over the
 * selection are the same edit.
 *
 * Carrying the caret to the next row closes this session and opens that one,
 * which unmounts this input — and unmounting something focused blurs it. Left
 * unguarded, that blur would close the session just opened for the row being
 * moved to, and the caret would arrive with nothing to type into.
 */
function onBlur(e: FocusEvent) {
  if (!editing.value) return
  if (markup.keepsSession(e.relatedTarget)) return
  editor.commitTextEdit()
}
</script>

<style scoped>
.row-content {
  grid-column: 3;
}

/*
 * `<pre>`, because where a translation breaks is a decision the typesetter made
 * and the element for structure carried by the breaks themselves rather than by
 * markup is this one. Its monospace stack is not part of that and is handed
 * back to the panel.
 */
.reading {
  font-family: inherit;
  font-feature-settings: inherit;
  font-variation-settings: inherit;
}
</style>
