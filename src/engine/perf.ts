/** 量一段同步操作的毫秒數(performance.now,renderer 端可用)。 */
export function timeMs(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}
