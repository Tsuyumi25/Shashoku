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

  return { view, setView };
});
