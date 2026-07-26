/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

// electron-vite hands the renderer only the RENDERER_VITE_ and VITE_ prefixes,
// so a variable meant for this side has to carry one of them in its name.
interface ImportMetaEnv {
  /** Absolute path to a project root to open on start. Dev builds only. */
  readonly RENDERER_VITE_DEV_PROJECT?: string;
}
