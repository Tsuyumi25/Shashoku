import { watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { logActivity, setActivityLogging } from '@/lib/activityLog'
import { isTypingSurface } from '@/lib/typingSurface'
import { useValuePicker } from '@/composables/useValuePicker'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useUiStore } from '@/stores/uiStore'

/** Held alone these are half a key; the key they go with is the one logged. */
const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

/** How much of a control's own words names it in the log. */
const NAME_CHARS = 40

/**
 * What a press landed on, in the words the interface shows for it: a button's
 * title or text, a field's label. The page is named by region, since its own
 * elements are drawing rather than controls.
 */
function describe(target: EventTarget | null): Record<string, unknown> {
  if (!(target instanceof Element)) return {}
  if (target.closest('[data-region="canvas"]') && !target.closest('[data-markup-toolbar], button'))
    return { on: 'canvas' }
  const control = target.closest('button, a, input, select, textarea, label, [role="button"], [role="tab"]')
  if (control === null) return { on: target.tagName.toLowerCase() }
  const name =
    control.getAttribute('title') ||
    control.getAttribute('aria-label') ||
    control.getAttribute('placeholder') ||
    control.textContent?.trim().replace(/\s+/g, ' ') ||
    ''
  return { on: control.tagName.toLowerCase(), name: name.slice(0, NAME_CHARS) }
}

function comboOf(e: KeyboardEvent): string {
  const mods = [e.ctrlKey && 'Ctrl', e.metaKey && 'Meta', e.altKey && 'Alt', e.shiftKey && 'Shift']
  return [...mods.filter(Boolean), e.key].join('+')
}

/**
 * Two layers. The first is every key and press, read on the way down so
 * nothing the app stops can hide it — what makes the log whole. The second is
 * what those came to: a step taken, a tool, a selection, a page — what makes it
 * readable. History steps are logged where they are taken, in the editor store.
 */
export function useActivityLog(): void {
  const preferences = usePreferencesStore()
  const editor = useEditorStore()
  const ui = useUiStore()
  const valuePicker = useValuePicker()

  watch(
    () => preferences.prefs.activityLog,
    (on) => {
      setActivityLogging(on)
      if (on) logActivity('session', { view: ui.view })
    },
    { immediate: true },
  )

  // Space held is the view being moved, which is left out along with what it drags.
  let panning = false
  useEventListener(window, 'keyup', (e: KeyboardEvent) => {
    if (e.key === ' ') panning = false
  })

  useEventListener(
    window,
    'keydown',
    (e: KeyboardEvent) => {
      if (e.repeat || MODIFIERS.has(e.key)) return
      // Typing is logged as the words it came to, not key by key.
      const bare = !e.ctrlKey && !e.metaKey && !e.altKey
      if (bare && isTypingSurface(document.activeElement) && e.key.length === 1) return
      if (bare && e.key === ' ') {
        panning = true
        return
      }
      logActivity('key', { combo: comboOf(e), ...describe(document.activeElement) })
    },
    { capture: true },
  )

  useEventListener(
    window,
    'pointerdown',
    (e: PointerEvent) => {
      if (panning || e.button === 1) return
      logActivity('press', {
        button: e.button,
        shift: e.shiftKey || undefined,
        alt: e.altKey || undefined,
        ctrl: e.ctrlKey || undefined,
        ...describe(e.target),
      })
    },
    { capture: true },
  )

  useEventListener(
    window,
    'dblclick',
    (e: MouseEvent) => logActivity('dblclick', describe(e.target)),
    { capture: true },
  )

  watch(() => ui.view, (view) => logActivity('view', { view }))
  watch(() => ui.settingsOpen, (open) => logActivity('settings', { open }))
  watch(() => editor.currentPageId, (page) => logActivity('page', { page }))
  watch(() => editor.tool, (tool) => logActivity('tool', { tool }))
  watch(
    () => [...editor.selectedIds].sort().join(','),
    (ids) => {
      const list = ids === '' ? [] : ids.split(',')
      logActivity('select', { n: list.length, ids: list })
    },
  )
  watch(valuePicker.shown, (which) => logActivity('values', { which }))
  watch(
    () => editor.pendingTextEdit?.labelId ?? null,
    (id, was) => {
      if (was) logActivity('edit-end', { id: was })
      if (id) logActivity('edit-start', { id })
    },
  )

  // Which preferences moved, and to what, read off the serialized form so the
  // comparison is the one the file itself would show.
  let held = JSON.parse(JSON.stringify(preferences.prefs)) as Record<string, unknown>
  watch(
    () => preferences.prefs,
    (now) => {
      const next = JSON.parse(JSON.stringify(now)) as Record<string, unknown>
      for (const key of Object.keys(next)) {
        if (key === 'panelLayout' || key === 'activityLog') continue
        if (JSON.stringify(next[key]) !== JSON.stringify(held[key])) {
          logActivity('pref', { key, value: next[key] })
        }
      }
      held = next
    },
    { deep: true },
  )
}
