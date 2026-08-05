import { ref } from "vue";
import { defineStore } from "pinia";

export type AppView = "translate" | "project-manager";

export const useUiStore = defineStore("ui", () => {
  const view = ref<AppView>("project-manager");

  function setView(v: AppView) {
    view.value = v;
  }

  /**
   * Buckets the reader has looked at and decided are fine as they are.
   *
   * Deliberately not in the document. It is a note about a pass someone is
   * making, not a fact about the pages — and a bucket's identity is the values
   * its members hold, so the moment one of them is restyled the bucket it was
   * marked as is gone. Handing that to a project file would mean shipping
   * verdicts about buckets nobody can find any more.
   */
  const reviewedBuckets = ref<Set<string>>(new Set());

  function toggleReviewed(key: string) {
    const next = new Set(reviewedBuckets.value);
    if (!next.delete(key)) next.add(key);
    reviewedBuckets.value = next;
  }

  function clearReviewed() {
    reviewedBuckets.value = new Set();
  }

  return {
    view,
    setView,
    reviewedBuckets,
    toggleReviewed,
    clearReviewed,
  };
});
