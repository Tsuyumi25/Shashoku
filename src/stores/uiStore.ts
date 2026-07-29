import { ref } from "vue";
import { defineStore } from "pinia";

export type AppView = "translate" | "project-manager";

/**
 * The two ways of looking at the same objects. One slot rather than two panels:
 * they answer different questions at different scales — the list reads the
 * chapter, the tree stacks the page — and nobody needs both answers at once.
 */
export type WorkbenchPanel = "labels" | "layers";

export const useUiStore = defineStore("ui", () => {
  const view = ref<AppView>("project-manager");
  const panel = ref<WorkbenchPanel>("labels");

  function setView(v: AppView) {
    view.value = v;
  }

  function togglePanel() {
    panel.value = panel.value === "labels" ? "layers" : "labels";
  }

  return { view, setView, panel, togglePanel };
});
