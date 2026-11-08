/**
 * Calls back once an element comes within a screenful of the view, then stops
 * watching it. One observer for every element, since a chapter's shelf asks
 * this of four hundred at once.
 */
const callbacks = new WeakMap<Element, () => void>()
let observer: IntersectionObserver | null = null

function observerFor(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const seen = callbacks.get(entry.target)
        callbacks.delete(entry.target)
        observer!.unobserve(entry.target)
        seen?.()
      }
    },
    { rootMargin: '100% 0px' },
  )
  return observer
}

export function whenSeen(el: Element, seen: () => void): () => void {
  callbacks.set(el, seen)
  observerFor().observe(el)
  return () => {
    callbacks.delete(el)
    observer?.unobserve(el)
  }
}
