import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { usePreferencesStore } from "./stores/preferencesStore";
import "./index.css";

const app = createApp(App).use(createPinia());

// Panel geometry has to be on hand before the first render, so preferences are
// loaded before mounting rather than in a component.
await usePreferencesStore().hydrate();

app.mount("#app");
