import { ref } from 'vue'

/** Where the font library's sidebar stands: a built-in list, or one of the user's groups. */
export type FontLibrarySection =
  | { kind: 'all' }
  | { kind: 'fav' }
  | { kind: 'used' }
  | { kind: 'group'; id: string }

/** Module-level so the sidebar and the list, mounted in different panels, read one place. */
const section = ref<FontLibrarySection>({ kind: 'all' })

export function useFontLibrary() {
  return { section }
}
