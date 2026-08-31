export interface ShelfKeyModifiers {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export type ShelfKeyAction =
  | { type: 'chooseAll' }
  | { type: 'clear' }
  | { type: 'walk'; across: number; down: number; extend: boolean }
  | { type: 'activate' }

/**
 * Escape always lands, since clearing is the same act regardless of where the
 * keyboard sits. Everything else stands down once a workspace row holds
 * focus: that row already answers its own arrows and Enter, and Ctrl+A has
 * nothing to land on there — the left column is a place to walk through, not
 * a focusable region with a band of its own.
 */
export function routeShelfKey(
  e: ShelfKeyModifiers,
  workspaceRowFocused: boolean,
): ShelfKeyAction | null {
  if (e.key === 'Escape') return { type: 'clear' }
  if (workspaceRowFocused) return null

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') return { type: 'chooseAll' }
  if (e.ctrlKey || e.metaKey || e.altKey) return null

  switch (e.key) {
    case 'ArrowLeft':
      return { type: 'walk', across: -1, down: 0, extend: e.shiftKey }
    case 'ArrowRight':
      return { type: 'walk', across: 1, down: 0, extend: e.shiftKey }
    case 'ArrowUp':
      return { type: 'walk', across: 0, down: -1, extend: e.shiftKey }
    case 'ArrowDown':
      return { type: 'walk', across: 0, down: 1, extend: e.shiftKey }
    case 'Enter':
      return { type: 'activate' }
    default:
      return null
  }
}
