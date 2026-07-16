import type { RasterLayer } from "@/engine/types";
import type { EditorCtx } from "../types";

export type LayerPropPatch = Partial<
  Pick<RasterLayer, "visible" | "opacity" | "blendMode" | "locked" | "alphaLocked">
>;

const LABELS: Record<keyof LayerPropPatch, string> = {
  visible: "切換可見性",
  opacity: "調整不透明度",
  blendMode: "變更混合模式",
  locked: "切換鎖定",
  alphaLocked: "切換透明鎖定",
};

/**
 * 改圖層屬性(可見性/不透明度/混合模式/鎖定)。同層同組鍵的連續變更
 * (opacity 滑桿拖曳)在合併窗內收成一步。
 */
export function setLayerProps(ctx: EditorCtx, layerId: string, patch: LayerPropPatch): boolean {
  const { doc, history } = ctx;
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer) return false;

  const keys = (Object.keys(patch) as (keyof LayerPropPatch)[]).filter(
    (k) => patch[k] !== undefined && layer[k] !== patch[k],
  );
  if (keys.length === 0) return false;

  const prev: LayerPropPatch = {};
  for (const k of keys) {
    setProp(prev, k, layer[k]);
    setProp(layer, k, patch[k]!);
  }
  ctx.changed();

  history.push({
    label: LABELS[keys[0]],
    mergeKey: `props:${layerId}:${keys.join(",")}`,
    undo: () => {
      Object.assign(layer, prev);
      ctx.changed();
    },
    redo: () => {
      for (const k of keys) setProp(layer, k, patch[k]!);
      ctx.changed();
    },
  });
  return true;
}

/** 型別安全的單鍵指派(RasterLayer 與 patch 物件共用)。 */
function setProp<K extends keyof LayerPropPatch>(
  target: LayerPropPatch | RasterLayer,
  key: K,
  value: RasterLayer[K],
): void {
  (target as LayerPropPatch)[key] = value;
}
