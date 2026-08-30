/**
 * How hard a pointer is pressing, for the two brushes that ask.
 *
 * The Pointer Events spec has a device with no pressure of its own report
 * `0.5` while a button is held, which is a placeholder rather than a reading:
 * taken at face value it draws every mouse stroke at half the size it was set
 * to. Only a pen's own report is read, and the sampler is where an absent or
 * out-of-range one falls back to the last valid pressure.
 */
export function pressureFrom(e: PointerEvent): number {
  return e.pointerType === 'pen' ? e.pressure : 1
}
