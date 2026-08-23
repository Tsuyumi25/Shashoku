/**
 * What a control says when the selection has no single answer. One string, so
 * two panels cannot word the same state differently; it moves to the message
 * catalogue once there is one.
 */
export const MIXED_TEXT = '多個值'

/**
 * How far a change is about to reach, in words.
 *
 * Shown before anyone touches a control rather than after: a selection crosses
 * pages and most of it may be somewhere nobody can see, so a panel about to
 * change forty objects on six pages has to say so first.
 */
export function scopeText(scope: { objects: number; pages: number }): string {
  if (scope.objects === 1) return '1 個物件'
  return scope.pages > 1 ? `${scope.objects} 個物件、${scope.pages} 頁` : `${scope.objects} 個物件`
}
