import { createApp } from "vue";
import { createPinia } from "pinia";
import Toast, { POSITION, type PluginOptions } from "vue-toastification";
import App from "./App.vue";
import { usePreferencesStore } from "./stores/preferencesStore";
import "vue-toastification/dist/index.css";
import "./index.css";

/**
 * Bottom centre, over nothing: an outcome that appeared under the button that
 * produced it would move that button out from under the pointer at the moment
 * someone might press it again. The bottom edge is the one strip of this
 * window that holds no control, and the middle of it is where a message is
 * seen from either side of a three-column workbench.
 */
const toastOptions: PluginOptions = {
  position: POSITION.BOTTOM_CENTER,
  // Flicking a notification away is a phone's gesture. Here it only costs: the
  // drag handler follows the pointer from mousedown, so a click that shifts by
  // a pixel leaves an inline "ease back to centre" transform that runs
  // alongside the dismissal, and the toast slides sideways on its way out.
  draggable: false,
  // Nothing here is worth a second row of the same sentence.
  filterBeforeCreate: (toast, toasts) =>
    toasts.some((t) => t.content === toast.content) ? false : toast,
  showCloseButtonOnHover: true,
  hideProgressBar: true,
};

const app = createApp(App).use(createPinia()).use(Toast, toastOptions);

// Panel geometry has to be on hand before the first render, so preferences are
// loaded before mounting rather than in a component.
await usePreferencesStore().hydrate();

app.mount("#app");
