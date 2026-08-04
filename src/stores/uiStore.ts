import { ref } from "vue";
import { defineStore } from "pinia";

export type AppView = "translate" | "project-manager";

/**
 * The ways of looking at the same objects. One slot rather than three panels:
 * each answers a different question at a different scale — the list reads the
 * chapter, the tree stacks the page, the buckets gather objects by what they
 * mean and ask whether they still look alike — and nobody needs two answers at
 * once.
 *
 * Chosen rather than cycled. A flip between two was a shortcut worth having;
 * with a third it becomes a guess about which one comes next.
 */
export type WorkbenchPanel = "labels" | "layers" | "buckets";

export const useUiStore = defineStore("ui", () => {
  const view = ref<AppView>("project-manager");
  const panel = ref<WorkbenchPanel>("labels");

  function setView(v: AppView) {
    view.value = v;
  }

  function setPanel(p: WorkbenchPanel) {
    panel.value = p;
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
    panel,
    setPanel,
    reviewedBuckets,
    toggleReviewed,
    clearReviewed,
  };
});
