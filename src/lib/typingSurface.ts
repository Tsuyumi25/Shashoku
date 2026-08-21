/**
 * Whether the caret is somewhere that owns its own text, and therefore owns the
 * keys that act on text.
 */
export function isTypingSurface(el: Element | null): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable;
}

/**
 * Whether the focused element answers a bare keypress itself, so the
 * application has to leave that key alone. A typing surface owns its text; a
 * native select owns the arrow keys that walk its options.
 *
 * Only for unmodified keys. A modifier combination is the application's
 * whatever has focus — Ctrl+S saves mid-sentence — so those ask
 * isTypingSurface directly and only where the caret's own history is at stake.
 */
export function ownsKeyboard(el: Element | null): boolean {
  return isTypingSurface(el) || el instanceof HTMLSelectElement;
}
