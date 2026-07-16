// vuedraggable@4 未附 TS 型別,補最小 shim。
declare module "vuedraggable" {
  import type { DefineComponent } from "vue";
  const draggable: DefineComponent<
    Record<string, unknown>,
    Record<string, unknown>,
    unknown
  >;
  export default draggable;
}
