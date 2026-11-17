/** The floating effects panel's width, in CSS pixels. */
export const EFFECTS_PANEL_WIDTH = 288

/**
 * Where the panel opens the first time, before it has been dragged anywhere:
 * near the top right, clear of the sidebar it is opened from.
 */
export function firstEffectsPanelPlace(windowWidth: number): { x: number; y: number } {
  return { x: Math.max(0, windowWidth - EFFECTS_PANEL_WIDTH - 360), y: 96 }
}
