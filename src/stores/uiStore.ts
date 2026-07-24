import { ref } from "vue";
import { defineStore } from "pinia";

export type AppView = "translate" | "project-manager";

export const useUiStore = defineStore("ui", () => {
  const view = ref<AppView>("project-manager");

  function setView(v: AppView) {
    view.value = v;
  }

  return { view, setView };
});
