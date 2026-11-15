import { computed, ref } from "vue";
import { defineStore } from "pinia";

/**
 * Every view is reachable at any time — one opened without a project simply
 * stands empty and says so. A session starts in the library because that is
 * where the first double-click happens, not because the library is above the
 * others.
 */
export type AppView = "library" | "fonts" | "book" | "editor" | "export";

export const useUiStore = defineStore("ui", () => {
  const view = ref<AppView>("library");

  function setView(v: AppView) {
    view.value = v;
  }

  /**
   * A floating panel over whatever view is up, not one more view: the views
   * are places to work, and settings is a form filled out and left. Where you
   * were stays under it, untouched.
   */
  const settingsOpen = ref(false);
  const pageManagerOpen = ref(false);
  const newProjectOpen = ref(false);
  const newProjectSource = ref<string | null>(null);
  /** The 收藏夾 the new project goes into once it is made. */
  const newProjectFavorite = ref<string | null>(null);
  const panelOpen = computed(
    () => settingsOpen.value || pageManagerOpen.value || newProjectOpen.value,
  );

  function openNewProject(source: string | null = null, favorite: string | null = null) {
    newProjectSource.value = source;
    newProjectFavorite.value = favorite;
    newProjectOpen.value = true;
  }

  return {
    view,
    setView,
    settingsOpen,
    pageManagerOpen,
    newProjectOpen,
    newProjectSource,
    newProjectFavorite,
    openNewProject,
    panelOpen,
  };
});
