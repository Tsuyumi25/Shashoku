import { ref } from "vue";
import { defineStore } from "pinia";

/**
 * Every view is reachable at any time — one opened without a project simply
 * stands empty and says so. A session starts in the library because that is
 * where the first double-click happens, not because the library is above the
 * others.
 */
export type AppView = "library" | "editor" | "pages" | "export";

export const useUiStore = defineStore("ui", () => {
  const view = ref<AppView>("library");

  function setView(v: AppView) {
    view.value = v;
  }

  /**
   * A floating panel over whatever view is up, not a fifth view: the views
   * are places to work, and settings is a form filled out and left. Where you
   * were stays under it, untouched.
   */
  const settingsOpen = ref(false);

  return { view, setView, settingsOpen };
});
