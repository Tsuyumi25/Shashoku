/**
 * Detected rather than assumed: where EditContext is missing the feature has to
 * degrade to nothing at all, since a sample is a bitmap with no DOM text to put
 * a caret in. The shared input above the grid stays the complete editing path.
 */
export const canEditInCell = "EditContext" in window;
