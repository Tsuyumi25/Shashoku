import { computed, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import type { TextLayerEntry } from '@shared/page/types'
import type { TextStyle } from '@shared/text-style/types'
import { TEXT_STYLE_FIELDS } from '@shared/text-style/schema'
import { sharedValue } from '@shared/batch/value'
import { sameTagSet, tagsInRegistryOrder } from '@shared/tags/set'
import { bucketObjectsOf, type BucketObject } from '@/lib/valueBuckets'
import { recommendStyle, type StyleCandidate } from '@/lib/styleRecommendation'
import type { AppearanceTarget } from '@/lib/appearance'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * The three states `sharedValue` already draws everywhere else, asked of the
 * tags. A selection that disagrees gets no recommendation at all: every value
 * offered here is a click away, so guessing which meaning was meant would not
 * turn one field into a trap but a whole column of them.
 */
export type TagState = { kind: 'none' } | { kind: 'many' } | { kind: 'one'; value: string[] }

/** What one field's control has to offer under it, and what to mark. */
export interface StyleSuggestionSet {
  /**
   * The meaning the counts were taken under, so a candidate that came from a
   * shorter station can say which one.
   */
  tags: readonly string[]
  byField: ReadonlyMap<keyof TextStyle, readonly StyleCandidate[]>
  /**
   * What the selection holds now, as JSON per field, absent where the selection
   * disagrees. A freshly tagged object sits on the head of its rows, so from
   * then on the mark shows how far it has drifted from its kind — while the
   * work is happening, rather than at some later audit.
   */
  current: ReadonlyMap<keyof TextStyle, string>
}

/**
 * The project's own statistics, offered under the very controls that set the
 * same fields — the prescription beside the instrument rather than in a panel
 * of its own, so reading what the kind looks like and departing from it are one
 * gesture.
 *
 * ⚠️ Only the fields the recommender has rows for appear in `byField`. The
 * weight walk has none: a face travels with its family, so the font row's
 * candidates already carry it.
 *
 * ⭐ Counted on the body being worked on, and the source has no pool — so under
 * the source tool the strips draw nothing at all, which is the true answer. The
 * panel used to show the translation's statistics beside the source's controls
 * and mark the source's values against them: three things pointing at two
 * different bodies.
 */
export function useStyleRecommendations(
  targets: Ref<readonly AppearanceTarget<TextLayerEntry>[]>,
): { tagState: ComputedRef<TagState>; suggestions: ComputedRef<StyleSuggestionSet | null> } {
  const project = useProjectStore()
  const editor = useEditorStore()

  const styles = computed(() => targets.value.map((t) => t.entry.body.style))

  /**
   * ⭐ Read one level up, from the translations the selected blocks belong to. A
   * sound set in two blocks means one thing, so two blocks of it agreeing is
   * not two votes for that meaning — it is the same fact seen twice.
   */
  const tagState = computed<TagState>(() => {
    const first = targets.value[0]
    if (!first) return { kind: 'none' }
    const tagsOf = (id: string) => project.placeOf(editor.currentPageId ?? '', id)?.unit.tags ?? []
    const head = tagsOf(first.entry.id)
    for (const { entry } of targets.value) {
      if (!sameTagSet(tagsOf(entry.id), head)) return { kind: 'many' }
    }
    return { kind: 'one', value: tagsInRegistryOrder(head, project.header.tags) }
  })

  /**
   * The family every row but the font one is narrowed by. A selection that
   * disagrees narrows by nothing, the same answer as a selection that has not
   * been given a font — there is no single face for the other fields to depend
   * on either way.
   */
  const fontFamily = computed(() => {
    const shared = sharedValue(styles.value, 'fontFamily')
    return shared.kind === 'one' ? shared.value : ''
  })

  /**
   * When the sample is taken again: the selection changed, or what it means did.
   * Deliberately not when a style changed.
   *
   * An object votes in the statistics it is being shown, so counting live would
   * move the candidate out from under the cursor the moment it was clicked — the
   * value just applied joins a different bucket, and a batch of forty turns the
   * row over completely. Holding the sample still means only the mark moves.
   *
   * It is also what keeps drift readable. Counted live, a colour applied to forty
   * objects becomes the largest bucket and takes the head of its row, so the
   * candidates would confirm whatever was just done instead of showing it as a
   * departure from the kind — which is the one thing they are here to make
   * visible.
   *
   * The meaning changing must retake it: tagging writes a style, and the head of
   * every row is only that style because the object is counted holding it.
   */
  const sampleKey = computed(() => {
    if (tagState.value.kind !== 'one') return ''
    const ids = targets.value.map((t) => t.entry.id).sort()
    // ⚠️ The side is part of it. What the two bodies of one object look like are
    // two different statistics, and a sample held over a switch would mark the
    // panel's values against the other body's counts.
    return JSON.stringify([editor.textSide, tagState.value.value, ids])
  })

  /**
   * Styles copied rather than referenced — `bucketObjectsOf` hands back the
   * labels' own style objects, so holding the array alone would go on watching
   * the very edits this is here to sit still through.
   */
  const sample = shallowRef<BucketObject[]>([])

  watch(
    sampleKey,
    () => {
      sample.value = project.files.flatMap((file) =>
        bucketObjectsOf(file.pageId, file.page, editor.textSide).map((object) => ({
          ...object,
          tags: [...object.tags],
          style: { ...object.style },
        })),
      )
    },
    { immediate: true },
  )

  /**
   * The family is read live while the sample is not, so choosing a font renarrows
   * every row below it — that is what the narrowing is for — without disturbing
   * the font row, which nothing narrows.
   *
   * ⚠️ One edge: a font set from the picker that no object in the sample uses
   * narrows the rows below to nothing until the selection moves. A control with
   * nothing under it is true when it happens, but it costs the guarantee that
   * every row can offer something, which used to hold because an object always
   * matched its own filter.
   */
  const suggestions = computed<StyleSuggestionSet | null>(() => {
    const tags = tagState.value
    if (tags.kind !== 'one') return null

    const byField = new Map<keyof TextStyle, readonly StyleCandidate[]>()
    for (const row of recommendStyle(sample.value, tags.value, project.header.tags, fontFamily.value))
      byField.set(row.field, row.candidates)

    const current = new Map<keyof TextStyle, string>()
    for (const field of TEXT_STYLE_FIELDS) {
      const shared = sharedValue(styles.value, field)
      if (shared.kind === 'one') current.set(field, JSON.stringify(shared.value))
    }

    return { tags: tags.value, byField, current }
  })

  return { tagState, suggestions }
}
